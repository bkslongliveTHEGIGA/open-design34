// Design Studio → Hermes typed events.
//
// Transport: Hermes' own event bus, not a new one. From
// `hermes_cli/web_routers/chat_ws.py`:
//
//   • `WS /api/pub?channel=<name>`    — publisher; every text frame received is
//                                       broadcast verbatim to that channel
//   • `WS /api/events?channel=<name>` — subscriber; receives frames, never sends
//   • channel must match `^[A-Za-z0-9._-]{1,128}$` (`_VALID_CHANNEL_RE`), or the
//     server closes with 4400
//   • both are gated by `_close_unless_sidecar_allowed`: 4403 when embedded chat
//     is disabled or the request is not allowed, 4401 on bad auth
//
// So Design Studio publishes on `/api/pub` and Hermes Chat subscribes on
// `/api/events` — the same path the React sidebar's tool-call feed already uses.
// Adding a channel needs no Hermes-side change, which is exactly why this is the
// right transport: section 8 asked for the existing mechanism, not a parallel one.

/** Channel Design Studio publishes on. Matches `_VALID_CHANNEL_RE`. */
export const HERMES_DESIGN_STUDIO_EVENT_CHANNEL = "design-studio";

/** `hermes_cli/web_routers/chat_ws.py::_VALID_CHANNEL_RE`. */
export const HERMES_EVENT_CHANNEL_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function isValidHermesEventChannel(channel: string): boolean {
  return HERMES_EVENT_CHANNEL_PATTERN.test(channel);
}

/** Event envelope version. Bumped on a breaking payload change. */
export const HERMES_EVENT_PROTOCOL_VERSION = 1;

/**
 * Every event Design Studio emits. Section 8's list, verbatim.
 *
 * Kept as a literal union (not a template type) so an unknown event name is a
 * compile error rather than a silent no-op on the Hermes side.
 */
export const HERMES_DESIGN_STUDIO_EVENTS = Object.freeze([
  "design.created",
  "design.updated",
  "design.variant.created",
  "design.preview.ready",
  "design.agent.started",
  "design.agent.progress",
  "design.agent.completed",
  "design.agent.failed",
  "design.export.completed",
  "artifact.created",
  "artifact.updated",
  "artifact.approved",
  "design.review.requested",
  "design.sent_to_code",
] as const);

export type HermesDesignStudioEventName = (typeof HERMES_DESIGN_STUDIO_EVENTS)[number];

export function isHermesDesignStudioEventName(value: unknown): value is HermesDesignStudioEventName {
  return typeof value === "string" && (HERMES_DESIGN_STUDIO_EVENTS as readonly string[]).includes(value);
}

/** Per-event payload shapes. Optional fields are absent, never null. */
export interface HermesDesignStudioEventPayloads {
  "design.created": { designId: string; title: string; templateId?: string };
  "design.updated": { designId: string; changed?: string[] };
  "design.variant.created": { designId: string; variantId: string; parentVariantId?: string };
  "design.preview.ready": { designId: string; variantId?: string; previewUrl: string };
  "design.agent.started": { designId: string; agentSessionId: string; modelId?: string };
  "design.agent.progress": { designId: string; agentSessionId: string; stage: string; progress?: number };
  "design.agent.completed": { designId: string; agentSessionId: string; artifactIds: string[] };
  "design.agent.failed": { designId: string; agentSessionId: string; error: string };
  "design.export.completed": { designId: string; format: string; path?: string; bytes?: number };
  "artifact.created": { artifactId: string; designId: string; kind: string };
  "artifact.updated": { artifactId: string; designId: string; version?: number };
  "artifact.approved": { artifactId: string; designId: string; approvedBy?: string };
  "design.review.requested": { designId: string; reviewer?: string; comment?: string };
  "design.sent_to_code": { designId: string; artifactId: string; target: string };
}

/** The frame written to `/api/pub`. */
export interface HermesEventFrame<T extends HermesDesignStudioEventName = HermesDesignStudioEventName> {
  /** Envelope version, so Hermes can ignore a frame from a newer client. */
  protocol: number;
  /** Always `design-studio`; lets Hermes filter by producer on a shared channel. */
  source: "design-studio";
  event: T;
  /** Monotonic per connection; Hermes uses it to drop out-of-order frames. */
  seq: number;
  /** Unix epoch millis, as captured by Design Studio. */
  at: number;
  payload: HermesDesignStudioEventPayloads[T];
  /** Context fields Hermes needs to route the event; never secrets. */
  context: {
    hermesProfile: string | null;
    workspaceKey: string | null;
    conversationId: string | null;
    agentSessionId: string | null;
    taskId: string | null;
  };
}

/** Minimal WebSocket surface, injected so tests never open a socket. */
export interface HermesEventSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  onOpen(handler: () => void): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: (event: { code: number; reason: string }) => void): void;
  onError(handler: (error: unknown) => void): void;
}

export const HERMES_WS_OPEN = 1;

export interface HermesEventBusDeps {
  /** Build the publish URL for a channel; the bridge supplies the authed URL. */
  buildPublishUrl: (channel: string) => string;
  createSocket: (url: string) => HermesEventSocket;
  now?: () => number;
  /** Called with a frame that could not be sent, so the caller can retry or drop. */
  onUndeliverable?: (frame: HermesEventFrame, reason: string) => void;
}

/**
 * The publish side of the event bus.
 *
 * Frames emitted before the socket opens are buffered, because the interesting
 * events (`design.agent.started`) fire in the first moments of a task — dropping
 * them would leave Hermes Chat showing nothing while work is in flight. The
 * buffer is bounded: if Hermes is unreachable, Design Studio must not grow
 * without limit, and a design task's event stream is not worth a leak.
 */
export const HERMES_EVENT_BUFFER_LIMIT = 256;

export function createHermesEventBus(deps: HermesEventBusDeps) {
  const now = deps.now ?? Date.now;
  let socket: HermesEventSocket | null = null;
  let seq = 0;
  let connected = false;
  const buffer: HermesEventFrame[] = [];

  const flush = (): void => {
    if (!connected || !socket) return;
    while (buffer.length > 0) {
      const frame = buffer.shift();
      if (!frame) break;
      try {
        socket.send(JSON.stringify(frame));
      } catch {
        deps.onUndeliverable?.(frame, "send-failed");
      }
    }
  };

  return {
    /** Open (or re-open) the publish connection. Idempotent. */
    connect(channel: string = HERMES_DESIGN_STUDIO_EVENT_CHANNEL): void {
      if (socket && connected) return;
      if (!isValidHermesEventChannel(channel)) {
        deps.onUndeliverable?.(
          makeFrame("design.created", { designId: "", title: "" }, null, 0, 0),
          "invalid-channel",
        );
        return;
      }

      let next: HermesEventSocket;
      try {
        next = deps.createSocket(deps.buildPublishUrl(channel));
      } catch {
        return;
      }
      socket = next;

      next.onOpen(() => {
        // A replaced socket must not resurrect itself and double-publish.
        if (socket !== next) return;
        connected = true;
        flush();
      });
      next.onClose((event) => {
        if (socket !== next) return;
        connected = false;
        // 4401/4403 are refusals, not dropouts: reconnecting cannot help, so
        // drain the buffer to `onUndeliverable` instead of holding it forever.
        if (event.code === 4401 || event.code === 4403) {
          while (buffer.length > 0) {
            const frame = buffer.shift();
            if (frame) deps.onUndeliverable?.(frame, `refused-${event.code}`);
          }
        }
      });
      next.onError(() => {
        if (socket !== next) return;
        connected = false;
      });
      // Publishers receive nothing; a message means the peer is not the bus.
      next.onMessage(() => undefined);
    },

    emit<T extends HermesDesignStudioEventName>(
      event: T,
      payload: HermesDesignStudioEventPayloads[T],
      context: HermesEventFrame["context"] | null,
    ): HermesEventFrame<T> {
      seq += 1;
      const frame = makeFrame(event, payload, context, seq, now()) as HermesEventFrame<T>;

      if (connected && socket) {
        try {
          socket.send(JSON.stringify(frame));
          return frame;
        } catch {
          deps.onUndeliverable?.(frame, "send-failed");
          return frame;
        }
      }

      buffer.push(frame as HermesEventFrame);
      if (buffer.length > HERMES_EVENT_BUFFER_LIMIT) {
        const dropped = buffer.shift();
        if (dropped) deps.onUndeliverable?.(dropped, "buffer-overflow");
      }
      return frame;
    },

    /** Frames waiting on a connection. Exposed for diagnostics and tests. */
    bufferedCount(): number {
      return buffer.length;
    },

    isConnected(): boolean {
      return connected;
    },

    close(): void {
      const current = socket;
      socket = null;
      connected = false;
      buffer.length = 0;
      try {
        current?.close();
      } catch {
        // Closing a dead socket is not an error worth surfacing.
      }
    },
  };
}

function makeFrame<T extends HermesDesignStudioEventName>(
  event: T,
  payload: HermesDesignStudioEventPayloads[T],
  context: HermesEventFrame["context"] | null,
  seq: number,
  at: number,
): HermesEventFrame<T> {
  return {
    protocol: HERMES_EVENT_PROTOCOL_VERSION,
    source: "design-studio",
    event,
    seq,
    at,
    payload,
    context: context ?? {
      hermesProfile: null,
      workspaceKey: null,
      conversationId: null,
      agentSessionId: null,
      taskId: null,
    },
  };
}

/**
 * Parse a frame arriving on `/api/events`.
 *
 * Hermes Chat uses this to decide whether a frame is one of ours; anything that
 * does not parse is another producer's frame on a shared channel, not an error.
 */
export function parseHermesEventFrame(raw: string): HermesEventFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const value = parsed as Record<string, unknown>;
  if (value.source !== "design-studio") return null;
  if (!isHermesDesignStudioEventName(value.event)) return null;
  if (typeof value.protocol !== "number") return null;
  if (!value.payload || typeof value.payload !== "object") return null;
  if (!value.context || typeof value.context !== "object") return null;

  return parsed as unknown as HermesEventFrame;
}

/**
 * Whether Hermes Chat should render a card for this event.
 *
 * Section 10: results appear in Chat as an inline preview/card with actions.
 * Progress events drive the live indicator but must not each spawn a card — only
 * terminal and result-bearing events do.
 */
export function isRenderableInHermesChat(event: HermesDesignStudioEventName): boolean {
  switch (event) {
    case "design.created":
    case "design.preview.ready":
    case "design.agent.completed":
    case "design.agent.failed":
    case "design.export.completed":
    case "design.review.requested":
    case "design.sent_to_code":
      return true;
    default:
      return false;
  }
}
