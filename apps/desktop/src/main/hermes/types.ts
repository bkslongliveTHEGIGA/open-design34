/**
 * Hermes Design Studio - Core Types
 * Defines the Hermes integration contract.
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

export interface HermesDetectionResult {
  state: HermesConnectionState;
  hermesHome?: string | undefined;
  executablePath?: string | undefined;
  version?: string | undefined;
  endpoint?: string | undefined;
  error?: string | undefined;
  detectedAt: string;
}

export interface HermesCapabilities {
  supportsChatInvocation: boolean;
  supportsArtifactSharing: boolean;
  supportsProjectSync: boolean;
  supportsModelSync: boolean;
  supportsThemeSync: boolean;
  supportsMemory: boolean;
  supportsPermissions: boolean;
  supportsSendToCode: boolean;
  version: string;
}

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
  // Additional fields for compatibility with real Hermes
  hermesHome?: string | undefined;
  profile?: string | undefined;
  updatedAt: string;
}

export interface HermesModelInfo {
  id: string;
  label: string;
  provider?: string | undefined;
  contextLength?: number;
  isDefault?: boolean | undefined;
}

export interface HermesTheme {
  id: string;
  name: string;
  mode: "light" | "dark" | "system";
  // Hermes Design Studio brand palette
  colors: {
    primary: string; // #0000F2
    light: string; // #F5F5F5
    white: string; // #FFFFFF
    accent: string; // #EDFF45
    supporting: string[];
  };
  typography: {
    display: string; // Sigurd
    ui: string; // Rules
    technical: string; // Courier Prime
  };
  // Hermes global theme that should sync into Design Studio
  hermesGlobalTheme?: {
    id: string;
    name: string;
    variables?: Record<string, string>;
  };
}

export interface HermesProject {
  id: string;
  name: string;
  path?: string | undefined;
  workspaceId?: string | undefined;
  metadata?: Record<string, unknown>;
}

export interface HermesArtifact {
  id: string;
  projectId: string;
  type: string;
  version: number;
  status: "draft" | "ready" | "approved" | "archived";
  metadata?: Record<string, unknown>;
  previewUrl?: string | undefined;
  createdAt: string;
  updatedAt: string;
  source: "hermes" | "design-studio";
  moduleOwnership: "hermes" | "design-studio" | "shared";
}

export interface HermesPermissions {
  canCreate: boolean;
  canEdit: boolean;
  canGenerate: boolean;
  canExport: boolean;
  canApprove: boolean;
  canSendToCode: boolean;
  canAccessMemory: boolean;
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

export interface DesignStudioAction<T = unknown> {
  type: DesignStudioActionType;
  id: string;
  payload?: T;
  context?: HermesSharedContext | undefined;
  timestamp: string;
}

export interface DesignStudioActionResult<T = unknown> {
  actionId: string;
  type: DesignStudioActionType;
  success: boolean;
  data?: T;
  error?: string | undefined;
  artifactIds?: string[];
  previewUrl?: string | undefined;
  timestamp: string;
}

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

export interface DesignStudioEvent<T = unknown> {
  type: DesignStudioEventType;
  id: string;
  designId?: string | undefined;
  artifactId?: string | undefined;
  projectId?: string | undefined;
  payload?: T;
  context?: HermesSharedContext | undefined;
  timestamp: string;
}

export interface HermesBridgeStatus {
  connectionState: HermesConnectionState;
  isConnected: boolean;
  isHermesInstalled: boolean;
  isHermesRunning: boolean;
  context?: HermesSharedContext | undefined;
  capabilities?: HermesCapabilities;
  model?: HermesModelInfo;
  theme?: HermesTheme;
  project?: HermesProject;
  permissions?: HermesPermissions;
  lastConnectedAt?: string | undefined;
  lastError?: string | undefined;
  reconnectionAttempts?: number;
}

// Deep link types
export type HermesDeepLinkType =
  | "design-studio"
  | "project"
  | "design"
  | "artifact"
  | "session";

export interface HermesDeepLink {
  type: HermesDeepLinkType;
  id?: string | undefined;
  path: string;
  originalUrl: string;
  params?: Record<string, string>;
}

export const HERMES_BRAND = Object.freeze({
  appName: "Hermes Design Studio",
  productName: "Hermes Design Studio",
  shortName: "Design Studio",
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
