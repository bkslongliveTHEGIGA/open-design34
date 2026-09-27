/**
 * Hermes Shared Context - Stable shared context object
 * Implements STEP 7: Shared Hermes Context
 */

import type { HermesSharedContext, HermesProject, HermesTheme, HermesModelInfo } from "./types.js";

export interface HermesContextStore {
  get(): HermesSharedContext;
  set(partial: Partial<HermesSharedContext>): HermesSharedContext;
  clear(): void;
  subscribe(listener: (context: HermesSharedContext) => void): () => void;
}

/**
 * Create a stable shared context store
 * Supports fields conceptually equivalent to:
 * hermesProjectId, workspaceId, conversationId, taskId, agentSessionId,
 * modelId, themeId, memoryContextId, artifactIds, permissionContextId
 */
export function createHermesContextStore(initial?: Partial<HermesSharedContext>): HermesContextStore {
  let current: HermesSharedContext = {
    updatedAt: new Date().toISOString(),
    ...initial,
  };

  const listeners = new Set<(context: HermesSharedContext) => void>();

  function notify() {
    for (const listener of listeners) {
      try {
        listener(current);
      } catch {
        // Ignore listener errors
      }
    }
  }

  return {
    get() {
      return { ...current };
    },
    set(partial) {
      current = {
        ...current,
        ...partial,
        updatedAt: new Date().toISOString(),
      };
      notify();
      return { ...current };
    },
    clear() {
      current = {
        updatedAt: new Date().toISOString(),
      };
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Adapt Hermes context from real Hermes codebase structures
 * Never invent incompatible Hermes structures
 */
export function adaptHermesContextFromUpstream(upstream: Record<string, unknown>): HermesSharedContext {
  // Map real Hermes structures to our shared context
  // This adapts based on actual Hermes codebase patterns
  const context: HermesSharedContext = {
    updatedAt: new Date().toISOString(),
  };

  // Common mappings from Hermes state
  if (typeof upstream.projectId === "string") context.hermesProjectId = upstream.projectId;
  if (typeof upstream.project_id === "string") context.hermesProjectId = upstream.project_id;
  if (typeof upstream.workspaceId === "string") context.workspaceId = upstream.workspaceId;
  if (typeof upstream.workspace_id === "string") context.workspaceId = upstream.workspace_id;
  if (typeof upstream.conversationId === "string") context.conversationId = upstream.conversationId;
  if (typeof upstream.conversation_id === "string") context.conversationId = upstream.conversation_id;
  if (typeof upstream.sessionId === "string") context.agentSessionId = upstream.sessionId;
  if (typeof upstream.session_id === "string") context.agentSessionId = upstream.session_id;
  if (typeof upstream.taskId === "string") context.taskId = upstream.taskId;
  if (typeof upstream.task_id === "string") context.taskId = upstream.task_id;
  if (typeof upstream.modelId === "string") context.modelId = upstream.modelId;
  if (typeof upstream.model_id === "string") context.modelId = upstream.model_id;
  if (typeof upstream.model === "string") context.modelId = upstream.model;
  if (typeof upstream.themeId === "string") context.themeId = upstream.themeId;
  if (typeof upstream.theme_id === "string") context.themeId = upstream.theme_id;
  if (typeof upstream.memoryContextId === "string") context.memoryContextId = upstream.memoryContextId;
  if (typeof upstream.permissionContextId === "string") context.permissionContextId = upstream.permissionContextId;
  if (Array.isArray(upstream.artifactIds)) context.artifactIds = upstream.artifactIds as string[];
  if (Array.isArray(upstream.artifact_ids)) context.artifactIds = upstream.artifact_ids as string[];

  // Hermes home
  if (typeof upstream.hermesHome === "string") context.hermesHome = upstream.hermesHome;
  if (typeof upstream.hermes_home === "string") context.hermesHome = upstream.hermes_home;
  if (typeof upstream.profile === "string") context.profile = upstream.profile;

  return context;
}

/**
 * Project context synchronization
 * When Hermes is connected: current Hermes project → Design Studio automatically
 */
export interface HermesProjectSync {
  currentProject: HermesProject | null;
  setCurrentProject(project: HermesProject | null): void;
  onProjectChange(listener: (project: HermesProject | null) => void): () => void;
}

export function createHermesProjectSync(): HermesProjectSync {
  let current: HermesProject | null = null;
  const listeners = new Set<(project: HermesProject | null) => void>();

  return {
    get currentProject() {
      return current;
    },
    setCurrentProject(project) {
      current = project;
      for (const listener of listeners) {
        try {
          listener(current);
        } catch {
          // Ignore
        }
      }
    },
    onProjectChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Model synchronization
 * When Hermes is connected: Hermes-selected model → Design Studio
 */
export interface HermesModelSync {
  currentModel: HermesModelInfo | null;
  setCurrentModel(model: HermesModelInfo | null): void;
  onModelChange(listener: (model: HermesModelInfo | null) => void): () => void;
}

export function createHermesModelSync(): HermesModelSync {
  let current: HermesModelInfo | null = null;
  const listeners = new Set<(model: HermesModelInfo | null) => void>();

  return {
    get currentModel() {
      return current;
    },
    setCurrentModel(model) {
      current = model;
      for (const listener of listeners) {
        try {
          listener(current);
        } catch {
          // Ignore
        }
      }
    },
    onModelChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Theme synchronization
 * When Hermes is connected: Hermes global theme → Design Studio
 */
export interface HermesThemeSync {
  currentTheme: HermesTheme | null;
  setCurrentTheme(theme: HermesTheme | null): void;
  onThemeChange(listener: (theme: HermesTheme | null) => void): () => void;
}

export const HERMES_DESIGN_STUDIO_THEME: HermesTheme = {
  id: "hermes-design-studio-default",
  name: "Hermes Design Studio",
  mode: "light",
  colors: {
    primary: "#0000F2",
    light: "#F5F5F5",
    white: "#FFFFFF",
    accent: "#EDFF45",
    supporting: [
      "#0000D9",
      "#1A1AFF",
      "#000099",
      "#0000CC",
      "#3333FF",
      "#E9ECEF",
      "#D0D0D0",
      "#A0A0A0",
      "#FF4444",
      "#FF8888",
    ],
  },
  typography: {
    display: "Sigurd",
    ui: "Rules",
    technical: "Courier Prime",
  },
};

export function createHermesThemeSync(): HermesThemeSync {
  let current: HermesTheme | null = HERMES_DESIGN_STUDIO_THEME;
  const listeners = new Set<(theme: HermesTheme | null) => void>();

  return {
    get currentTheme() {
      return current;
    },
    setCurrentTheme(theme) {
      current = theme || HERMES_DESIGN_STUDIO_THEME;
      for (const listener of listeners) {
        try {
          listener(current);
        } catch {
          // Ignore
        }
      }
    },
    onThemeChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Memory context - Hermes remains source of truth
 */
export interface HermesMemoryContext {
  memoryContextId?: string;
  canAccess: boolean;
  contextData?: Record<string, unknown>;
}

export function createHermesMemoryContext() {
  let current: HermesMemoryContext = { canAccess: false };
  const listeners = new Set<(ctx: HermesMemoryContext) => void>();

  return {
    get current() {
      return current;
    },
    set(ctx: HermesMemoryContext) {
      current = ctx;
      for (const l of listeners) {
        try {
          l(current);
        } catch {
          // ignore
        }
      }
    },
    subscribe(listener: (ctx: HermesMemoryContext) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
