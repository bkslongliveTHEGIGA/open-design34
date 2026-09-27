/**
 * Hermes Bridge - Daemon Side
 */

import type { HermesBridgeStatus, HermesSharedContext } from "./types.js";
import { HERMES_CONNECTION_STATES } from "./types.js";
import { detectHermes } from "./detection.js";

export interface HermesDaemonBridge {
  status(): Promise<HermesBridgeStatus>;
  context(): HermesSharedContext;
  setContext(partial: Partial<HermesSharedContext>): void;
  onStatusChange(listener: (status: HermesBridgeStatus) => void): () => void;
}

export function createHermesDaemonBridge(): HermesDaemonBridge {
  let currentContext: HermesSharedContext = {
    updatedAt: new Date().toISOString(),
  };

  const listeners = new Set<(status: HermesBridgeStatus) => void>();
  let lastStatus: HermesBridgeStatus | null = null;

  async function status(): Promise<HermesBridgeStatus> {
    const detection = await detectHermes();
    const isConnected = detection.state === HERMES_CONNECTION_STATES.RUNNING;
    const result: HermesBridgeStatus = {
      connectionState: detection.state,
      isConnected,
      isHermesInstalled: detection.state !== HERMES_CONNECTION_STATES.NOT_INSTALLED,
      isHermesRunning: isConnected,
      context: currentContext,
      lastConnectedAt: isConnected ? new Date().toISOString() : lastStatus?.lastConnectedAt,
      lastError: detection.error,
    };
    lastStatus = result;
    // Notify listeners
    for (const listener of listeners) {
      try {
        listener(result);
      } catch {}
    }
    return result;
  }

  function context(): HermesSharedContext {
    return { ...currentContext };
  }

  function setContext(partial: Partial<HermesSharedContext>) {
    currentContext = {
      ...currentContext,
      ...partial,
      updatedAt: new Date().toISOString(),
    };
  }

  function onStatusChange(listener: (status: HermesBridgeStatus) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    status,
    context,
    setContext,
    onStatusChange,
  };
}

let globalBridge: HermesDaemonBridge | null = null;

export function getHermesDaemonBridge(): HermesDaemonBridge {
  if (!globalBridge) {
    globalBridge = createHermesDaemonBridge();
  }
  return globalBridge;
}
