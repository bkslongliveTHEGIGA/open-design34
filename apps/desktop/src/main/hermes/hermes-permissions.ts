// Hermes permission adapter.
//
// Maps Design Studio's action risks onto the *real* Hermes approval model rather
// than a bespoke one. From `hermes_cli/approval_mode.py`:
//
//   • `VALID_APPROVAL_MODES = ("manual", "smart", "off")`
//   • approval mode is **profile-scoped configuration**, not conversation state
//   • the terminal guard re-reads config on every check, so a change takes
//     effect immediately
//   • the mode can be **managed** (org policy) and then cannot be changed at all
//
// The consequence for this bridge: Design Studio must not cache a permission
// verdict across actions, and must not invent an "always allow" of its own. When
// Hermes is disconnected there is no upstream authority to consult, so the
// policy is fail-closed for anything that leaves the machine or touches files —
// section 15's "never silently bypass the Hermes permission model" cuts both
// ways, and pretending a missing Hermes granted permission would be exactly such
// a bypass.

/** `hermes_cli/approval_mode.py::VALID_APPROVAL_MODES`. */
export const HERMES_APPROVAL_MODES = Object.freeze(["manual", "smart", "off"] as const);

export type HermesApprovalMode = (typeof HERMES_APPROVAL_MODES)[number];

export function isHermesApprovalMode(value: unknown): value is HermesApprovalMode {
  return typeof value === "string" && (HERMES_APPROVAL_MODES as readonly string[]).includes(value);
}

/**
 * What an action actually does to the world.
 *
 * Section 15 draws the line at: read-only versus anything that executes code,
 * touches files, exports content, mutates projects, invokes agents, reads
 * private memory, or talks to an external system. Each tier below names exactly
 * one of those, so a reviewer can audit the mapping without reading the actions.
 */
export type HermesActionRisk =
  /** Reads Design Studio's own state. Leaves the machine only to report to Hermes. */
  | "read"
  /** Mutates Design Studio documents/artifacts. No file system, no code. */
  | "write"
  /** Writes files outside Design Studio's own storage (exports, handoffs). */
  | "filesystem"
  /** Invokes an agent/model run. */
  | "agent"
  /** Reads Hermes memory or other private context. */
  | "private-memory"
  /** Sends content to another Hermes module or an external system. */
  | "external";

/** The tiers that can be satisfied without an explicit Hermes approval. */
const AUTONOMOUS_RISKS: readonly HermesActionRisk[] = Object.freeze(["read"]);

/** Tiers that require an approval even when Hermes' mode is `off`. */
const ALWAYS_REQUIRE_APPROVAL: readonly HermesActionRisk[] = Object.freeze(["private-memory", "external"]);

export type HermesPermissionDecision =
  | { allow: true; reason: "autonomous" | "approval-mode" | "explicit-grant"; mode: HermesApprovalMode | null }
  | { allow: false; reason: "no-hermes" | "managed-policy" | "requires-approval" | "denied"; mode: HermesApprovalMode | null };

export interface HermesPermissionRequest {
  /** Risk tier of the action being attempted. */
  risk: HermesActionRisk;
  /** The `designStudio.*` action name, for the approval prompt and the audit trail. */
  action: string;
  /** Present when the caller carries an explicit Hermes grant for this action. */
  explicitGrant?: boolean;
}

export interface HermesPermissionEnvironment {
  /** True when a Hermes connection is live. No Hermes means no authority. */
  connected: boolean;
  /** Profile-scoped approval mode as Hermes reports it. */
  approvalMode: HermesApprovalMode | null;
  /** True when org/managed policy pins the mode and it cannot be changed. */
  managed: boolean;
}

/**
 * Decide whether an action may proceed.
 *
 * Rules, in order:
 *   1. No live Hermes → fail closed for everything above `read`. Standalone
 *      Design Studio keeps working (reads and local writes are its own
 *      business), but it cannot claim Hermes authorised anything.
 *   2. `private-memory` and `external` always need an explicit grant, even with
 *      `approvals.mode = off` — `off` means "don't ask me about terminal
 *      commands", not "let any module read my memory or post outward".
 *   3. An explicit grant from Hermes satisfies the request.
 *   4. Otherwise the profile's approval mode decides: `off` allows, `smart`
 *      allows anything not in `ALWAYS_REQUIRE_APPROVAL`, `manual` allows only
 *      reads.
 *
 * Note rule 4's use of `ALWAYS_REQUIRE_APPROVAL` under `smart`: `smart` is
 * Hermes' heuristic tier, and a heuristic is not a grant for private memory.
 */
export function decideHermesPermission(
  request: HermesPermissionRequest,
  environment: HermesPermissionEnvironment,
): HermesPermissionDecision {
  const mode = environment.connected ? environment.approvalMode : null;

  if (!environment.connected) {
    if (request.risk === "read") return { allow: true, reason: "autonomous", mode: null };
    if (request.risk === "write") return { allow: true, reason: "autonomous", mode: null };
    return { allow: false, reason: "no-hermes", mode: null };
  }

  if (ALWAYS_REQUIRE_APPROVAL.includes(request.risk)) {
    if (request.explicitGrant === true) return { allow: true, reason: "explicit-grant", mode };
    return { allow: false, reason: "requires-approval", mode };
  }

  if (request.explicitGrant === true) return { allow: true, reason: "explicit-grant", mode };

  if (AUTONOMOUS_RISKS.includes(request.risk)) return { allow: true, reason: "autonomous", mode };

  const effective = mode ?? "manual";

  if (environment.managed && effective === "manual") {
    return { allow: false, reason: "managed-policy", mode };
  }

  switch (effective) {
    case "off":
      return { allow: true, reason: "approval-mode", mode };
    case "smart":
      return { allow: true, reason: "approval-mode", mode };
    case "manual":
      return { allow: false, reason: "requires-approval", mode };
  }
}

/**
 * Whether a risk tier is safe to perform with no Hermes attached at all.
 *
 * Used by the standalone-mode UI to grey out (not hide) the controls that need
 * Hermes, so the user can see what connecting would unlock.
 */
export function isStandaloneSafeRisk(risk: HermesActionRisk): boolean {
  return risk === "read" || risk === "write";
}

/**
 * Redact an approval prompt's description of a grant.
 *
 * Grants travel as opaque handles; a UI must never render the handle itself,
 * because a handle is a bearer token for a privileged action.
 */
export function describePermissionDecision(decision: HermesPermissionDecision): string {
  if (decision.allow) {
    return decision.reason === "explicit-grant"
      ? "allowed by Hermes grant"
      : decision.reason === "autonomous"
        ? "allowed autonomously"
        : `allowed by Hermes approvals mode (${decision.mode ?? "unknown"})`;
  }
  switch (decision.reason) {
    case "no-hermes":
      return "Hermes is not connected";
    case "managed-policy":
      return "blocked by managed Hermes policy";
    case "requires-approval":
      return "waiting for Hermes approval";
    case "denied":
      return "denied by Hermes";
  }
}
