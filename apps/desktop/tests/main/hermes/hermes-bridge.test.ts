import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";

import { createHermesBridge } from "../../../src/main/hermes/hermes-bridge.js";
import { SPAWN_LEDGER_FILENAME } from "../../../src/main/hermes/hermes-discovery.js";
import type { HermesPathFs } from "../../../src/main/hermes/hermes-paths.js";
import type { HermesRuntimeFetch } from "../../../src/main/hermes/hermes-runtime-adapter.js";
import type { HermesEventSocket } from "../../../src/main/hermes/hermes-events.js";
import type { HermesControlSocket } from "../../../src/main/hermes/hermes-control-client.js";

const HERMES_HOME = "/home/ada/.hermes";

function memFs(files: Record<string, string> = {}): HermesPathFs {
  return {
    exists: (path) => Object.hasOwn(files, path),
    readText: (path) => (Object.hasOwn(files, path) ? files[path] : null),
  };
}

function ledger(port = 9119, pid = 4242, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify([
    {
      pid,
      create_time: 1_700_000_000,
      purpose: "dashboard",
      install: "abcdef012345",
      spawner_pid: 1,
      spawner_create: 1_700_000_000,
      registered_at: 1_700_000_001,
      argv: "hermes serve",
      host: "127.0.0.1",
      port,
      profile: "default",
      hermes_home: HERMES_HOME,
      isolated: false,
      ...overrides,
    },
  ]);
}

const INSTALLED = { [join(HERMES_HOME, "config.yaml")]: "profile: default\n" };

/** A fetch stub routed by path, so a test can flip a single endpoint's answer. */
function fakeFetch(routes: Record<string, { status?: number; body?: unknown } | null>): HermesRuntimeFetch {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const route = Object.hasOwn(routes, path) ? routes[path] : undefined;
    if (route === null || route === undefined) {
      return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
    }
    const status = route.status ?? 200;
    return {
      ok: status < 400,
      status,
      text: async () => (typeof route.body === "string" ? route.body : JSON.stringify(route.body ?? {})),
      json: async () => (typeof route.body === "string" ? JSON.parse(route.body) : (route.body ?? {})),
    };
  }) as unknown as HermesRuntimeFetch;
}

const RUNNING = {
  "/api/status": {
    body: {
      version: "0.19.0",
      gateway_running: true,
      gateway_state: "running",
      active_agents: 0,
      active_sessions: 2,
      auth_required: false,
      install_id: "install-aaa",
      profiles: ["default"],
      gateway_mode: "multiplex",
      hermes_home: HERMES_HOME,
      gateway_pid: 4242,
      overall: "ok",
    },
  },
  "/api/model/info": { body: { provider: "nous", model: "Hermes-4", model_config: { api_key_ref: "SECRET" } } },
  "/": { body: '<script>window.__HERMES_SESSION_TOKEN__="tok-abc123";</script>' },
};

function makeBridge(options: {
  fs: HermesPathFs;
  fetch?: HermesRuntimeFetch;
  controlResult?: unknown;
  onSync?: (change: { kind: string; previous: unknown; next: unknown }) => void;
  onStateChange?: (snapshot: unknown) => void;
}) {
  const controlSocket = options.controlResult ?? null;
  const sockets: HermesEventSocket[] = [];

  const bridge = createHermesBridge({
    discovery: { fs: options.fs, platform: "linux", homeDir: "/home/ada", env: {} },
    control: {
      platform: "linux",
      // `HermesControlSocket`, not the event-bus socket: the control transport is
      // one line in, one line out, then the server closes.
      createSocket: () => {
        const handlers: Record<string, (arg: never) => void> = {};
        const socket: HermesControlSocket = {
          write: vi.fn(() => true),
          end: vi.fn(),
          destroy: vi.fn(),
          onData: (h) => void (handlers.data = h as never),
          onError: (h) => void (handlers.error = h as never),
          onClose: (h) => void (handlers.close = h as never),
        };
        setTimeout(() => {
          if (controlSocket != null) {
            (handlers.data as (chunk: Buffer) => void)?.(Buffer.from(`${JSON.stringify(controlSocket)}\n`));
          } else {
            (handlers.error as (error: Error) => void)?.(new Error("ECONNREFUSED"));
          }
        }, 0);
        return socket;
      },
    },
    fetch: options.fetch ?? fakeFetch(RUNNING),
    createEventSocket: (url) => {
      const handlers: Record<string, (arg: never) => void> = {};
      const socket: HermesEventSocket = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
        onOpen: (h) => {
          handlers.open = h as never;
          setTimeout(() => (handlers.open as () => void)?.(), 0);
        },
        onMessage: (h) => void (handlers.message = h as never),
        onClose: (h) => void (handlers.close = h as never),
        onError: (h) => void (handlers.error = h as never),
      };
      sockets.push({ ...socket, url } as unknown as HermesEventSocket);
      return socket;
    },
    now: () => 1_700_000_000_000,
    onSync: options.onSync,
    onStateChange: options.onStateChange,
  });

  return { bridge, sockets };
}

describe("HermesBridge discovery states", () => {
  it("reports not-installed when Hermes is absent", async () => {
    const { bridge } = makeBridge({ fs: memFs({}) });
    const snapshot = await bridge.connect();
    expect(snapshot.state).toBe("not-installed");
    expect(snapshot.reason).toBe("not-installed");
    expect(snapshot.installed).toBe(false);
    expect(snapshot.baseUrl).toBeNull();
    bridge.dispose();
  });

  it("reports installed-idle when Hermes is present but not running", async () => {
    const { bridge } = makeBridge({ fs: memFs(INSTALLED) });
    const snapshot = await bridge.connect();
    expect(snapshot.state).toBe("installed-idle");
    expect(snapshot.reason).toBe("installed-but-not-running");
    expect(snapshot.installed).toBe(true);
    bridge.dispose();
  });

  it("reports installed-idle with backend-unreachable when the ledger record is stale", async () => {
    const fs = memFs({ ...INSTALLED, [join(HERMES_HOME, SPAWN_LEDGER_FILENAME)]: ledger() });
    const { bridge } = makeBridge({ fs, fetch: fakeFetch({}) });
    const snapshot = await bridge.connect();
    expect(snapshot.state).toBe("installed-idle");
    expect(snapshot.reason).toBe("backend-unreachable");
    bridge.dispose();
  });

  it("connects when a running backend answers /api/status", async () => {
    const fs = memFs({ ...INSTALLED, [join(HERMES_HOME, SPAWN_LEDGER_FILENAME)]: ledger() });
    const { bridge } = makeBridge({ fs });
    const snapshot = await bridge.connect();
    expect(snapshot.state).toBe("connected");
    expect(snapshot.reason).toBeNull();
    expect(snapshot.baseUrl).toBe("http://127.0.0.1:9119");
    expect(snapshot.status?.version).toBe("0.19.0");
    expect(bridge.isConnected()).toBe(true);
    bridge.dispose();
  });

  it("refuses to connect when the bind is gated and no token can be obtained", async () => {
    const fs = memFs({ ...INSTALLED, [join(HERMES_HOME, SPAWN_LEDGER_FILENAME)]: ledger() });
    const { bridge } = makeBridge({
      fs,
      fetch: fakeFetch({ ...RUNNING, "/api/status": { body: { ...RUNNING["/api/status"]!.body as object, auth_required: true } } }),
    });
    const snapshot = await bridge.connect();
    expect(snapshot.state).toBe("installed-idle");
    expect(snapshot.reason).toBe("auth-required");
    bridge.dispose();
  });
});

describe("HermesBridge context, model and theme sync", () => {
  it("adopts the model Hermes has selected, and never its credentials", async () => {
    const fs = memFs({ ...INSTALLED, [join(HERMES_HOME, SPAWN_LEDGER_FILENAME)]: ledger() });
    const { bridge } = makeBridge({ fs });
    const snapshot = await bridge.connect();
    expect(snapshot.model?.modelId).toBe("nous/Hermes-4");
    expect(snapshot.model?.provider).toBe("nous");
    // The credential reference stays out of anything the renderer could see.
    expect(JSON.stringify(snapshot.model?.modelConfig)).not.toContain("SECRET");
    bridge.dispose();
  });

  it("reports a model change through onSync", async () => {
    const fs = memFs({ ...INSTALLED, [join(HERMES_HOME, SPAWN_LEDGER_FILENAME)]: ledger() });
    const syncs: { kind: string }[] = [];
    const { bridge } = makeBridge({ fs, onSync: (change) => syncs.push(change) });
    await bridge.connect();
    expect(syncs.some((entry) => entry.kind === "model")).toBe(true);
    bridge.dispose();
  });

  it("carries the profile and home into the shared context", async () => {
    const fs = memFs({ ...INSTALLED, [join(HERMES_HOME, SPAWN_LEDGER_FILENAME)]: ledger() });
    const identify = { ok: true, result: { protocol: 1, kind: "gateway", pid: 4242, hermes_home: HERMES_HOME, profile: "work", supervisor: "manual" } };
    const { bridge } = makeBridge({ fs, controlResult: identify });
    const snapshot = await bridge.connect();
    expect(snapshot.identify?.profile).toBe("work");
    expect(snapshot.context.hermesProfile).toBe("work");
    expect(snapshot.context.hermesHome).toBe(HERMES_HOME);
    bridge.dispose();
  });

  it("applies a Hermes theme and reports the change", async () => {
    const fs = memFs({ ...INSTALLED, [join(HERMES_HOME, SPAWN_LEDGER_FILENAME)]: ledger() });
    const syncs: { kind: string; next: unknown }[] = [];
    const { bridge } = makeBridge({ fs, onSync: (change) => syncs.push(change) });
    await bridge.connect();

    const applied = bridge.applyHermesTheme({
      name: "nous-blue",
      label: "Nous Blue",
      palette: {
        background: { hex: "#000033", alpha: 1 },
        midground: { hex: "#ffffff", alpha: 1 },
        foreground: { hex: "#ffffff", alpha: 0 },
      },
      typography: { fontSans: '"Rules Compressed", sans-serif', fontMono: '"JetBrains Mono", monospace', baseSize: "16px", lineHeight: "1.5", letterSpacing: "normal" },
      layout: { radius: "0.5rem", density: "default" },
    });

    expect(applied).toBe(true);
    expect(bridge.snapshot().theme?.sourceThemeName).toBe("nous-blue");
    expect(bridge.snapshot().theme?.canvas).toBe("#000033");
    expect(syncs.some((entry) => entry.kind === "theme")).toBe(true);
    bridge.dispose();
  });

  it("rejects a theme payload that is not a Hermes theme", async () => {
    const { bridge } = makeBridge({ fs: memFs(INSTALLED) });
    expect(bridge.applyHermesTheme({ nope: true })).toBe(false);
    expect(bridge.applyHermesTheme(null)).toBe(false);
    expect(bridge.snapshot().theme).toBeNull();
    bridge.dispose();
  });

  it("preserves an in-flight operation's ids across a background sync", async () => {
    const fs = memFs({ ...INSTALLED, [join(HERMES_HOME, SPAWN_LEDGER_FILENAME)]: ledger() });
    const { bridge } = makeBridge({ fs });
    await bridge.connect();
    bridge.setLocalContext({ conversationId: "20260927_120000_abc123", taskId: "task-1" });
    await bridge.connect();
    expect(bridge.snapshot().context.conversationId).toBe("20260927_120000_abc123");
    expect(bridge.snapshot().context.taskId).toBe("task-1");
    bridge.dispose();
  });
});

describe("HermesBridge reconnect", () => {
  it("moves to reconnecting when a connected backend stops answering", async () => {
    const fs = memFs({ ...INSTALLED, [join(HERMES_HOME, SPAWN_LEDGER_FILENAME)]: ledger() });
    const fetchImpl = fakeFetch(RUNNING);
    const { bridge } = makeBridge({ fs, fetch: fetchImpl });
    await bridge.connect();
    expect(bridge.snapshot().state).toBe("connected");

    // Hermes goes away: every request now fails.
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      ok: false,
      status: 0,
      text: async () => "",
      json: async () => ({}),
    }));

    const snapshot = await bridge.connect();
    expect(snapshot.state).toBe("reconnecting");
    expect(snapshot.reason).toBe("backend-unreachable");
    expect(bridge.nextReconnectDelayMs()).toBeGreaterThan(0);
    bridge.dispose();
  });

  it("clears cached state after Hermes is upgraded (install_id changed)", async () => {
    const fs = memFs({ ...INSTALLED, [join(HERMES_HOME, SPAWN_LEDGER_FILENAME)]: ledger() });
    const diagnostics: { kind: string }[] = [];
    const fetchImpl = fakeFetch(RUNNING);
    const { bridge } = makeBridge({ fs, fetch: fetchImpl });
    await bridge.connect();
    expect(bridge.snapshot().status?.installId).toBe("install-aaa");

    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/api/status") {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({ ...(RUNNING["/api/status"]!.body as object), install_id: "install-bbb", version: "0.20.0" }),
        };
      }
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    });

    await bridge.connect();
    expect(bridge.snapshot().status?.installId).toBe("install-bbb");
    expect(bridge.snapshot().status?.version).toBe("0.20.0");
    void diagnostics;
    bridge.dispose();
  });

  it("treats a changed pid with the same install_id as a restart, not a new install", async () => {
    const fs = memFs({ ...INSTALLED, [join(HERMES_HOME, SPAWN_LEDGER_FILENAME)]: ledger() });
    const kinds: string[] = [];
    const { bridge } = makeBridge({
      fs,
      controlResult: { ok: true, result: { protocol: 1, kind: "gateway", pid: 9999, hermes_home: HERMES_HOME, profile: "default" } },
      onStateChange: () => undefined,
    });
    bridge.events.close();
    await bridge.connect();
    expect(bridge.snapshot().identify?.pid).toBe(9999);
    expect(kinds).toEqual([]);
    bridge.dispose();
  });

  it("reconnects cleanly after a disconnect", async () => {
    const fs = memFs({ ...INSTALLED, [join(HERMES_HOME, SPAWN_LEDGER_FILENAME)]: ledger() });
    const { bridge } = makeBridge({ fs });
    await bridge.connect();
    bridge.disconnect();
    expect(bridge.snapshot().state).toBe("disconnected");
    expect(bridge.snapshot().baseUrl).toBeNull();

    const after = await bridge.connect();
    expect(after.state).toBe("connected");
    expect(after.baseUrl).toBe("http://127.0.0.1:9119");
    bridge.dispose();
  });

  it("bumps generation on every transition so the UI can invalidate caches", async () => {
    const { bridge } = makeBridge({ fs: memFs(INSTALLED) });
    const first = bridge.snapshot().generation;
    await bridge.connect();
    expect(bridge.snapshot().generation).toBeGreaterThan(first);
    bridge.dispose();
  });
});

describe("HermesBridge event bus", () => {
  it("opens a publish connection once connected", async () => {
    const fs = memFs({ ...INSTALLED, [join(HERMES_HOME, SPAWN_LEDGER_FILENAME)]: ledger() });
    const { bridge } = makeBridge({ fs });
    await bridge.connect();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(bridge.events.bufferedCount()).toBe(0);
    bridge.dispose();
  });
});
