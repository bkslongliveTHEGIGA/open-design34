// Hermes filesystem layout and local socket addressing.
//
// This is a deliberate, line-for-line port of the *path* rules in the vendored
// upstream source — `hermes_constants.py` and `gateway/control_socket.py`. Those
// rules are what makes a running Hermes findable at all, so they cannot be
// approximated: a home resolved one directory off reads a different profile's
// ledger, and a pipe name hashed from a differently-normalised path never
// connects.
//
// Electron-free and filesystem-injected so every branch is unit-testable
// without a Hermes installation present.

import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import pathPosix from "node:path/posix";
import pathWin32 from "node:path/win32";
import type { PlatformPath } from "node:path";

/**
 * The path implementation for a *target* platform.
 *
 * `node:path` follows the host, so reasoning about a Windows Hermes home from a
 * POSIX machine (CI, a dev container, this module's own tests) would produce
 * forward-slash paths that never match what Windows actually writes — and a pipe
 * name hashed from the wrong string connects to nothing. Selecting the
 * implementation by target platform keeps the two in agreement, which is also
 * what makes the Windows branches testable on Linux CI.
 */
export function pathFor(platform: NodeJS.Platform = process.platform): PlatformPath {
  return platform === "win32" ? pathWin32 : pathPosix;
}

/** `hermes_constants.py::_HERMES_HOME_MARKERS` — files that mark a real Hermes home. */
export const HERMES_HOME_MARKERS = Object.freeze(["config.yaml", ".env", "state.db"] as const);

/** `gateway/control_socket.py::_SOCKET_FILENAME`. */
export const HERMES_CONTROL_SOCKET_FILENAME = "gateway.sock";

/** `gateway/control_socket.py::_POINTER_FILENAME`. */
export const HERMES_CONTROL_SOCKET_POINTER_FILENAME = "gateway.sock.path";

/**
 * `gateway/control_socket.py::_MAX_UNIX_PATH`.
 *
 * Upstream's comment: sun_path is 104 on macOS/BSD and 108 on Linux, with margin
 * left for the NUL terminator. A home path longer than this cannot host the
 * socket directly and upstream falls back to a short temp-dir path plus a
 * pointer file — the bridge must look in the same two places.
 */
export const HERMES_MAX_UNIX_SOCKET_PATH_BYTES = 100;

/** Environment variable naming an explicit Hermes home. */
export const HERMES_HOME_ENV = "HERMES_HOME";

/** `hermes_constants.py::_get_platform_default_hermes_home`'s optional suffix input. */
export const HERMES_DATA_DIR_SUFFIX_ENV = "HERMES_DATA_DIR_SUFFIX";

/** Minimal filesystem surface, injected so tests never touch the real disk. */
export interface HermesPathFs {
  exists(path: string): boolean;
  /** Read a text file, or null when it is missing/unreadable. */
  readText(path: string): string | null;
}

/** Platform options accepted by most helpers here. */
export interface HermesPlatformOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  tmpDir?: string;
}

/**
 * `os.path.normcase`: on Windows, lowercase and use backslashes; elsewhere the
 * identity. Upstream hashes the *normcased* home to name its pipe, so hashing
 * anything else produces a name no server ever bound.
 */
export function normalizePathCase(path: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? path.toLowerCase().replaceAll("/", pathWin32.sep) : path;
}

/**
 * `gateway/control_socket.py::_home_hash` — first 16 hex chars of the SHA-256 of
 * the normcased, resolved home path.
 */
export function hermesHomeHash(home: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = normalizePathCase(pathFor(platform).resolve(home), platform);
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
}

/** `gateway/control_socket.py::windows_pipe_name`. */
export function hermesWindowsControlPipeName(home: string, platform: NodeJS.Platform = process.platform): string {
  return `\\\\.\\pipe\\hermes-gateway-${hermesHomeHash(home, platform)}`;
}

/** Expand a leading `~` the way `os.path.expanduser` does for our cases. */
export function expandUserPath(path: string, home: string, platform: NodeJS.Platform = process.platform): string {
  if (path === "~") return home;
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return pathFor(platform).join(home, path.slice(2));
  }
  return path;
}

/**
 * `hermes_constants.py::_get_platform_default_hermes_home`.
 *
 * Windows: `%LOCALAPPDATA%\hermes`, falling back to `~/AppData/Local/hermes` when
 * `LOCALAPPDATA` is unset. Everywhere else: `~/.hermes`. `HERMES_DATA_DIR_SUFFIX`
 * is appended to the literal directory name in both cases — that is how upstream
 * runs isolated side-by-side instances, so ignoring it would point at the wrong
 * installation.
 */
export function platformDefaultHermesHome(options: HermesPlatformOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const suffix = env[HERMES_DATA_DIR_SUFFIX_ENV] ?? "";
  const path = pathFor(platform);

  if (platform === "win32") {
    const localAppData = (env.LOCALAPPDATA ?? "").trim();
    const base = localAppData.length > 0 ? localAppData : path.join(home, "AppData", "Local");
    return path.join(base, `hermes${suffix}`);
  }

  return path.join(home, `.hermes${suffix}`);
}

/**
 * `hermes_constants.py::get_process_hermes_home` — `HERMES_HOME` when set and
 * non-blank, otherwise the platform default.
 *
 * Upstream `.strip()`s the value, so a whitespace-only variable falls through to
 * the default rather than resolving to the cwd.
 */
export function processHermesHome(options: HermesPlatformOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const path = pathFor(platform);
  const value = (env[HERMES_HOME_ENV] ?? "").trim();

  if (value.length === 0) return platformDefaultHermesHome(options);

  const expanded = expandUserPath(value, options.homeDir ?? homedir(), platform);
  return path.isAbsolute(expanded) ? expanded : path.resolve(expanded);
}

/**
 * `hermes_constants.py::get_default_hermes_root` — the *machine* root shared by
 * every profile of an install. This, not the home, is where the spawn ledger
 * lives, because exactly one backend serves the whole host.
 *
 * Upstream's resolution: start from the platform default; if `HERMES_HOME` is
 * set and sits under that default (normal or profile mode) keep the default; if
 * it is elsewhere and looks like `<root>/profiles/<name>` step up two levels to
 * the root (Docker/custom layout); otherwise the explicit home *is* the root.
 */
export function hermesMachineRoot(options: HermesPlatformOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const path = pathFor(platform);
  const nativeHome = platformDefaultHermesHome(options);
  const envValue = (env[HERMES_HOME_ENV] ?? "").trim();
  if (envValue.length === 0) return nativeHome;

  const resolved = path.resolve(processHermesHome(options));
  const nativeResolved = path.resolve(nativeHome);

  if (isUnder(resolved, nativeResolved, platform)) return nativeHome;

  const parent = path.dirname(resolved);
  return path.basename(parent) === "profiles" ? path.dirname(parent) : resolved;
}

function isUnder(child: string, parent: string, platform: NodeJS.Platform): boolean {
  const sep = pathFor(platform).sep;
  if (child === parent) return true;
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * Where a client should connect for a given home, or null when nothing is there.
 *
 * `gateway/control_socket.py::resolve_client_socket_path`: prefer
 * `<home>/gateway.sock`; when absent, follow the `<home>/gateway.sock.path`
 * pointer (upstream writes it when the direct path would exceed sun_path) and
 * use it only if the target actually exists.
 */
export function resolveHermesControlSocketPath(
  home: string,
  fs: HermesPathFs,
  options: HermesPlatformOptions = {},
): string | null {
  const path = pathFor(options.platform ?? process.platform);
  const direct = path.join(home, HERMES_CONTROL_SOCKET_FILENAME);
  if (fs.exists(direct)) return direct;

  const pointer = path.join(home, HERMES_CONTROL_SOCKET_POINTER_FILENAME);
  const target = (fs.readText(pointer) ?? "").replace(/^\uFEFF/, "").trim();
  if (target.length > 0 && fs.exists(target)) return target;

  return null;
}

/**
 * `gateway/control_socket.py::resolve_server_socket_path`, expressed as the pair
 * a *client* has to reason about: the direct path when it fits sun_path,
 * otherwise the short temp-dir path upstream binds to instead.
 *
 * Upstream tries `tempfile.gettempdir()` first and then `/tmp` on POSIX, picking
 * the first candidate that fits.
 */
export function resolveHermesControlSocketCandidates(home: string, options: HermesPlatformOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  const path = pathFor(platform);
  const direct = path.join(home, HERMES_CONTROL_SOCKET_FILENAME);
  if (fitsUnixSocketPath(direct)) return [direct];

  const hash = hermesHomeHash(home, platform);
  const tmp = options.tmpDir ?? tmpdir();
  const candidates = [path.join(tmp, `hermes-gw-${hash}.sock`)];
  // Upstream's second candidate only exists on POSIX, where `/tmp` is a real
  // fallback ahead of an over-long `$TMPDIR`.
  if (platform !== "win32") candidates.push(path.join("/tmp", `hermes-gw-${hash}.sock`));
  return candidates;
}

/** `gateway/control_socket.py::_fits_sun_path`. */
export function fitsUnixSocketPath(path: string): boolean {
  return Buffer.byteLength(path, "utf8") <= HERMES_MAX_UNIX_SOCKET_PATH_BYTES;
}

/**
 * The transport a client should use for `home` on this platform.
 *
 * Windows is a named pipe (no filesystem ACL to lean on); POSIX is an AF_UNIX
 * stream socket. This is the only place that decides, so the client never has to
 * branch on platform itself.
 */
export type HermesControlTransport = { kind: "unix"; path: string } | { kind: "pipe"; name: string };

export function resolveHermesControlTransport(
  home: string,
  fs: HermesPathFs,
  options: HermesPlatformOptions = {},
): HermesControlTransport | null {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    // A named pipe is invisible to `exists()`; the connect attempt is the probe,
    // exactly as upstream's `_query_windows_pipe` treats FileNotFoundError.
    return { kind: "pipe", name: hermesWindowsControlPipeName(home, platform) };
  }
  const path = resolveHermesControlSocketPath(home, fs, options);
  return path == null ? null : { kind: "unix", path };
}

/**
 * Common Windows install/executable locations to probe when `HERMES_HOME` is
 * unset.
 *
 * Deliberately conservative and derived from the two places upstream itself
 * installs to (`_get_platform_default_hermes_home`'s `%LOCALAPPDATA%\hermes`,
 * and a per-user `~/.hermes`). Nothing here is invented: each candidate is
 * checked against `HERMES_HOME_MARKERS` before it counts, so a directory that
 * merely exists is never mistaken for an installation.
 */
export function windowsHermesHomeCandidates(options: HermesPlatformOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return [];

  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const path = pathFor(platform);
  const localAppData = (env.LOCALAPPDATA ?? "").trim();
  const programFiles = (env.ProgramFiles ?? "").trim();
  const candidates: string[] = [];

  if (localAppData.length > 0) candidates.push(path.join(localAppData, "hermes"));
  candidates.push(path.join(home, "AppData", "Local", "hermes"));
  candidates.push(path.join(home, ".hermes"));
  if (programFiles.length > 0) candidates.push(path.join(programFiles, "Hermes"));

  return [...new Set(candidates)];
}

/**
 * A Hermes home is real when at least one upstream marker file is present.
 *
 * Upstream defines exactly this set (`_HERMES_HOME_MARKERS`) for the same
 * purpose — telling a real home apart from an arbitrary directory whose path
 * merely contains a `profiles` segment.
 */
export function isHermesHome(home: string, fs: HermesPathFs, options: HermesPlatformOptions = {}): boolean {
  const path = pathFor(options.platform ?? process.platform);
  return HERMES_HOME_MARKERS.some((marker) => fs.exists(path.join(home, marker)));
}

/** Split a `PATH` value using the platform separator. */
export function splitPathEnv(value: string, platform: NodeJS.Platform = process.platform): string[] {
  const separator = platform === "win32" ? ";" : pathPosix.delimiter;
  return value.split(separator).filter((entry) => entry.length > 0);
}
