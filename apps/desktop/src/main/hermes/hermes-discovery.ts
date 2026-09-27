// Hermes auto-discovery.
//
// Ports `apps/desktop/electron/backend-discovery.ts` — the *upstream Desktop's
// own* attach-first discovery — because Design Studio is attaching to exactly
// the backend that file exists to find. Reusing its rules is not a stylistic
// choice: the ledger is written by `hermes_cli/process_identity.py::register_self`
// and only these field/filter rules read it correctly.
//
// The one rule worth restating, in upstream's words: "The ledger is DISCOVERY
// ONLY — a record is never trusted as proof of a usable backend; the HTTP probe
// and the token handshake are the boundary that validates it." Every stage below
// is therefore a *candidate*; only `HermesBridge` promotes one to a connection.
//
// Pure and dependency-injected: no electron, no fs, no network.

import { HERMES_CONTROL_PROTOCOL_VERSION } from "./upstream-pin.js";
import {
  HERMES_HOME_MARKERS,
  isHermesHome,
  hermesMachineRoot,
  pathFor,
  platformDefaultHermesHome,
  processHermesHome,
  splitPathEnv,
  windowsHermesHomeCandidates,
  type HermesPathFs,
} from "./hermes-paths.js";

/** `backend-discovery.ts::SPAWN_LEDGER_FILENAME`. */
export const SPAWN_LEDGER_FILENAME = "spawn-ledger.json";

/**
 * `backend-discovery.ts::ATTACHABLE_PURPOSES` — ledger purposes denoting a
 * JSON-RPC/WebSocket backend worth attaching to. `gateway` and `mcp-helper` are
 * reapable but do not serve the dashboard HTTP surface the bridge needs.
 */
export const ATTACHABLE_LEDGER_PURPOSES = Object.freeze(["dashboard", "serve"] as const);

/** `backend-discovery.ts::LOOPBACK_DIALABLE`. */
export const LOOPBACK_DIALABLE_HOSTS = Object.freeze([
  "",
  "0.0.0.0",
  "127.0.0.1",
  "::",
  "::1",
  "localhost",
] as const);

/**
 * How this attempt found a candidate. The order matters and is the order
 * section 3 of the integration spec requires; it is also upstream's own
 * precedence (env var → platform default → PATH).
 */
export type HermesDiscoverySource =
  | "HERMES_HOME"
  | "windows-install-location"
  | "platform-default"
  | "path-executable"
  | "local-endpoint";

/** Ledger record for a backend that might be attachable. Mirrors `HostBackendRecord`. */
export interface HermesBackendRecord {
  createTime: number | null;
  /** Bind host as recorded; `0.0.0.0`/`::`/empty all dial back on loopback. */
  host: string;
  pid: number;
  port: number;
  profile: string;
  purpose: string;
  registeredAt: number;
  /** Upstream's `hermes_home` detail, when the writing version supplied it. */
  hermesHome: string | null;
}

export type HermesSpawnOrAttachDecision =
  | { action: "attach"; record: HermesBackendRecord }
  | { action: "spawn"; reason: "isolated" | "no-running-backend" };

function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * `backend-discovery.ts::parseSpawnLedger`, including every rejection rule.
 *
 * A record is skipped when: `pid` is not a positive integer; `port` is not an
 * integer in 1..65535; `isolated === true` (that backend opted out of the host
 * singleton and belongs to another client); the purpose is not attachable; or
 * the bind host is not loopback-dialable. Unreadable or corrupt JSON yields `[]`
 * — discovery degrades to "spawn", never to a wrong attach.
 */
export function parseSpawnLedger(contents: unknown): HermesBackendRecord[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(String(contents ?? ""));
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const records: HermesBackendRecord[] = [];

  for (const value of parsed) {
    if (!value || typeof value !== "object") continue;

    const entry = value as Record<string, unknown>;
    const pid = asInteger(entry.pid);
    const port = asInteger(entry.port);
    const purpose = String(entry.purpose ?? "");
    const host = String(entry.host ?? "");

    if (
      pid === null ||
      pid <= 0 ||
      port === null ||
      port <= 0 ||
      port > 65535 ||
      entry.isolated === true ||
      !(ATTACHABLE_LEDGER_PURPOSES as readonly string[]).includes(purpose) ||
      !(LOOPBACK_DIALABLE_HOSTS as readonly string[]).includes(host.toLowerCase())
    ) {
      continue;
    }

    records.push({
      createTime: typeof entry.create_time === "number" ? entry.create_time : null,
      host,
      pid,
      port,
      profile: String(entry.profile ?? ""),
      purpose,
      registeredAt: typeof entry.registered_at === "number" ? entry.registered_at : 0,
      hermesHome: typeof entry.hermes_home === "string" && entry.hermes_home.length > 0 ? entry.hermes_home : null,
    });
  }

  return records;
}

/**
 * `backend-discovery.ts::spawnOrAttach`.
 *
 * One running backend on the host means attach and spawn nothing — refusing a
 * backend another profile registered is what produced a second process per
 * profile upstream. `isolated` is the deliberate escape hatch and wins over
 * every record. Newest registration first, so a host holding both a stale and a
 * fresh record tries the live one first.
 */
export function spawnOrAttach(input: {
  isolated?: boolean;
  records?: readonly HermesBackendRecord[];
}): HermesSpawnOrAttachDecision {
  const records = input.records ?? [];
  if (input.isolated === true) return { action: "spawn", reason: "isolated" };

  const [newest] = [...records].sort((left, right) => right.registeredAt - left.registeredAt);
  return newest ? { action: "attach", record: newest } : { action: "spawn", reason: "no-running-backend" };
}

/** `backend-discovery.ts::recordBaseUrl` — the loopback base URL for a record. */
export function recordBaseUrl(record: HermesBackendRecord): string {
  return `http://127.0.0.1:${record.port}`;
}

/** `backend-discovery.ts::classifyHostSpawnGate` — the cross-process spawn race. */
export type HermesHostSpawnGateState = { ownerAlive: boolean; startedAt: number };

export function classifyHostSpawnGate(
  state: HermesHostSpawnGateState | null,
  options: { now: number; staleAfterMs: number },
): "take" | "wait" {
  if (!state || !state.ownerAlive || options.now - state.startedAt >= options.staleAfterMs) return "take";
  return "wait";
}

/** A candidate Hermes installation found on this machine. */
export interface HermesInstallation {
  /** Absolute Hermes home directory. */
  home: string;
  /** Which marker file proved this directory is a real Hermes home. */
  marker: string;
  /** Machine root the spawn ledger is expected under. */
  machineRoot: string;
  source: HermesDiscoverySource;
  /** Profile label from `<home>/active_profile`, when present. */
  activeProfile: string | null;
}

/** A candidate running Hermes backend. */
export interface HermesRunningBackend {
  home: string;
  baseUrl: string;
  record: HermesBackendRecord;
}

/** Everything discovery learned, including why it found nothing. */
export interface HermesDiscoveryResult {
  installed: HermesInstallation | null;
  /** All installations seen, newest source first; the first is `installed`. */
  installations: HermesInstallation[];
  backends: HermesRunningBackend[];
  decision: HermesSpawnOrAttachDecision;
  /** Ordered account of what was checked, for the UI and diagnostics. */
  trace: string[];
}

export interface HermesDiscoveryDeps {
  fs: HermesPathFs;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
  tmpDir?: string;
  /** `PATH` lookup for the `hermes` executable; null when not found. */
  whichHermes?: (name: string) => string | null;
  /** `hermes serve --isolated` opts out of the host singleton. */
  isolated?: boolean;
  /** Already-known loopback endpoint (e.g. an explicit `--hermes-url`). */
  localEndpoint?: { baseUrl: string; home: string } | null;
}

/**
 * Run the full ordered discovery pass.
 *
 * Order (spec section 3, and upstream's own precedence):
 *   1. `HERMES_HOME`
 *   2. common Windows install/config locations
 *   3. the platform default (`~/.hermes`)
 *   4. a `hermes` executable on `PATH` (its directory's parent is a home candidate)
 *   5. an explicitly known local endpoint
 *
 * Each candidate is validated against upstream's home markers before it counts,
 * so an empty or foreign directory is reported as "not installed" rather than
 * silently adopted.
 */
export function discoverHermes(deps: HermesDiscoveryDeps): HermesDiscoveryResult {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const trace: string[] = [];
  const installations: HermesInstallation[] = [];

  const consider = (home: string | null, source: HermesDiscoverySource, label: string): void => {
    if (!home || home.length === 0) {
      trace.push(`skip ${label}: no path`);
      return;
    }
    const marker = findHomeMarker(home, deps.fs, platform);
    if (marker == null) {
      trace.push(`skip ${label}: ${home} has no Hermes marker file`);
      return;
    }
    if (installations.some((entry) => entry.home === home)) {
      trace.push(`skip ${label}: ${home} already found`);
      return;
    }
    installations.push({
      home,
      marker,
      machineRoot: hermesMachineRoot({ env, platform, homeDir: deps.homeDir }),
      source,
      activeProfile: readActiveProfile(home, deps.fs, platform),
    });
    trace.push(`found ${label}: ${home} (marker ${marker})`);
  };

  // 1. HERMES_HOME
  const envHome = (env.HERMES_HOME ?? "").trim();
  consider(envHome.length > 0 ? processHermesHome({ env, platform, homeDir: deps.homeDir }) : null, "HERMES_HOME", "HERMES_HOME");

  // 2. common Windows locations
  for (const candidate of windowsHermesHomeCandidates({ env, homeDir: deps.homeDir, platform })) {
    consider(candidate, "windows-install-location", "windows location");
  }

  // 3. platform default
  consider(platformDefaultHermesHome({ env, platform, homeDir: deps.homeDir }), "platform-default", "platform default");

  // 4. PATH executable — `<dir>/hermes(.exe)`; the installation home is beside
  //    the launcher for source installs, so probe the launcher's directory too.
  const which = deps.whichHermes;
  if (which) {
    const executable = which(platform === "win32" ? "hermes.exe" : "hermes") ?? which("hermes");
    if (executable == null) {
      trace.push("skip PATH: no hermes executable found");
    } else {
      trace.push(`PATH: found executable ${executable}`);
      consider(executable, "path-executable", "PATH executable directory");
    }
  }

  // 5. explicit local endpoint
  if (deps.localEndpoint) {
    consider(deps.localEndpoint.home, "local-endpoint", "local endpoint");
  }

  const installed = installations[0] ?? null;

  // Running backends come from the machine-root spawn ledger.
  const backends: HermesRunningBackend[] = [];
  if (installed) {
    const ledgerPath = pathFor(platform).join(installed.machineRoot, SPAWN_LEDGER_FILENAME);
    const raw = deps.fs.readText(ledgerPath);
    if (raw == null) {
      trace.push(`ledger: absent at ${ledgerPath}`);
    } else {
      const records = parseSpawnLedger(raw);
      trace.push(`ledger: ${records.length} attachable record(s) at ${ledgerPath}`);
      for (const record of records) {
        backends.push({ home: installed.home, baseUrl: recordBaseUrl(record), record });
      }
    }
  } else {
    trace.push("ledger: skipped, no Hermes installation found");
  }

  return {
    installed,
    installations,
    backends,
    decision: spawnOrAttach({ isolated: deps.isolated, records: backends.map((entry) => entry.record) }),
    trace,
  };
}

function findHomeMarker(home: string, fs: HermesPathFs, platform: NodeJS.Platform): string | null {
  const path = pathFor(platform);
  for (const marker of HERMES_HOME_MARKERS) {
    if (fs.exists(path.join(home, marker))) return marker;
  }
  return null;
}

/**
 * `<home>/active_profile` holds the profile label. Upstream warns loudly when
 * `HERMES_HOME` is unset but a non-default profile is sticky-active, because
 * falling back to the default home would write to the wrong profile — surfacing
 * the label lets Design Studio show which profile it attached to.
 */
export function readActiveProfile(
  home: string,
  fs: HermesPathFs,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const raw = fs.readText(pathFor(platform).join(home, "active_profile"));
  if (raw == null) return null;
  const value = raw.replace(/^\uFEFF/, "").trim();
  return value.length > 0 ? value : null;
}

/**
 * Whether a discovered backend is worth attaching to, as opposed to merely
 * present in the ledger.
 *
 * Upstream's stance: a ledger record is never proof. This is the cheap half of
 * that check (shape + loopback + attachable purpose); the expensive half — the
 * HTTP probe and the token handshake — lives in `hermes-bridge.ts`.
 */
export function isAttachableRecord(record: HermesBackendRecord): boolean {
  return (
    record.pid > 0 &&
    record.port > 0 &&
    record.port <= 65535 &&
    (ATTACHABLE_LEDGER_PURPOSES as readonly string[]).includes(record.purpose) &&
    (LOOPBACK_DIALABLE_HOSTS as readonly string[]).includes(record.host.toLowerCase())
  );
}

/** The control-socket protocol version this discovery expects the peer to speak. */
export const EXPECTED_CONTROL_PROTOCOL_VERSION = HERMES_CONTROL_PROTOCOL_VERSION;

/** Re-exported so callers do not have to reach into the paths module. */
export { isHermesHome, splitPathEnv };
