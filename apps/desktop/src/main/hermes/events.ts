/**
 * Hermes Design Studio Events - Outbound event stream
 * Implements STEP 9: Design Studio Events
 */

import { randomUUID } from "node:crypto";
import type { DesignStudioEvent, DesignStudioEventType, HermesSharedContext } from "./types.js";

export type EventListener<T = unknown> = (event: DesignStudioEvent<T>) => void;

export interface HermesEventBus {
  emit<T>(type: DesignStudioEventType, payload?: T, options?: {
    designId?: string;
    artifactId?: string;
    projectId?: string;
    context?: HermesSharedContext;
  }): DesignStudioEvent<T>;
  on<T>(type: DesignStudioEventType, listener: EventListener<T>): () => void;
  onAny(listener: EventListener): () => void;
  off(type: DesignStudioEventType, listener: EventListener): void;
  getRecent(count?: number): DesignStudioEvent[];
  clear(): void;
}

export function createHermesEventBus(): HermesEventBus {
  const listeners = new Map<DesignStudioEventType, Set<EventListener>>();
  const anyListeners = new Set<EventListener>();
  const recentEvents: DesignStudioEvent[] = [];
  const MAX_RECENT = 100;

  function emit<T>(
    type: DesignStudioEventType,
    payload?: T,
    options: {
      designId?: string;
      artifactId?: string;
      projectId?: string;
      context?: HermesSharedContext;
    } = {}
  ): DesignStudioEvent<T> {
    const event: DesignStudioEvent<T> = {
      type,
      id: randomUUID(),
      designId: options.designId,
      artifactId: options.artifactId,
      projectId: options.projectId,
      payload,
      context: options.context,
      timestamp: new Date().toISOString(),
    };

    // Store recent
    recentEvents.push(event);
    if (recentEvents.length > MAX_RECENT) {
      recentEvents.shift();
    }

    // Notify type-specific listeners
    const typeListeners = listeners.get(type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        try {
          listener(event);
        } catch {
          // Ignore listener errors
        }
      }
    }

    // Notify any listeners
    for (const listener of anyListeners) {
      try {
        listener(event);
      } catch {
        // Ignore
      }
    }

    return event;
  }

  return {
    emit,
    on<T>(type: DesignStudioEventType, listener: EventListener<T>) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)!.add(listener as EventListener);
      return () => {
        listeners.get(type)?.delete(listener as EventListener);
      };
    },
    onAny(listener) {
      anyListeners.add(listener);
      return () => anyListeners.delete(listener);
    },
    off(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    getRecent(count = 20) {
      return recentEvents.slice(-count);
    },
    clear() {
      recentEvents.length = 0;
    },
  };
}

// Structured event helpers - machine-readable per requirements
export const DesignStudioEvents = {
  created: (designId: string, projectId?: string, context?: HermesSharedContext) => ({
    type: "design.created" as const,
    designId,
    projectId,
    context,
  }),
  updated: (designId: string, projectId?: string, context?: HermesSharedContext) => ({
    type: "design.updated" as const,
    designId,
    projectId,
    context,
  }),
  variantCreated: (designId: string, variantId: string, projectId?: string) => ({
    type: "design.variant.created" as const,
    designId,
    artifactId: variantId,
    projectId,
  }),
  previewReady: (designId: string, previewUrl: string, projectId?: string) => ({
    type: "design.preview.ready" as const,
    designId,
    projectId,
    payload: { previewUrl },
  }),
  agentStarted: (designId: string, agentSessionId: string) => ({
    type: "design.agent.started" as const,
    designId,
    payload: { agentSessionId },
  }),
  agentProgress: (designId: string, progress: number, message?: string) => ({
    type: "design.agent.progress" as const,
    designId,
    payload: { progress, message },
  }),
  agentCompleted: (designId: string, artifactIds?: string[]) => ({
    type: "design.agent.completed" as const,
    designId,
    payload: { artifactIds },
  }),
  agentFailed: (designId: string, error: string) => ({
    type: "design.agent.failed" as const,
    designId,
    payload: { error },
  }),
  exportCompleted: (designId: string, exportPath: string, format: string) => ({
    type: "design.export.completed" as const,
    designId,
    payload: { exportPath, format },
  }),
  artifactCreated: (artifactId: string, projectId: string, type: string) => ({
    type: "artifact.created" as const,
    artifactId,
    projectId,
    payload: { type },
  }),
  artifactUpdated: (artifactId: string, projectId: string) => ({
    type: "artifact.updated" as const,
    artifactId,
    projectId,
  }),
  artifactApproved: (artifactId: string, projectId: string) => ({
    type: "artifact.approved" as const,
    artifactId,
    projectId,
  }),
  reviewRequested: (designId: string, projectId?: string) => ({
    type: "design.review.requested" as const,
    designId,
    projectId,
  }),
  sentToCode: (designId: string, artifactId: string, projectId: string) => ({
    type: "design.sent_to_code" as const,
    designId,
    artifactId,
    projectId,
  }),
};

/**
 * Event bridge to Hermes - forwards Design Studio events to Hermes
 */
export interface HermesEventForwarder {
  forward(event: DesignStudioEvent): Promise<void>;
  setEndpoint(endpoint: string | null): void;
}

export function createHermesEventForwarder(): HermesEventForwarder {
  let endpoint: string | null = null;

  return {
    setEndpoint(ep) {
      endpoint = ep;
    },
    async forward(event) {
      if (!endpoint) return;

      try {
        await fetch(`${endpoint}/api/design-studio/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event),
        });
      } catch {
        // Fail silently - events are best effort when Hermes is unavailable
        // Will be retried on reconnection
      }
    },
  };
}
