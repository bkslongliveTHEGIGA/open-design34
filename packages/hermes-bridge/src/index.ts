/**
 * Hermes Bridge - Shared Package
 * Re-exports core types and contracts for use across daemon, desktop, web
 */

export const HERMES_CONNECTION_STATES = Object.freeze({
  NOT_INSTALLED: "HERMES_NOT_INSTALLED",
  INSTALLED_NOT_RUNNING: "HERMES_INSTALLED_NOT_RUNNING",
  RUNNING: "HERMES_RUNNING",
  CONNECTED: "HERMES_CONNECTED",
  CONNECTION_LOST: "HERMES_CONNECTION_LOST",
  RECONNECTING: "HERMES_RECONNECTING",
} as const);

export type HermesConnectionState =
  (typeof HERMES_CONNECTION_STATES)[keyof typeof HERMES_CONNECTION_STATES];

export interface HermesSharedContext {
  hermesProjectId?: string;
  workspaceId?: string;
  conversationId?: string;
  taskId?: string;
  agentSessionId?: string;
  modelId?: string;
  themeId?: string;
  memoryContextId?: string;
  artifactIds?: string[];
  permissionContextId?: string;
  hermesHome?: string;
  profile?: string;
  updatedAt: string;
}

export interface HermesBridgeStatus {
  connectionState: HermesConnectionState;
  isConnected: boolean;
  isHermesInstalled: boolean;
  isHermesRunning: boolean;
  context?: HermesSharedContext;
  lastConnectedAt?: string;
  lastError?: string;
}

export const HERMES_BRAND = Object.freeze({
  appName: "Hermes Design Studio",
  productName: "Hermes Design Studio",
  primaryColor: "#0000F2",
  lightColor: "#F5F5F5",
  whiteColor: "#FFFFFF",
  accentColor: "#EDFF45",
  supportingPalette: [
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
  typography: {
    display: "Sigurd",
    ui: "Rules",
    technical: "Courier Prime",
  },
} as const);

export type DesignStudioActionType =
  | "designStudio.open"
  | "designStudio.close"
  | "designStudio.focus"
  | "designStudio.create"
  | "designStudio.edit"
  | "designStudio.generate"
  | "designStudio.generateVariant"
  | "designStudio.preview"
  | "designStudio.compare"
  | "designStudio.export"
  | "designStudio.approve"
  | "designStudio.pause"
  | "designStudio.resume"
  | "designStudio.cancel"
  | "designStudio.getStatus"
  | "designStudio.getArtifacts"
  | "designStudio.sendToCode";

export type DesignStudioEventType =
  | "design.created"
  | "design.updated"
  | "design.variant.created"
  | "design.preview.ready"
  | "design.agent.started"
  | "design.agent.progress"
  | "design.agent.completed"
  | "design.agent.failed"
  | "design.export.completed"
  | "artifact.created"
  | "artifact.updated"
  | "artifact.approved"
  | "design.review.requested"
  | "design.sent_to_code";

export const HERMES_DEEPLINKS = Object.freeze({
  scheme: "hermes",
  host: "design-studio",
  paths: {
    root: "hermes://design-studio",
    project: (id: string) => `hermes://design-studio/project/${id}`,
    design: (id: string) => `hermes://design-studio/design/${id}`,
    artifact: (id: string) => `hermes://design-studio/artifact/${id}`,
    session: (id: string) => `hermes://design-studio/session/${id}`,
  },
} as const);
