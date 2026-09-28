/**
 * Hermes Provider - Web Side
 * Provides Hermes connection state to React components
 * Implements two modes: HERMES_CONNECTED and STANDALONE
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import type { HermesBridgeStatus, HermesConnectionState, HermesSharedContext } from "./types";
import { HERMES_CONNECTION_STATES } from "./types";

export interface HermesContextValue {
  status: HermesBridgeStatus;
  isConnected: boolean;
  isStandalone: boolean;
  isHermesInstalled: boolean;
  connectionState: HermesConnectionState;
  context: HermesSharedContext | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  reconnect: () => Promise<void>;
  refresh: () => Promise<void>;
  setContext: (partial: Partial<HermesSharedContext>) => void;
}

const defaultStatus: HermesBridgeStatus = {
  connectionState: HERMES_CONNECTION_STATES.NOT_INSTALLED,
  isConnected: false,
  isHermesInstalled: false,
  isHermesRunning: false,
};

const HermesContext = createContext<HermesContextValue>({
  status: defaultStatus,
  isConnected: false,
  isStandalone: true,
  isHermesInstalled: false,
  connectionState: HERMES_CONNECTION_STATES.NOT_INSTALLED,
  context: null,
  connect: async () => {},
  disconnect: async () => {},
  reconnect: async () => {},
  refresh: async () => {},
  setContext: () => {},
});

export function useHermes() {
  return useContext(HermesContext);
}

export function useHermesStatus() {
  const { status } = useHermes();
  return status;
}

export function useHermesConnectionState() {
  const { connectionState, isConnected, isStandalone } = useHermes();
  return { connectionState, isConnected, isStandalone };
}

export function HermesProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<HermesBridgeStatus>(defaultStatus);
  const [context, setContextState] = useState<HermesSharedContext | null>(null);
  const intervalRef = useRef<number | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/hermes/status");
      if (response.ok) {
        const data = (await response.json()) as HermesBridgeStatus;
        setStatus(data);
        if (data.context) {
          setContextState(data.context);
        }
        return data;
      }
    } catch {
      // Hermes unavailable - standalone mode
      setStatus((prev) => ({
        ...prev,
        connectionState:
          prev.isHermesInstalled
            ? HERMES_CONNECTION_STATES.CONNECTION_LOST
            : HERMES_CONNECTION_STATES.NOT_INSTALLED,
        isConnected: false,
        isHermesRunning: false,
      }));
    }
    return null;
  }, []);

  const connect = useCallback(async () => {
    try {
      const response = await fetch("/api/hermes/connect", { method: "POST" });
      if (response.ok) {
        const data = (await response.json()) as HermesBridgeStatus;
        setStatus(data);
        if (data.context) setContextState(data.context);
      }
    } catch {
      // Ignore
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await fetch("/api/hermes/disconnect", { method: "POST" });
    } catch {}
    setStatus((prev) => ({
      ...prev,
      connectionState: HERMES_CONNECTION_STATES.INSTALLED_NOT_RUNNING,
      isConnected: false,
    }));
  }, []);

  const reconnect = useCallback(async () => {
    setStatus((prev) => ({
      ...prev,
      connectionState: HERMES_CONNECTION_STATES.RECONNECTING,
    }));
    try {
      const response = await fetch("/api/hermes/reconnect", { method: "POST" });
      if (response.ok) {
        const data = (await response.json()) as HermesBridgeStatus;
        setStatus(data);
        if (data.context) setContextState(data.context);
      } else {
        await fetchStatus();
      }
    } catch {
      await fetchStatus();
    }
  }, [fetchStatus]);

  const refresh = useCallback(async () => {
    await fetchStatus();
  }, [fetchStatus]);

  const setContext = useCallback((partial: Partial<HermesSharedContext>) => {
    setContextState((prev) => ({
      ...(prev || { updatedAt: new Date().toISOString() }),
      ...partial,
      updatedAt: new Date().toISOString(),
    }));
    // Also sync to backend
    void fetch("/api/hermes/context", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    // Initial fetch
    void fetchStatus();

    // Poll every 10 seconds for Hermes status
    intervalRef.current = window.setInterval(() => {
      void fetchStatus();
    }, 10000);

    // Try SSE for real-time updates if available
    try {
      const es = new EventSource("/api/hermes/events");
      sseRef.current = es;
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as HermesBridgeStatus;
          setStatus(data);
          if (data.context) setContextState(data.context);
        } catch {}
      };
      es.onerror = () => {
        // SSE failed, fallback to polling
        es.close();
      };
    } catch {
      // SSE not available
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (sseRef.current) sseRef.current.close();
    };
  }, [fetchStatus]);

  const value: HermesContextValue = {
    status,
    isConnected: status.isConnected,
    isStandalone: !status.isConnected,
    isHermesInstalled: status.isHermesInstalled,
    connectionState: status.connectionState,
    context,
    connect,
    disconnect,
    reconnect,
    refresh,
    setContext,
  };

  return <HermesContext.Provider value={value}>{children}</HermesContext.Provider>;
}
