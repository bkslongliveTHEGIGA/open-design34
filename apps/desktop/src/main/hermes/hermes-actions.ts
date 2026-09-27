// The `designStudio.*` action surface Hermes can invoke.
//
// One registry, one dispatch, one permission gate — so "Hermes can do X to
// Design Studio" is a list a reviewer can read in one place rather than a set of
// IPC handlers scattered across the main process.
//
// Section 7's list is implemented in full. The extras are only added where this
// repository already has the capability behind them, so a natural-language
// request maps onto something that genuinely exists rather than a stub:
//
//   • `applyDesignSystem` → `apps/daemon/src/design-systems/*`
//   • `critique`          → `apps/daemon/src/critique/*`, `packages/contracts/src/critique.ts`
//   • `listSkills`        → the checked-in `skills/` catalogue
//   • `handoff`           → `packages/contracts/src/api/handoff.ts`
//
// Handlers are injected, not imported: the registry is pure so it can be unit
// tested without Electron, a daemon, or a design document on disk.

import { decideHermesPermission, type HermesActionRisk, type HermesPermissionEnvironment } from "./hermes-permissions.js";
import type { HermesSharedContext } from "./hermes-context.js";

/** Every action Hermes may invoke, and the risk tier each carries. */
export const HERMES_DESIGN_STUDIO_ACTIONS = Object.freeze({
  open: "read",
  close: "read",
  focus: "read",
  create: "write",
  edit: "write",
  generate: "agent",
  generateVariant: "agent",
  preview: "read",
  compare: "read",
  export: "filesystem",
  approve: "write",
  pause: "write",
  resume: "write",
  cancel: "write",
  getStatus: "read",
  getArtifacts: "read",
  sendToCode: "external",
  // Extras backed by capabilities this repository already ships.
  applyDesignSystem: "write",
  critique: "agent",
  listSkills: "read",
  handoff: "external",
} as const satisfies Record<string, HermesActionRisk>);

export type HermesDesignStudioActionName = keyof typeof HERMES_DESIGN_STUDIO_ACTIONS;

export const HERMES_DESIGN_STUDIO_ACTION_NAMES = Object.freeze(
  Object.keys(HERMES_DESIGN_STUDIO_ACTIONS),
) as readonly HermesDesignStudioActionName[];

/** The fully qualified wire name, e.g. `designStudio.generate`. */
export const HERMES_ACTION_NAMESPACE = "designStudio";

export function isHermesDesignStudioActionName(value: unknown): value is HermesDesignStudioActionName {
  return typeof value === "string" && Object.hasOwn(HERMES_DESIGN_STUDIO_ACTIONS, value);
}

/** Parse `designStudio.generate` (or a bare `generate`) into a known action. */
export function parseHermesActionName(value: unknown): HermesDesignStudioActionName | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const bare = trimmed.startsWith(`${HERMES_ACTION_NAMESPACE}.`)
    ? trimmed.slice(HERMES_ACTION_NAMESPACE.length + 1)
    : trimmed;
  return isHermesDesignStudioActionName(bare) ? bare : null;
}

/** Risk tier of an action — the single source of truth for the permission gate. */
export function hermesActionRisk(action: HermesDesignStudioActionName): HermesActionRisk {
  return HERMES_DESIGN_STUDIO_ACTIONS[action];
}

/** Payload for one action invocation. */
export interface HermesActionInvocation {
  action: HermesDesignStudioActionName;
  /** Caller-supplied arguments; shape is per-action and validated by the handler. */
  args?: Record<string, unknown>;
  /** Context the operation runs under. */
  context: HermesSharedContext;
  /** Present when Hermes attached an explicit grant for this invocation. */
  explicitGrant?: boolean;
}

export type HermesActionResult =
  | { ok: true; action: HermesDesignStudioActionName; value: unknown }
  | { ok: false; action: HermesDesignStudioActionName; error: string; code: HermesActionErrorCode };

export type HermesActionErrorCode =
  | "unknown-action"
  | "permission-denied"
  | "not-connected"
  | "invalid-args"
  | "handler-failed"
  | "unsupported-standalone";

export type HermesActionHandler = (invocation: HermesActionInvocation) => Promise<unknown> | unknown;

export interface HermesActionRegistryDeps {
  permissions: HermesPermissionEnvironment;
  /** Called for every invocation, allowed or not, for the audit trail. */
  onAudit?: (entry: {
    action: HermesDesignStudioActionName;
    allowed: boolean;
    reason: string;
    /** True when the invocation carried a Hermes connection. */
    connected: boolean;
  }) => void;
}

/**
 * The registry Hermes invokes Design Studio through.
 *
 * Dispatch is deliberately narrow: resolve the name, apply the permission gate,
 * call the handler, normalise the result. It never throws — a failing handler is
 * a `handler-failed` result, because the caller is Hermes' own agent loop and an
 * exception escaping into it would abort the user's turn for a design-tool
 * problem.
 */
export function createHermesActionRegistry(deps: HermesActionRegistryDeps) {
  const handlers = new Map<HermesDesignStudioActionName, HermesActionHandler>();

  return {
    /** Register a handler. Re-registering replaces, so tests can rebind freely. */
    register(action: HermesDesignStudioActionName, handler: HermesActionHandler): void {
      handlers.set(action, handler);
    },

    registerAll(entries: Partial<Record<HermesDesignStudioActionName, HermesActionHandler>>): void {
      for (const [name, handler] of Object.entries(entries)) {
        if (handler && isHermesDesignStudioActionName(name)) handlers.set(name, handler);
      }
    },

    has(action: HermesDesignStudioActionName): boolean {
      return handlers.has(action);
    },

    /** Actions with a handler *and* permitted right now — what the UI can offer. */
    availableActions(): HermesDesignStudioActionName[] {
      return HERMES_DESIGN_STUDIO_ACTION_NAMES.filter((name) => {
        if (!handlers.has(name)) return false;
        return decideHermesPermission(
          { risk: hermesActionRisk(name), action: `${HERMES_ACTION_NAMESPACE}.${name}` },
          deps.permissions,
        ).allow;
      });
    },

    /** The capability manifest Hermes receives at handshake. */
    manifest(): { name: string; action: string; risk: HermesActionRisk; available: boolean }[] {
      return HERMES_DESIGN_STUDIO_ACTION_NAMES.map((name) => ({
        name,
        action: `${HERMES_ACTION_NAMESPACE}.${name}`,
        risk: hermesActionRisk(name),
        available: handlers.has(name) &&
          decideHermesPermission(
            { risk: hermesActionRisk(name), action: `${HERMES_ACTION_NAMESPACE}.${name}` },
            deps.permissions,
          ).allow,
      }));
    },

    async dispatch(invocation: HermesActionInvocation): Promise<HermesActionResult> {
      const { action, context } = invocation;
      const risk = hermesActionRisk(action);
      const wireName = `${HERMES_ACTION_NAMESPACE}.${action}`;

      const handler = handlers.get(action);
      if (!handler) {
        audit(deps, action, false, "unknown-action", false);
        return { ok: false, action, error: `no handler registered for ${wireName}`, code: "unknown-action" };
      }

      // A `read` is permitted standalone by design; everything else that leaves
      // the app needs the authority Hermes is connected to provide.
      const standaloneBlocked = !deps.permissions.connected && !isStandalonePermitted(risk);
      if (standaloneBlocked) {
        audit(deps, action, false, "not-connected", false);
        return {
          ok: false,
          action,
          error: `${wireName} requires a Hermes connection`,
          code: "not-connected",
        };
      }

      const decision = decideHermesPermission(
        { risk, action: wireName, explicitGrant: invocation.explicitGrant },
        deps.permissions,
      );

      if (!decision.allow) {
        audit(deps, action, false, decision.reason, deps.permissions.connected);
        return {
          ok: false,
          action,
          error: `${wireName} blocked: ${decision.reason}`,
          code: decision.reason === "no-hermes" ? "not-connected" : "permission-denied",
        };
      }

      try {
        const value = await handler({ ...invocation, context });
        audit(deps, action, true, decision.reason, deps.permissions.connected);
        return { ok: true, action, value: value ?? null };
      } catch (error) {
        audit(deps, action, false, "handler-failed", deps.permissions.connected);
        return {
          ok: false,
          action,
          error: error instanceof Error ? error.message : String(error),
          code: "handler-failed",
        };
      }
    },
  };
}

function isStandalonePermitted(risk: HermesActionRisk): boolean {
  return risk === "read" || risk === "write";
}

function audit(
  deps: HermesActionRegistryDeps,
  action: HermesDesignStudioActionName,
  allowed: boolean,
  reason: string,
  connected: boolean,
): void {
  try {
    deps.onAudit?.({ action, allowed, reason, connected });
  } catch {
    // Auditing is observational; it must never fail the action it describes.
  }
}

/**
 * Natural-language intent → structured action.
 *
 * Section 7: "The model should invoke structured Design Studio capabilities
 * rather than pretending to click the UI when a direct API exists." This is the
 * deterministic half of that — a keyword map used to *suggest* an action to the
 * model and to make deep links and quick actions work. It is not an NLU engine,
 * and it deliberately returns null rather than guessing: an unmapped phrase
 * should reach the model, not be silently coerced into `create`.
 */
export interface HermesIntentMatch {
  action: HermesDesignStudioActionName;
  /** Words that triggered the match, for diagnostics. */
  matched: string[];
  /** Confidence in 0..1; below `HERMES_INTENT_MIN_CONFIDENCE` should be treated as no match. */
  confidence: number;
}

export const HERMES_INTENT_MIN_CONFIDENCE = 0.5;

const INTENT_PATTERNS: { action: HermesDesignStudioActionName; patterns: RegExp[] }[] = [
  { action: "generateVariant", patterns: [/\balternat(e|ive)\b/i, /\bvariant/i, /\bthree versions?\b/i, /\bmore versions?\b/i] },
  {
    action: "sendToCode",
    // Deliberately loose on the middle: "send this design to Hermes Code",
    // "send it over to Code" and "hand this off to Code" are all the same
    // intent, and pinning the wording would silently miss the common ones.
    patterns: [/\bsend\b[\s\S]{0,40}?\bto (?:hermes )?code\b/i, /\bhand\b[\s\S]{0,30}?\bto code\b/i],
  },
  { action: "export", patterns: [/\bexport\b/i, /\bas a presentation\b/i, /\bdownload\b/i] },
  { action: "compare", patterns: [/\bcompare\b/i, /\bside[- ]by[- ]side\b/i] },
  { action: "preview", patterns: [/\bpreview\b/i, /\bshow me\b/i] },
  { action: "approve", patterns: [/\bapprove\b/i, /\bship it\b/i, /\blooks good\b/i] },
  { action: "pause", patterns: [/\bpause\b/i] },
  { action: "resume", patterns: [/\bresume\b/i, /\bcontinue\b/i] },
  { action: "cancel", patterns: [/\bcancel\b/i, /\bstop\b/i] },
  { action: "edit", patterns: [/\bmore apple[- ]like\b/i, /\brefine\b/i, /\btweak\b/i, /\bchange\b/i, /\bmake this\b/i] },
  { action: "open", patterns: [/\bopen\b/i, /\bfrom yesterday\b/i, /\bshow the design\b/i] },
  { action: "create", patterns: [/\bcreate\b/i, /\bdesign (a|an|the)\b/i, /\blanding page\b/i, /\bhomepage\b/i, /\bbuild\b/i] },
];

export function matchHermesIntent(text: string): HermesIntentMatch | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  let best: HermesIntentMatch | null = null;

  for (const entry of INTENT_PATTERNS) {
    const matched: string[] = [];
    for (const pattern of entry.patterns) {
      const found = pattern.exec(trimmed);
      if (found) matched.push(found[0]);
    }
    if (matched.length === 0) continue;

    const confidence = Math.min(1, matched.length / 2 + 0.5);
    if (!best || confidence > best.confidence) {
      best = { action: entry.action, matched, confidence };
    }
  }

  if (!best || best.confidence < HERMES_INTENT_MIN_CONFIDENCE) return null;
  return best;
}
