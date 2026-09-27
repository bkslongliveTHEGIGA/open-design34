import { describe, expect, it, vi } from "vitest";

import {
  HERMES_DESIGN_STUDIO_EVENTS,
  HERMES_DESIGN_STUDIO_EVENT_CHANNEL,
  HERMES_EVENT_BUFFER_LIMIT,
  HERMES_EVENT_CHANNEL_PATTERN,
  createHermesEventBus,
  isRenderableInHermesChat,
  isValidHermesEventChannel,
  parseHermesEventFrame,
  type HermesEventSocket,
} from "../../../src/main/hermes/hermes-events.js";
import { buildHermesEventPublishUrl } from "../../../src/main/hermes/hermes-runtime-adapter.js";

/** A socket stub that records sends and lets the test drive open/close. */
function socketStub() {
  const handlers: Record<string, (arg: never) => void> = {};
  const sent: string[] = [];
  const socket: HermesEventSocket = {
    readyState: 1,
    send: (data) => void sent.push(data),
    close: vi.fn(),
    onOpen: (h) => void (handlers.open = h as never),
    onMessage: (h) => void (handlers.message = h as never),
    onClose: (h) => void (handlers.close = h as never),
    onError: (h) => void (handlers.error = h as never),
  };
  return {
    socket,
    sent,
    open: () => (handlers.open as () => void)?.(),
    close: (code = 1000, reason = "") => (handlers.close as (e: { code: number; reason: string }) => void)?.({ code, reason }),
    error: (error: unknown) => (handlers.error as (e: unknown) => void)?.(error),
  };
}

function makeBus(options: { autoOpen?: boolean; now?: () => number } = {}) {
  const stubs: ReturnType<typeof socketStub>[] = [];
  const undeliverable: { frame: unknown; reason: string }[] = [];
  const bus = createHermesEventBus({
    buildPublishUrl: (channel) => `ws://127.0.0.1:9119/api/pub?channel=${channel}`,
    createSocket: () => {
      const stub = socketStub();
      stubs.push(stub);
      if (options.autoOpen !== false) setTimeout(() => stub.open(), 0);
      return stub.socket;
    },
    now: options.now ?? (() => 1_700_000_000_000),
    onUndeliverable: (frame, reason) => undeliverable.push({ frame, reason }),
  });
  return { bus, stubs, undeliverable };
}

describe("event channel", () => {
  it("is a name upstream's _VALID_CHANNEL_RE accepts", () => {
    expect(isValidHermesEventChannel(HERMES_DESIGN_STUDIO_EVENT_CHANNEL)).toBe(true);
    expect(HERMES_EVENT_CHANNEL_PATTERN.test(HERMES_DESIGN_STUDIO_EVENT_CHANNEL)).toBe(true);
  });

  it("rejects names upstream would close with 4400", () => {
    for (const bad of ["", "has space", "has/slash", "a".repeat(129), "emoji-🙂"]) {
      expect(isValidHermesEventChannel(bad)).toBe(false);
    }
  });
});

describe("event catalogue", () => {
  it("includes every event section 8 requires", () => {
    const required = [
      "design.created", "design.updated", "design.variant.created", "design.preview.ready",
      "design.agent.started", "design.agent.progress", "design.agent.completed", "design.agent.failed",
      "design.export.completed", "artifact.created", "artifact.updated", "artifact.approved",
      "design.review.requested", "design.sent_to_code",
    ];
    for (const name of required) expect(HERMES_DESIGN_STUDIO_EVENTS).toContain(name as never);
  });
});

describe("event delivery", () => {
  it("publishes a well-formed frame on /api/pub once connected", async () => {
    const { bus, stubs } = makeBus();
    bus.connect();
    await new Promise((resolve) => setTimeout(resolve, 5));

    bus.emit(
      "design.created",
      { designId: "d1", title: "PartForge landing" },
      { hermesProfile: "default", workspaceKey: "/srv/partforge", conversationId: "20260927_120000_abc123", agentSessionId: null, taskId: null },
    );

    expect(stubs).toHaveLength(1);
    expect(stubs[0]?.sent).toHaveLength(1);
    const frame = JSON.parse(stubs[0]!.sent[0]!) as Record<string, unknown>;
    expect(frame).toMatchObject({ protocol: 1, source: "design-studio", event: "design.created", seq: 1 });
    expect((frame.payload as Record<string, unknown>).designId).toBe("d1");
    expect((frame.context as Record<string, unknown>).conversationId).toBe("20260927_120000_abc123");
    bus.close();
  });

  it("buffers events emitted before the socket opens, then flushes them in order", async () => {
    const { bus, stubs } = makeBus({ autoOpen: false });
    bus.connect();
    bus.emit("design.agent.started", { designId: "d1", agentSessionId: "s1" }, null);
    bus.emit("design.agent.progress", { designId: "d1", agentSessionId: "s1", stage: "layout", progress: 0.4 }, null);
    expect(bus.bufferedCount()).toBe(2);
    expect(stubs[0]?.sent).toEqual([]);

    stubs[0]?.open();
    expect(bus.bufferedCount()).toBe(0);
    const events = stubs[0]!.sent.map((raw) => (JSON.parse(raw) as { event: string }).event);
    expect(events).toEqual(["design.agent.started", "design.agent.progress"]);
    bus.close();
  });

  it("increments seq monotonically so Hermes can drop out-of-order frames", async () => {
    const { bus, stubs } = makeBus();
    bus.connect();
    await new Promise((resolve) => setTimeout(resolve, 5));
    bus.emit("design.updated", { designId: "d1" }, null);
    bus.emit("design.updated", { designId: "d1" }, null);
    const seqs = stubs[0]!.sent.map((raw) => (JSON.parse(raw) as { seq: number }).seq);
    expect(seqs).toEqual([1, 2]);
    bus.close();
  });

  it("bounds the buffer and reports the overflow instead of leaking", () => {
    const { bus, undeliverable } = makeBus({ autoOpen: false });
    bus.connect();
    for (let index = 0; index < HERMES_EVENT_BUFFER_LIMIT + 5; index += 1) {
      bus.emit("design.agent.progress", { designId: "d1", agentSessionId: "s1", stage: `stage-${index}` }, null);
    }
    expect(bus.bufferedCount()).toBe(HERMES_EVENT_BUFFER_LIMIT);
    expect(undeliverable.filter((entry) => entry.reason === "buffer-overflow")).toHaveLength(5);
    bus.close();
  });

  it("drains the buffer as undeliverable when the bus refuses with 4401/4403", async () => {
    const { bus, stubs, undeliverable } = makeBus({ autoOpen: false });
    bus.connect();
    bus.emit("design.created", { designId: "d1", title: "t" }, null);
    stubs[0]?.close(4403, "chat disabled");
    expect(bus.bufferedCount()).toBe(0);
    expect(undeliverable.map((entry) => entry.reason)).toContain("refused-4403");
    bus.close();
  });

  it("stops reporting connected after a socket error", async () => {
    const { bus, stubs } = makeBus();
    bus.connect();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(bus.isConnected()).toBe(true);
    stubs[0]?.error(new Error("boom"));
    expect(bus.isConnected()).toBe(false);
    bus.close();
  });

  it("does not resurrect a replaced socket", async () => {
    const { bus, stubs } = makeBus({ autoOpen: false });
    bus.connect();
    bus.close();
    stubs[0]?.open();
    expect(bus.isConnected()).toBe(false);
  });

  it("refuses to connect on a channel upstream would reject", () => {
    const { bus, stubs, undeliverable } = makeBus();
    bus.connect("has space");
    expect(stubs).toHaveLength(0);
    expect(undeliverable.map((entry) => entry.reason)).toContain("invalid-channel");
  });
});

describe("frame parsing (the Hermes Chat side)", () => {
  const valid = JSON.stringify({
    protocol: 1,
    source: "design-studio",
    event: "design.preview.ready",
    seq: 3,
    at: 1,
    payload: { designId: "d1", previewUrl: "http://127.0.0.1:1/p" },
    context: { hermesProfile: null, workspaceKey: null, conversationId: null, agentSessionId: null, taskId: null },
  });

  it("accepts a well-formed frame", () => {
    expect(parseHermesEventFrame(valid)?.event).toBe("design.preview.ready");
  });

  it("ignores another producer's frame on a shared channel", () => {
    expect(parseHermesEventFrame(JSON.stringify({ ...JSON.parse(valid), source: "tui" }))).toBeNull();
  });

  it("rejects malformed JSON and unknown events", () => {
    expect(parseHermesEventFrame("{")).toBeNull();
    expect(parseHermesEventFrame(JSON.stringify({ ...JSON.parse(valid), event: "design.bogus" }))).toBeNull();
    expect(parseHermesEventFrame(JSON.stringify({ ...JSON.parse(valid), payload: null }))).toBeNull();
  });
});

describe("Hermes Chat result rendering", () => {
  it("renders a card for terminal and result-bearing events", () => {
    for (const event of ["design.created", "design.preview.ready", "design.agent.completed", "design.agent.failed", "design.export.completed", "design.review.requested", "design.sent_to_code"] as const) {
      expect(isRenderableInHermesChat(event)).toBe(true);
    }
  });

  it("does not spawn a card per progress tick", () => {
    expect(isRenderableInHermesChat("design.agent.progress")).toBe(false);
    expect(isRenderableInHermesChat("design.agent.started")).toBe(false);
    expect(isRenderableInHermesChat("design.updated")).toBe(false);
  });
});

describe("publish URL construction", () => {
  it("targets /api/pub with the channel and token in the query string", () => {
    const url = buildHermesEventPublishUrl("http://127.0.0.1:9119", "design-studio", "tok-abc");
    expect(url).toBe("ws://127.0.0.1:9119/api/pub?channel=design-studio&token=tok-abc");
  });

  it("omits the token when there is none", () => {
    expect(buildHermesEventPublishUrl("http://127.0.0.1:9119", "design-studio", null)).toBe(
      "ws://127.0.0.1:9119/api/pub?channel=design-studio",
    );
  });

  it("upgrades https to wss", () => {
    expect(buildHermesEventPublishUrl("https://127.0.0.1:9119", "design-studio", null)?.startsWith("wss://")).toBe(true);
  });

  it("refuses a non-loopback base URL, so a token is never sent off-machine", () => {
    expect(buildHermesEventPublishUrl("http://10.0.0.5:9119", "design-studio", "tok")).toBeNull();
    expect(buildHermesEventPublishUrl("http://hermes.example.com", "design-studio", "tok")).toBeNull();
  });
});
