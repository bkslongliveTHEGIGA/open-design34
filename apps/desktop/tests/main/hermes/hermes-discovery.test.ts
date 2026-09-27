import { describe, expect, it } from "vitest";
import { join } from "node:path";

import {
  ATTACHABLE_LEDGER_PURPOSES,
  LOOPBACK_DIALABLE_HOSTS,
  SPAWN_LEDGER_FILENAME,
  classifyHostSpawnGate,
  discoverHermes,
  isAttachableRecord,
  parseSpawnLedger,
  readActiveProfile,
  recordBaseUrl,
  spawnOrAttach,
  type HermesBackendRecord,
} from "../../../src/main/hermes/hermes-discovery.js";
import { pathFor, type HermesPathFs } from "../../../src/main/hermes/hermes-paths.js";

function memFs(files: Record<string, string | true> = {}): HermesPathFs {
  const present = new Set<string>();
  const contents = new Map<string, string>();
  for (const [path, value] of Object.entries(files)) {
    present.add(path);
    if (typeof value === "string") contents.set(path, value);
  }
  return {
    exists: (path) => present.has(path),
    readText: (path) => (contents.has(path) ? (contents.get(path) as string) : null),
  };
}

const LINUX = { platform: "linux" as const, homeDir: "/home/ada", env: {} as NodeJS.ProcessEnv };
const HERMES_HOME = "/home/ada/.hermes";

/** A ledger entry shaped like `hermes_cli/process_identity.py::LedgerEntry`. */
function ledgerEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pid: 4242,
    create_time: 1_700_000_000.5,
    purpose: "dashboard",
    install: "abcdef012345",
    spawner_pid: 1,
    spawner_create: 1_700_000_000.0,
    registered_at: 1_700_000_001,
    argv: "hermes serve",
    host: "127.0.0.1",
    port: 9119,
    profile: "default",
    hermes_home: HERMES_HOME,
    isolated: false,
    ...overrides,
  };
}

function ledger(...entries: Record<string, unknown>[]): string {
  return JSON.stringify(entries);
}

describe("parseSpawnLedger", () => {
  it("reads a well-formed record", () => {
    const [record] = parseSpawnLedger(ledger(ledgerEntry()));
    expect(record).toMatchObject({ pid: 4242, port: 9119, purpose: "dashboard", host: "127.0.0.1", profile: "default" });
    expect(record?.createTime).toBe(1_700_000_000.5);
    expect(record?.registeredAt).toBe(1_700_000_001);
    expect(record?.hermesHome).toBe(HERMES_HOME);
  });

  it("yields [] for corrupt JSON rather than a wrong attach", () => {
    expect(parseSpawnLedger("{not json")).toEqual([]);
    expect(parseSpawnLedger("")).toEqual([]);
    expect(parseSpawnLedger(null)).toEqual([]);
    expect(parseSpawnLedger(undefined)).toEqual([]);
  });

  it("yields [] for a non-array document", () => {
    expect(parseSpawnLedger('{"pid":1}')).toEqual([]);
  });

  it("skips records without a bound port", () => {
    expect(parseSpawnLedger(ledger(ledgerEntry({ port: null })))).toEqual([]);
    expect(parseSpawnLedger(ledger(ledgerEntry({})))).toHaveLength(1);
    delete ledgerEntry().port;
  });

  it("skips out-of-range ports", () => {
    expect(parseSpawnLedger(ledger(ledgerEntry({ port: 0 })))).toEqual([]);
    expect(parseSpawnLedger(ledger(ledgerEntry({ port: 70_000 })))).toEqual([]);
  });

  it("skips a non-positive pid", () => {
    expect(parseSpawnLedger(ledger(ledgerEntry({ pid: 0 })))).toEqual([]);
    expect(parseSpawnLedger(ledger(ledgerEntry({ pid: -3 })))).toEqual([]);
  });

  it("skips an isolated record, which opted out of the host singleton", () => {
    expect(parseSpawnLedger(ledger(ledgerEntry({ isolated: true })))).toEqual([]);
  });

  it("skips purposes that do not serve the dashboard surface", () => {
    expect(parseSpawnLedger(ledger(ledgerEntry({ purpose: "gateway" })))).toEqual([]);
    expect(parseSpawnLedger(ledger(ledgerEntry({ purpose: "mcp-helper" })))).toEqual([]);
    expect(parseSpawnLedger(ledger(ledgerEntry({ purpose: "chat" })))).toEqual([]);
    for (const purpose of ATTACHABLE_LEDGER_PURPOSES) {
      expect(parseSpawnLedger(ledger(ledgerEntry({ purpose })))).toHaveLength(1);
    }
  });

  it("skips hosts that are not loopback-dialable", () => {
    expect(parseSpawnLedger(ledger(ledgerEntry({ host: "10.0.0.7" })))).toEqual([]);
    expect(parseSpawnLedger(ledger(ledgerEntry({ host: "hermes.example.com" })))).toEqual([]);
    for (const host of LOOPBACK_DIALABLE_HOSTS) {
      expect(parseSpawnLedger(ledger(ledgerEntry({ host })))).toHaveLength(1);
    }
  });

  it("is case-insensitive about the bind host", () => {
    expect(parseSpawnLedger(ledger(ledgerEntry({ host: "LOCALHOST" })))).toHaveLength(1);
  });

  it("ignores non-object entries", () => {
    expect(parseSpawnLedger(JSON.stringify([null, 3, "x", ledgerEntry()]))).toHaveLength(1);
  });

  it("treats a missing hermes_home detail as null, since older ledgers predate it", () => {
    const entry = ledgerEntry();
    delete entry.hermes_home;
    const [record] = parseSpawnLedger(ledger(entry));
    expect(record?.hermesHome).toBeNull();
  });
});

describe("spawnOrAttach", () => {
  const [record] = parseSpawnLedger(ledger(ledgerEntry())) as [HermesBackendRecord];

  it("attaches when a running backend exists", () => {
    expect(spawnOrAttach({ records: [record] })).toEqual({ action: "attach", record });
  });

  it("spawns when the ledger is empty", () => {
    expect(spawnOrAttach({ records: [] })).toEqual({ action: "spawn", reason: "no-running-backend" });
  });

  it("lets `isolated` win over every record", () => {
    expect(spawnOrAttach({ isolated: true, records: [record] })).toEqual({ action: "spawn", reason: "isolated" });
  });

  it("prefers the newest registration when a host holds a stale and a fresh record", () => {
    const stale = { ...record, registeredAt: 1_000 };
    const fresh = { ...record, registeredAt: 2_000 };
    const decision = spawnOrAttach({ records: [stale, fresh] });
    expect(decision.action).toBe("attach");
    if (decision.action === "attach") expect(decision.record.registeredAt).toBe(2_000);
  });
});

describe("recordBaseUrl", () => {
  it("always dials back on loopback, whatever host was recorded", () => {
    const [record] = parseSpawnLedger(ledger(ledgerEntry({ host: "0.0.0.0" }))) as [HermesBackendRecord];
    expect(recordBaseUrl(record)).toBe("http://127.0.0.1:9119");
  });
});

describe("classifyHostSpawnGate", () => {
  it("takes the gate when no owner exists", () => {
    expect(classifyHostSpawnGate(null, { now: 1000, staleAfterMs: 5000 })).toBe("take");
  });

  it("waits while a live owner holds it", () => {
    expect(classifyHostSpawnGate({ ownerAlive: true, startedAt: 1000 }, { now: 2000, staleAfterMs: 5000 })).toBe("wait");
  });

  it("takes over a gate whose owner is gone", () => {
    expect(classifyHostSpawnGate({ ownerAlive: false, startedAt: 1000 }, { now: 2000, staleAfterMs: 5000 })).toBe("take");
  });

  it("takes over a stale gate so a crashed spawner cannot wedge every launch", () => {
    expect(classifyHostSpawnGate({ ownerAlive: true, startedAt: 1000 }, { now: 9000, staleAfterMs: 5000 })).toBe("take");
  });
});

describe("isAttachableRecord", () => {
  it("accepts a well-formed loopback dashboard record", () => {
    const [record] = parseSpawnLedger(ledger(ledgerEntry())) as [HermesBackendRecord];
    expect(isAttachableRecord(record)).toBe(true);
  });

  it("rejects a record that lost its port", () => {
    expect(isAttachableRecord({ pid: 1, port: 0, host: "127.0.0.1", purpose: "serve", profile: "", registeredAt: 0, createTime: null, hermesHome: null })).toBe(false);
  });
});

describe("discoverHermes", () => {
  const installedFs = () => memFs({ [pathFor("linux").join(HERMES_HOME, "config.yaml")]: "profile: default\n" });

  it("reports not-installed when no candidate has a Hermes marker file", () => {
    const result = discoverHermes({ fs: memFs({ "/home/ada/notes.txt": true }), ...LINUX });
    expect(result.installed).toBeNull();
    expect(result.backends).toEqual([]);
    expect(result.decision).toEqual({ action: "spawn", reason: "no-running-backend" });
    expect(result.trace.some((line) => line.includes("no Hermes marker file"))).toBe(true);
  });

  it("finds the platform default installation", () => {
    const result = discoverHermes({ fs: installedFs(), ...LINUX });
    expect(result.installed?.home).toBe(HERMES_HOME);
    expect(result.installed?.source).toBe("platform-default");
    expect(result.installed?.marker).toBe("config.yaml");
  });

  it("prefers HERMES_HOME over the platform default", () => {
    const fs = memFs({
      "/srv/custom/config.yaml": "x: 1\n",
      [pathFor("linux").join(HERMES_HOME, "config.yaml")]: "x: 1\n",
    });
    const result = discoverHermes({
      fs,
      platform: "linux",
      homeDir: "/home/ada",
      env: { HERMES_HOME: "/srv/custom" },
    });
    expect(result.installed?.home).toBe("/srv/custom");
    expect(result.installed?.source).toBe("HERMES_HOME");
  });

  it("derives the machine root for a custom HERMES_HOME and looks for the ledger there", () => {
    const ledgerPath = pathFor("linux").join("/srv/custom", SPAWN_LEDGER_FILENAME);
    const fs = memFs({
      "/srv/custom/config.yaml": "x: 1\n",
      [ledgerPath]: ledger(ledgerEntry({ hermes_home: "/srv/custom" })),
    });
    const result = discoverHermes({
      fs,
      platform: "linux",
      homeDir: "/home/ada",
      env: { HERMES_HOME: "/srv/custom" },
    });
    expect(result.installed?.machineRoot).toBe("/srv/custom");
    expect(result.backends).toHaveLength(1);
    expect(result.backends[0]?.baseUrl).toBe("http://127.0.0.1:9119");
    expect(result.trace.some((line) => line.includes(ledgerPath))).toBe(true);
  });

  it("distinguishes installed-but-idle from not-installed", () => {
    const result = discoverHermes({ fs: installedFs(), ...LINUX });
    expect(result.installed).not.toBeNull();
    expect(result.backends).toEqual([]);
    expect(result.decision).toEqual({ action: "spawn", reason: "no-running-backend" });
    expect(result.trace.some((line) => line.includes("ledger: absent"))).toBe(true);
  });

  it("reports a running backend and decides to attach", () => {
    const fs = memFs({
      [pathFor("linux").join(HERMES_HOME, "config.yaml")]: "x: 1\n",
      [pathFor("linux").join(HERMES_HOME, SPAWN_LEDGER_FILENAME)]: ledger(ledgerEntry()),
    });
    const result = discoverHermes({ fs, ...LINUX });
    expect(result.decision.action).toBe("attach");
    expect(result.backends[0]?.record.port).toBe(9119);
  });

  it("finds Hermes via a PATH executable when HERMES_HOME is unset", () => {
    const fs = memFs({ [pathFor("linux").join("/opt/hermes", ".env")]: "X=1\n" });
    const result = discoverHermes({
      fs,
      platform: "linux",
      homeDir: "/home/ada",
      env: { PATH: "/opt/hermes:/usr/bin" },
      whichHermes: (name) => (name === "hermes" ? "/opt/hermes" : null),
    });
    expect(result.installed?.home).toBe("/opt/hermes");
    expect(result.installed?.source).toBe("path-executable");
  });

  it("records that PATH lookup found nothing", () => {
    const result = discoverHermes({ fs: memFs(), ...LINUX, whichHermes: () => null });
    expect(result.trace.some((line) => line.includes("skip PATH"))).toBe(true);
  });

  it("surfaces the active profile label", () => {
    const fs = memFs({
      [pathFor("linux").join(HERMES_HOME, "config.yaml")]: "x: 1\n",
      [pathFor("linux").join(HERMES_HOME, "active_profile")]: "work\n",
    });
    const result = discoverHermes({ fs, ...LINUX });
    expect(result.installed?.activeProfile).toBe("work");
    expect(readActiveProfile(HERMES_HOME, fs, "linux")).toBe("work");
  });

  it("does not report the same installation twice when several sources match", () => {
    const result = discoverHermes({
      fs: installedFs(),
      platform: "linux",
      homeDir: "/home/ada",
      env: { HERMES_HOME: HERMES_HOME },
      whichHermes: () => HERMES_HOME,
    });
    expect(result.installations).toHaveLength(1);
    expect(result.trace.some((line) => line.includes("already found"))).toBe(true);
  });

  it("records an explicit local endpoint as an additional discovery source", () => {
    // A distinct home, so the endpoint is genuinely a second candidate rather
    // than the platform default found again.
    const fs = memFs({
      [join(HERMES_HOME, "config.yaml")]: "x: 1\n",
      "/srv/endpoint/config.yaml": "x: 1\n",
    });
    const result = discoverHermes({
      fs,
      ...LINUX,
      localEndpoint: { baseUrl: "http://127.0.0.1:9119", home: "/srv/endpoint" },
    });
    expect(result.installations.map((entry) => entry.source)).toContain("local-endpoint");
    expect(result.installations.map((entry) => entry.home)).toContain("/srv/endpoint");
  });

  it("checks Windows locations in order and validates each against a marker", () => {
    const home = "C:\\Users\\ada\\AppData\\Local\\hermes";
    const fs = memFs({ [pathFor("win32").join(home, "config.yaml")]: "x: 1\n" });
    const result = discoverHermes({
      fs,
      platform: "win32",
      homeDir: "C:\\Users\\ada",
      env: { LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" },
    });
    expect(result.installed?.home).toBe(home);
    expect(result.installed?.source).toBe("windows-install-location");
  });

  it("reads the Windows ledger using backslash paths", () => {
    const home = "C:\\Users\\ada\\AppData\\Local\\hermes";
    const fs = memFs({
      [pathFor("win32").join(home, "config.yaml")]: "x: 1\n",
      [pathFor("win32").join(home, SPAWN_LEDGER_FILENAME)]: ledger(ledgerEntry()),
    });
    const result = discoverHermes({
      fs,
      platform: "win32",
      homeDir: "C:\\Users\\ada",
      env: { LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" },
    });
    expect(result.backends).toHaveLength(1);
  });
});
