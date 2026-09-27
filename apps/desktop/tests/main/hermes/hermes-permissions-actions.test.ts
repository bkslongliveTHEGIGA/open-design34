import { describe, expect, it } from "vitest";

import {
  HERMES_APPROVAL_MODES,
  decideHermesPermission,
  describePermissionDecision,
  isHermesApprovalMode,
  isStandaloneSafeRisk,
  type HermesActionRisk,
  type HermesPermissionEnvironment,
} from "../../../src/main/hermes/hermes-permissions.js";
import {
  HERMES_ACTION_NAMESPACE,
  HERMES_DESIGN_STUDIO_ACTION_NAMES,
  HERMES_DESIGN_STUDIO_ACTIONS,
  HERMES_INTENT_MIN_CONFIDENCE,
  createHermesActionRegistry,
  hermesActionRisk,
  isHermesDesignStudioActionName,
  matchHermesIntent,
  parseHermesActionName,
  type HermesDesignStudioActionName,
} from "../../../src/main/hermes/hermes-actions.js";
import { emptyHermesContext } from "../../../src/main/hermes/hermes-context.js";

const CONNECTED_SMART: HermesPermissionEnvironment = { connected: true, approvalMode: "smart", managed: false };
const CONNECTED_OFF: HermesPermissionEnvironment = { connected: true, approvalMode: "off", managed: false };
const CONNECTED_MANUAL: HermesPermissionEnvironment = { connected: true, approvalMode: "manual", managed: false };
const DISCONNECTED: HermesPermissionEnvironment = { connected: false, approvalMode: null, managed: false };

describe("Hermes approval modes", () => {
  it("are exactly upstream's VALID_APPROVAL_MODES", () => {
    expect([...HERMES_APPROVAL_MODES]).toEqual(["manual", "smart", "off"]);
  });

  it("reject anything else", () => {
    for (const mode of HERMES_APPROVAL_MODES) expect(isHermesApprovalMode(mode)).toBe(true);
    expect(isHermesApprovalMode("yolo")).toBe(false);
    expect(isHermesApprovalMode(null)).toBe(false);
  });
});

describe("permission enforcement", () => {
  const check = (risk: HermesActionRisk, environment: HermesPermissionEnvironment, explicitGrant = false) =>
    decideHermesPermission({ risk, action: `designStudio.${risk}`, explicitGrant }, environment);

  it("allows reads and local writes with no Hermes attached", () => {
    expect(check("read", DISCONNECTED).allow).toBe(true);
    expect(check("write", DISCONNECTED).allow).toBe(true);
  });

  it("fails closed for anything that leaves the app when Hermes is absent", () => {
    for (const risk of ["filesystem", "agent", "private-memory", "external"] as const) {
      const decision = check(risk, DISCONNECTED);
      expect(decision.allow).toBe(false);
      expect(decision).toMatchObject({ reason: "no-hermes" });
    }
  });

  it("requires an explicit grant for private memory even when approvals are off", () => {
    expect(check("private-memory", CONNECTED_OFF).allow).toBe(false);
    expect(check("private-memory", CONNECTED_OFF, true).allow).toBe(true);
  });

  it("requires an explicit grant for external sends even when approvals are off", () => {
    const decision = check("external", CONNECTED_OFF);
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("requires-approval");
    expect(check("external", CONNECTED_OFF, true).allow).toBe(true);
  });

  it("lets `smart` approve ordinary privileged actions", () => {
    for (const risk of ["filesystem", "agent"] as const) {
      expect(check(risk, CONNECTED_SMART)).toMatchObject({ allow: true, reason: "approval-mode" });
    }
  });

  it("lets `off` approve ordinary privileged actions", () => {
    expect(check("filesystem", CONNECTED_OFF)).toMatchObject({ allow: true, reason: "approval-mode" });
  });

  it("blocks privileged actions under `manual`", () => {
    expect(check("agent", CONNECTED_MANUAL)).toMatchObject({ allow: false, reason: "requires-approval" });
  });

  it("still allows reads under `manual`", () => {
    expect(check("read", CONNECTED_MANUAL).allow).toBe(true);
  });

  it("reports managed policy as its own reason, distinct from a plain denial", () => {
    const managed: HermesPermissionEnvironment = { connected: true, approvalMode: "manual", managed: true };
    expect(check("agent", managed)).toMatchObject({ allow: false, reason: "managed-policy" });
  });

  it("never derives permission from a missing approval mode: unknown means manual", () => {
    expect(check("agent", { connected: true, approvalMode: null, managed: false })).toMatchObject({
      allow: false,
      reason: "requires-approval",
    });
  });

  it("marks only reads and local writes as standalone-safe", () => {
    expect(isStandaloneSafeRisk("read")).toBe(true);
    expect(isStandaloneSafeRisk("write")).toBe(true);
    expect(isStandaloneSafeRisk("external")).toBe(false);
    expect(isStandaloneSafeRisk("private-memory")).toBe(false);
  });

  it("describes every decision without echoing a grant handle", () => {
    expect(describePermissionDecision(check("read", DISCONNECTED))).toBe("allowed autonomously");
    expect(describePermissionDecision(check("external", CONNECTED_OFF))).toBe("waiting for Hermes approval");
    expect(describePermissionDecision(check("agent", CONNECTED_SMART))).toContain("smart");
  });
});

describe("action registry", () => {
  it("covers every action section 7 requires", () => {
    const required = [
      "open", "close", "focus", "create", "edit", "generate", "generateVariant", "preview",
      "compare", "export", "approve", "pause", "resume", "cancel", "getStatus", "getArtifacts", "sendToCode",
    ];
    for (const name of required) {
      expect(HERMES_DESIGN_STUDIO_ACTION_NAMES).toContain(name as HermesDesignStudioActionName);
    }
  });

  it("only adds extras this repository already has behind them", () => {
    const extras = HERMES_DESIGN_STUDIO_ACTION_NAMES.filter(
      (name) => !["open","close","focus","create","edit","generate","generateVariant","preview","compare","export","approve","pause","resume","cancel","getStatus","getArtifacts","sendToCode"].includes(name),
    );
    expect(new Set(extras)).toEqual(new Set(["applyDesignSystem", "critique", "listSkills", "handoff"]));
  });

  it("names every action on the wire as designStudio.<name>", () => {
    expect(HERMES_ACTION_NAMESPACE).toBe("designStudio");
    expect(parseHermesActionName("designStudio.generate")).toBe("generate");
    expect(parseHermesActionName("generate")).toBe("generate");
    expect(parseHermesActionName("designStudio.nope")).toBeNull();
    expect(parseHermesActionName(42)).toBeNull();
  });

  it("gives sendToCode the external tier and getStatus the read tier", () => {
    expect(hermesActionRisk("sendToCode")).toBe("external");
    expect(hermesActionRisk("getStatus")).toBe("read");
    expect(HERMES_DESIGN_STUDIO_ACTIONS.generate).toBe("agent");
  });

  it("dispatches to a registered handler and returns its value", async () => {
    const registry = createHermesActionRegistry({ permissions: CONNECTED_SMART });
    registry.register("getStatus", () => ({ running: false }));
    const result = await registry.dispatch({ action: "getStatus", context: emptyHermesContext("hermes-action") });
    expect(result).toEqual({ ok: true, action: "getStatus", value: { running: false } });
  });

  it("refuses an action with no handler rather than silently succeeding", async () => {
    const registry = createHermesActionRegistry({ permissions: CONNECTED_SMART });
    const result = await registry.dispatch({ action: "generate", context: emptyHermesContext() });
    expect(result).toMatchObject({ ok: false, code: "unknown-action" });
  });

  it("blocks a permission-denied action and audits the refusal", async () => {
    const audits: { action: string; allowed: boolean; reason: string }[] = [];
    const registry = createHermesActionRegistry({
      permissions: CONNECTED_MANUAL,
      onAudit: (entry) => audits.push(entry),
    });
    registry.register("generate", () => "should not run");
    const result = await registry.dispatch({ action: "generate", context: emptyHermesContext() });
    expect(result).toMatchObject({ ok: false, code: "permission-denied" });
    expect(audits).toContainEqual({ action: "generate", allowed: false, reason: "requires-approval", connected: true });
  });

  it("lets an explicit Hermes grant through the manual gate", async () => {
    const registry = createHermesActionRegistry({ permissions: CONNECTED_MANUAL });
    registry.register("generate", () => "ran");
    const result = await registry.dispatch({
      action: "generate",
      context: emptyHermesContext("hermes-action"),
      explicitGrant: true,
    });
    expect(result).toMatchObject({ ok: true, value: "ran" });
  });

  it("turns a throwing handler into a result, never an escaped exception", async () => {
    const registry = createHermesActionRegistry({ permissions: CONNECTED_SMART });
    registry.register("generate", () => {
      throw new Error("design engine exploded");
    });
    const result = await registry.dispatch({ action: "generate", context: emptyHermesContext() });
    expect(result).toMatchObject({ ok: false, code: "handler-failed" });
    expect((result as { error: string }).error).toContain("design engine exploded");
  });

  it("refuses privileged actions when Hermes is not connected", async () => {
    const registry = createHermesActionRegistry({ permissions: DISCONNECTED });
    registry.register("sendToCode", () => "nope");
    const result = await registry.dispatch({ action: "sendToCode", context: emptyHermesContext() });
    expect(result).toMatchObject({ ok: false, code: "not-connected" });
  });

  it("still serves reads while standalone", async () => {
    const registry = createHermesActionRegistry({ permissions: DISCONNECTED });
    registry.register("getStatus", () => ({ standalone: true }));
    const result = await registry.dispatch({ action: "getStatus", context: emptyHermesContext() });
    expect(result).toMatchObject({ ok: true, value: { standalone: true } });
  });

  it("lists only handled and permitted actions as available", () => {
    const registry = createHermesActionRegistry({ permissions: CONNECTED_MANUAL });
    registry.register("getStatus", () => null);
    registry.register("generate", () => null);
    const available = registry.availableActions();
    expect(available).toContain("getStatus");
    expect(available).not.toContain("generate");
  });

  it("publishes a capability manifest Hermes can enumerate", () => {
    const registry = createHermesActionRegistry({ permissions: CONNECTED_SMART });
    registry.registerAll({ getStatus: () => null, generate: () => null });
    const manifest = registry.manifest();
    expect(manifest.find((entry) => entry.name === "generate")).toMatchObject({
      action: "designStudio.generate",
      risk: "agent",
      available: true,
    });
    // Unhandled actions are listed as unavailable, not omitted, so Hermes can
    // tell "not installed" from "not permitted".
    expect(manifest.find((entry) => entry.name === "export")?.available).toBe(false);
  });
});

describe("natural-language intent mapping", () => {
  const cases: [string, HermesDesignStudioActionName][] = [
    ["Create a landing page for PartForge.", "create"],
    ["Design a homepage for PartForge.", "create"],
    ["Create three alternate versions.", "generateVariant"],
    ["Make this more Apple-like.", "edit"],
    ["Refine the spacing here.", "edit"],
    ["Send this design to Hermes Code.", "sendToCode"],
    ["Export this as a presentation.", "export"],
    ["Show them side by side.", "compare"],
    ["Approve it.", "approve"],
    ["Cancel that.", "cancel"],
    ["Pause the generation.", "pause"],
  ];

  it.each(cases)("maps %j to %s", (text, expected) => {
    const match = matchHermesIntent(text);
    expect(match?.action).toBe(expected);
    expect((match?.confidence ?? 0)).toBeGreaterThanOrEqual(HERMES_INTENT_MIN_CONFIDENCE);
  });

  it("returns null rather than guessing on an unmapped phrase", () => {
    expect(matchHermesIntent("what is the weather")).toBeNull();
    expect(matchHermesIntent("")).toBeNull();
    expect(matchHermesIntent("   ")).toBeNull();
  });

  it("only ever returns a real action name", () => {
    for (const text of cases.map(([entry]) => entry)) {
      const match = matchHermesIntent(text);
      if (match) expect(isHermesDesignStudioActionName(match.action)).toBe(true);
    }
  });
});
