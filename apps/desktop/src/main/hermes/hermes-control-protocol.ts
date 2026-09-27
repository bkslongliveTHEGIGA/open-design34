// Gateway control-socket wire protocol.
//
// Ported from `gateway/control_socket.py`. The contract, in upstream's words:
// "ONE request per connection — one JSON line in, one out, then the server
// closes." Requests are bounded at 64 KiB and responses at 512 KiB so a
// misbehaving peer cannot balloon memory; this client enforces the same caps on
// the response it reads.
//
// The auth boundary is the filesystem/pipe ACL — there is no token on this
// transport, which is precisely why it is never a TCP port and never leaves the
// machine. Nothing sensitive is ever sent over it: `identify` and `status` are
// read-only liveness/identity queries.

import { HERMES_CONTROL_PROTOCOL_VERSION } from "./upstream-pin.js";

/** `gateway/control_socket.py::_MAX_REQUEST_BYTES`. */
export const HERMES_CONTROL_MAX_REQUEST_BYTES = 64 * 1024;

/** `gateway/control_socket.py::_MAX_RESPONSE_BYTES`. */
export const HERMES_CONTROL_MAX_RESPONSE_BYTES = 512 * 1024;

/** `gateway/control_socket.py::_DEFAULT_CLIENT_TIMEOUT`. */
export const HERMES_CONTROL_DEFAULT_TIMEOUT_MS = 2000;

/** Verbs the base server always answers; hosts may register more. */
export const HERMES_CONTROL_BASE_VERBS = Object.freeze(["identify", "status"] as const);

export type HermesControlVerb = (typeof HERMES_CONTROL_BASE_VERBS)[number] | (string & {});

/** Request frame: `{"verb","id","protocol",["params"]}` plus a trailing newline. */
export interface HermesControlRequest {
  verb: HermesControlVerb;
  id?: number;
  params?: Record<string, unknown>;
}

export type HermesControlResponse =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string; protocol?: number; supportedVerbs?: string[] };

/**
 * Encode one request as the single JSON line the server expects.
 *
 * `query_gateway_control` always sends `id: 1`; params are only attached when
 * non-empty, because argument-less verbs (`identify`, `status`, `rescan`) keep a
 * bare handler signature upstream and would choke on an unexpected kwarg.
 */
export function encodeHermesControlRequest(request: HermesControlRequest): string {
  const payload: Record<string, unknown> = {
    verb: request.verb,
    id: request.id ?? 1,
    protocol: HERMES_CONTROL_PROTOCOL_VERSION,
  };
  if (request.params && Object.keys(request.params).length > 0) payload.params = request.params;

  const encoded = `${JSON.stringify(payload)}\n`;
  if (Buffer.byteLength(encoded, "utf8") > HERMES_CONTROL_MAX_REQUEST_BYTES) {
    throw new Error(`hermes control request exceeds ${HERMES_CONTROL_MAX_REQUEST_BYTES} bytes`);
  }
  return encoded;
}

/**
 * Decode one response line.
 *
 * Returns a discriminated result rather than throwing: upstream's client
 * (`query_gateway_control`) treats *any* failure — no socket, timeout, malformed
 * answer, `ok: false` — as "fall back to the scan layer", and this bridge has to
 * make the same decision. `invalid` distinguishes "the peer answered with
 * something that is not this protocol" from "nothing answered".
 */
export type HermesControlDecodeResult =
  | { kind: "ok"; result: Record<string, unknown> }
  | { kind: "error"; error: string; protocol: number | null; supportedVerbs: string[] }
  | { kind: "invalid"; reason: string }
  | { kind: "protocol-mismatch"; protocol: number };

export function decodeHermesControlResponse(raw: string | null | undefined): HermesControlDecodeResult {
  if (raw == null) return { kind: "invalid", reason: "no-response" };
  if (Buffer.byteLength(raw, "utf8") > HERMES_CONTROL_MAX_RESPONSE_BYTES) {
    return { kind: "invalid", reason: "response-too-large" };
  }

  const line = raw.replace(/^\uFEFF/, "").split("\n", 1)[0] ?? "";
  if (line.trim().length === 0) return { kind: "invalid", reason: "empty-response" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: "invalid", reason: "malformed-json" };
  }
  if (!parsed || typeof parsed !== "object") return { kind: "invalid", reason: "not-an-object" };

  const response = parsed as Record<string, unknown>;
  const protocol = typeof response.protocol === "number" ? response.protocol : null;

  if (protocol !== null && protocol !== HERMES_CONTROL_PROTOCOL_VERSION) {
    return { kind: "protocol-mismatch", protocol };
  }

  if (response.ok === true) {
    if (!response.result || typeof response.result !== "object") {
      return { kind: "invalid", reason: "ok-without-result" };
    }
    return { kind: "ok", result: response.result as Record<string, unknown> };
  }

  return {
    kind: "error",
    error: typeof response.error === "string" ? response.error : "unknown-error",
    protocol,
    supportedVerbs: Array.isArray(response.supported_verbs)
      ? response.supported_verbs.filter((verb): verb is string => typeof verb === "string")
      : [],
  };
}

/**
 * The `identify` payload, narrowed to the fields this bridge reads.
 *
 * `build_identify_payload` returns `{protocol, kind, pid, start_time,
 * hermes_home, profile, supervisor, served_profiles?, ...code identity}`. Only
 * the subset below is consumed; everything else is passed through untouched so a
 * newer upstream can add fields without breaking us.
 */
export interface HermesIdentify {
  protocol: number;
  kind: string | null;
  pid: number | null;
  startTime: number | null;
  hermesHome: string | null;
  profile: string | null;
  supervisor: string | null;
  /** Multiplex mode: the profiles this one backend serves. */
  servedProfiles: string[];
  /** Unconsumed upstream fields, preserved verbatim. */
  extra: Record<string, unknown>;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const IDENTIFY_KNOWN_KEYS = Object.freeze([
  "protocol",
  "kind",
  "pid",
  "start_time",
  "hermes_home",
  "profile",
  "supervisor",
  "served_profiles",
] as const);

export function parseHermesIdentify(result: Record<string, unknown>): HermesIdentify {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if (!(IDENTIFY_KNOWN_KEYS as readonly string[]).includes(key)) extra[key] = value;
  }

  return {
    protocol: asNumberOrNull(result.protocol) ?? HERMES_CONTROL_PROTOCOL_VERSION,
    kind: asStringOrNull(result.kind),
    pid: asNumberOrNull(result.pid),
    startTime: asNumberOrNull(result.start_time),
    hermesHome: asStringOrNull(result.hermes_home),
    profile: asStringOrNull(result.profile),
    supervisor: asStringOrNull(result.supervisor),
    servedProfiles: Array.isArray(result.served_profiles)
      ? result.served_profiles.filter((entry): entry is string => typeof entry === "string")
      : [],
    extra,
  };
}

/**
 * Liveness rule, straight from the module docstring: "A connectable socket with
 * a well-formed `identify` answer IS liveness — no PID-reuse heuristics."
 *
 * So a stale ledger entry whose gateway still answers is alive, and a fresh
 * ledger entry whose gateway does not answer is not. `pid` is never compared.
 */
export function isLiveIdentify(decoded: HermesControlDecodeResult): decoded is { kind: "ok"; result: Record<string, unknown> } {
  return decoded.kind === "ok";
}
