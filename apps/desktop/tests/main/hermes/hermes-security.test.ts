import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  extractHermesSessionToken,
  joinLoopbackUrl,
  parseHermesStatusSnapshot,
  redactHermesStatusSnapshot,
} from "../../../src/main/hermes/hermes-runtime-adapter.js";
import { decodeHermesControlResponse, encodeHermesControlRequest } from "../../../src/main/hermes/hermes-control-protocol.js";
import { redactHermesContext, mapHermesContext } from "../../../src/main/hermes/hermes-context.js";
import { redactHermesModelSelection, mapHermesModelSelection } from "../../../src/main/hermes/hermes-model-adapter.js";
import {
  HERMES_CONTROL_MAX_REQUEST_BYTES,
  HERMES_CONTROL_MAX_RESPONSE_BYTES,
} from "../../../src/main/hermes/hermes-control-protocol.js";

const HERMES_DIR = join(process.cwd(), "src", "main", "hermes");

const MODULES = [
  "upstream-pin.ts",
  "hermes-paths.ts",
  "hermes-discovery.ts",
  "hermes-control-protocol.ts",
  "hermes-control-client.ts",
  "hermes-runtime-adapter.ts",
  "hermes-context.ts",
  "hermes-permissions.ts",
  "hermes-actions.ts",
  "hermes-events.ts",
  "hermes-model-adapter.ts",
  "hermes-theme-adapter.ts",
  "hermes-artifact-adapter.ts",
  "hermes-bridge.ts",
  "hermes-deeplink.ts",
  "hermes-controls.ts",
  "hermes-brand.ts",
  "index.ts",
] as const;

describe("module boundary", () => {
  it.each(MODULES)("%s imports neither electron nor node:net at module scope", (file) => {
    const source = readFileSync(join(HERMES_DIR, file), "utf8");
    // The whole layer is electron-free so it is testable without a runtime; only
    // the control client may touch a socket, and it does so through an injectable
    // factory rather than at import time.
    expect(source).not.toMatch(/from\s+"electron"/);
    if (file !== "hermes-control-client.ts") {
      expect(source).not.toMatch(/from\s+"node:net"/);
    }
  });

/**
 * Real module specifiers, i.e. only `import`/`export ... from` statements.
 *
 * A looser `/from\s+"..."/` also matches prose in comments, which made this test
 * fail on a sentence rather than on a dependency.
 */
function importedSpecifiers(source: string): string[] {
  const statements = source.match(/^(?:import|export)[\s\S]*?from\s+"([^"]+)"\s*;?$/gm) ?? [];
  return statements.map((statement) => /from\s+"([^"]+)"/.exec(statement)?.[1] ?? "");
}

  it("keeps every dependency inside node builtins and this directory", () => {
    for (const file of MODULES) {
      const specifiers = importedSpecifiers(readFileSync(join(HERMES_DIR, file), "utf8"));
      // `upstream-pin.ts` is pure data and legitimately imports nothing; what
      // matters is that anything imported is a builtin or a sibling module.
      for (const specifier of specifiers) {
        const allowed =
          specifier.startsWith("node:") ||
          specifier.startsWith("./") ||
          specifier === "@open-design/sidecar-proto" ||
          specifier === "@open-design/contracts";
        expect(allowed, `${file} imports unexpected "${specifier}"`).toBe(true);
      }
    }
  });

  it("never imports or requires the vendored Hermes source", () => {
    for (const file of MODULES) {
      const source = readFileSync(join(HERMES_DIR, file), "utf8");
      // `upstream-pin.ts` legitimately *names* the submodule path as data so the
      // verification script can find it; what must never happen is importing code
      // from it, which would pull Hermes source into the production bundle.
      for (const specifier of importedSpecifiers(source)) {
        expect(specifier, `${file} imports "${specifier}"`).not.toContain("nous-hermes");
      }
      expect(source, file).not.toMatch(/require\(\s*["'][^"']*nous-hermes/);
      expect(source, file).not.toMatch(/import\(\s*["'][^"']*nous-hermes/);
    }
  });
});

describe("secret handling", () => {
  const TOKEN = "tok-super-secret-value";

  it("extracts the session token from the dashboard document", () => {
    expect(extractHermesSessionToken(`<script>window.__HERMES_SESSION_TOKEN__="${TOKEN}";</script>`)).toBe(TOKEN);
    expect(extractHermesSessionToken(`<script>window.__HERMES_SESSION_TOKEN__='${TOKEN}';</script>`)).toBe(TOKEN);
    expect(extractHermesSessionToken(`window.__HERMES_SESSION_TOKEN__=${JSON.stringify(TOKEN)};`)).toBe(TOKEN);
  });

  it("returns null when the document carries no token", () => {
    expect(extractHermesSessionToken("<html>nope</html>")).toBeNull();
    expect(extractHermesSessionToken("")).toBeNull();
    expect(extractHermesSessionToken(null)).toBeNull();
    expect(extractHermesSessionToken('window.__HERMES_SESSION_TOKEN__="";')).toBeNull();
  });

  it("never logs the token value — only its presence", () => {
    const source = readFileSync(join(HERMES_DIR, "hermes-bridge.ts"), "utf8");
    // The diagnostic hook must receive a literal, not the token.
    expect(source).toContain('detail: "acquired"');
    expect(source).not.toMatch(/detail:\s*token/);
    expect(source).not.toMatch(/detail:\s*\$\{token\}/);
  });

  it("keeps model credentials out of anything a renderer can read", () => {
    const selection = mapHermesModelSelection({
      provider: "nous",
      model: "m",
      model_config: { api_key: "sk-live-123", token: "SECRET-TOKEN" },
    });
    const redacted = redactHermesModelSelection(selection);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("sk-live-123");
    expect(serialized).not.toContain("SECRET-TOKEN");
  });

  it("keeps credentials and permission grants out of the shared context", () => {
    const context = mapHermesContext({
      model_config: { api_key: "sk-live-123" },
      permission_context_id: "grant-abc",
      extra_secret: "nope",
    });
    const serialized = JSON.stringify(redactHermesContext(context));
    expect(serialized).not.toContain("sk-live-123");
    expect(serialized).not.toContain("grant-abc");
    expect(serialized).not.toContain("nope");
  });

  it("keeps host recon out of the status snapshot sent to the UI", () => {
    const snapshot = parseHermesStatusSnapshot({
      version: "0.19.0",
      gateway_running: true,
      auth_required: false,
      install_id: "i-1",
      hermes_home: "/home/ada/.hermes",
      gateway_pid: 4242,
      config_path: "/home/ada/.hermes/config.yaml",
      env_path: "/home/ada/.hermes/.env",
      gateways: [{ port: 9119 }],
      overall: "ok",
    })!;
    const redacted = redactHermesStatusSnapshot(snapshot);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("/home/ada/.hermes");
    expect(serialized).not.toContain("4242");
    expect(serialized).not.toContain("config.yaml");
    expect(serialized).not.toContain("9119");
    // Liveness facts the UI legitimately needs survive.
    expect(redacted.version).toBe("0.19.0");
    expect(redacted.gatewayRunning).toBe(true);
  });

  it("treats the loopback-only status fields as optional, since a gated bind omits them", () => {
    const snapshot = parseHermesStatusSnapshot({ version: "0.19.0", gateway_running: true, auth_required: true });
    expect(snapshot?.hermesHome).toBeNull();
    expect(snapshot?.gatewayPid).toBeNull();
  });
});

describe("network boundary", () => {
  it("only ever dials loopback", () => {
    for (const base of ["http://127.0.0.1:9119", "http://localhost:9119", "http://[::1]:9119"]) {
      expect(joinLoopbackUrl(base, "/api/status")).not.toBeNull();
    }
  });

  it("refuses any origin that could carry a session token off-machine", () => {
    for (const base of [
      "http://10.0.0.5:9119",
      "http://192.168.1.20:9119",
      "https://hermes.example.com",
      "http://169.254.169.254",
      "file:///etc/passwd",
    ]) {
      expect(joinLoopbackUrl(base, "/api/status"), base).toBeNull();
    }
  });

  it("refuses a base URL it cannot parse", () => {
    expect(joinLoopbackUrl("not a url", "/api/status")).toBeNull();
  });

  it("does not allow path traversal out of the loopback origin", () => {
    const url = joinLoopbackUrl("http://127.0.0.1:9119", "//evil.example.com/x");
    expect(url == null || url.startsWith("http://127.0.0.1:9119/")).toBe(true);
  });
});

describe("control socket hygiene", () => {
  it("bounds the request it will send", () => {
    const huge = { verb: "identify", params: { blob: "x".repeat(HERMES_CONTROL_MAX_REQUEST_BYTES) } };
    expect(() => encodeHermesControlRequest(huge)).toThrow();
  });

  it("bounds the response it will accept", () => {
    expect(decodeHermesControlResponse("y".repeat(HERMES_CONTROL_MAX_RESPONSE_BYTES + 1))).toEqual({
      kind: "invalid",
      reason: "response-too-large",
    });
  });

  it("refuses a peer speaking a different protocol version rather than half-interpreting it", () => {
    expect(decodeHermesControlResponse('{"ok":true,"protocol":2,"result":{}}')).toEqual({
      kind: "protocol-mismatch",
      protocol: 2,
    });
  });

  it("surfaces the peer's supported verbs on an unknown-verb error", () => {
    const decoded = decodeHermesControlResponse(
      '{"ok":false,"error":"unknown verb: \'frobnicate\'","protocol":1,"supported_verbs":["identify","status"]}',
    );
    expect(decoded).toMatchObject({ kind: "error", supportedVerbs: ["identify", "status"] });
  });

  it("sends no params for argument-less verbs, which upstream handlers reject", () => {
    expect(encodeHermesControlRequest({ verb: "identify" })).toBe('{"verb":"identify","id":1,"protocol":1}\n');
  });
});

describe("logging discipline", () => {
  it("does not console.log a token, key or authorization header anywhere in the layer", () => {
    for (const file of MODULES) {
      const source = readFileSync(join(HERMES_DIR, file), "utf8");
      expect(source, file).not.toMatch(/console\.(log|info|warn|error|debug)\([^)]*token/i);
      expect(source, file).not.toMatch(/console\.(log|info|warn|error|debug)\([^)]*api[_-]?key/i);
      expect(source, file).not.toMatch(/console\.(log|info|warn|error|debug)\([^)]*authorization/i);
    }
  });

  it("never writes credentials to the filesystem", () => {
    for (const file of MODULES) {
      const source = readFileSync(join(HERMES_DIR, file), "utf8");
      expect(source, file).not.toMatch(/writeFile|appendFile|createWriteStream/);
    }
  });

  it("keeps the audit hook from throwing into the action it describes", async () => {
    const { createHermesActionRegistry } = await import("../../../src/main/hermes/hermes-actions.js");
    const { emptyHermesContext } = await import("../../../src/main/hermes/hermes-context.js");
    const registry = createHermesActionRegistry({
      permissions: { connected: true, approvalMode: "off", managed: false },
      onAudit: () => {
        throw new Error("audit sink is down");
      },
    });
    registry.register("getStatus", () => "ok");
    const result = await registry.dispatch({ action: "getStatus", context: emptyHermesContext() });
    expect(result).toMatchObject({ ok: true });
    void vi;
  });
});
