/**
 * Hermes Actions - Typed actions Hermes can invoke
 * Implements STEP 8: Hermes Actions
 */

import { randomUUID } from "node:crypto";
import type {
  DesignStudioAction,
  DesignStudioActionType,
  DesignStudioActionResult,
  HermesSharedContext,
} from "./types.js";

export type DesignStudioActionHandler = (action: DesignStudioAction<any>) => Promise<DesignStudioActionResult<any>>;

export interface DesignStudioActionRegistry {
  register(type: DesignStudioActionType, handler: DesignStudioActionHandler): void;
  unregister(type: DesignStudioActionType): void;
  execute(action: DesignStudioAction<any>): Promise<DesignStudioActionResult<any>>;
  has(type: DesignStudioActionType): boolean;
  list(): DesignStudioActionType[];
}

export function createActionRegistry(): DesignStudioActionRegistry {
  const handlers = new Map<DesignStudioActionType, DesignStudioActionHandler>();

  return {
    register(type, handler) {
      handlers.set(type, handler);
    },
    unregister(type) {
      handlers.delete(type);
    },
    async execute(action) {
      const handler = handlers.get(action.type);
      if (!handler) {
        return {
          actionId: action.id,
          type: action.type,
          success: false,
          error: `No handler registered for ${action.type}`,
          timestamp: new Date().toISOString(),
        };
      }

      try {
        return await handler(action);
      } catch (error) {

        return {
          actionId: action.id,
          type: action.type,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        };
      }
    },
    has(type) {
      return handlers.has(type);
    },
    list() {
      return Array.from(handlers.keys());
    },
  };
}

// Action payload types
export interface OpenActionPayload {
  designId?: string;
  projectId?: string;
  path?: string;
}

export interface CreateActionPayload {
  prompt: string;
  templateId?: string;
  designSystemId?: string;
  projectId?: string;
  name?: string;
}

export interface EditActionPayload {
  designId: string;
  instructions: string;
  projectId?: string;
}

export interface GenerateActionPayload {
  designId?: string;
  prompt: string;
  projectId?: string;
  templateId?: string;
  designSystemId?: string;
  variantCount?: number;
}

export interface GenerateVariantPayload {
  designId: string;
  prompt?: string;
  count?: number;
  projectId?: string;
}

export interface PreviewActionPayload {
  designId: string;
  projectId?: string;
}

export interface CompareActionPayload {
  designIds: string[];
  projectId?: string;
}

export interface ExportActionPayload {
  designId: string;
  format: "pdf" | "png" | "jpeg" | "html" | "zip";
  projectId?: string;
  outputPath?: string;
}

export interface ApproveActionPayload {
  designId: string;
  artifactId?: string;
  projectId?: string;
  approved: boolean;
}

export interface SendToCodePayload {
  designId: string;
  artifactId?: string;
  projectId: string;
  metadata?: Record<string, unknown>;
  assets?: string[];
  designIntent?: string;
  variant?: string;
}

// Factory for creating actions
export function createAction<T>(
  type: DesignStudioActionType,
  payload?: T,
  context?: HermesSharedContext
): DesignStudioAction<T> {
  return {
    type,
    id: randomUUID(),
    payload,
    context,
    timestamp: new Date().toISOString(),
  };
}

export const DesignStudioActionFactory = {
  open: (payload?: OpenActionPayload, context?: HermesSharedContext) =>
    createAction<OpenActionPayload>("designStudio.open", payload, context),
  close: (payload?: OpenActionPayload, context?: HermesSharedContext) =>
    createAction<OpenActionPayload>("designStudio.close", payload, context),
  focus: (payload?: OpenActionPayload, context?: HermesSharedContext) =>
    createAction<OpenActionPayload>("designStudio.focus", payload, context),
  create: (payload: CreateActionPayload, context?: HermesSharedContext) =>
    createAction<CreateActionPayload>("designStudio.create", payload, context),
  edit: (payload: EditActionPayload, context?: HermesSharedContext) =>
    createAction<EditActionPayload>("designStudio.edit", payload, context),
  generate: (payload: GenerateActionPayload, context?: HermesSharedContext) =>
    createAction<GenerateActionPayload>("designStudio.generate", payload, context),
  generateVariant: (payload: GenerateVariantPayload, context?: HermesSharedContext) =>
    createAction<GenerateVariantPayload>("designStudio.generateVariant", payload, context),
  preview: (payload: PreviewActionPayload, context?: HermesSharedContext) =>
    createAction<PreviewActionPayload>("designStudio.preview", payload, context),
  compare: (payload: CompareActionPayload, context?: HermesSharedContext) =>
    createAction<CompareActionPayload>("designStudio.compare", payload, context),
  export: (payload: ExportActionPayload, context?: HermesSharedContext) =>
    createAction<ExportActionPayload>("designStudio.export", payload, context),
  approve: (payload: ApproveActionPayload, context?: HermesSharedContext) =>
    createAction<ApproveActionPayload>("designStudio.approve", payload, context),
  pause: (designId: string, context?: HermesSharedContext) =>
    createAction("designStudio.pause", { designId }, context),
  resume: (designId: string, context?: HermesSharedContext) =>
    createAction("designStudio.resume", { designId }, context),
  cancel: (designId: string, context?: HermesSharedContext) =>
    createAction("designStudio.cancel", { designId }, context),
  getStatus: (designId?: string, context?: HermesSharedContext) =>
    createAction("designStudio.getStatus", { designId }, context),
  getArtifacts: (projectId?: string, context?: HermesSharedContext) =>
    createAction("designStudio.getArtifacts", { projectId }, context),
  sendToCode: (payload: SendToCodePayload, context?: HermesSharedContext) =>
    createAction<SendToCodePayload>("designStudio.sendToCode", payload, context),
};

/**
 * SendToCode handoff - preserves project, artifact, selected design, metadata, assets, intent, variant
 * Implements STEP 20: Design -> Code Handoff
 */
export interface DesignToCodeHandoff {
  projectId: string;
  designId: string;
  artifactId?: string;
  selectedDesign: {
    id: string;
    name?: string;
    html?: string;
    metadata?: Record<string, unknown>;
  };
  relevantMetadata?: Record<string, unknown>;
  relevantAssets?: Array<{
    path: string;
    type: string;
    url?: string;
  }>;
  designIntent?: string;
  variant?: string;
  context?: HermesSharedContext;
  timestamp: string;
}

export function createDesignToCodeHandoff(
  payload: SendToCodePayload & { selectedDesign?: DesignToCodeHandoff["selectedDesign"] }
): DesignToCodeHandoff {
  return {
    projectId: payload.projectId,
    designId: payload.designId,
    artifactId: payload.artifactId,
    selectedDesign: payload.selectedDesign || { id: payload.designId },
    relevantMetadata: payload.metadata,
    relevantAssets: payload.assets?.map((a) => ({ path: a, type: "asset" })) || [],
    designIntent: payload.designIntent,
    variant: payload.variant,
    timestamp: new Date().toISOString(),
  };
}
