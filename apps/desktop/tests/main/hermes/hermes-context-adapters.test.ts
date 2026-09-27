import { describe, expect, it } from "vitest";

import {
  HERMES_SESSION_ID_PATTERN,
  emptyHermesContext,
  hermesContextVisibleDiff,
  isHermesSessionId,
  mapHermesContext,
  redactHermesContext,
} from "../../../src/main/hermes/hermes-context.js";
import {
  flattenHermesModelOptions,
  hermesModelSelectionChanged,
  mapHermesModelSelection,
  redactHermesModelSelection,
} from "../../../src/main/hermes/hermes-model-adapter.js";
import {
  HERMES_THEME_PRESET_NAMES,
  compositeHermesThemeLayer,
  designThemeTokensChanged,
  designThemeTokensToCssVariables,
  isHermesThemePreset,
  mapHermesThemeToDesignTokens,
} from "../../../src/main/hermes/hermes-theme-adapter.js";
import {
  HERMES_CODE_HANDOFF_KINDS,
  buildHermesCodeHandoff,
  defaultHandoffKind,
  deriveArtifactStatus,
  pickHandoffMetadata,
  toHermesArtifactDescriptor,
} from "../../../src/main/hermes/hermes-artifact-adapter.js";

describe("shared context", () => {
  it("maps a real Hermes session row (snake_case) onto the stable interface", () => {
    const context = mapHermesContext({
      profile_name: "work",
      git_repo_root: "/srv/partforge",
      session_id: "20260927_120000_abc123",
      model: "nous/Hermes-4",
      model_config: { temperature: 0.7 },
      theme: "nous-blue",
      hermes_home: "/home/ada/.hermes",
    });
    expect(context.hermesProfile).toBe("work");
    expect(context.workspaceKey).toBe("/srv/partforge");
    expect(context.conversationId).toBe("20260927_120000_abc123");
    expect(context.modelId).toBe("nous/Hermes-4");
    expect(context.themeId).toBe("nous-blue");
  });

  it("falls back to cwd when a session predates per-session git metadata", () => {
    expect(mapHermesContext({ cwd: "/srv/plain" }).workspaceKey).toBe("/srv/plain");
  });

  it("accepts the camelCase bridge spelling too", () => {
    const context = mapHermesContext({
      hermesProfile: "default",
      workspaceKey: "/srv/x",
      conversationId: "20260927_120000_ffffff",
      modelId: "m",
      themeId: "mono",
      artifactIds: ["a1", "a2"],
    });
    expect(context.hermesProfile).toBe("default");
    expect(context.artifactIds).toEqual(["a1", "a2"]);
  });

  it("never invents a project id: core Hermes sessions have none", () => {
    expect(mapHermesContext({ session_id: "20260927_120000_abc123" }).projectId).toBeNull();
    expect(mapHermesContext({ project_id: "kanban-7" }).projectId).toBe("kanban-7");
  });

  it("drops a conversationId that is not shaped like a real Hermes session id", () => {
    expect(mapHermesContext({ session_id: "not-a-session" }).conversationId).toBeNull();
    expect(mapHermesContext({ session_id: "" }).conversationId).toBeNull();
    expect(isHermesSessionId("20260927_120000_abc123")).toBe(true);
    expect(isHermesSessionId("20260927_120000_abc123456789ab")).toBe(true);
    expect(isHermesSessionId("2026-09-27T12:00:00Z")).toBe(false);
    expect(HERMES_SESSION_ID_PATTERN.test("20260927_120000_")).toBe(false);
  });

  it("preserves unknown upstream keys in extra rather than dropping them", () => {
    const context = mapHermesContext({ some_future_field: 7 });
    expect(context.extra.some_future_field).toBe(7);
  });

  it("redacts model_config and the permission handle", () => {
    const context = mapHermesContext({
      model_config: { api_key_ref: "SECRET" },
      permission_context_id: "grant-xyz",
    });
    const redacted = redactHermesContext(context);
    expect(redacted.modelConfig).toBeNull();
    expect(redacted.permissionContextId).toBeNull();
    expect(JSON.stringify(redacted)).not.toContain("SECRET");
    expect(JSON.stringify(redacted)).not.toContain("grant-xyz");
  });

  it("diffs only fields the UI reflects", () => {
    const base = emptyHermesContext("bridge-sync");
    expect(hermesContextVisibleDiff(base, base)).toEqual([]);
    expect(hermesContextVisibleDiff(base, { ...base, themeId: "mono" })).toEqual(["themeId"]);
    expect(hermesContextVisibleDiff(base, { ...base, artifactIds: ["a"] })).toEqual(["artifactIds"]);
    // A permission change has no visual consequence and must not re-render.
    expect(hermesContextVisibleDiff(base, { ...base, permissionContextId: "g" })).toEqual([]);
  });
});

describe("model adapter", () => {
  it("builds a composite modelId from provider and model", () => {
    expect(mapHermesModelSelection({ provider: "nous", model: "Hermes-4" }).modelId).toBe("nous/Hermes-4");
  });

  it("accepts a session row's `model` alone", () => {
    expect(mapHermesModelSelection({ model: "openrouter/x" }).modelId).toBe("openrouter/x");
  });

  it("returns an empty selection for junk", () => {
    expect(mapHermesModelSelection(null).modelId).toBeNull();
    expect(mapHermesModelSelection("nope").modelId).toBeNull();
  });

  it("strips model_config when redacting for the renderer", () => {
    const selection = mapHermesModelSelection({ provider: "nous", model: "m", model_config: { api_key: "sk-1" } });
    expect(selection.modelConfig).not.toBeNull();
    const redacted = redactHermesModelSelection(selection);
    expect(redacted.modelConfig).toBeNull();
    expect(redacted.modelId).toBe("nous/m");
  });

  it("detects a change", () => {
    const a = mapHermesModelSelection({ provider: "nous", model: "m1" });
    const b = mapHermesModelSelection({ provider: "nous", model: "m2" });
    expect(hermesModelSelectionChanged(a, a)).toBe(false);
    expect(hermesModelSelectionChanged(a, b)).toBe(true);
    expect(hermesModelSelectionChanged(null, a)).toBe(true);
  });

  it("flattens a provider-keyed options payload without asserting one nesting", () => {
    const options = flattenHermesModelOptions({
      providers: [
        { provider: "nous", configured: true, models: [{ model: "Hermes-4", context_length: 200_000 }] },
        { provider: "openrouter", models: [{ id: "anthropic/claude", label: "Claude" }] },
      ],
    });
    expect(options.map((entry) => `${entry.provider}/${entry.model}`).sort()).toEqual([
      "nous/Hermes-4",
      "openrouter/anthropic/claude",
    ]);
    expect(options.find((entry) => entry.model === "Hermes-4")?.contextLength).toBe(200_000);
  });

  it("de-duplicates repeated model entries", () => {
    const options = flattenHermesModelOptions([{ provider: "p", model: "m" }, { provider: "p", model: "m" }]);
    expect(options).toHaveLength(1);
  });
});

describe("theme adapter", () => {
  const hermesTheme = {
    name: "nous-blue",
    label: "Nous Blue",
    palette: {
      background: { hex: "#000033", alpha: 1 },
      midground: { hex: "#ffffff", alpha: 1 },
      foreground: { hex: "#ffffff", alpha: 0 },
    },
    typography: {
      fontSans: '"Inter", sans-serif',
      fontMono: '"JetBrains Mono", monospace',
      fontDisplay: '"Mondwest", serif',
      baseSize: "16px",
      lineHeight: "1.5",
      letterSpacing: "normal",
    },
    layout: { radius: "0.5rem", density: "comfortable" },
  };

  it("recognises the presets upstream ships", () => {
    for (const name of HERMES_THEME_PRESET_NAMES) expect(isHermesThemePreset(name)).toBe(true);
    expect(isHermesThemePreset("my-custom")).toBe(false);
  });

  it("maps the midground to text/accent, not the invisible foreground", () => {
    const tokens = mapHermesThemeToDesignTokens(hermesTheme);
    expect(tokens?.text).toBe("#ffffff");
    expect(tokens?.accent).toBe("#ffffff");
    expect(tokens?.canvas).toBe("#000033");
    expect(tokens?.fontDisplay).toBe('"Mondwest", serif');
    expect(tokens?.radius).toBe("0.5rem");
    expect(tokens?.isPreset).toBe(true);
  });

  it("composites a translucent layer over the canvas", () => {
    expect(compositeHermesThemeLayer({ hex: "#ffffff", alpha: 0.5 }, "#000000")).toBe("#808080");
    expect(compositeHermesThemeLayer({ hex: "#ffffff", alpha: 0 }, "#000000")).toBe("#000000");
    expect(compositeHermesThemeLayer({ hex: "#ffffff", alpha: 1 }, "#000000")).toBe("#ffffff");
  });

  it("clamps an out-of-range alpha instead of producing an invalid colour", () => {
    expect(compositeHermesThemeLayer({ hex: "#ffffff", alpha: 9 }, "#000000")).toBe("#ffffff");
    expect(compositeHermesThemeLayer({ hex: "#ffffff", alpha: -3 }, "#000000")).toBe("#000000");
  });

  it("rejects a payload that is not a Hermes theme", () => {
    expect(mapHermesThemeToDesignTokens(null)).toBeNull();
    expect(mapHermesThemeToDesignTokens({})).toBeNull();
    expect(mapHermesThemeToDesignTokens({ name: "x" })).toBeNull();
    expect(mapHermesThemeToDesignTokens({ name: "x", palette: { background: { hex: "blue", alpha: 1 } } })).toBeNull();
  });

  it("emits --hermes-* variables and reports changes", () => {
    const tokens = mapHermesThemeToDesignTokens(hermesTheme)!;
    const variables = designThemeTokensToCssVariables(tokens);
    expect(variables["--hermes-canvas"]).toBe("#000033");
    expect(variables["--hermes-theme-name"]).toBe("nous-blue");
    expect(Object.keys(variables).every((key) => key.startsWith("--hermes-"))).toBe(true);

    expect(designThemeTokensChanged(tokens, tokens)).toBe(false);
    expect(designThemeTokensChanged(tokens, { ...tokens, canvas: "#000000" })).toBe(true);
    expect(designThemeTokensChanged(null, tokens)).toBe(true);
  });

  it("carries pinned colour overrides through", () => {
    const tokens = mapHermesThemeToDesignTokens({
      ...hermesTheme,
      colorOverrides: { destructive: "#ff0000" },
    });
    expect(tokens?.colorOverrides.destructive).toBe("#ff0000");
    expect(designThemeTokensToCssVariables(tokens!)["--hermes-override-destructive"]).toBe("#ff0000");
  });
});

describe("artifact adapter", () => {
  const manifest = {
    version: 1,
    kind: "html",
    title: "PartForge landing",
    entry: "index.html",
    renderer: "html",
    status: "complete",
    exports: ["html", "pdf"],
    supportingFiles: ["assets/logo.svg", "styles.css"],
    createdAt: "2026-09-27T12:00:00.000Z",
    updatedAt: "2026-09-27T12:05:00.000Z",
    sourceProjectId: "proj-1",
    designSystemId: "ds-1",
    metadata: { designSystemId: "ds-1", sourceSkillId: "landing", secret: "do-not-leak" },
    exportTargets: [{ surface: "desktop", target: "/tmp/out.pdf", exportedAt: 1_700_000_000 }],
  } as unknown as Record<string, unknown>;

  it("produces a Hermes-visible descriptor with every field section 17 asks for", () => {
    const descriptor = toHermesArtifactDescriptor({
      artifactId: "art-1",
      manifest,
      context: mapHermesContext({ session_id: "20260927_120000_abc123", git_repo_root: "/srv/partforge" }),
      version: 3,
      previewUrl: "http://127.0.0.1:1/p/art-1",
    });
    expect(descriptor.artifactId).toBe("art-1");
    expect(descriptor.version).toBe(3);
    expect(descriptor.status).toBe("exported");
    expect(descriptor.conversationId).toBe("20260927_120000_abc123");
    expect(descriptor.workspaceKey).toBe("/srv/partforge");
    expect(descriptor.projectId).toBe("proj-1");
    expect(descriptor.previewUrl).toContain("art-1");
    expect(descriptor.exportTargets).toHaveLength(1);
    expect(descriptor.createdAt).toBe(Date.parse("2026-09-27T12:00:00.000Z"));
  });

  it("keeps a streaming artifact as draft so Chat never previews half-written output", () => {
    expect(deriveArtifactStatus({ status: "streaming" })).toBe("draft");
    expect(deriveArtifactStatus({ status: "error" })).toBe("failed");
    expect(deriveArtifactStatus({ status: "complete" })).toBe("ready");
    expect(deriveArtifactStatus({ exports: ["pdf"] })).toBe("exported");
  });

  it("falls back to the manifest's own project when the context has none", () => {
    expect(toHermesArtifactDescriptor({ artifactId: "a", manifest }).projectId).toBe("proj-1");
  });
});

describe("Design Studio → Hermes Code handoff", () => {
  const manifest = {
    kind: "html",
    title: "PartForge landing",
    entry: "index.html",
    supportingFiles: ["styles.css", "assets/logo.svg"],
    sourceProjectId: "proj-1",
    metadata: { designSystemId: "ds-1", sourceSkillId: "landing", secret: "do-not-leak" },
  } as unknown as Record<string, unknown>;

  it("carries project, artifact, entry, assets, intent, variant and context", () => {
    const handoff = buildHermesCodeHandoff({
      artifactId: "art-1",
      manifest,
      variantId: "variant-b",
      intent: "Apple-like, restrained",
      context: mapHermesContext({ session_id: "20260927_120000_abc123", git_repo_root: "/srv/partforge" }),
    });
    expect(handoff).not.toBeNull();
    expect(handoff?.artifactId).toBe("art-1");
    expect(handoff?.target).toBe("hermes-code");
    expect(handoff?.entry).toBe("index.html");
    expect(handoff?.assets).toEqual(["index.html", "styles.css", "assets/logo.svg"]);
    expect(handoff?.variantId).toBe("variant-b");
    expect(handoff?.intent).toBe("Apple-like, restrained");
    expect(handoff?.projectId).toBe("proj-1");
    expect(handoff?.workspaceKey).toBe("/srv/partforge");
    expect(handoff?.conversationId).toBe("20260927_120000_abc123");
  });

  it("always includes the entry in the asset list", () => {
    const handoff = buildHermesCodeHandoff({
      artifactId: "a",
      manifest: { entry: "main.html", supportingFiles: ["main.html", "b.css"] } as Record<string, unknown>,
    });
    expect(handoff?.assets).toEqual(["main.html", "b.css"]);
  });

  it("refuses an artifact with no entry rather than handing over nothing buildable", () => {
    expect(buildHermesCodeHandoff({ artifactId: "a", manifest: { kind: "html" } })).toBeNull();
    expect(buildHermesCodeHandoff({ artifactId: "", manifest })).toBeNull();
  });

  it("picks the handoff kind from what the artifact actually is", () => {
    expect(defaultHandoffKind({ kind: "mini-app" })).toBe("deployable-app");
    expect(defaultHandoffKind({ kind: "design-system" })).toBe("deployable-app");
    expect(defaultHandoffKind({ kind: "code-snippet" })).toBe("patch");
    expect(defaultHandoffKind({ kind: "html" })).toBe("implementation-plan");
    expect(HERMES_CODE_HANDOFF_KINDS).toContain("design-only");
  });

  it("honours an explicitly requested handoff kind", () => {
    expect(buildHermesCodeHandoff({ artifactId: "a", manifest, handoffKind: "design-only" })?.handoffKind).toBe(
      "design-only",
    );
  });

  it("only forwards design-describing metadata, never the whole bag", () => {
    const handoff = buildHermesCodeHandoff({ artifactId: "a", manifest });
    expect(handoff?.designMetadata).toEqual({ designSystemId: "ds-1", sourceSkillId: "landing" });
    expect(JSON.stringify(handoff?.designMetadata)).not.toContain("do-not-leak");
    expect(pickHandoffMetadata({ secret: "x", designSystemId: "ds" })).toEqual({ designSystemId: "ds" });
  });
});
