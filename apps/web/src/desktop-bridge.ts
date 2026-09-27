/**
 * The surface `apps/desktop/src/main/preload.cts` exposes via `contextBridge`.
 *
 * Declared in exactly one place on purpose. The preload deliberately publishes
 * only two window globals (asserted by
 * `apps/desktop/tests/main/preload-host-boundary.test.ts`), and `openDesignDesktop`
 * is the desktop-utility one — so anything the renderer needs from main hangs
 * off it. Two files each declaring their own `Window.openDesignDesktop` is a
 * TS2717 collision waiting to happen, and worse, the two declarations drift.
 *
 * Mirrored by hand rather than imported from the desktop package, so the web
 * bundle never pulls Electron types into a browser build.
 */

export type DesktopExportResult =
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; message: string };

/**
 * The Hermes Design Studio bridge snapshot, as the renderer is allowed to see
 * it. This is the already-redacted snapshot the main process publishes — no
 * token, credential, cookie or `model_config` crosses the boundary.
 *
 * Only the fields the web UI actually renders are declared; the real snapshot
 * carries more (trace, identify, eventsConnected, generation, …).
 */
export interface HermesBridgeSnapshotView {
  state:
    | 'disconnected'
    | 'discovering'
    | 'not-installed'
    | 'installed-idle'
    | 'connecting'
    | 'connected'
    | 'reconnecting';
  reason: string | null;
  installed: boolean;
  baseUrl: string | null;
  model: { provider?: string; model?: string } | null;
  context: { hermesProjectId?: string | null; workspaceId?: string | null } | null;
}

export interface HermesBridgeApi {
  /** The redacted bridge snapshot, including the connection state. */
  getState(): Promise<HermesBridgeSnapshotView | null>;
  /** Ask the bridge to re-run discovery now. */
  reconnect(): Promise<HermesBridgeSnapshotView | null>;
  /** Report this renderer's current task state to the bridge. */
  setTaskState(state: string): Promise<unknown>;
  onStateChanged(handler: (payload: unknown) => void): () => void;
  onActionRequested(handler: (payload: unknown) => void): () => void;
  onDeepLink(handler: (url: string) => void): () => void;
}

export interface OpenDesignDesktopApi {
  exportDiagnostics(): Promise<DesktopExportResult>;
  /**
   * Optional because a desktop build predating the bridge will not have it.
   * Consumers must treat its absence as "no bridge", not as an error.
   */
  hermes?: HermesBridgeApi;
}

declare global {
  interface Window {
    openDesignDesktop?: OpenDesignDesktopApi;
  }
}

/** Narrow an IPC payload to a snapshot without trusting its shape. */
export function isHermesBridgeSnapshot(value: unknown): value is HermesBridgeSnapshotView {
  return typeof value === 'object' && value != null && 'state' in value;
}
