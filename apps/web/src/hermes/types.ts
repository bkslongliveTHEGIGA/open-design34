/**
 * Hermes Design Studio - Web Types
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
  capabilities?: {
    supportsChatInvocation: boolean;
    supportsArtifactSharing: boolean;
    supportsProjectSync: boolean;
    supportsModelSync: boolean;
    supportsThemeSync: boolean;
    supportsMemory: boolean;
    supportsPermissions: boolean;
    supportsSendToCode: boolean;
    version: string;
  };
  model?: {
    id: string;
    label: string;
    provider?: string;
  };
  theme?: {
    id: string;
    name: string;
    mode: "light" | "dark" | "system";
    colors: {
      primary: string;
      light: string;
      white: string;
      accent: string;
      supporting: string[];
    };
  };
  project?: {
    id: string;
    name: string;
  };
  lastConnectedAt?: string;
  lastError?: string;
  reconnectionAttempts?: number;
}

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
  typography: {
    display: "Sigurd",
    ui: "Rules",
    technical: "Courier Prime",
  },
});

export const HERMES_THEME_CSS_VARS = {
  "--hermes-primary": "#0000F2",
  "--hermes-primary-dark": "#0000D9",
  "--hermes-primary-light": "#1A1AFF",
  "--hermes-primary-soft": "#000099",
  "--hermes-accent": "#EDFF45",
  "--hermes-light": "#F5F5F5",
  "--hermes-white": "#FFFFFF",
  "--hermes-supporting-1": "#0000CC",
  "--hermes-supporting-2": "#3333FF",
  "--hermes-supporting-3": "#E9ECEF",
  "--hermes-supporting-4": "#D0D0D0",
  "--hermes-supporting-5": "#A0A0A0",
  "--hermes-error": "#FF4444",
  "--hermes-error-light": "#FF8888",
};
