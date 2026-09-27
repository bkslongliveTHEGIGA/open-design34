// HermesBridge — the single interface between Design Studio and Hermes.
//
// Everything else in this directory is a leaf: discovery finds candidates, the
// control client proves liveness, the runtime adapter reads state, the adapters
// map it, the action registry is invoked, the event bus reports back. This module
// owns the *lifecycle* that ties them together, and nothing outside it talks to
// Hermes.
//
// State machine:
//
//   disconnected → discovering → (not-installed | installed-idle)
//                                        │
//                                        ▼
//                                   connecting → connected
//                                        │           │
//                                        └───────────┴─→ reconnecting → connected
//
// `installed-idle` is a real, user-visible state: Hermes is on the machine but
// not running, which section 3 requires us to distinguish from "not installed"
// because the remedy is different.
//
// Reconnect is keyed on upstream's `install_id` (`GET /api/status`) plus the
// gateway's `identify.pid`/`start_time`. A changed `install_id` means Hermes was
// upgraded, so cached context is dropped; a changed pid with the same
// `install_id` means a restart, so context is re-read but the subscription
// survives. That distinction is the difference between a seamless reconnect and
// a confusing one.
//
// Pure and injectable: no electron, no timers that cannot be driven by a test.

import {
  discoverHermes,
  recordBaseUrl,
  type HermesBackendRecord,
  type HermesDiscoveryDeps,
  type HermesDiscoveryResult,
  type HermesInstallation,
} from "./hermes-discovery.js";
import {
  identifyHermesGateway,
  type HermesControlClientDeps,
} from "./hermes-control-client.js";
import { parseHermesIdentify, type HermesIdentify } from "./hermes-control-protocol.js";
import {
  createHermesRuntimeAdapter,
  buildHermesEventPublishUrl,
  extractHermesSessionToken,
  parseHermesStatusSnapshot,
  redactHermesStatusSnapshot,
  type HermesRuntimeAdapterDeps,
  type HermesRuntimeFetch,
  type HermesStatusSnapshot,
} from "./hermes-runtime-adapter.js";
import {
  emptyHermesContext,
  mapHermesContext,
  redactHermesContext,
  type HermesSharedContext,
} from "./hermes-context.js";
import { createHermesEventBus, type HermesEventSocket } from "./hermes-events.js";
import {
  hermesModelSelectionChanged,
  mapHermesModelSelection,
  redactHermesModelSelection,
  type HermesModelSelection,
} from "./hermes-model-adapter.js";
import { mapHermesThemeToDesignTokens, type DesignStudioThemeTokens } from "./hermes-theme-adapter.js";
import { HERMES_CONTROL_DEFAULT_TIMEOUT_MS } from "./hermes-control-protocol.js";

export type HermesBridgeState =
  | "disconnected"
  | "discovering"
  | "not-installed"
  | "installed-idle"
  | "connecting"
  | "connected"
  | "reconnecting";

/** Why the bridge is not connected. Surfaced verbatim in the UI. */
export type HermesBridgeReason =
  | "not-installed"
  | "installed-but-not-running"
  | "backend-unreachable"
  | "auth-required"
  | "control-socket-silent"
  | "temporarily-unavailable"
  | null;

export interface HermesBridgeSnapshot {
  state: HermesBridgeState;
  reason: HermesBridgeReason;
  /** True when Hermes is installed on this machine. */
  installed: boolean;
  installation: HermesInstallation | null;
  /** Loopback base URL of the attached backend. */
  baseUrl: string | null;
  status: HermesStatusSnapshot | null;
  identify: HermesIdentify | null;
  context: HermesSharedContext;
  model: HermesModelSelection | null;
  theme: DesignStudioThemeTokens | null;
  /** True when the event bus has an open publish connection. */
  eventsConnected: boolean;
  /** Monotonic; changes on every state transition. */
  generation: number;
  /** Last transition, for diagnostics. */
  lastTransitionAt: number;
  /** Discovery trace of the most recent pass. */
  trace: string[];
}

export interface HermesBridgeDeps {
  discovery: HermesDiscoveryDeps;
  /** Control-socket transport; injectable for tests. */
  control?: HermesControlClientDeps & { platform?: NodeJS.Platform; tmpDir?: string };
  fetch?: HermesRuntimeFetch;
  /** Event-bus socket factory. */
  createEventSocket?: (url: string) => HermesEventSocket;
  now?: () => number;
  /** Poll interval for the discovery/reconnect loop. */
  pollIntervalMs?: number;
  /** Called on every state transition. */
  onStateChange?: (snapshot: HermesBridgeSnapshot) => void;
  /** Called when live sync observes a Hermes-side change. */
  onSync?: (change: {
    kind: "model" | "theme" | "context" | "status";
    previous: unknown;
    next: unknown;
  }) => void;
  /** Never log a token; this hook receives only its presence. */
  onDiagnostic?: (entry: { kind: string; detail: string }) => void;
}

export const HERMES_BRIDGE_POLL_INTERVAL_MS = 5_000;

/** Reconnect backoff, so a restarting Hermes is not hammered. */
export const HERMES_BRIDGE_RECONNECT_DELAYS_MS = Object.freeze([1_000, 2_000, 5_000, 10_000, 30_000] as const);

export function createHermesBridge(deps: HermesBridgeDeps) {
  const now = deps.now ?? Date.now;
  const pollIntervalMs = deps.pollIntervalMs ?? HERMES_BRIDGE_POLL_INTERVAL_MS;

  let state: HermesBridgeState = "disconnected";
  let reason: HermesBridgeReason = null;
  let installation: HermesInstallation | null = null;
  let baseUrl: string | null = null;
  let status: HermesStatusSnapshot | null = null;
  let identify: HermesIdentify | null = null;
  let context: HermesSharedContext = emptyHermesContext("bridge-sync");
  let model: HermesModelSelection | null = null;
  let theme: DesignStudioThemeTokens | null = null;
  let token: string | null = null;
  let generation = 0;
  let lastTransitionAt = now();
  let trace: string[] = [];
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  const bus = createHermesEventBus({
    buildPublishUrl: (channel) =>
      baseUrl ? buildHermesEventPublishUrl(baseUrl, channel, token) ?? "" : "",
    createSocket: (url) => {
      const factory = deps.createEventSocket;
      if (!factory) throw new Error("no event socket factory configured");
      return factory(url);
    },
    now,
    onUndeliverable: (_frame, why) => deps.onDiagnostic?.({ kind: "event-undeliverable", detail: why }),
  });

  const resolveToken = async (): Promise<string | null> => {
    if (token != null) return token;
    if (!baseUrl) return null;
    const runtime = makeRuntime();
    const document = await runtime.dashboardDocument();
    if (!document.ok) return null;
    const found = extractHermesSessionToken(document.value);
    if (found) {
      token = found;
      // Presence only. Logging the value would put a bearer token in a log file.
      deps.onDiagnostic?.({ kind: "session-token", detail: "acquired" });
    }
    return token;
  };

  const makeRuntime = () =>
    createHermesRuntimeAdapter({
      baseUrl: baseUrl ?? "http://127.0.0.1:0",
      fetch: deps.fetch,
      resolveToken,
    } as HermesRuntimeAdapterDeps);

  /**
   * The state as the rest of the app — including the renderer — may see it.
   *
   * Redaction happens *here*, at the boundary, rather than at each call site: the
   * snapshot is what `onStateChange` publishes and what the diagnostics panel
   * renders, so it is the one place a credential could escape. `model` keeps
   * `model_config` internally because upstream stores provider credential
   * references in it, and `status` keeps `hermes_home`/`gateway_pid` because the
   * main process needs them; neither leaves this function.
   */
  const snapshot = (): HermesBridgeSnapshot => ({
    state,
    reason,
    installed: installation != null,
    installation,
    baseUrl,
    status: status == null ? null : redactHermesStatusSnapshot(status),
    identify,
    context: redactHermesContext(context),
    model: model == null ? null : redactHermesModelSelection(model),
    theme,
    eventsConnected: bus.isConnected(),
    generation,
    lastTransitionAt,
    trace,
  });

  const emit = (): void => {
    try {
      deps.onStateChange?.(snapshot());
    } catch {
      // A subscriber that throws must not wedge the bridge.
    }
  };

  const transition = (next: HermesBridgeState, nextReason: HermesBridgeReason = null): void => {
    if (state === next && reason === nextReason) return;
    state = next;
    reason = nextReason;
    generation += 1;
    lastTransitionAt = now();
    emit();
  };

  /**
   * One discovery + connect pass.
   *
   * Never throws: the poll loop calls this on an interval and an exception would
   * silently kill the loop, leaving the UI claiming a state it stopped
   * verifying.
   */
  const runPass = async (): Promise<HermesBridgeSnapshot> => {
    if (disposed) return snapshot();

    let discovery: HermesDiscoveryResult;
    try {
      discovery = discoverHermes(deps.discovery);
    } catch (error) {
      trace = [`discovery threw: ${error instanceof Error ? error.message : String(error)}`];
      transition(state === "connected" ? "reconnecting" : "disconnected", "temporarily-unavailable");
      return snapshot();
    }
    trace = discovery.trace;

    installation = discovery.installed;

    if (!installation) {
      baseUrl = null;
      status = null;
      identify = null;
      token = null;
      transition("not-installed", "not-installed");
      return snapshot();
    }

    if (discovery.decision.action !== "attach") {
      // Installed, no attachable backend in the ledger.
      if (state !== "connected") transition("installed-idle", "installed-but-not-running");
      return snapshot();
    }

    const record: HermesBackendRecord = discovery.decision.record;
    const candidateUrl = recordBaseUrl(record);

    // Probe the public status endpoint. This is the validation step upstream
    // insists on: a ledger record is a candidate, not proof.
    const probe = await createHermesRuntimeAdapter({
      baseUrl: candidateUrl,
      fetch: deps.fetch,
    }).status();

    if (!probe.ok || !probe.value) {
      if (state === "connected") {
        transition("reconnecting", "backend-unreachable");
        scheduleReconnect();
      } else {
        transition("installed-idle", "backend-unreachable");
      }
      return snapshot();
    }

    const nextStatus = probe.value;
    const previousInstallId = status?.installId ?? null;
    const previousPid = identify?.pid ?? null;

    baseUrl = candidateUrl;
    status = nextStatus;

    // A gated bind means we cannot obtain a token without the user doing
    // something; report it rather than silently failing every authenticated call.
    if (nextStatus.authRequired) {
      transition("installed-idle", "auth-required");
      return snapshot();
    }

    // Control socket identity. Silent is not fatal — the HTTP probe already
    // proved the backend answers — but it is worth recording, because it is the
    // difference between "Hermes is running" and "Hermes' gateway is running".
    const control = await identifyHermesGateway(installation.home, deps.discovery.fs, {
      ...deps.control,
      platform: deps.control?.platform ?? deps.discovery.platform,
    });
    identify = control.kind === "ok" ? parseHermesIdentify(control.result) : null;
    if (control.kind !== "ok" && state !== "connected") {
      deps.onDiagnostic?.({ kind: "control-socket", detail: control.kind === "error" ? control.error : "silent" });
    }

    // Detect restart vs upgrade before overwriting the cached context.
    const installIdChanged = previousInstallId != null && nextStatus.installId != null && previousInstallId !== nextStatus.installId;
    const pidChanged = previousPid != null && identify?.pid != null && previousPid !== identify.pid;

    if (installIdChanged) {
      // Hermes was upgraded or replaced: cached context describes a different
      // install and must not survive.
      context = emptyHermesContext("bridge-sync");
      model = null;
      theme = null;
      token = null;
      deps.onDiagnostic?.({ kind: "hermes-upgraded", detail: `install_id ${previousInstallId} → ${nextStatus.installId}` });
    } else if (pidChanged) {
      token = null;
      deps.onDiagnostic?.({ kind: "hermes-restarted", detail: `pid ${previousPid} → ${identify?.pid}` });
    }

    const wasConnected = state === "connected";
    transition(wasConnected ? "connected" : "connecting", null);

    await synchronize({ installIdChanged, pidChanged });

    if (!wasConnected || installIdChanged || pidChanged) {
      bus.connect();
    }
    reconnectAttempt = 0;
    transition("connected", null);

    return snapshot();
  };

  /**
   * Re-read Hermes-owned state after connecting or after a restart/upgrade.
   *
   * Section 9's two-way sync is pull-based on this side by design: Hermes has no
   * push channel aimed at Design Studio, and polling the two cheap endpoints is
   * far less machinery than asking upstream for one. Changes are diffed before
   * they are reported, so an unchanged Hermes does not re-render the canvas.
   */
  const synchronize = async (flags: { installIdChanged: boolean; pidChanged: boolean }): Promise<void> => {
    const runtime = makeRuntime();

    const modelResult = await runtime.modelInfo();
    if (modelResult.ok) {
      const next = mapHermesModelSelection(modelResult.value);
      // Diff before reporting: an unchanged Hermes must not re-render the canvas.
      if (hermesModelSelectionChanged(model, next)) {
        const previous = model;
        model = next;
        deps.onSync?.({ kind: "model", previous, next });
      }
    }

    const previousContext = context;
    const nextContext = mapHermesContext(
      {
        profile: identify?.profile ?? status?.profiles[0] ?? null,
        hermes_home: status?.hermesHome ?? installation?.home ?? null,
        ...(model?.modelId ? { model: model.modelId } : {}),
        ...(model?.modelConfig ? { model_config: model.modelConfig } : {}),
      },
      "bridge-sync",
    );

    // Preserve fields the context mapper cannot know (an active design's ids) so
    // a background sync never wipes the operation in flight.
    context = {
      ...nextContext,
      conversationId: previousContext.conversationId,
      agentSessionId: previousContext.agentSessionId,
      taskId: previousContext.taskId,
      projectId: previousContext.projectId,
      workspaceKey: nextContext.workspaceKey ?? previousContext.workspaceKey,
      artifactIds: previousContext.artifactIds,
      permissionContextId: previousContext.permissionContextId,
      memoryContextId: previousContext.memoryContextId,
    };

    if (
      previousContext.hermesProfile !== context.hermesProfile ||
      previousContext.workspaceKey !== context.workspaceKey ||
      previousContext.modelId !== context.modelId
    ) {
      deps.onSync?.({ kind: "context", previous: previousContext, next: context });
    }

    deps.onSync?.({ kind: "status", previous: null, next: status });
    void flags;
  };

  /**
   * Apply a theme reported by Hermes.
   *
   * Kept as an explicit call rather than part of `synchronize` because the
   * dashboard theme is a process-level asset with its own endpoint, and section 5
   * makes it Hermes' to own — Design Studio applies it, it does not negotiate it.
   */
  const applyHermesTheme = (payload: unknown): boolean => {
    const next = mapHermesThemeToDesignTokens(payload);
    if (!next) return false;
    const changed = theme?.sourceThemeName !== next.sourceThemeName || theme?.canvas !== next.canvas;
    const previous = theme;
    theme = next;
    if (changed) deps.onSync?.({ kind: "theme", previous, next });
    return true;
  };

  const scheduleReconnect = (): void => {
    if (disposed || reconnectTimer != null) return;
    const delay = HERMES_BRIDGE_RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, HERMES_BRIDGE_RECONNECT_DELAYS_MS.length - 1)] ?? 30_000;
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void runPass();
    }, delay);
    reconnectTimer.unref?.();
  };

  return {
    /** Run one pass immediately. Safe to call repeatedly. */
    connect: () => runPass(),

    /** Start the background poll that keeps the state honest. */
    startPolling(): void {
      if (disposed || pollTimer != null) return;
      pollTimer = setInterval(() => void runPass(), pollIntervalMs);
      pollTimer.unref?.();
    },

    stopPolling(): void {
      if (pollTimer != null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    },

    /**
     * Forget the connection without uninstalling anything.
     *
     * Used when Hermes shuts down cleanly: the next poll re-discovers from
     * scratch rather than trying to reuse a socket that will never answer.
     */
    disconnect(): void {
      bus.close();
      token = null;
      baseUrl = null;
      status = null;
      identify = null;
      transition("disconnected", null);
    },

    dispose(): void {
      disposed = true;
      this.stopPolling();
      bus.close();
    },

    /** Apply a theme payload Hermes reported. Returns false when unusable. */
    applyHermesTheme,

    /** Merge caller-supplied context (a deep link, an action) over the synced base. */
    setLocalContext(patch: Partial<HermesSharedContext>): void {
      const previous = context;
      context = { ...context, ...patch };
      if (previous.conversationId !== context.conversationId || previous.taskId !== context.taskId) {
        deps.onSync?.({ kind: "context", previous, next: context });
      }
      emit();
    },

    /** The event bus, so callers can emit typed events. */
    events: bus,

    isConnected: () => state === "connected",

    snapshot,

    /** Reconnect delay that would be used next — exposed for tests and the UI. */
    nextReconnectDelayMs(): number {
      return HERMES_BRIDGE_RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, HERMES_BRIDGE_RECONNECT_DELAYS_MS.length - 1)] ?? 30_000;
    },

    /** Control-socket timeout in use, for the diagnostics panel. */
    controlTimeoutMs: HERMES_CONTROL_DEFAULT_TIMEOUT_MS,
  };
}

export type HermesBridge = ReturnType<typeof createHermesBridge>;

/** Re-exported so the bridge is the only import most callers need. */
export { parseHermesStatusSnapshot };
