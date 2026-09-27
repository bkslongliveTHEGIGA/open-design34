// Hermes ⇄ Design Studio deep links — pure core.
//
// Follows the convention this repository already set for `opendesign://`
// (`invite-deeplink-core.ts`): a pure, electron-free core that parses and plans,
// and a thin electron-coupled wrapper that claims the scheme with the OS.
//
// **Which scheme each app owns.** Upstream registers `hermes://` at runtime with
// `app.setAsDefaultProtocolClient(HERMES_PROTOCOL)` and *re-asserts it on every
// start* (`apps/desktop/electron/main.ts::registerDeepLinkProtocol`). Two
// applications cannot both own one scheme, and whichever started last would win
// — so Design Studio must never claim `hermes://`. It claims
// `hermes-design-studio://` instead and *also* understands the
// `hermes://design-studio/...` form, because that is the form Hermes emits and
// the form users and docs will use.
//
// Parsing therefore accepts both schemes, and `planProtocolClientRegistration`
// only ever registers the Design Studio scheme. A `hermes://design-studio/...`
// URL arriving in argv means Hermes relaunched us (or the OS routed it after a
// user hand-off); either way the payload is the same.

/** The scheme Design Studio claims with the OS. */
export const HERMES_DESIGN_STUDIO_SCHEME = "hermes-design-studio";

/** The scheme Hermes owns; accepted on input, never registered here. */
export const HERMES_SCHEME = "hermes";

/** Upstream's dev scheme, accepted so a dev Hermes can drive a dev Studio. */
export const HERMES_DEV_SCHEME = "hermes-dev";

/** The `host` segment that marks a Hermes link as ours. */
export const HERMES_DESIGN_STUDIO_LINK_HOST = "design-studio";

/** Schemes this parser accepts. */
export const HERMES_DEEPLINK_SCHEMES = Object.freeze([
  HERMES_DESIGN_STUDIO_SCHEME,
  HERMES_SCHEME,
  HERMES_DEV_SCHEME,
] as const);

/**
 * What a deep link is asking for.
 *
 * Section 13's list. `session` is the Hermes conversation to open under, which
 * is how "use the current Hermes project" arrives as a link.
 */
export type HermesDeepLinkTarget =
  | { kind: "root" }
  | { kind: "project"; id: string }
  | { kind: "design"; id: string }
  | { kind: "artifact"; id: string }
  | { kind: "session"; id: string }
  | { kind: "action"; action: string; args: Record<string, string> };

export interface HermesDeepLink {
  /** Which scheme it arrived on. */
  scheme: string;
  target: HermesDeepLinkTarget;
  /** Query parameters, verbatim. */
  params: Record<string, string>;
  /** The original URL, for diagnostics only — never logged with a token in it. */
  raw: string;
}

const ID_SEGMENTS = Object.freeze({
  project: "project",
  design: "design",
  artifact: "artifact",
  session: "session",
} as const);

/** Reject ids that could smuggle a path or a URL into a later consumer. */
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isSafeHermesDeepLinkId(value: string): boolean {
  return SAFE_ID_PATTERN.test(value);
}

/**
 * Parse a Hermes deep link into a typed target.
 *
 * Returns null for anything malformed rather than a best-effort target: a deep
 * link is an entry point from outside the app, and silently opening the wrong
 * document is worse than opening nothing.
 *
 * Accepted shapes:
 *   `hermes-design-studio://`                      → root
 *   `hermes-design-studio://design/{id}`           → design
 *   `hermes://design-studio/design/{id}`           → design
 *   `hermes://design-studio/project/{id}`          → project
 *   `hermes://design-studio/artifact/{id}`         → artifact
 *   `hermes://design-studio/session/{id}`          → session
 *   `hermes-design-studio://action/{name}?k=v`     → action
 */
export function parseHermesDeepLink(url: string | null | undefined): HermesDeepLink | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (!(HERMES_DEEPLINK_SCHEMES as readonly string[]).includes(scheme)) return null;

  const params: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  const base: Omit<HermesDeepLink, "target"> = { scheme, params, raw: url };

  // Split the path into segments, dropping empties.
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0).map(decodeSegment);

  if (scheme === HERMES_SCHEME || scheme === HERMES_DEV_SCHEME) {
    // Hermes' own parser treats `hostname` as the kind, so ours arrives as the
    // host and the real path starts after it.
    const host = parsed.hostname.toLowerCase();
    if (host !== HERMES_DESIGN_STUDIO_LINK_HOST) return null;
    return targetFromSegments(segments, params, base);
  }

  // `hermes-design-studio://design/x` → hostname is `design`, so rejoin it.
  const host = parsed.hostname.toLowerCase();
  const joined = host.length > 0 ? [host, ...segments] : segments;
  return targetFromSegments(joined, params, base);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function targetFromSegments(
  segments: string[],
  params: Record<string, string>,
  base: Omit<HermesDeepLink, "target">,
): HermesDeepLink | null {
  if (segments.length === 0) return { ...base, target: { kind: "root" } };

  const [head, id] = segments as [string, string | undefined];

  if (head === "action") {
    const action = id ?? "";
    if (action.length === 0) return null;
    return { ...base, target: { kind: "action", action, args: { ...params } } };
  }

  const known = Object.entries(ID_SEGMENTS).find(([, segment]) => segment === head);
  if (!known) return null;

  const kind = known[0] as "project" | "design" | "artifact" | "session";
  if (!id || !isSafeHermesDeepLinkId(id)) return null;

  return { ...base, target: { kind, id } };
}

/** How this process may claim a scheme with the OS, if at all. */
export type HermesProtocolClientRegistration =
  | { register: false; reason: string }
  | { register: true; scheme: string; clientPath: string | null };

/**
 * Plan OS scheme registration.
 *
 * Two rules, both inherited from this repository's existing
 * `planProtocolClientRegistration`:
 *   1. Only a packaged install claims a scheme. A dev run is hosted by the
 *      shared `electron` binary, so claiming there points the OS at a
 *      throwaway executable for every channel at once.
 *   2. On Windows, register the stable installed launcher rather than the
 *      versioned payload executable, which an update can delete.
 *
 * And the third, specific to this module: only ever `hermes-design-studio://`.
 * Registering `hermes://` here would fight the Hermes desktop for a scheme that
 * Hermes re-claims on every launch.
 */
export function planHermesProtocolClientRegistration(input: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  protocolClientPath?: string | null;
}): HermesProtocolClientRegistration {
  if (!input.isPackaged) {
    return { register: false, reason: "not-packaged" };
  }
  const clientPath = input.platform === "win32" ? input.protocolClientPath ?? null : null;
  return { register: true, scheme: HERMES_DESIGN_STUDIO_SCHEME, clientPath };
}

/** Extract a Hermes deep link from a process argv list, if present. */
export function findHermesDeepLinkArg(argv: readonly string[]): string | null {
  return (
    argv.find((arg) => HERMES_DEEPLINK_SCHEMES.some((scheme) => arg.startsWith(`${scheme}://`))) ?? null
  );
}

/**
 * Build the URL Design Studio hands *back* to Hermes.
 *
 * Always the `hermes://` form: Hermes owns that scheme and its own deep-link
 * router, so a link that opens Hermes must use Hermes' scheme. Producing a
 * `hermes-design-studio://` URL here would open Design Studio instead of Hermes,
 * which is the opposite of what a "open in Hermes" affordance means.
 */
export function buildHermesDeepLink(
  target: HermesDeepLinkTarget,
  options: { scheme?: string } = {},
): string {
  const scheme = options.scheme ?? HERMES_SCHEME;
  const segments: string[] = [];

  switch (target.kind) {
    case "root":
      break;
    case "project":
    case "design":
    case "artifact":
    case "session":
      segments.push(ID_SEGMENTS[target.kind], encodeURIComponent(target.id));
      break;
    case "action":
      segments.push("action", encodeURIComponent(target.action));
      break;
  }

  const query =
    target.kind === "action" && Object.keys(target.args).length > 0
      ? `?${new URLSearchParams(target.args).toString()}`
      : "";

  return `${scheme}://${HERMES_DESIGN_STUDIO_LINK_HOST}/${segments.join("/")}${query}`;
}

/**
 * Queue deep links that arrive before the runtime can handle them.
 *
 * Same reason as the invite dispatcher: a cold start through a deep link
 * delivers the URL before the app has finished wiring its bridges, and dropping
 * it would strand the user on a link that appeared to do nothing.
 */
export function createHermesDeepLinkDispatcher(handle: (link: HermesDeepLink) => void | Promise<void>) {
  let ready = false;
  const pending: HermesDeepLink[] = [];

  const dispatch = (url: string | null): void => {
    if (!url) return;
    const link = parseHermesDeepLink(url);
    if (!link) return;
    if (!ready) {
      pending.push(link);
      return;
    }
    void handle(link);
  };

  return {
    dispatch,
    markReady(): void {
      ready = true;
      const queued = pending.splice(0);
      for (const link of queued) void handle(link);
    },
    pendingCount(): number {
      return pending.length;
    },
  };
}
