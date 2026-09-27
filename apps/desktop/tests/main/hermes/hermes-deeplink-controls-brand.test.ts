import { describe, expect, it } from "vitest";

import {
  HERMES_DESIGN_STUDIO_SCHEME,
  HERMES_SCHEME,
  buildHermesDeepLink,
  createHermesDeepLinkDispatcher,
  findHermesDeepLinkArg,
  isSafeHermesDeepLinkId,
  parseHermesDeepLink,
  planHermesProtocolClientRegistration,
} from "../../../src/main/hermes/hermes-deeplink.js";
import {
  HERMES_CHAT_CARD_ACTIONS,
  HERMES_FLOATING_CONTROLS,
  chatCardActionsFor,
  controlsForTask,
  groupControlsBySlot,
  validateFloatingControls,
} from "../../../src/main/hermes/hermes-controls.js";
import {
  HERMES_BRAND_COLORS,
  HERMES_DESIGN_STUDIO_PRODUCT_NAME,
  HERMES_FONT_FAMILIES,
  HERMES_VENDORED_FONT_FACES,
  HERMES_WORDMARK,
  containsLegacyProductName,
  hermesBrandCssVariables,
  hermesContrastRatio,
  hermesFontFaceCss,
  hermesReadableTextOn,
} from "../../../src/main/hermes/hermes-brand.js";
import { HERMES_DESIGN_STUDIO_ACTION_NAMES } from "../../../src/main/hermes/hermes-actions.js";

describe("deep link parsing", () => {
  it("parses a bare root on either scheme", () => {
    expect(parseHermesDeepLink("hermes-design-studio://")?.target).toEqual({ kind: "root" });
    expect(parseHermesDeepLink("hermes://design-studio")?.target).toEqual({ kind: "root" });
    expect(parseHermesDeepLink("hermes://design-studio/")?.target).toEqual({ kind: "root" });
  });

  it.each([
    ["hermes://design-studio/project/p-1", { kind: "project", id: "p-1" }],
    ["hermes://design-studio/design/d-1", { kind: "design", id: "d-1" }],
    ["hermes://design-studio/artifact/a-1", { kind: "artifact", id: "a-1" }],
    ["hermes://design-studio/session/20260927_120000_abc123", { kind: "session", id: "20260927_120000_abc123" }],
  ])("parses %s", (url, expected) => {
    expect(parseHermesDeepLink(url)?.target).toEqual(expected);
  });

  it("parses the same targets on the Design Studio scheme", () => {
    expect(parseHermesDeepLink("hermes-design-studio://design/d-1")?.target).toEqual({ kind: "design", id: "d-1" });
    expect(parseHermesDeepLink("hermes-design-studio://project/p-1")?.target).toEqual({ kind: "project", id: "p-1" });
  });

  it("accepts the upstream dev scheme so a dev Hermes can drive a dev Studio", () => {
    expect(parseHermesDeepLink("hermes-dev://design-studio/design/d-1")?.target).toEqual({ kind: "design", id: "d-1" });
  });

  it("carries query parameters", () => {
    const link = parseHermesDeepLink("hermes://design-studio/design/d-1?variant=v2&model=nous");
    expect(link?.params).toEqual({ variant: "v2", model: "nous" });
  });

  it("parses an action link with its arguments", () => {
    const link = parseHermesDeepLink("hermes-design-studio://action/generateVariant?count=3");
    expect(link?.target).toEqual({ kind: "action", action: "generateVariant", args: { count: "3" } });
  });

  it("rejects a link aimed at another Hermes module", () => {
    expect(parseHermesDeepLink("hermes://blueprint/morning-brief")).toBeNull();
    expect(parseHermesDeepLink("hermes://mcp/install?name=x")).toBeNull();
  });

  it("rejects another scheme entirely", () => {
    expect(parseHermesDeepLink("opendesign://workspace/open")).toBeNull();
    expect(parseHermesDeepLink("https://example.com")).toBeNull();
  });

  it("rejects malformed input rather than guessing", () => {
    expect(parseHermesDeepLink(null)).toBeNull();
    expect(parseHermesDeepLink("")).toBeNull();
    expect(parseHermesDeepLink("not a url")).toBeNull();
    expect(parseHermesDeepLink("hermes://design-studio/unknown/x")).toBeNull();
    expect(parseHermesDeepLink("hermes://design-studio/design/")).toBeNull();
  });

  it("rejects an id that could smuggle a path or URL onward", () => {
    expect(isSafeHermesDeepLinkId("d-1")).toBe(true);
    expect(isSafeHermesDeepLinkId("../etc/passwd")).toBe(false);
    expect(isSafeHermesDeepLinkId("a/b")).toBe(false);
    expect(isSafeHermesDeepLinkId("")).toBe(false);
    expect(parseHermesDeepLink("hermes://design-studio/design/..%2F..%2Fetc")).toBeNull();
  });

  it("records which scheme a link arrived on", () => {
    expect(parseHermesDeepLink("hermes://design-studio/design/d-1")?.scheme).toBe(HERMES_SCHEME);
    expect(parseHermesDeepLink("hermes-design-studio://design/d-1")?.scheme).toBe(HERMES_DESIGN_STUDIO_SCHEME);
  });
});

describe("deep link construction", () => {
  it("always builds the hermes:// form, because Hermes owns that scheme", () => {
    const url = buildHermesDeepLink({ kind: "design", id: "d-1" });
    expect(url).toBe("hermes://design-studio/design/d-1");
    expect(url.startsWith("hermes-design-studio://")).toBe(false);
  });

  it("round-trips through the parser", () => {
    for (const target of [
      { kind: "root" as const },
      { kind: "project" as const, id: "p-1" },
      { kind: "design" as const, id: "d-1" },
      { kind: "artifact" as const, id: "a-1" },
      { kind: "session" as const, id: "20260927_120000_abc123" },
    ]) {
      expect(parseHermesDeepLink(buildHermesDeepLink(target))?.target).toEqual(target);
    }
  });

  it("encodes action arguments", () => {
    const url = buildHermesDeepLink({ kind: "action", action: "generate", args: { prompt: "a b" } });
    expect(url).toContain("action/generate");
    expect(parseHermesDeepLink(url)?.params.prompt).toBe("a b");
  });
});

describe("protocol registration", () => {
  it("never claims hermes:// — Hermes re-asserts that scheme on every start", () => {
    const plan = planHermesProtocolClientRegistration({ platform: "win32", isPackaged: true });
    expect(plan).toMatchObject({ register: true, scheme: HERMES_DESIGN_STUDIO_SCHEME });
    if (plan.register) expect(plan.scheme).not.toBe(HERMES_SCHEME);
  });

  it("refuses to claim any scheme in a dev run", () => {
    const plan = planHermesProtocolClientRegistration({ platform: "darwin", isPackaged: false });
    expect(plan).toEqual({ register: false, reason: "not-packaged" });
  });

  it("registers the stable launcher path on Windows, not the versioned payload exe", () => {
    const plan = planHermesProtocolClientRegistration({
      platform: "win32",
      isPackaged: true,
      protocolClientPath: "C:\\Apps\\HermesDesignStudio.exe",
    });
    expect(plan).toMatchObject({ register: true, clientPath: "C:\\Apps\\HermesDesignStudio.exe" });
  });

  it("registers this process on macOS", () => {
    const plan = planHermesProtocolClientRegistration({ platform: "darwin", isPackaged: true });
    if (plan.register) expect(plan.clientPath).toBeNull();
  });

  it("finds a deep link in argv", () => {
    expect(findHermesDeepLinkArg(["--flag", "hermes://design-studio/design/d-1"])).toBe(
      "hermes://design-studio/design/d-1",
    );
    expect(findHermesDeepLinkArg(["--flag"])).toBeNull();
  });

  it("queues links that arrive before the runtime is ready, then flushes them", () => {
    const handled: unknown[] = [];
    const dispatcher = createHermesDeepLinkDispatcher((link) => void handled.push(link));
    dispatcher.dispatch("hermes://design-studio/design/d-1");
    expect(handled).toHaveLength(0);
    expect(dispatcher.pendingCount()).toBe(1);
    dispatcher.markReady();
    expect(handled).toHaveLength(1);
    expect(dispatcher.pendingCount()).toBe(0);
  });

  it("drops a malformed queued link instead of handling it half-way", () => {
    const handled: unknown[] = [];
    const dispatcher = createHermesDeepLinkDispatcher((link) => void handled.push(link));
    dispatcher.dispatch("hermes://design-studio/bogus/x");
    dispatcher.markReady();
    expect(handled).toHaveLength(0);
  });
});

describe("floating controls", () => {
  it("binds every control to a real action — no decorative UI", () => {
    expect(validateFloatingControls()).toEqual([]);
    for (const control of HERMES_FLOATING_CONTROLS) {
      expect(HERMES_DESIGN_STUDIO_ACTION_NAMES).toContain(control.action);
    }
  });

  it("offers the section-11 contextual options", () => {
    const labels = HERMES_FLOATING_CONTROLS.map((control) => control.label);
    for (const label of ["Design", "Generate", "Variant", "Refine", "Preview", "Compare", "Export", "Send to Code"]) {
      expect(labels).toContain(label);
    }
  });

  it("hides a control whose action is not currently available", () => {
    const withGenerate = controlsForTask("idle", ["create", "generate"]);
    expect(withGenerate.map((control) => control.id)).toEqual(["design", "generate"]);
    expect(controlsForTask("idle", ["create"]).map((control) => control.id)).toEqual(["design"]);
  });

  it("adapts to the task state", () => {
    expect(controlsForTask("generating", HERMES_DESIGN_STUDIO_ACTION_NAMES).map((control) => control.id)).toContain("pause");
    expect(controlsForTask("generating", HERMES_DESIGN_STUDIO_ACTION_NAMES).map((control) => control.id)).not.toContain("design");
    expect(controlsForTask("paused", HERMES_DESIGN_STUDIO_ACTION_NAMES).map((control) => control.id)).toContain("resume");
    expect(controlsForTask("ready", HERMES_DESIGN_STUDIO_ACTION_NAMES).map((control) => control.id)).toContain("send-to-code");
  });

  it("splits controls between the composer bar and the floating card", () => {
    const grouped = groupControlsBySlot(controlsForTask("ready", HERMES_DESIGN_STUDIO_ACTION_NAMES));
    expect(grouped["composer-bar"].length).toBeGreaterThan(0);
    expect(grouped["floating-card"].length).toBeGreaterThan(0);
    expect(grouped["composer-bar"].every((control) => control.slot === "composer-bar")).toBe(true);
  });

  it("orders controls deterministically", () => {
    const controls = controlsForTask("ready", HERMES_DESIGN_STUDIO_ACTION_NAMES);
    const orders = controls.map((control) => control.order);
    expect(orders).toEqual([...orders].sort((left, right) => left - right));
  });

  it("offers the Hermes Chat card actions from the same registry", () => {
    const labels = HERMES_CHAT_CARD_ACTIONS.map((entry) => entry.label);
    expect(labels).toContain("Open in Design Studio");
    expect(labels).toContain("Send to Hermes Code");
    expect(chatCardActionsFor(["open", "edit"]).map((entry) => entry.action)).toEqual(["open", "edit"]);
    expect(chatCardActionsFor([])).toEqual([]);
  });
});

describe("brand identity", () => {
  it("presents the product as Hermes Design Studio", () => {
    expect(HERMES_DESIGN_STUDIO_PRODUCT_NAME).toBe("Hermes Design Studio");
  });

  it("carries the specified palette exactly", () => {
    expect(HERMES_BRAND_COLORS.primary).toBe("#0000F2");
    expect(HERMES_BRAND_COLORS.light).toBe("#F5F5F5");
    expect(HERMES_BRAND_COLORS.white).toBe("#FFFFFF");
    expect(HERMES_BRAND_COLORS.accent).toBe("#EDFF45");
    for (const value of ["#0000D9", "#1A1AFF", "#000099", "#0000CC", "#3333FF", "#E9ECEF", "#D0D0D0", "#A0A0A0", "#FF4444", "#FF8888"]) {
      expect(Object.values(HERMES_BRAND_COLORS)).toContain(value);
    }
  });

  it("names the specified typefaces for each role", () => {
    expect(HERMES_FONT_FAMILIES.display.specified).toBe("Sigurd");
    expect(HERMES_FONT_FAMILIES.ui.specified).toBe("Rules");
    expect(HERMES_FONT_FAMILIES.technical.specified).toBe("Courier Prime");
  });

  it("is honest about which font assets are actually vendored", () => {
    expect(HERMES_FONT_FAMILIES.ui.assetVendored).toBe(true);
    expect(HERMES_FONT_FAMILIES.display.assetVendored).toBe(false);
    expect(HERMES_FONT_FAMILIES.technical.assetVendored).toBe(false);
  });

  it("declares the specified face first in every stack", () => {
    for (const family of Object.values(HERMES_FONT_FAMILIES)) {
      expect(family.stack.startsWith(`"${family.specified}`) || family.stack.startsWith(`"${family.specified.split(" ")[0]}`)).toBe(true);
    }
  });

  it("vendors the real Rules faces from the pinned Hermes submodule", () => {
    expect(HERMES_VENDORED_FONT_FACES.map((face) => face.file).sort()).toEqual([
      "RulesCompressed-Medium.woff2",
      "RulesCompressed-Regular.woff2",
      "RulesExpanded-Bold.woff2",
      "RulesExpanded-Regular.woff2",
    ]);
    expect(HERMES_VENDORED_FONT_FACES.every((face) => face.file.endsWith(".woff2"))).toBe(true);
  });

  it("emits @font-face rules with the declared stretch, since Rules is two distinct cuts", () => {
    const css = hermesFontFaceCss("/fonts/hermes");
    expect(css).toContain('font-family: "Rules Compressed"');
    expect(css).toContain("font-stretch: compressed");
    expect(css).toContain("font-stretch: expanded");
    expect(css).toContain('url("/fonts/hermes/RulesExpanded-Bold.woff2")');
    expect(css).toContain("font-display: swap");
  });

  it("renders the HERMES wordmark in the display face", () => {
    expect(HERMES_WORDMARK.text).toBe("HERMES");
    expect(HERMES_WORDMARK.fontFamily).toBe(HERMES_FONT_FAMILIES.display.stack);
    expect(HERMES_WORDMARK.color).toBe(HERMES_BRAND_COLORS.primary);
  });

  it("emits --hermes-brand-* variables", () => {
    const variables = hermesBrandCssVariables();
    expect(variables["--hermes-brand-primary"]).toBe("#0000F2");
    expect(variables["--hermes-font-ui"]).toBe(HERMES_FONT_FAMILIES.ui.stack);
  });

  it("keeps text readable on both brand surfaces", () => {
    expect(hermesContrastRatio(HERMES_BRAND_COLORS.accent, HERMES_BRAND_COLORS.primary)).toBeGreaterThan(4.5);
    expect(hermesReadableTextOn(HERMES_BRAND_COLORS.primary)).toBe(HERMES_BRAND_COLORS.white);
    expect(hermesReadableTextOn(HERMES_BRAND_COLORS.white)).toBe(HERMES_BRAND_COLORS.primary);
  });

  it("flags legacy product names so a rename regression fails the build", () => {
    expect(containsLegacyProductName("Open Design")).toBe(true);
    expect(containsLegacyProductName("Hermes Design Studio")).toBe(false);
  });
});
