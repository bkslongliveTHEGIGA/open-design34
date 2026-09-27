// Hermes runtime adapter — the loopback HTTP surface.
//
// Two things live here: the *unauthenticated* handshake and the *authenticated*
// reads. The split is upstream's, not ours:
//
//   • `GET /api/status` is in `PUBLIC_API_PATHS` (`hermes_cli/dashboard_auth/
//     public_paths.py`) and documented as "public machine-level liveness probe:
//     version, gateway state, active session count and the auth-gate shape — no
//     bodies, no session content, no secrets". That makes it the correct first
//     call, before any token exists.
//   • Everything else needs `X-Hermes-Session-Token` (REST) or `?token=` (WS),
//     per `apps/desktop/electron/connection-config.ts`. The token itself is
//     published by `hermes_cli/web_server_dashboard.py` as
//     `window.__HERMES_SESSION_TOKEN__` in the dashboard document — but *only*
//     on an ungated loopback bind.
//
// A security detail worth repeating because it shapes this file: `/api/status`
// includes `hermes_home`, `config_path`, `env_path`, `gateway_pid`,
// `gateway_health_url` and `gateways` **only when `auth_required` is false**.
// Those fields are therefore optional in the type below and must never be
// assumed present. They are also never forwarded to the renderer.

/** `GET /api/status`, narrowed. Fields marked optional are conditionally present. */
export interface HermesStatusSnapshot {
  version: string | null;
  gatewayRunning: boolean;
  gatewayState: string | null;
  activeAgents: number | null;
  activeSessions: number | null;
  /** From `_auth_gate_status()`. */
  authRequired: boolean;
  /** Stable per-install identity; the bridge keys reconnect detection on it. */
  installId: string | null;
  profiles: string[];
  gatewayMode: string | null;
  /** Present only on a loopback / non-auth bind. Never sent to a renderer. */
  hermesHome: string | null;
  gatewayPid: number | null;
  /** Component rollup: `"ok"` when every component is ok, else `"degraded"`. */
  overall: string | null;
  /** Unconsumed upstream fields, preserved verbatim. */
  extra: Record<string, unknown>;
}

const STATUS_KNOWN_KEYS = Object.freeze([
  "version",
  "gateway_running",
  "gateway_state",
  "active_agents",
  "active_sessions",
  "auth_required",
  "install_id",
  "profiles",
  "gateway_mode",
  "hermes_home",
  "gateway_pid",
  "overall",
] as const);

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseHermesStatusSnapshot(payload: unknown): HermesStatusSnapshot | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;

  const extra: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!(STATUS_KNOWN_KEYS as readonly string[]).includes(key)) extra[key] = entry;
  }

  return {
    version: asNullableString(value.version),
    gatewayRunning: value.gateway_running === true,
    gatewayState: asNullableString(value.gateway_state),
    activeAgents: asNullableNumber(value.active_agents),
    activeSessions: asNullableNumber(value.active_sessions),
    authRequired: value.auth_required === true,
    installId: asNullableString(value.install_id),
    profiles: Array.isArray(value.profiles)
      ? value.profiles.filter((entry): entry is string => typeof entry === "string")
      : [],
    gatewayMode: asNullableString(value.gateway_mode),
    hermesHome: asNullableString(value.hermes_home),
    gatewayPid: asNullableNumber(value.gateway_pid),
    overall: asNullableString(value.overall),
    extra,
  };
}

/**
 * Redacted copy safe for the renderer and logs.
 *
 * Drops `hermesHome` and `gatewayPid` (host recon) and the raw `extra` bag,
 * which may carry `config_path`/`env_path`/`gateways` on a loopback bind.
 */
export function redactHermesStatusSnapshot(snapshot: HermesStatusSnapshot): HermesStatusSnapshot {
  return { ...snapshot, hermesHome: null, gatewayPid: null, extra: {} };
}

/**
 * Extract the session token from a dashboard document body.
 *
 * `web_server_dashboard.py` inlines `window.__HERMES_SESSION_TOKEN__=<json>;`.
 * Only the token is extracted — the document is otherwise discarded, and the
 * token is never logged or passed to the renderer.
 */
export function extractHermesSessionToken(html: string | null | undefined): string | null {
  if (!html) return null;

  const patterns = [
    /window\.__HERMES_SESSION_TOKEN__\s*=\s*"([^"]*)"/,
    /window\.__HERMES_SESSION_TOKEN__\s*=\s*'([^']*)'/,
    /window\.__HERMES_SESSION_TOKEN__\s*=\s*(".*?")\s*;/s,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (!match?.[1]) continue;
    let token = match[1];
    if (token.startsWith('"') && token.endsWith('"') && token.length >= 2) {
      try {
        token = JSON.parse(token) as string;
      } catch {
        // Leave the raw literal; it is still a usable opaque string.
      }
    }
    token = token.trim();
    if (token.length > 0) return token;
  }

  return null;
}

/** Minimal fetch surface, injected so tests never touch the network. */
export interface HermesRuntimeFetch {
  (url: string, init?: { method?: string; headers?: Record<string, string>; signal?: unknown }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    json(): Promise<unknown>;
  }>;
}

export interface HermesRuntimeAdapterDeps {
  /** Loopback base URL of the attached backend, e.g. `http://127.0.0.1:9119`. */
  baseUrl: string;
  fetch?: HermesRuntimeFetch;
  /** Resolve the session token; returns null when the bind is gated. */
  resolveToken?: () => Promise<string | null>;
  /** Milliseconds before a request is abandoned. */
  timeoutMs?: number;
}

export const HERMES_RUNTIME_TIMEOUT_MS = 15_000;

export type HermesRuntimeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status?: number };

/**
 * The bridge's only HTTP client for Hermes.
 *
 * Every request goes to the attached loopback base URL and carries the session
 * token header when one is known. It never sends credentials, never follows to a
 * non-loopback origin, and never logs a token.
 */
export function createHermesRuntimeAdapter(deps: HermesRuntimeAdapterDeps) {
  const fetchImpl: HermesRuntimeFetch = deps.fetch ?? (fetch as unknown as HermesRuntimeFetch);
  const timeoutMs = deps.timeoutMs ?? HERMES_RUNTIME_TIMEOUT_MS;

  const request = async <T>(
    path: string,
    options: { method?: string; authenticated?: boolean; parse?: (payload: unknown) => T } = {},
  ): Promise<HermesRuntimeResult<T>> => {
    const url = joinLoopbackUrl(deps.baseUrl, path);
    if (url == null) return { ok: false, error: "non-loopback-base-url" };

    const headers: Record<string, string> = { accept: "application/json" };
    if (options.authenticated !== false && deps.resolveToken) {
      const token = await deps.resolveToken();
      // Absent token is not an error: `/api/status` is public, and a gated bind
      // must produce a clean 401 rather than a thrown exception.
      if (token) headers["X-Hermes-Session-Token"] = token;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();

    try {
      const response = await fetchImpl(url, {
        method: options.method ?? "GET",
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        return { ok: false, error: `http-${response.status}`, status: response.status };
      }
      const payload = await response.json();
      const parse = options.parse ?? ((value: unknown) => value as T);
      return { ok: true, value: parse(payload) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    /** Public liveness probe. Safe before any token exists. */
    status(): Promise<HermesRuntimeResult<HermesStatusSnapshot | null>> {
      return request<HermesStatusSnapshot | null>("/api/status", {
        authenticated: false,
        parse: (payload) => parseHermesStatusSnapshot(payload),
      });
    },

    /** The dashboard document, for the loopback session token. */
    async dashboardDocument(): Promise<HermesRuntimeResult<string>> {
      const url = joinLoopbackUrl(deps.baseUrl, "/");
      if (url == null) return { ok: false, error: "non-loopback-base-url" };
      try {
        const response = await fetchImpl(url, { method: "GET", headers: { accept: "text/html" } });
        if (!response.ok) return { ok: false, error: `http-${response.status}`, status: response.status };
        return { ok: true, value: await response.text() };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    /** `GET /api/model/info` — the model Hermes currently has selected. */
    modelInfo(): Promise<HermesRuntimeResult<unknown>> {
      return request<unknown>("/api/model/info", {});
    },

    /** `GET /api/model/options` — the picker list. Read-only; see module note. */
    modelOptions(): Promise<HermesRuntimeResult<unknown>> {
      return request<unknown>("/api/model/options", {});
    },

    /** `GET /api/skills` — Hermes' skill catalogue, for parity in the UI. */
    skills(): Promise<HermesRuntimeResult<unknown>> {
      return request<unknown>("/api/skills", {});
    },

    /** `GET /api/sessions` — recent conversations, so a deep link can resolve. */
    sessions(): Promise<HermesRuntimeResult<unknown>> {
      return request<unknown>("/api/sessions", {});
    },

    /** Escape hatch for a path this adapter has not wrapped yet. */
    get: <T>(path: string, parse?: (payload: unknown) => T) =>
      request<T>(path, parse ? { parse } : {}),
  };
}

/**
 * Join a path onto the base URL, refusing anything that is not loopback.
 *
 * The bridge must never be talked into calling a remote origin: a ledger entry
 * with a spoofed host, or a hand-edited config, could otherwise turn a
 * local-only integration into an outbound request carrying a session token.
 */
export function joinLoopbackUrl(baseUrl: string, path: string): string | null {
  let url: URL;
  try {
    url = new URL(path, baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (!loopback.has(host)) return null;

  return url.toString();
}

/** WS URL for the event bus, with the token in the query string per upstream. */
export function buildHermesEventPublishUrl(baseUrl: string, channel: string, token: string | null): string | null {
  const http = joinLoopbackUrl(baseUrl, "/api/pub");
  if (http == null) return null;

  const url = new URL(http);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("channel", channel);
  // Upstream's WS auth convention: `?token=` for the static session token.
  if (token) url.searchParams.set("token", token);
  return url.toString();
}
