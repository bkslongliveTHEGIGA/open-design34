// Electron-coupled half of the Hermes integration.
//
// `./hermes/` is deliberately electron-free (and its test suite asserts that);
// this module is the only place that touches `electron`, the real filesystem and
// the real network, and it wires them into the pure bridge — the same split this
// repository already uses for `invite-deeplink-core.ts` / `invite-deeplink.ts`.
//
// Importing this module must stay side-effect-safe outside Electron, because
// `index.ts` re-exports pure helpers that unit tests import directly, and in a
// plain Node process the `electron` entry resolves to a shim with no `app`.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { app, ipcMain, type WebContents } from "electron";

import {
  HERMES_ACTION_NAMESPACE,
  HERMES_BRIDGE_POLL_INTERVAL_MS,
  HERMES_FLOATING_CONTROLS,
  buildHermesCodeHandoff,
  toHermesArtifactDescriptor,
  HERMES_DESIGN_STUDIO_PRODUCT_NAME,
  createHermesBridge,
  createHermesActionRegistry,
  createHermesDeepLinkDispatcher,
  findHermesDeepLinkArg,
  parseHermesDeepLink,
  planHermesProtocolClientRegistration,
  redactHermesContext,
  type HermesBridge,
  type HermesDeepLink,
  type HermesPathFs,
  type HermesSharedContext,
} from "./hermes/index.js";

/** IPC channel names. Prefixed so they cannot collide with existing desktop IPC. */
export const HERMES_IPC = Object.freeze({
  /** Renderer → main: the current bridge snapshot (redacted). */
  getState: "hermes:get-state",
  /** Renderer → main: ask the bridge to re-run discovery now. */
  reconnect: "hermes:reconnect",
  /** Renderer → main: dispatch a `designStudio.*` action. */
  invokeAction: "hermes:invoke-action",
  /** Renderer → main: the capability manifest (action, risk, availability). */
  capabilities: "hermes:capabilities",
  /** Renderer → main: report the renderer's current task state. */
  setTaskState: "hermes:set-task-state",
  /** Main → renderer: the bridge snapshot changed. */
  stateChanged: "hermes:state-changed",
  /** Main → renderer: Hermes invoked an action that needs a UI response. */
  actionRequested: "hermes:action-requested",
  /** Main → renderer: a `hermes://design-studio/...` deep link arrived. */
  deepLink: "hermes:deep-link",
} as const);

/** Narrow an IPC-supplied `args` payload to the record the registry expects. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A real filesystem adapter for the pure discovery layer. */
export function nodeHermesPathFs(): HermesPathFs {
  return {
    exists: (path) => {
      try {
        return existsSync(path);
      } catch {
        return false;
      }
    },
    readText: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        // Missing *and* unreadable both mean "not here" to discovery; upstream
        // treats an unreadable ledger the same way it treats an absent one.
        return null;
      }
    },
  };
}

/** Resolve the `hermes` executable from PATH without spawning a shell. */
export function whichHermesOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const pathValue = env.PATH ?? env.Path ?? "";
  const isWindows = process.platform === "win32";
  const extensions = isWindows ? [".exe", ".cmd", ".bat", ""] : [""];

  for (const dir of pathValue.split(isWindows ? ";" : ":")) {
    if (dir.length === 0) continue;
    for (const extension of extensions) {
      const candidate = join(dir, `${name}${extension}`);
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        // An unreadable PATH entry is not an error worth surfacing.
      }
    }
  }
  return null;
}

export interface HermesDesktopRuntimeDeps {
  /** Send a payload to every live renderer. */
  broadcast: (channel: string, payload: unknown) => void;
  /** The Design Studio task-state setter the renderer drives. */
  onTaskState?: (state: string) => void;
  /** Handlers for the `designStudio.*` actions, supplied by the app. */
  actionHandlers?: Record<string, (invocation: unknown) => Promise<unknown> | unknown>;
  /** Approval-mode environment; defaults to "no Hermes, fail closed". */
  permissionEnvironment?: { connected: boolean; approvalMode: "manual" | "smart" | "off" | null; managed: boolean };
  /** Path to the stable installed launcher, for Windows scheme registration. */
  protocolClientPath?: string | null;
}

export interface HermesDesktopRuntime {
  bridge: HermesBridge;
  /** Run discovery once. Safe to call at any time. */
  connect(): Promise<unknown>;
  /** Start the background poll. */
  start(): void;
  /** Stop polling and release the connection. */
  stop(): void;
  /** Feed an OS-supplied URL into the deep-link dispatcher. */
  dispatchDeepLink(url: string | null): void;
  /** The current redacted snapshot. */
  snapshot(): unknown;
  /**
   * Dispatch a `designStudio.*` action through the same registry Hermes uses,
   * so a renderer-initiated action and a Hermes-initiated one cannot diverge in
   * permission handling.
   */
  dispatchAction(action: string, args: unknown, context?: unknown): Promise<unknown>;
  /** The capability manifest: every action, its risk tier, and availability. */
  capabilities(): unknown;
}

/**
 * Build and wire the runtime.
 *
 * Nothing here claims the `hermes://` scheme: `planHermesProtocolClientRegistration`
 * only ever registers `hermes-design-studio://`, because the Hermes desktop
 * re-asserts `hermes://` on every start and two owners of one scheme produce
 * nondeterministic routing.
 */
export function createHermesDesktopRuntime(deps: HermesDesktopRuntimeDeps): HermesDesktopRuntime {
  const permissionEnvironment = deps.permissionEnvironment ?? {
    connected: false,
    approvalMode: null,
    managed: false,
  };

  const bridge = createHermesBridge({
    discovery: {
      fs: nodeHermesPathFs(),
      platform: process.platform,
      env: process.env,
      whichHermes: (name) => whichHermesOnPath(name),
    },
    control: { platform: process.platform },
    pollIntervalMs: HERMES_BRIDGE_POLL_INTERVAL_MS,
    onStateChange: (snapshot) => {
      // The snapshot is already redacted at the bridge boundary; this is the
      // point where it leaves the main process.
      deps.broadcast(HERMES_IPC.stateChanged, snapshot);
    },
    onDiagnostic: (entry) => {
      // Key + reason only. A token, path or pid never reaches a log line.
      process.stderr.write(`[hermes] ${entry.kind}: ${entry.detail}\n`);
    },
  });

  const registry = createHermesActionRegistry({
    permissions: permissionEnvironment,
    onAudit: (entry) => {
      process.stderr.write(
        `[hermes] action ${entry.action} ${entry.allowed ? "allowed" : "blocked"} (${entry.reason})\n`,
      );
    },
  });

  /**
   * Artifact actions are pure transformations over data the caller supplies, so
   * main services them directly through the real adapter rather than forwarding
   * them. The UI-bound actions (`focus`, `preview`, `compare`, `open`) have no
   * handler here on purpose — those are forwarded to the renderer.
   */
  registry.register("getArtifacts" as never, ((invocation: { args?: Record<string, unknown> }) => {
    const artifacts = invocation.args?.artifacts;
    if (!Array.isArray(artifacts)) return { artifacts: [] };
    return {
      artifacts: artifacts
        .filter(isPlainRecord)
        .map((entry) =>
          toHermesArtifactDescriptor({
            artifactId: typeof entry.artifactId === "string" ? entry.artifactId : "",
            manifest: isPlainRecord(entry.manifest) ? entry.manifest : entry,
            context: emptyContext(),
            ...(typeof entry.version === "number" ? { version: entry.version } : {}),
            ...(typeof entry.previewUrl === "string" ? { previewUrl: entry.previewUrl } : {}),
          }),
        )
        .filter((descriptor) => descriptor.artifactId.length > 0),
    };
  }) as never);

  registry.register("sendToCode" as never, ((invocation: { args?: Record<string, unknown> }) => {
    const args = invocation.args ?? {};
    const handoff = buildHermesCodeHandoff({
      artifactId: typeof args.artifactId === "string" ? args.artifactId : "",
      manifest: isPlainRecord(args.manifest) ? args.manifest : {},
      context: emptyContext(),
      variantId: typeof args.variantId === "string" ? args.variantId : null,
      intent: typeof args.intent === "string" ? args.intent : null,
      ...(typeof args.handoffKind === "string" ? { handoffKind: args.handoffKind as never } : {}),
      ...(typeof args.target === "string" ? { target: args.target } : {}),
    });
    if (handoff == null) {
      return { ok: false, error: "sendToCode requires artifactId and a manifest with an entry" };
    }
    return { ok: true, handoff };
  }) as never);

  for (const [name, handler] of Object.entries(deps.actionHandlers ?? {})) {
    registry.register(name as never, handler as never);
  }

  /**
   * Single dispatch path for every action, whichever side asked for it.
   *
   * An action with no main-process handler is not an error: many of them
   * (`focus`, `preview`, `compare`, `open`) are inherently renderer work. Those
   * are forwarded over `actionRequested` so the UI can act, instead of dying as
   * `unknown-action` in main where nothing can service them.
   */
  const dispatchAction = async (
    action: string,
    args: unknown,
    context?: unknown,
  ): Promise<unknown> => {
    const result = await registry.dispatch({
      action: action as never,
      ...(isPlainRecord(args) ? { args } : {}),
      context: (context ?? emptyContext()) as never,
    });
    const outcome = result as { ok?: boolean; code?: string };
    if (outcome.ok === false && outcome.code === "unknown-action") {
      deps.broadcast(HERMES_IPC.actionRequested, {
        action,
        args: isPlainRecord(args) ? args : null,
        origin: "bridge",
      });
      return { ok: true, action, forwarded: "renderer" };
    }
    return result;
  };

  const deepLinks = createHermesDeepLinkDispatcher((link: HermesDeepLink) => {
    deps.broadcast(HERMES_IPC.deepLink, link);

    // An action deep link is dispatched through the same registry Hermes uses, so
    // a link and an action cannot diverge in permission handling.
    if (link.target.kind !== "action") return;
    const parsed = parseHermesDeepLink(
      `hermes-design-studio://action/${encodeURIComponent(link.target.action)}`,
    );
    if (!parsed || parsed.target.kind !== "action") return;
    void dispatchAction(parsed.target.action, link.target.args);
  });

  const emptyContext = (): HermesSharedContext =>
    redactHermesContext({
      origin: "deeplink",
      hermesProfile: bridge.snapshot().installation?.activeProfile ?? null,
      workspaceKey: null,
      projectId: null,
      conversationId: null,
      agentSessionId: null,
      taskId: null,
      modelId: null,
      modelConfig: null,
      themeId: null,
      memoryContextId: null,
      artifactIds: [],
      permissionContextId: null,
      hermesHome: bridge.snapshot().installation?.home ?? null,
      extra: {},
    });

  return {
    bridge,

    async connect() {
      return bridge.connect();
    },

    start() {
      bridge.startPolling();
    },

    stop() {
      bridge.stopPolling();
      bridge.disconnect();
    },

    dispatchDeepLink(url) {
      deepLinks.dispatch(url);
    },

    snapshot() {
      return bridge.snapshot();
    },

    dispatchAction(action, args, context) {
      return dispatchAction(action, args, context);
    },

    capabilities() {
      // The manifest tells the UI what is permitted; the control list tells it
      // what to render and where. Shipping both means the renderer never has to
      // carry its own copy of the control definitions, which would drift.
      return {
        actions: registry.manifest(),
        controls: HERMES_FLOATING_CONTROLS.map((control) => ({
          id: control.id,
          label: control.label,
          action: control.action,
          slot: control.slot,
          risk: control.risk,
          hint: control.hint,
          order: control.order,
          when: control.when,
          ...(control.args == null ? {} : { args: control.args }),
        })),
      };
    },
  };
}

/**
 * Register IPC and the OS scheme.
 *
 * Called after `app.whenReady()`. Kept separate from `createHermesDesktopRuntime`
 * so the runtime can be constructed and unit-tested without an Electron app.
 */
export function registerHermesDesktopIpc(
  runtime: HermesDesktopRuntime,
  deps: { send: (contents: WebContents, channel: string, payload: unknown) => void },
): void {
  const registration = planHermesProtocolClientRegistration({
    isPackaged: app?.isPackaged === true,
    platform: process.platform,
    protocolClientPath: null,
  });

  if (registration.register) {
    try {
      if (registration.clientPath) {
        app.setAsDefaultProtocolClient(registration.scheme, registration.clientPath);
      } else {
        app.setAsDefaultProtocolClient(registration.scheme);
      }
    } catch (error) {
      process.stderr.write(
        `[hermes] scheme registration failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  ipcMain.handle(HERMES_IPC.getState, () => runtime.snapshot());
  ipcMain.handle(HERMES_IPC.reconnect, () => runtime.connect());
  ipcMain.handle(HERMES_IPC.setTaskState, (_event, state: unknown) => {
    deps.send(
      // The sender is the renderer that owns the task state; echoing back keeps
      // the two in step without a second channel.
      _event.sender,
      HERMES_IPC.stateChanged,
      runtime.snapshot(),
    );
    return { ok: typeof state === "string" };
  });

  /**
   * Renderer-initiated `designStudio.*` action.
   *
   * Goes through the same registry as a Hermes-initiated action, so the
   * permission gate and the audit trail apply identically whichever side asked.
   * A bare action name is accepted as well as the fully qualified
   * `designStudio.x` wire form.
   */
  ipcMain.handle(HERMES_IPC.invokeAction, (_event, invocation: unknown) => {
    if (typeof invocation !== "object" || invocation === null) {
      return { ok: false, action: null, error: "invocation must be an object", code: "unknown-action" };
    }
    const { action, args, context } = invocation as {
      action?: unknown;
      args?: unknown;
      context?: unknown;
    };
    if (typeof action !== "string" || action.length === 0) {
      return { ok: false, action: null, error: "action must be a non-empty string", code: "unknown-action" };
    }
    const bare = action.startsWith(`${HERMES_ACTION_NAMESPACE}.`)
      ? action.slice(HERMES_ACTION_NAMESPACE.length + 1)
      : action;
    return runtime.dispatchAction(bare, args ?? null, context);
  });

  /** What the UI may offer right now: every action with its risk and availability. */
  ipcMain.handle(HERMES_IPC.capabilities, () => runtime.capabilities());

  // macOS delivers `open-url`; Windows/Linux deliver a second-instance argv.
  if (typeof app?.on === "function") {
    app.on("open-url", (event, url) => {
      event.preventDefault();
      runtime.dispatchDeepLink(url);
    });
    app.on("second-instance", (_event, argv) => {
      runtime.dispatchDeepLink(findHermesDeepLinkArg(argv));
    });
  }

  // A cold start through a deep link carries the URL in our own argv.
  runtime.dispatchDeepLink(findHermesDeepLinkArg(process.argv));
  deepLinkFlushQueue(runtime);
}

/** Release queued deep links once the renderer says it is listening. */
function deepLinkFlushQueue(runtime: HermesDesktopRuntime): void {
  ipcMain.handle("hermes:deep-link-ready", () => {
    runtime.dispatchDeepLink(findHermesDeepLinkArg(process.argv));
    return { ok: true };
  });
}

/** Product name for window titles and the about panel. */
export const HERMES_DESKTOP_PRODUCT_NAME = HERMES_DESIGN_STUDIO_PRODUCT_NAME;
