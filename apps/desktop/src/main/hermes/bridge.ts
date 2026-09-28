/**
 * Hermes Bridge - Dedicated integration layer
 * Implements STEP 6: Hermes Bridge
 * Preferred area: apps/desktop/src/main/hermes/
 */

import { randomUUID } from "node:crypto";
import type {
  HermesConnectionState,
  HermesDetectionResult,
  HermesSharedContext,
  HermesCapabilities,
  HermesBridgeStatus,
  HermesModelInfo,
  HermesTheme,
  HermesProject,
  HermesPermissions,
  HermesArtifact,
} from "./types.js";
import { HERMES_CONNECTION_STATES, HERMES_BRAND } from "./types.js";
import { detectHermes, type HermesDetectionOptions } from "./detection.js";
import { createHermesContextStore } from "./context.js";
import { createHermesEventBus, createHermesEventForwarder } from "./events.js";
import { createActionRegistry } from "./actions.js";
import {
  createHermesProjectSync,
  createHermesModelSync,
  createHermesThemeSync,
  HERMES_DESIGN_STUDIO_THEME,
} from "./context.js";

export interface HermesBridgeOptions {
  autoReconnect?: boolean;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  detectionOptions?: HermesDetectionOptions;
}

export interface HermesBridge {
  // Core operations per STEP 6
  detect(): Promise<HermesDetectionResult>;
  connect(): Promise<HermesBridgeStatus>;
  disconnect(): Promise<void>;
  reconnect(): Promise<HermesBridgeStatus>;
  status(): HermesBridgeStatus;
  capabilities(): HermesCapabilities | null;
  context(): HermesSharedContext;
  model(): HermesModelInfo | null;
  theme(): HermesTheme;
  project(): HermesProject | null;
  artifacts(): HermesArtifact[];
  events(): ReturnType<typeof createHermesEventBus>;
  permissions(): HermesPermissions | null;

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
  onStatusChange(listener: (status: HermesBridgeStatus) => void): () => void;
  onConnectionStateChange(listener: (state: HermesConnectionState) => void): () => void;
}

const DEFAULT_CAPABILITIES: HermesCapabilities = {
  supportsChatInvocation: true,
  supportsArtifactSharing: true,
  supportsProjectSync: true,
  supportsModelSync: true,
  supportsThemeSync: true,
  supportsMemory: true,
  supportsPermissions: true,
  supportsSendToCode: true,
  version: "1.0.0",
};

const DEFAULT_PERMISSIONS: HermesPermissions = {
  canCreate: true,
  canEdit: true,
  canGenerate: true,
  canExport: true,
  canApprove: true,
  canSendToCode: true,
  canAccessMemory: true,
};

export function createHermesBridge(options: HermesBridgeOptions = {}): HermesBridge {
  const autoReconnect = options.autoReconnect ?? true;
  const reconnectIntervalMs = options.reconnectIntervalMs ?? 5000;
  const maxReconnectAttempts = options.maxReconnectAttempts ?? 20;

  let currentState: HermesConnectionState = HERMES_CONNECTION_STATES.NOT_INSTALLED;
  let detectionResult: HermesDetectionResult | null = null;
  let isConnected = false;
  let lastConnectedAt: string | undefined;
  let lastError: string | undefined;
  let reconnectionAttempts = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let stopped = false;

  const contextStore = createHermesContextStore();
  const eventBus = createHermesEventBus();
  const eventForwarder = createHermesEventForwarder();
  const actionRegistry = createActionRegistry();
  const projectSync = createHermesProjectSync();
  const modelSync = createHermesModelSync();
  const themeSync = createHermesThemeSync();

  let capabilities: HermesCapabilities | null = null;
  let artifacts: HermesArtifact[] = [];
  let permissions: HermesPermissions | null = DEFAULT_PERMISSIONS as HermesPermissions;

  const statusListeners = new Set<(status: HermesBridgeStatus) => void>();
  const connectionStateListeners = new Set<(state: HermesConnectionState) => void>();

  function buildStatus(): HermesBridgeStatus {
    return {
      connectionState: currentState,
      isConnected,
      isHermesInstalled: currentState !== HERMES_CONNECTION_STATES.NOT_INSTALLED,
      isHermesRunning:
        currentState === HERMES_CONNECTION_STATES.RUNNING ||
        currentState === HERMES_CONNECTION_STATES.CONNECTED ||
        currentState === HERMES_CONNECTION_STATES.RECONNECTING,
      context: contextStore.get(),
      capabilities: capabilities || undefined,
      model: modelSync.currentModel || undefined,
      theme: themeSync.currentTheme || HERMES_DESIGN_STUDIO_THEME,
      project: projectSync.currentProject || undefined,
      permissions: permissions || undefined,
      lastConnectedAt,
      lastError,
      reconnectionAttempts,
    };
  }

  function notifyStatusChange() {
    const status = buildStatus();
    for (const listener of statusListeners) {
      try {
        listener(status);
      } catch {
        // Ignore
      }
    }
  }

  function notifyConnectionStateChange(state: HermesConnectionState) {
    for (const listener of connectionStateListeners) {
      try {
        listener(state);
      } catch {
        // Ignore
      }
    }
  }

  function setState(newState: HermesConnectionState) {
    if (currentState !== newState) {
      currentState = newState;
      notifyConnectionStateChange(newState);
      notifyStatusChange();
    }
  }

  async function detect(): Promise<HermesDetectionResult> {
    try {
      const result = await detectHermes(options.detectionOptions);
      detectionResult = result;

      // Update state based on detection if not already connected
      if (!isConnected) {
        if (result.state === HERMES_CONNECTION_STATES.RUNNING) {
          setState(HERMES_CONNECTION_STATES.RUNNING);
        } else if (result.state === HERMES_CONNECTION_STATES.NOT_INSTALLED) {
          setState(HERMES_CONNECTION_STATES.NOT_INSTALLED);
        } else {
          setState(HERMES_CONNECTION_STATES.INSTALLED_NOT_RUNNING);
        }
      }

      // Update endpoint for event forwarder
      if (result.endpoint) {
        eventForwarder.setEndpoint(result.endpoint);
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      const result: HermesDetectionResult = {
        state: HERMES_CONNECTION_STATES.NOT_INSTALLED,
        detectedAt: new Date().toISOString(),
        error: lastError,
      };
      detectionResult = result;
      setState(HERMES_CONNECTION_STATES.NOT_INSTALLED);
      return result;
    }
  }

  async function connect(): Promise<HermesBridgeStatus> {
    const detection = await detect();

    if (detection.state === HERMES_CONNECTION_STATES.NOT_INSTALLED) {
      lastError = "Hermes not installed";
      setState(HERMES_CONNECTION_STATES.NOT_INSTALLED);
      return buildStatus();
    }

    if (detection.state === HERMES_CONNECTION_STATES.INSTALLED_NOT_RUNNING) {
      lastError = "Hermes installed but not running";
      setState(HERMES_CONNECTION_STATES.INSTALLED_NOT_RUNNING);
      // Try to start reconnection loop if autoReconnect enabled
      if (autoReconnect && !stopped) {
        scheduleReconnect();
      }
      return buildStatus();
    }

    // Try to establish connection to Hermes endpoint
    if (detection.endpoint) {
      try {
        // Attempt to fetch Hermes context / capabilities
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        // Try to get Hermes capabilities and context
        try {
          const response = await fetch(`${detection.endpoint}/api/hermes/context`, {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          });

          if (response.ok) {
            const data = (await response.json()) as Record<string, unknown>;
            // Adapt upstream context
            if (data.context) {
              const { adaptHermesContextFromUpstream } = await import("./context.js");
              const adapted = adaptHermesContextFromUpstream(data.context as Record<string, unknown>);
              contextStore.set(adapted);
            }
            if (data.capabilities) {
              capabilities = data.capabilities as HermesCapabilities;
            }
            if (data.project) {
              projectSync.setCurrentProject(data.project as HermesProject);
            }
            if (data.model) {
              modelSync.setCurrentModel(data.model as HermesModelInfo);
            }
            if (data.theme) {
              themeSync.setCurrentTheme(data.theme as HermesTheme);
            }
          }
        } catch {
          // Endpoint might not support /api/hermes/context yet - that's ok
          // Use default capabilities
          capabilities = DEFAULT_CAPABILITIES;
        }

        clearTimeout(timeout);

        // Connected!
        isConnected = true;
        lastConnectedAt = new Date().toISOString();
        lastError = undefined;
        reconnectionAttempts = 0;
        setState(HERMES_CONNECTION_STATES.CONNECTED);
        capabilities = capabilities || DEFAULT_CAPABILITIES;

        // Forward any pending events
        eventBus.onAny((event) => {
          void eventForwarder.forward(event);
        });

        return buildStatus();
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        setState(HERMES_CONNECTION_STATES.CONNECTION_LOST);
        if (autoReconnect && !stopped) {
          scheduleReconnect();
        }
        return buildStatus();
      }
    }

    // If no endpoint but installed, mark as installed_not_running
    setState(detection.state);
    return buildStatus();
  }

  async function disconnect(): Promise<void> {
    isConnected = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    eventForwarder.setEndpoint(null);
    setState(
      detectionResult?.state === HERMES_CONNECTION_STATES.NOT_INSTALLED
        ? HERMES_CONNECTION_STATES.NOT_INSTALLED
        : HERMES_CONNECTION_STATES.INSTALLED_NOT_RUNNING
    );
  }

  function scheduleReconnect() {
    if (stopped) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);

    if (reconnectionAttempts >= maxReconnectAttempts) {
      lastError = `Max reconnection attempts (${maxReconnectAttempts}) reached`;
      setState(HERMES_CONNECTION_STATES.CONNECTION_LOST);
      return;
    }

    setState(HERMES_CONNECTION_STATES.RECONNECTING);
    reconnectionAttempts++;

    reconnectTimer = setTimeout(async () => {
      if (stopped) return;
      try {
        const result = await detect();
        if (result.state === HERMES_CONNECTION_STATES.RUNNING) {
          await connect();
        } else {
          scheduleReconnect();
        }
      } catch {
        scheduleReconnect();
      }
    }, reconnectIntervalMs);
  }

  async function reconnect(): Promise<HermesBridgeStatus> {
    reconnectionAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    setState(HERMES_CONNECTION_STATES.RECONNECTING);
    return connect();
  }

  function status(): HermesBridgeStatus {
    return buildStatus();
  }

  function capabilitiesFn(): HermesCapabilities | null {
    return capabilities;
  }

  function context(): HermesSharedContext {
    return contextStore.get();
  }

  function model(): HermesModelInfo | null {
    return modelSync.currentModel;
  }

  function theme(): HermesTheme {
    return themeSync.currentTheme || HERMES_DESIGN_STUDIO_THEME;
  }

  function project(): HermesProject | null {
    return projectSync.currentProject;
  }

  function artifactsFn(): HermesArtifact[] {
    return [...artifacts];
  }

  function eventsFn() {
    return eventBus;
  }

  function permissionsFn(): HermesPermissions | null {
    return permissions;
  }

  async function start(): Promise<void> {
    stopped = false;
    await detect();
    if (detectionResult?.state === HERMES_CONNECTION_STATES.RUNNING) {
      await connect();
    } else if (autoReconnect) {
      // Start watching for Hermes to become available
      scheduleReconnect();
    }
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    await disconnect();
  }

  function onStatusChange(listener: (status: HermesBridgeStatus) => void): () => void {
    statusListeners.add(listener);
    return () => statusListeners.delete(listener);
  }

  function onConnectionStateChange(listener: (state: HermesConnectionState) => void): () => void {
    connectionStateListeners.add(listener);
    return () => connectionStateListeners.delete(listener);
  }

  return {
    detect,
    connect,
    disconnect,
    reconnect,
    status,
    capabilities: capabilitiesFn,
    context,
    model,
    theme,
    project,
    artifacts: artifactsFn,
    events: eventsFn,
    permissions: permissionsFn,
    start,
    stop,
    onStatusChange,
    onConnectionStateChange,
  };
}

/**
 * Global singleton for desktop main process
 */
let globalBridge: HermesBridge | null = null;

export function getHermesBridge(options?: HermesBridgeOptions): HermesBridge {
  if (!globalBridge) {
    globalBridge = createHermesBridge(options);
  }
  return globalBridge;
}

export function resetHermesBridge(): void {
  if (globalBridge) {
    void globalBridge.stop();
    globalBridge = null;
  }
}
