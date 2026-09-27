// Gateway control-socket client.
//
// The transport half of `gateway/control_socket.py::query_gateway_control`. It
// is split from the protocol module so the framing rules stay pure and this file
// is the only place that touches a socket.
//
// Both upstream transports are covered by one implementation: on POSIX the path
// is an AF_UNIX stream socket, and on Windows Node's `net.connect(path)` speaks
// the same framed protocol over `\\.\pipe\hermes-gateway-<hash>`. The server
// closes after one response, so this client opens a connection per verb — that
// is the documented contract, not an inefficiency to optimise away.

import { connect, type Socket } from "node:net";

import {
  HERMES_CONTROL_DEFAULT_TIMEOUT_MS,
  HERMES_CONTROL_MAX_RESPONSE_BYTES,
  decodeHermesControlResponse,
  encodeHermesControlRequest,
  type HermesControlDecodeResult,
  type HermesControlRequest,
} from "./hermes-control-protocol.js";
import {
  resolveHermesControlSocketCandidates,
  resolveHermesControlSocketPath,
  hermesWindowsControlPipeName,
  type HermesPathFs,
} from "./hermes-paths.js";

/** Injectable socket factory so tests never open a real connection. */
export interface HermesControlSocket {
  write(data: string): boolean;
  end(): void;
  destroy(): void;
  onData(handler: (chunk: Buffer) => void): void;
  onError(handler: (error: Error) => void): void;
  onClose(handler: () => void): void;
}

export interface HermesControlClientDeps {
  /** Defaults to a `node:net` adapter. */
  createSocket?: (target: { kind: "unix"; path: string } | { kind: "pipe"; name: string }) => HermesControlSocket;
  now?: () => number;
}

/**
 * Ask the gateway serving `home` one control verb.
 *
 * Mirrors upstream's never-raise contract: no socket, connect refused, timeout,
 * oversized or malformed answer, and `ok: false` all resolve to a non-`ok`
 * result so the caller can fall back to the scan layer instead of crashing the
 * desktop main process.
 */
export async function queryHermesControl(
  target: { kind: "unix"; path: string } | { kind: "pipe"; name: string },
  request: HermesControlRequest,
  deps: HermesControlClientDeps = {},
): Promise<HermesControlDecodeResult> {
  const createSocket = deps.createSocket ?? defaultCreateSocket;

  let encoded: string;
  try {
    encoded = encodeHermesControlRequest(request);
  } catch {
    return { kind: "invalid", reason: "request-too-large" };
  }

  return new Promise<HermesControlDecodeResult>((resolvePromise) => {
    const chunks: Buffer[] = [];
    let settled = false;
    let socket: HermesControlSocket;

    const settle = (result: HermesControlDecodeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {
        // Best-effort teardown; the server closes its side regardless.
      }
      resolvePromise(result);
    };

    const timer = setTimeout(() => settle({ kind: "invalid", reason: "timeout" }), HERMES_CONTROL_DEFAULT_TIMEOUT_MS);
    // The timer must never hold the process open on quit.
    timer.unref?.();

    try {
      socket = createSocket(target);
    } catch {
      clearTimeout(timer);
      resolvePromise({ kind: "invalid", reason: "socket-create-failed" });
      return;
    }

    socket.onError(() => settle({ kind: "invalid", reason: "socket-error" }));
    socket.onClose(() => settle(decodeHermesControlResponse(finalize(chunks))));
    socket.onData((chunk) => {
      chunks.push(chunk);
      const total = chunks.reduce((sum, entry) => sum + entry.byteLength, 0);
      if (total > HERMES_CONTROL_MAX_RESPONSE_BYTES) {
        settle({ kind: "invalid", reason: "response-too-large" });
        return;
      }
      // The server answers with exactly one line then closes; stop early if the
      // newline already arrived so we do not wait on the close event.
      if (chunk.includes(0x0a)) {
        settle(decodeHermesControlResponse(finalize(chunks)));
      }
    });

    try {
      socket.write(encoded);
    } catch {
      settle({ kind: "invalid", reason: "write-failed" });
    }
  });
}

function finalize(chunks: Buffer[]): string | null {
  if (chunks.length === 0) return null;
  return Buffer.concat(chunks).toString("utf8");
}

function defaultCreateSocket(target: { kind: "unix"; path: string } | { kind: "pipe"; name: string }): HermesControlSocket {
  const path = target.kind === "unix" ? target.path : target.name;
  const socket: Socket = connect({ path });

  return {
    write: (data) => socket.write(data),
    end: () => socket.end(),
    destroy: () => socket.destroy(),
    onData: (handler) => socket.on("data", handler),
    onError: (handler) => socket.on("error", handler),
    onClose: (handler) => {
      socket.on("close", handler);
      // An ECONNREFUSED/ENOENT on a missing socket can surface as 'error' only.
      socket.on("error", () => handler());
    },
  };
}

/**
 * `identify` the gateway serving `home`, or null when nothing answers.
 *
 * The bridge's primary liveness probe. POSIX resolves the socket path first
 * (direct, then the `gateway.sock.path` pointer); Windows has no path to resolve
 * because the pipe is only observable by connecting.
 */
export async function identifyHermesGateway(
  home: string,
  fs: HermesPathFs,
  deps: HermesControlClientDeps & { platform?: NodeJS.Platform; tmpDir?: string } = {},
): Promise<HermesControlDecodeResult> {
  const platform = deps.platform ?? process.platform;
  const target =
    platform === "win32"
      ? ({ kind: "pipe", name: hermesWindowsControlPipeName(home, platform) } as const)
      : (() => {
          const path =
            resolveHermesControlSocketPath(home, fs, { platform }) ??
            resolveHermesControlSocketCandidates(home, { platform, tmpDir: deps.tmpDir })[0];
          return path ? ({ kind: "unix", path } as const) : null;
        })();

  if (target == null) return { kind: "invalid", reason: "no-socket" };
  return queryHermesControl(target, { verb: "identify" }, deps);
}

/** `status` the gateway serving `home`. */
export async function queryHermesGatewayStatus(
  home: string,
  fs: HermesPathFs,
  deps: HermesControlClientDeps & { platform?: NodeJS.Platform; tmpDir?: string } = {},
): Promise<HermesControlDecodeResult> {
  const platform = deps.platform ?? process.platform;
  const target =
    platform === "win32"
      ? ({ kind: "pipe", name: hermesWindowsControlPipeName(home, platform) } as const)
      : (() => {
          const path =
            resolveHermesControlSocketPath(home, fs, { platform }) ??
            resolveHermesControlSocketCandidates(home, { platform, tmpDir: deps.tmpDir })[0];
          return path ? ({ kind: "unix", path } as const) : null;
        })();

  if (target == null) return { kind: "invalid", reason: "no-socket" };
  return queryHermesControl(target, { verb: "status" }, deps);
}
