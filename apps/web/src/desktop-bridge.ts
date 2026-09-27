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

/** A single entry of the capability manifest. */
export interface HermesCapability {
  name: string;
  /** Fully qualified wire name, e.g. `designStudio.generate`. */
  action: string;
  risk: 'read' | 'write' | 'agent' | 'filesystem' | 'external';
  available: boolean;
}

/** Result of invoking an action. */
export type HermesActionResult =
  | { ok: true; action: string; value?: unknown; forwarded?: 'renderer' }
  | { ok: false; action: string | null; error: string; code: string };

/** Main → renderer: an action whose effect lives in the UI. */
export interface HermesActionRequest {
  action: string;
  args: Record<string, unknown> | null;
  origin: string;
}

/** A floating control, exactly as `hermes-controls.ts` in main defines it. */
export interface HermesFloatingControlView {
  id: string;
  label: string;
  /** Bare action name, e.g. `generate`. */
  action: string;
  slot: 'composer-bar' | 'floating-card';
  risk: 'read' | 'write' | 'agent' | 'filesystem' | 'external';
  hint: string;
  order: number;
  /** Task states in which this control should be offered. */
  when: string[];
  args?: Record<string, unknown>;
}

/** What `capabilities()` returns: permissions plus the real control layout. */
export interface HermesCapabilities {
  actions: HermesCapability[];
  controls: HermesFloatingControlView[];
}

export interface HermesBridgeApi {
  /** The redacted bridge snapshot, including the connection state. */
  getState(): Promise<HermesBridgeSnapshotView | null>;
  /** Ask the bridge to re-run discovery now. */
  reconnect(): Promise<HermesBridgeSnapshotView | null>;
  /** Report this renderer's current task state to the bridge. */
  setTaskState(state: string): Promise<unknown>;
  /**
   * Invoke a `designStudio.*` action. Routed through the same registry Hermes
   * uses, so the permission gate and audit trail apply either way.
   */
  invokeAction(action: string, args?: Record<string, unknown>): Promise<HermesActionResult>;
  /** Permitted actions plus the control layout, from main's single source. */
  capabilities(): Promise<HermesCapabilities>;
  onStateChanged(handler: (payload: unknown) => void): () => void;
  onActionRequested(handler: (request: HermesActionRequest) => void): () => void;
  onDeepLink(handler: (url: string) => void): () => void;
}

/** Narrow an `onActionRequested` payload without trusting its shape. */
export function isHermesActionRequest(value: unknown): value is HermesActionRequest {
  return (
    typeof value === 'object' &&
    value != null &&
    typeof (value as { action?: unknown }).action === 'string'
  );
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
