#!/usr/bin/env node
/**
 * Verify that the vendored Hermes submodule still has the surface the bridge
 * depends on.
 *
 * `apps/desktop/src/main/hermes/upstream-pin.ts` records the exact upstream
 * commit and the modules/symbols the integration reads. This script re-checks
 * each of them against the checked-out submodule, so:
 *
 *   • bumping the submodule without re-reading the cited symbols fails CI;
 *   • a bridge written against a symbol upstream later renamed fails CI;
 *   • the pin in the source cannot drift from the actual gitlink.
 *
 * Exit codes:
 *   0  everything matches
 *   1  a checked surface is missing or the pin disagrees with the gitlink
 *   0  with a SKIP notice when the submodule is not initialised (normal for a
 *      plain clone; CI initialises it explicitly)
 *
 * Usage:
 *   node scripts/hermes/verify-upstream-pin.mjs [--require-submodule]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const requireSubmodule = process.argv.includes("--require-submodule");

/** Values read out of `upstream-pin.ts` without importing TypeScript. */
function readPinSource() {
  const pinPath = join(repoRoot, "apps", "desktop", "src", "main", "hermes", "upstream-pin.ts");
  if (!existsSync(pinPath)) {
    throw new Error(`missing ${pinPath}`);
  }
  const source = readFileSync(pinPath, "utf8");

  const stringConstant = (name) => {
    const match = new RegExp(`export const ${name} = "([^"]+)"`).exec(source);
    return match?.[1] ?? null;
  };

  const repo = stringConstant("HERMES_UPSTREAM_REPO");
  const submodulePath = stringConstant("HERMES_UPSTREAM_SUBMODULE_PATH");
  const commit = stringConstant("HERMES_UPSTREAM_COMMIT");
  const protocolVersion = Number(/export const HERMES_CONTROL_PROTOCOL_VERSION = (\d+)/.exec(source)?.[1] ?? "0");

  // The surface table: every `module:` value and every quoted symbol under it.
  const surface = [];
  const surfaceBlock = /export const HERMES_UPSTREAM_SURFACE = Object\.freeze\(\{([\s\S]*?)\n\} as const\);/.exec(source)?.[1] ?? "";
  for (const entry of surfaceBlock.matchAll(/module:\s*"([^"]+)",\s*\n\s*symbols:\s*\[([\s\S]*?)\],/g)) {
    const symbols = [...entry[2].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    surface.push({ module: entry[1], symbols });
  }

  return { repo, submodulePath, commit, protocolVersion, surface, source };
}

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

let problemCount = 0;

function fail(message) {
  problemCount += 1;
  process.stderr.write(`hermes-pin: FAIL — ${message}\n`);
  process.exitCode = 1;
}

function info(message) {
  process.stdout.write(`hermes-pin: ${message}\n`);
}

const pin = readPinSource();

if (!pin.repo || !pin.submodulePath || !pin.commit) {
  fail("upstream-pin.ts is missing HERMES_UPSTREAM_REPO / _SUBMODULE_PATH / _COMMIT");
  process.exit(1);
}

info(`pin     ${pin.commit}`);
info(`repo    ${pin.repo}`);
info(`path    ${pin.submodulePath}`);

// 1. .gitmodules must declare the submodule at the pinned path and URL.
const gitmodulesPath = join(repoRoot, ".gitmodules");
if (!existsSync(gitmodulesPath)) {
  fail(".gitmodules is missing");
} else {
  const gitmodules = readFileSync(gitmodulesPath, "utf8");
  if (!gitmodules.includes(`path = ${pin.submodulePath}`)) {
    fail(`.gitmodules does not declare path = ${pin.submodulePath}`);
  }
  if (!gitmodules.includes(`url = ${pin.repo}`)) {
    fail(`.gitmodules does not declare url = ${pin.repo}`);
  }
}

// 2. The recorded pin must equal the actual gitlink.
let gitlink = null;
try {
  const entry = git(["ls-files", "-s", pin.submodulePath]);
  gitlink = /^160000 ([0-9a-f]{40})/.exec(entry)?.[1] ?? null;
} catch {
  gitlink = null;
}

if (gitlink == null) {
  fail(`${pin.submodulePath} is not recorded as a gitlink in the index`);
} else if (gitlink !== pin.commit) {
  fail(`pin disagrees with the gitlink: upstream-pin.ts says ${pin.commit}, index says ${gitlink}`);
} else {
  info(`gitlink matches`);
}

// 3. The submodule must be initialised for the surface check.
const submoduleRoot = join(repoRoot, pin.submodulePath);
const initialised = existsSync(join(submoduleRoot, "hermes_constants.py"));

if (!initialised) {
  if (requireSubmodule) {
    fail(
      `${pin.submodulePath} is not checked out. Run: git submodule update --init --depth 1 ${pin.submodulePath}`,
    );
    process.exit(1);
  }
  info("SKIP — submodule not initialised, surface check not run");
  process.exit(process.exitCode ?? 0);
}

// 4. Every cited symbol must still exist at the pinned commit.
let missing = 0;
for (const entry of pin.surface) {
  const modulePath = join(submoduleRoot, entry.module);
  if (!existsSync(modulePath)) {
    fail(`cited module is absent: ${entry.module}`);
    missing += 1;
    continue;
  }
  const text = readFileSync(modulePath, "utf8");
  for (const symbol of entry.symbols) {
    if (!text.includes(symbol)) {
      fail(`symbol not found in ${entry.module}: ${symbol}`);
      missing += 1;
    }
  }
}

// 5. The control-socket protocol version must still be the one we speak.
const controlSocket = join(submoduleRoot, "gateway", "control_socket.py");
if (existsSync(controlSocket)) {
  const text = readFileSync(controlSocket, "utf8");
  const declared = /CONTROL_PROTOCOL_VERSION\s*=\s*(\d+)/.exec(text)?.[1];
  if (declared == null) {
    fail("CONTROL_PROTOCOL_VERSION not found in gateway/control_socket.py");
  } else if (Number(declared) !== pin.protocolVersion) {
    fail(
      `control protocol version moved: bridge speaks ${pin.protocolVersion}, upstream declares ${declared}`,
    );
  } else {
    info(`control protocol v${declared} matches`);
  }
} else {
  fail("gateway/control_socket.py is absent");
}

// 6. The Rules font assets the product vendors must still exist upstream.
const fontDir = join(submoduleRoot, "web", "public", "fonts");
for (const face of [
  "RulesCompressed-Regular.woff2",
  "RulesCompressed-Medium.woff2",
  "RulesExpanded-Regular.woff2",
  "RulesExpanded-Bold.woff2",
]) {
  if (!existsSync(join(fontDir, face))) {
    fail(`vendored font is no longer present upstream: web/public/fonts/${face}`);
    missing += 1;
  }
}

if (process.exitCode) {
  process.stderr.write(
    `\n${problemCount} problem(s). The bridge is written against the pinned commit in\n` +
      "apps/desktop/src/main/hermes/upstream-pin.ts; re-read the cited symbols at the\n" +
      "new commit, update the pin, and record what changed in docs/hermes-integration.md.\n",
  );
  process.exit(1);
}

info(`OK — ${pin.surface.length} module(s), ${pin.surface.reduce((n, e) => n + e.symbols.length, 0)} symbol(s) verified at ${pin.commit.slice(0, 12)}`);
