import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertHermesVendorExcludedInTree,
  collectPackagedPaths,
  HERMES_RELEASE_ARTIFACT_BASENAME,
  HERMES_VENDOR_SUBMODULE_PATH,
  assertHermesVendorExcluded,
  checkHermesVendorExclusion,
  hermesReleaseArtifactNames,
  hermesVendorExclusionFailure,
  parseSha256Sums,
  renderSha256Sums,
  sha256Hex,
  verifySha256Sums,
} from "@/win/release-artifacts.js";

describe("public release artifact names", () => {
  it("produces the names the release contract documents", () => {
    expect(hermesReleaseArtifactNames()).toEqual({
      portable: "HermesDesignStudio-Windows-x64.exe",
      setup: "HermesDesignStudio-Setup-Windows-x64.exe",
      checksums: "SHA256SUMS.txt",
    });
  });

  it("carries the arch rather than hardcoding x64", () => {
    expect(hermesReleaseArtifactNames({ arch: "arm64" }).portable).toBe("HermesDesignStudio-Windows-arm64.exe");
    expect(hermesReleaseArtifactNames({ arch: "arm64" }).setup).toBe("HermesDesignStudio-Setup-Windows-arm64.exe");
  });

  it("keeps the base name free of spaces so URLs and scripts stay simple", () => {
    expect(HERMES_RELEASE_ARTIFACT_BASENAME).not.toContain(" ");
    expect(hermesReleaseArtifactNames().setup).not.toContain(" ");
  });
});

describe("SHA256SUMS", () => {
  const entries = [
    { name: "HermesDesignStudio-Windows-x64.exe", sha256: sha256Hex("portable-bytes"), bytes: 14 },
    { name: "HermesDesignStudio-Setup-Windows-x64.exe", sha256: sha256Hex("setup-bytes"), bytes: 11 },
  ];

  it("renders the GNU coreutils two-space format", () => {
    const manifest = renderSha256Sums(entries);
    for (const line of manifest.trimEnd().split("\n")) {
      expect(line).toMatch(/^[0-9a-f]{64}  \S+$/);
    }
  });

  it("sorts entries so the manifest is reproducible", () => {
    const manifest = renderSha256Sums([...entries].reverse());
    const names = manifest.trimEnd().split("\n").map((line) => line.split("  ")[1]);
    expect(names).toEqual([...names].sort());
  });

  it("round-trips through the parser", () => {
    const parsed = parseSha256Sums(renderSha256Sums(entries));
    expect(parsed.map((entry) => entry.name).sort()).toEqual(entries.map((entry) => entry.name).sort());
    expect(parsed.map((entry) => entry.sha256).sort()).toEqual(entries.map((entry) => entry.sha256).sort());
  });

  it("renders an empty manifest for no entries", () => {
    expect(renderSha256Sums([])).toBe("");
  });

  it("verifies matching files and reports mismatches by name", () => {
    const files = {
      "HermesDesignStudio-Windows-x64.exe": "portable-bytes",
      "HermesDesignStudio-Setup-Windows-x64.exe": "setup-bytes",
    };
    expect(verifySha256Sums(renderSha256Sums(entries), files)).toEqual([]);
  });

  it("reports a tampered file", () => {
    const problems = verifySha256Sums(renderSha256Sums(entries), {
      "HermesDesignStudio-Windows-x64.exe": "tampered",
      "HermesDesignStudio-Setup-Windows-x64.exe": "setup-bytes",
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.name).toBe("HermesDesignStudio-Windows-x64.exe");
    expect(problems[0]?.problem).toContain("digest mismatch");
  });

  it("reports a missing file", () => {
    const problems = verifySha256Sums(renderSha256Sums(entries), {});
    expect(problems.map((entry) => entry.problem)).toEqual(["missing", "missing"]);
  });

  it("ignores comments and blank lines", () => {
    expect(parseSha256Sums("# a comment\n\n")).toEqual([]);
  });
});

describe("vendored Hermes exclusion gate", () => {
  it("passes a clean package", () => {
    const result = checkHermesVendorExclusion([
      { path: "resources/app/main.cjs" },
      { path: "resources/app/dist/main/index.js" },
      { path: "resources/app/node_modules/electron/package.json" },
    ]);
    expect(result.clean).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("fails when the vendored submodule was packaged", () => {
    const result = checkHermesVendorExclusion([
      { path: "resources/app/main.cjs" },
      { path: "resources/app/vendor/nous-hermes/README.md" },
      { path: "resources/app/vendor/nous-hermes/hermes_constants.py" },
    ]);
    expect(result.clean).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it("catches Windows separators too", () => {
    const result = checkHermesVendorExclusion([{ path: "resources\\app\\vendor\\nous-hermes\\cli.py" }]);
    expect(result.clean).toBe(false);
    expect(result.violations[0]).toBe("resources/app/vendor/nous-hermes/cli.py");
  });

  it("catches a renamed vendor directory", () => {
    expect(checkHermesVendorExclusion([{ path: "resources/app/third_party/hermes-agent/cli.py" }]).clean).toBe(false);
  });

  it("ships the product's own Hermes integration layer", () => {
    const result = checkHermesVendorExclusion([
      { path: "resources/app/dist/main/hermes/hermes-bridge.js" },
      { path: "resources/app/dist/main/hermes/hermes-discovery.js" },
      { path: "resources/app/dist/main/hermes-desktop.js" },
      { path: "resources/app/public/fonts/hermes/RulesExpanded-Bold.woff2" },
    ]);
    expect(result.clean).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("records allowlisted decisions so the build log shows what was considered", () => {
    const result = checkHermesVendorExclusion([{ path: "resources/app/dist/main/hermes/hermes-bridge.js" }]);
    expect(result.clean).toBe(true);
  });

  it("assertHermesVendorExcluded throws an actionable message", () => {
    expect(() =>
      assertHermesVendorExcluded([{ path: `resources/app/${HERMES_VENDOR_SUBMODULE_PATH}/cli.py` }]),
    ).toThrow(/vendored Hermes source/);
    expect(() => assertHermesVendorExcluded([{ path: "resources/app/main.cjs" }])).not.toThrow();
  });

  it("names the remediation in the failure message", () => {
    const message = hermesVendorExclusionFailure(
      checkHermesVendorExclusion([{ path: "resources/app/vendor/nous-hermes/cli.py" }]),
    );
    expect(message).toContain("development-only submodule");
    expect(message).toContain("electron-builder file");
  });

  it("truncates a long violation list but reports the true count", () => {
    const entries = Array.from({ length: 45 }, (_unused, index) => ({
      path: `resources/app/vendor/nous-hermes/file-${index}.py`,
    }));
    const message = hermesVendorExclusionFailure(checkHermesVendorExclusion(entries));
    expect(message).toContain("45 path(s)");
    expect(message).toContain("and 25 more");
  });
});

describe("packaged tree walker", () => {
  /** In-memory directory tree: absolute path -> child names. */
  function fakeTree(tree: Record<string, string[]>) {
    return async (path: string) =>
      (tree[path] ?? []).map((name) => ({
        name,
        isDirectory: Object.hasOwn(tree, `${path}/${name}`),
        isSymbolicLink: false,
      }));
  }

  it("lists files recursively, relative to the root", async () => {
    const entries = await collectPackagedPaths("/pkg", {
      readdir: fakeTree({
        "/pkg": ["main.cjs", "dist", "vendor"],
        "/pkg/dist": ["index.js"],
        "/pkg/vendor": ["nous-hermes"],
        "/pkg/vendor/nous-hermes": ["cli.py", "README.md"],
      }),
    });
    expect(entries.map((entry) => entry.path).sort()).toEqual([
      "dist/index.js",
      "main.cjs",
      "vendor/nous-hermes/README.md",
      "vendor/nous-hermes/cli.py",
    ]);
  });

  it("survives an unreadable directory", async () => {
    // `broken` must actually be a directory for the walker to descend into it
    // and hit the failure.
    const tree = fakeTree({ "/pkg": ["broken", "ok.txt"], "/pkg/broken": [] });
    const readdir = async (path: string) => {
      if (path === "/pkg/broken") throw new Error("EACCES");
      return tree(path);
    };
    const entries = await collectPackagedPaths("/pkg", { readdir });
    expect(entries.map((entry) => entry.path)).toEqual(["ok.txt"]);
  });

  it("honours the entry bound so a pathological tree cannot hang packaging", async () => {
    const entries = await collectPackagedPaths("/pkg", {
      readdir: fakeTree({ "/pkg": Array.from({ length: 50 }, (_u, i) => `f${i}.txt`) }),
      maxEntries: 10,
    });
    expect(entries).toHaveLength(10);
  });

  it("fails the build when a real built tree contains the vendored submodule", async () => {
    // Real filesystem on purpose: this is the assertion wired into the Windows
    // build, so it has to be exercised through the default readdir rather than
    // a stub.
    const root = await mkdtemp(join(tmpdir(), "hermes-vendor-gate-"));
    try {
      await mkdir(join(root, "dist"), { recursive: true });
      await writeFile(join(root, "dist", "hermes-bridge.js"), "// ours, must ship\n");
      await mkdir(join(root, "vendor", "nous-hermes"), { recursive: true });
      await writeFile(join(root, "vendor", "nous-hermes", "cli.py"), "# vendored\n");

      await expect(assertHermesVendorExcludedInTree(root)).rejects.toThrow(/vendored Hermes source/);

      // Removing the vendored tree makes the same call pass, so the gate is
      // sensitive to exactly the thing it claims to catch.
      await rm(join(root, "vendor"), { recursive: true, force: true });
      await expect(assertHermesVendorExcludedInTree(root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
