/**
 * Hermes Deep Links - Secure deep link handling
 * Implements STEP 18: Deep Links
 * Examples: hermes://design-studio, hermes://design-studio/project/{id}, etc.
 */

import type { HermesDeepLink, HermesDeepLinkType } from "./types.js";

export const HERMES_DEEPLINK_SCHEME = "hermes";
export const HERMES_DEEPLINK_HOST = "design-studio";

export const HERMES_DEEPLINK_PATHS = Object.freeze({
  ROOT: "/",
  PROJECT: "/project",
  DESIGN: "/design",
  ARTIFACT: "/artifact",
  SESSION: "/session",
} as const);

/**
 * Parse hermes://design-studio/* URLs
 */
export function parseHermesDeepLink(url: string): HermesDeepLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== `${HERMES_DEEPLINK_SCHEME}:`) return null;
  if (parsed.host !== HERMES_DEEPLINK_HOST) return null;

  const pathParts = parsed.pathname.split("/").filter(Boolean);
  let type: HermesDeepLinkType = "design-studio";
  let id: string | undefined;

  if (pathParts.length === 0 || (pathParts.length === 1 && pathParts[0] === "")) {
    type = "design-studio";
  } else if (pathParts[0] === "project" && pathParts[1]) {
    type = "project";
    id = pathParts[1];
  } else if (pathParts[0] === "design" && pathParts[1]) {
    type = "design";
    id = pathParts[1];
  } else if (pathParts[0] === "artifact" && pathParts[1]) {
    type = "artifact";
    id = pathParts[1];
  } else if (pathParts[0] === "session" && pathParts[1]) {
    type = "session";
    id = pathParts[1];
  } else if (pathParts[0] === "project" && !pathParts[1]) {
    type = "project";
  } else if (pathParts[0] === "design" && !pathParts[1]) {
    type = "design";
  }

  return {
    type,
    id,
    path: parsed.pathname,
    originalUrl: url,
    params: Object.fromEntries(parsed.searchParams.entries()),
  };
}

/**
 * Validate deep link ID - prevent injection
 */
export function isValidDeepLinkId(id: string): boolean {
  // Allow alphanumeric, dash, underscore, dot, max 128 chars
  return /^[A-Za-z0-9._-]{1,128}$/.test(id);
}

/**
 * Create deep link URLs
 */
export const HermesDeepLinkFactory = {
  designStudio: (params?: Record<string, string>) => {
    const url = new URL(`${HERMES_DEEPLINK_SCHEME}://${HERMES_DEEPLINK_HOST}/`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    return url.toString();
  },
  project: (projectId: string, params?: Record<string, string>) => {
    if (!isValidDeepLinkId(projectId)) throw new Error("Invalid project ID");
    const url = new URL(`${HERMES_DEEPLINK_SCHEME}://${HERMES_DEEPLINK_HOST}/project/${projectId}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    return url.toString();
  },
  design: (designId: string, params?: Record<string, string>) => {
    if (!isValidDeepLinkId(designId)) throw new Error("Invalid design ID");
    const url = new URL(`${HERMES_DEEPLINK_SCHEME}://${HERMES_DEEPLINK_HOST}/design/${designId}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    return url.toString();
  },
  artifact: (artifactId: string, params?: Record<string, string>) => {
    if (!isValidDeepLinkId(artifactId)) throw new Error("Invalid artifact ID");
    const url = new URL(`${HERMES_DEEPLINK_SCHEME}://${HERMES_DEEPLINK_HOST}/artifact/${artifactId}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    return url.toString();
  },
  session: (sessionId: string, params?: Record<string, string>) => {
    if (!isValidDeepLinkId(sessionId)) throw new Error("Invalid session ID");
    const url = new URL(`${HERMES_DEEPLINK_SCHEME}://${HERMES_DEEPLINK_HOST}/session/${sessionId}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    return url.toString();
  },
};

/**
 * Check if URL is a Hermes deep link
 */
export function isHermesDeepLink(url: string): boolean {
  return parseHermesDeepLink(url) !== null;
}

/**
 * Extract deep link from argv (similar to invite deeplink)
 */
export function findHermesDeepLinkArg(argv: readonly string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${HERMES_DEEPLINK_SCHEME}://${HERMES_DEEPLINK_HOST}`)) ?? null;
}

/**
 * Handle Hermes deep link - routes to appropriate Design Studio view
 */
export interface HermesDeepLinkHandlerDeps {
  resolveDaemonBaseUrl: () => Promise<string>;
  focus?: () => void;
  onNavigate?: (link: HermesDeepLink) => void;
  onCompleted?: (outcome: { ok: boolean; reason?: string }) => void;
  fetch?: typeof fetch;
}

export async function handleHermesDeepLink(
  url: string,
  deps: HermesDeepLinkHandlerDeps
): Promise<{ ok: boolean; reason?: string }> {
  const link = parseHermesDeepLink(url);
  if (!link) {
    deps.onCompleted?.({ ok: false, reason: "not_a_hermes_deeplink" });
    return { ok: false, reason: "not_a_hermes_deeplink" };
  }

  // Validate ID if present
  if (link.id && !isValidDeepLinkId(link.id)) {
    deps.onCompleted?.({ ok: false, reason: "invalid_id" });
    return { ok: false, reason: "invalid_id" };
  }

  try {
    // Notify navigation
    deps.onNavigate?.(link);
    deps.focus?.();
    deps.onCompleted?.({ ok: true });
    return { ok: true };
  } catch {
    deps.onCompleted?.({ ok: false, reason: "handling_failed" });
    return { ok: false, reason: "handling_failed" };
  }
}
