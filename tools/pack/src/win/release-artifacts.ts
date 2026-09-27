// Release-artifact naming, checksums, and the vendored-Hermes exclusion gate.
//
// Three concerns that belong together because they all run once, at the end of a
// Windows build, over the artifacts that are about to be published:
//
//   1. **Public names.** The internal `tools/pack` path scheme encodes the
//      namespace (`${PRODUCT_NAME}-${namespace}-setup.exe`) and is load-bearing
//      for the blockmap and `latest.yml` updater feed, so it is not rewritten.
//      The published filenames are derived from it instead, giving the release
//      the stable names the product documents.
//   2. **Checksums.** A `SHA256SUMS.txt` in the BSD/GNU-coreutils format
//      (`<hex>  <name>`, two spaces) so `sha256sum -c` verifies it unchanged.
//   3. **The exclusion gate.** `vendor/nous-hermes` is a *development* submodule:
//      it exists so this codebase can read the real Hermes source, verify
//      compatibility and test against a pinned commit. It must never ship. This
//      module fails the build when it finds any trace of it in what is about to
//      be packaged — requirement 20's "automated packaging check".
//
// Pure and filesystem-injected, so all three are unit-testable without a
// Windows build.

import { createHash } from "node:crypto";

/** Public artifact base name, with no spaces so URLs and scripts stay simple. */
export const HERMES_RELEASE_ARTIFACT_BASENAME = "HermesDesignStudio";

/** The vendored Hermes submodule path that must never appear in a package. */
export const HERMES_VENDOR_SUBMODULE_PATH = "vendor/nous-hermes";

/** Substrings that identify vendored Hermes material inside a packaged tree. */
export const HERMES_VENDOR_MARKERS = Object.freeze([
  "vendor/nous-hermes",
  "vendor\\nous-hermes",
  "nous-hermes",
  "hermes-agent",
] as const);

/** Path fragments that are *expected* to mention Hermes and are not violations. */
export const HERMES_VENDOR_ALLOWLIST = Object.freeze([
  // The bridge itself, and its tests.
  "/main/hermes/",
  "\\main\\hermes\\",
  "/main/hermes-desktop",
  "\\main\\hermes-desktop",
  "/hermes/hermes-",
  "\\hermes\\hermes-",
  // Brand assets vendored as fonts, not Hermes source.
  "/fonts/hermes/",
  "\\fonts\\hermes\\",
  // Documentation.
  "/docs/hermes-",
  "\\docs\\hermes-",
] as const);

/** The published Windows artifact names, per the release contract. */
export interface HermesReleaseArtifactNames {
  /** Portable executable. */
  portable: string;
  /** NSIS setup executable. */
  setup: string;
  /** Checksum manifest. */
  checksums: string;
}

/**
 * Derive the published filenames.
 *
 * `arch` is carried rather than assumed: the pipeline builds x64 today, but
 * hardcoding it here would silently mislabel an arm64 build later.
 */
export function hermesReleaseArtifactNames(options: {
  arch?: string;
  platform?: string;
  includeSetup?: boolean;
} = {}): HermesReleaseArtifactNames {
  const platform = options.platform ?? "Windows";
  const arch = options.arch ?? "x64";
  const suffix = `${platform}-${arch}`;
  return {
    portable: `${HERMES_RELEASE_ARTIFACT_BASENAME}-${suffix}.exe`,
    setup: `${HERMES_RELEASE_ARTIFACT_BASENAME}-Setup-${suffix}.exe`,
    checksums: "SHA256SUMS.txt",
  };
}

/** Compute the SHA-256 hex digest of a buffer. */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface HermesChecksumEntry {
  /** File name as it should appear in the manifest — the public name. */
  name: string;
  /** SHA-256 hex of the file's bytes. */
  sha256: string;
  /** Byte length, for the release notes. */
  bytes: number;
}

/**
 * Render `SHA256SUMS.txt`.
 *
 * Two spaces between digest and name is the GNU coreutils text-mode format, so
 * `sha256sum -c SHA256SUMS.txt` works on the downloaded file without
 * translation. Entries are sorted so the manifest is reproducible — a release
 * whose checksum file reorders between runs looks like a changed artifact.
 */
export function renderSha256Sums(entries: readonly HermesChecksumEntry[]): string {
  return [...entries]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => `${entry.sha256}  ${entry.name}`)
    .join("\n")
    .concat(entries.length > 0 ? "\n" : "");
}

/**
 * Parse a `SHA256SUMS.txt` back into entries.
 *
 * Used by the verification step so "the manifest matches the files" is checked
 * with the same parser the format is written with, rather than a second ad-hoc
 * regex that could disagree.
 */
export function parseSha256Sums(text: string): HermesChecksumEntry[] {
  const entries: HermesChecksumEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(trimmed);
    if (!match) continue;
    entries.push({ name: match[2]!.trim(), sha256: match[1]!.toLowerCase(), bytes: 0 });
  }
  return entries;
}

/** Verify files against a manifest. Returns the mismatches; empty means all good. */
export function verifySha256Sums(
  manifest: string,
  files: Record<string, Uint8Array | string>,
): { name: string; problem: string }[] {
  const problems: { name: string; problem: string }[] = [];
  for (const entry of parseSha256Sums(manifest)) {
    const bytes = files[entry.name];
    if (bytes === undefined) {
      problems.push({ name: entry.name, problem: "missing" });
      continue;
    }
    const actual = sha256Hex(bytes);
    if (actual !== entry.sha256) {
      problems.push({ name: entry.name, problem: `digest mismatch (expected ${entry.sha256}, got ${actual})` });
    }
  }
  return problems;
}

/** One path inside a packaged tree. */
export interface PackagedPathEntry {
  /** Path relative to the package root, using either separator. */
  path: string;
  bytes?: number;
}

export interface HermesVendorExclusionResult {
  /** True when nothing vendored was found. */
  clean: boolean;
  /** Offending paths, normalised to forward slashes. */
  violations: string[];
  /** Paths that matched a marker but were allowlisted, for the build log. */
  allowlisted: string[];
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

/**
 * Scan a packaged tree for vendored Hermes source.
 *
 * The gate is deliberately strict about *paths* and lenient about *names*: a file
 * called `hermes-bridge.js` is this product's own integration layer and must
 * ship, while anything under `vendor/nous-hermes` must not. That is why the
 * allowlist is a set of path fragments rather than a name filter — filtering by
 * name would either block the bridge or let vendored source through under a
 * renamed directory.
 */
export function checkHermesVendorExclusion(entries: readonly PackagedPathEntry[]): HermesVendorExclusionResult {
  const violations: string[] = [];
  const allowlisted: string[] = [];

  for (const entry of entries) {
    const normalized = normalizePath(entry.path);

    if (HERMES_VENDOR_ALLOWLIST.some((fragment) => normalized.includes(normalizePath(fragment)))) {
      // Only record it as allowlisted when it would otherwise have matched, so
      // the log shows the decisions that mattered.
      if (HERMES_VENDOR_MARKERS.some((marker) => normalized.includes(normalizePath(marker)))) {
        allowlisted.push(normalized);
      }
      continue;
    }

    if (HERMES_VENDOR_MARKERS.some((marker) => normalized.includes(normalizePath(marker)))) {
      violations.push(normalized);
    }
  }

  return { clean: violations.length === 0, violations, allowlisted };
}

/**
 * The failure message for a violated build.
 *
 * Names the remediation rather than just the offence, because this check runs in
 * CI where the person reading it did not write the packaging step.
 */
export function hermesVendorExclusionFailure(result: HermesVendorExclusionResult): string {
  const list = result.violations.slice(0, 20).map((path) => `  - ${path}`).join("\n");
  const more = result.violations.length > 20 ? `\n  … and ${result.violations.length - 20} more` : "";
  return [
    `Packaged build contains vendored Hermes source (${result.violations.length} path(s)):`,
    list + more,
    "",
    `${HERMES_VENDOR_SUBMODULE_PATH} is a development-only submodule. It must be`,
    "excluded from production bundles: keep it out of the electron-builder file",
    "patterns and out of any prebundle entrypoint graph, and initialise the",
    "submodule only in the jobs that need to read the upstream source.",
  ].join("\n");
}

/**
 * Assert the packaged tree is clean, throwing with an actionable message.
 *
 * Called from the packaging step so a violation fails the build rather than
 * shipping a bundle with the whole Hermes repository in it.
 */
export function assertHermesVendorExcluded(entries: readonly PackagedPathEntry[]): void {
  const result = checkHermesVendorExclusion(entries);
  if (!result.clean) throw new Error(hermesVendorExclusionFailure(result));
}

/**
 * Recursive listing of a directory tree, as `PackagedPathEntry` paths relative to
 * `root`.
 *
 * `readdir` is injectable so the walker itself is unit-testable; the default is
 * the real filesystem. Symlinks are not followed — a vendored submodule checked
 * out behind a symlink would still be reported, because the link's own name is
 * what lands in the package.
 */
export async function collectPackagedPaths(
  root: string,
  deps: {
    readdir?: (path: string) => Promise<{ name: string; isDirectory: boolean; isSymbolicLink: boolean }[]>;
    /** Safety bound; a pathological tree must not hang the packaging step. */
    maxEntries?: number;
  } = {},
): Promise<PackagedPathEntry[]> {
  const readdir =
    deps.readdir ??
    (async (path: string) => {
      const { readdir: nodeReaddir } = await import("node:fs/promises");
      const entries = await nodeReaddir(path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isSymbolicLink: entry.isSymbolicLink(),
      }));
    });

  const maxEntries = deps.maxEntries ?? 250_000;
  const collected: PackagedPathEntry[] = [];
  const queue: string[] = [""];

  while (queue.length > 0) {
    const relative = queue.shift() as string;
    const absolute = relative.length === 0 ? root : `${root}/${relative}`;
    let entries: { name: string; isDirectory: boolean; isSymbolicLink: boolean }[];
    try {
      entries = await readdir(absolute);
    } catch {
      // An unreadable directory contributes nothing to the package either.
      continue;
    }

    for (const entry of entries) {
      const child = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory && !entry.isSymbolicLink) {
        queue.push(child);
        continue;
      }
      collected.push({ path: child });
      if (collected.length >= maxEntries) return collected;
    }
  }

  return collected;
}

/**
 * Walk a built package root and fail the build if vendored Hermes source is in it.
 *
 * Wired into the Windows build's post-assembly validation, alongside the existing
 * sidecar-runtime assertion, so it runs on cache hits as well as fresh builds.
 */
export async function assertHermesVendorExcludedInTree(root: string): Promise<void> {
  const entries = await collectPackagedPaths(root);
  assertHermesVendorExcluded(entries);
}
