/**
 * Hermes Integration - Daemon Side Types
 * Mirrors desktop bridge types for server-side use
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
  hermesProjectId?: string | undefined;
  workspaceId?: string | undefined;
  conversationId?: string | undefined;
  taskId?: string | undefined;
  agentSessionId?: string | undefined;
  modelId?: string | undefined;
  themeId?: string | undefined;
  memoryContextId?: string | undefined;
  artifactIds?: string[];
  permissionContextId?: string | undefined;
  hermesHome?: string | undefined;
  profile?: string | undefined;
  updatedAt: string;
}

export interface HermesBridgeStatus {
  connectionState: HermesConnectionState;
  isConnected: boolean;
  isHermesInstalled: boolean;
  isHermesRunning: boolean;
  context?: HermesSharedContext | undefined;
  lastConnectedAt?: string | undefined;
  lastError?: string | undefined;
}

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

export const HERMES_BRAND = Object.freeze({
  appName: "Hermes Design Studio",
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
});
