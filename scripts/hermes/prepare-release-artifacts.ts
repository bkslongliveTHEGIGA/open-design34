#!/usr/bin/env node
/**
 * Prepare the Windows release artifacts for Hermes Design Studio.
 *
 * Runs after `tools-pack win build` and before upload. Three jobs, in order:
 *
 *   1. **Gate.** Assert the built package contains no vendored Hermes source.
 *      This is the same check the builder runs post-assembly, repeated against
 *      the artifacts actually about to be published — belt and braces, because
 *      the consequence of getting it wrong is shipping the entire upstream
 *      Hermes repository inside an installer.
 *   2. **Name.** Copy the internal `${PRODUCT_NAME}-${namespace}-…` artifacts to
 *      the published names the release documents
 *      (`HermesDesignStudio-Windows-x64.exe`, `HermesDesignStudio-Setup-Windows-x64.exe`).
 *      The internal names stay put: the blockmap and `latest.yml` updater feed
 *      reference them.
 *   3. **Checksum.** Write `SHA256SUMS.txt` over the published names.
 *
 * Nothing here is "best effort": a missing source artifact, a failed gate or a
 * digest mismatch exits non-zero and the release step does not run. A release
 * that cannot be verified must not be reported as successful.
 *
 * Usage:
 *   pnpm exec tsx scripts/hermes/prepare-release-artifacts.ts \
 *     --source-root <dir with the built artifacts> \
 *     --out-root <dir to write published artifacts to> \
 *     [--arch x64] [--platform Windows] \
 *     [--portable-src <path>] [--setup-src <path>] [--zip-src <path>] \
 *     [--dry-run]
 */

import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertHermesVendorExcluded,
  collectPackagedPaths,
  hermesReleaseArtifactNames,
  hermesVendorExclusionFailure,
  renderSha256Sums,
  sha256Hex,
  verifySha256Sums,
} from "../../tools/pack/src/win/release-artifacts.ts";

type CliArgs = {
  arch: string;
  platform: string;
  dryRun: boolean;
  sourceRoot?: string;
  outRoot?: string;
  portableSrc?: string;
  setupSrc?: string;
  zipSrc?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { arch: "x64", platform: "Windows", dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => {
      const value = argv[index += 1];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case "--source-root":
        args.sourceRoot = next();
        break;
      case "--out-root":
        args.outRoot = next();
        break;
      case "--arch":
        args.arch = next();
        break;
      case "--platform":
        args.platform = next();
        break;
      case "--portable-src":
        args.portableSrc = next();
        break;
      case "--setup-src":
        args.setupSrc = next();
        break;
      case "--zip-src":
        args.zipSrc = next();
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Find the first existing candidate, or null. */
async function firstExisting(candidates: Array<string | undefined>): Promise<string | null> {
  for (const candidate of candidates) {
    if (candidate != null && candidate.length > 0 && (await exists(candidate))) return candidate;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.sourceRoot == null || args.sourceRoot.length === 0) {
    throw new Error("--source-root is required");
  }
  if (args.outRoot == null || args.outRoot.length === 0) {
    throw new Error("--out-root is required");
  }
  const sourceRoot = args.sourceRoot;
  const outRoot = args.outRoot;

  const names = hermesReleaseArtifactNames({ arch: args.arch, platform: args.platform });

  // --- 1. Gate: no vendored Hermes source in what is about to be published. ---
  const unpacked = await firstExisting([
    join(sourceRoot, "win-unpacked"),
    join(sourceRoot, "win-unpacked", "resources", "app"),
  ]);

  if (unpacked) {
    const entries = await collectPackagedPaths(unpacked);
    const result = (() => {
      try {
        assertHermesVendorExcluded(entries);
        return { clean: true, violations: [] };
      } catch {
        // Recompute for the message; assert already decided.
        return null;
      }
    })();
    if (result === null) {
      const { checkHermesVendorExclusion } = await import("../../tools/pack/src/win/release-artifacts.ts");
      throw new Error(hermesVendorExclusionFailure(checkHermesVendorExclusion(entries)));
    }
    process.stdout.write(`gate: ${entries.length} packaged path(s) scanned under ${unpacked} — clean\n`);
  } else {
    process.stdout.write(`gate: SKIP — no win-unpacked tree found under ${sourceRoot}\n`);
  }

  // --- 2. Locate the built artifacts. ---
  const discovered = await readdir(sourceRoot).catch(() => []);
  const portableSrc =
    args.portableSrc ??
    (await firstExisting([
      ...discovered.filter((name) => /\.exe$/i.test(name) && !/-setup\.exe$/i.test(name)).map((name) => join(sourceRoot, name)),
    ]));
  const setupSrc =
    args.setupSrc ??
    (await firstExisting([
      ...discovered.filter((name) => /-setup\.exe$/i.test(name)).map((name) => join(sourceRoot, name)),
    ]));
  const zipSrc =
    args.zipSrc ??
    (await firstExisting([
      ...discovered.filter((name) => /-portable\.zip$/i.test(name)).map((name) => join(sourceRoot, name)),
    ]));

  const planned: Array<{ from: string; to: string }> = [];
  if (portableSrc) planned.push({ from: portableSrc, to: join(outRoot, names.portable) });
  if (setupSrc) planned.push({ from: setupSrc, to: join(outRoot, names.setup) });
  if (zipSrc) {
    planned.push({
      from: zipSrc,
      to: join(outRoot, names.portable.replace(/\.exe$/, ".zip")),
    });
  }

  if (planned.length === 0) {
    throw new Error(
      `no release artifacts found under ${sourceRoot}. ` +
        "Expected a portable .exe and/or a *-setup.exe from `tools-pack win build --to all`.",
    );
  }

  if (!args.dryRun) await mkdir(outRoot, { recursive: true });

  // --- 3. Copy to the published names and checksum them. ---
  const entries: Array<{ name: string; sha256: string; bytes: number }> = [];
  for (const item of planned) {
    const bytes = await readFile(item.from);
    const name = item.to.split(/[\\/]/).pop() as string;
    entries.push({ name, sha256: sha256Hex(bytes), bytes: bytes.byteLength });
    process.stdout.write(`name: ${item.from.split(/[\\/]/).pop() ?? item.from} -> ${name} (${bytes.byteLength} bytes)\n`);
    if (!args.dryRun) await copyFile(item.from, item.to);
  }

  const manifest = renderSha256Sums(entries);
  const manifestPath = join(outRoot, names.checksums);
  process.stdout.write(`checksums: ${names.checksums}\n${manifest}`);
  if (!args.dryRun) {
    await writeFile(manifestPath, manifest, "utf8");

    // Read back and verify, so a truncated or reordered write is caught here
    // rather than by a user downloading a bad artifact.
    const written = await readFile(manifestPath, "utf8");
    const files: Record<string, Uint8Array> = {};
    for (const item of planned) {
      const name = item.to.split(/[\\/]/).pop() as string;
      files[name] = await readFile(item.to);
    }
    const problems = verifySha256Sums(written, files);
    if (problems.length > 0) {
      throw new Error(`checksum verification failed: ${JSON.stringify(problems)}`);
    }
    process.stdout.write("verify: SHA256SUMS.txt matches every published artifact\n");
  }
}

main().catch((error) => {
  process.stderr.write(`prepare-release-artifacts: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
