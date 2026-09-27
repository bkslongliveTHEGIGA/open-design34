// Hermes artifact adapter, and the Design Studio → Hermes Code handoff.
//
// Section 17 asks for stable IDs, previews, metadata, versioning, status,
// project and conversation association, and export information. This repository
// already has exactly that shape in `packages/contracts/src/api/artifacts.ts::
// ArtifactManifest` — `version`, `kind`, `entry`/`renderer`/`primary`,
// `metadata`, `status`, `sourceProjectId`, `parentArtifactId`, `exports`,
// `exportTargets`. So the adapter *maps onto* that type instead of defining a
// competing artifact model, which is what "avoid introducing duplicate
// databases" means in practice.
//
// Two things Hermes needs that the manifest does not carry, because they are
// Hermes' state and not Design Studio's:
//   • conversation association — `conversationId` (a Hermes session id)
//   • the Hermes-side artifact identity it can address the artifact by
// Both are added here as an envelope rather than bolted onto the shared
// contract, so the daemon's artifact code is untouched.
//
// Section 18's handoff reuses the manifest's own `handoffKind` vocabulary
// (`design-only` | `implementation-plan` | `patch` | `deployable-app`) rather
// than inventing a handoff taxonomy.

import type { HermesSharedContext } from "./hermes-context.js";

/** `packages/contracts/src/api/artifacts.ts::ArtifactProvenanceHandoffKind`. */
export const HERMES_CODE_HANDOFF_KINDS = Object.freeze([
  "design-only",
  "implementation-plan",
  "patch",
  "deployable-app",
] as const);

export type HermesCodeHandoffKind = (typeof HERMES_CODE_HANDOFF_KINDS)[number];

export function isHermesCodeHandoffKind(value: unknown): value is HermesCodeHandoffKind {
  return typeof value === "string" && (HERMES_CODE_HANDOFF_KINDS as readonly string[]).includes(value);
}

/**
 * A Design Studio artifact as Hermes sees it.
 *
 * `manifest` is the real `ArtifactManifest`, passed through untouched so a
 * Hermes consumer that understands artifacts understands this one. The envelope
 * adds only the Hermes-side association.
 */
export interface HermesArtifactDescriptor {
  /** Stable Design Studio artifact identifier. */
  artifactId: string;
  /** The underlying manifest, unmodified. */
  manifest: Record<string, unknown>;
  /** Hermes conversation this artifact belongs to, when known. */
  conversationId: string | null;
  /** Hermes workspace key (git repo root / cwd) it is associated with. */
  workspaceKey: string | null;
  /** Design Studio project the artifact was produced in. */
  projectId: string | null;
  /** Monotonic version within the artifact's own lineage. */
  version: number;
  /** Lifecycle status Hermes can render. */
  status: "draft" | "ready" | "approved" | "exported" | "failed";
  /** Preview location, resolved by the caller (loopback only). */
  previewUrl: string | null;
  /** Where it has been exported, mirrored from the manifest. */
  exportTargets: { surface: string; target: string; exportedAt: number }[];
  createdAt: number;
  updatedAt: number;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export interface HermesArtifactInput {
  artifactId: string;
  /** The real `ArtifactManifest` object. */
  manifest: Record<string, unknown>;
  context?: HermesSharedContext | null;
  version?: number;
  status?: HermesArtifactDescriptor["status"];
  previewUrl?: string | null;
}

/**
 * Build the Hermes-visible descriptor for an artifact.
 *
 * Falls back to the manifest's own `sourceProjectId` for the project when the
 * context does not carry one, because a manifest produced before a Hermes
 * connection still knows which Design Studio project it came from.
 */
export function toHermesArtifactDescriptor(input: HermesArtifactInput): HermesArtifactDescriptor {
  const manifest = input.manifest;
  const context = input.context ?? null;
  const now = Date.now();

  const exportTargets = Array.isArray(manifest.exportTargets)
    ? manifest.exportTargets
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
        .map((entry) => ({
          surface: asNullableString(entry.surface) ?? "desktop",
          target: asNullableString(entry.target) ?? "",
          exportedAt: asNumber(entry.exportedAt, now),
        }))
    : [];

  return {
    artifactId: input.artifactId,
    manifest,
    conversationId: context?.conversationId ?? null,
    workspaceKey: context?.workspaceKey ?? null,
    projectId: context?.projectId ?? asNullableString(manifest.sourceProjectId),
    version: asNumber(input.version, 1),
    status: input.status ?? deriveArtifactStatus(manifest),
    previewUrl: input.previewUrl ?? null,
    exportTargets,
    createdAt: parseTimestamp(manifest.createdAt) ?? now,
    updatedAt: parseTimestamp(manifest.updatedAt) ?? now,
  };
}

/**
 * Map the manifest's own streaming status onto the lifecycle Hermes renders.
 *
 * `'streaming'` is still `'draft'` from Hermes' point of view: showing a
 * half-written artifact as `ready` would put a broken preview in Chat.
 */
export function deriveArtifactStatus(manifest: Record<string, unknown>): HermesArtifactDescriptor["status"] {
  const status = asNullableString(manifest.status);
  if (status === "streaming") return "draft";
  if (status === "error") return "failed";
  const exports = Array.isArray(manifest.exports) ? manifest.exports : [];
  return exports.length > 0 ? "exported" : "ready";
}

/**
 * The payload for `designStudio.sendToCode`.
 *
 * Section 18's checklist, mapped onto real fields: project, artifact, design
 * metadata, relevant assets, design intent, selected variant and context. Assets
 * travel as *references* (`supportingFiles` + `entry` from the manifest), not
 * inline bytes — the handoff stays small and Hermes Code reads them from the
 * shared location, which is what makes "without the user manually downloading
 * and uploading files" true.
 */
export interface HermesCodeHandoffRequest {
  artifactId: string;
  /** Hermes Code module identity to hand off to. */
  target: string;
  handoffKind: HermesCodeHandoffKind;
  /** The selected variant, when the design has several. */
  variantId: string | null;
  /** Free-text design intent, carried so Code does not have to guess. */
  intent: string | null;
  /** Files to hand over, as references relative to the artifact root. */
  assets: string[];
  /** Entry file within `assets`. */
  entry: string | null;
  projectId: string | null;
  workspaceKey: string | null;
  conversationId: string | null;
  /** Manifest metadata worth carrying; credentials are never in here. */
  designMetadata: Record<string, unknown>;
}

export interface HermesCodeHandoffResult {
  ok: boolean;
  handoffId: string | null;
  target: string;
  error?: string;
}

/**
 * Build a handoff request from an artifact and its context.
 *
 * Returns null when the artifact cannot be handed off — no artifact id, or no
 * entry file. Silently handing over an artifact with no entry would leave Hermes
 * Code with nothing to build, which is worse than refusing.
 */
export function buildHermesCodeHandoff(
  input: {
    artifactId: string;
    manifest: Record<string, unknown>;
    context?: HermesSharedContext | null;
    variantId?: string | null;
    intent?: string | null;
    handoffKind?: HermesCodeHandoffKind;
    target?: string;
  },
): HermesCodeHandoffRequest | null {
  if (!input.artifactId || input.artifactId.trim().length === 0) return null;

  const manifest = input.manifest;
  const entry = asNullableString(manifest.entry);
  if (entry == null) return null;

  const context = input.context ?? null;
  const supporting = Array.isArray(manifest.supportingFiles)
    ? manifest.supportingFiles.filter((file): file is string => typeof file === "string" && file.trim().length > 0)
    : [];

  const metadata =
    manifest.metadata && typeof manifest.metadata === "object" && !Array.isArray(manifest.metadata)
      ? (manifest.metadata as Record<string, unknown>)
      : {};

  return {
    artifactId: input.artifactId,
    target: input.target?.trim() || "hermes-code",
    handoffKind: isHermesCodeHandoffKind(input.handoffKind) ? input.handoffKind : defaultHandoffKind(manifest),
    variantId: input.variantId ?? asNullableString(manifest.parentArtifactId),
    intent: input.intent ?? asNullableString(manifest.title),
    // The entry must be in the asset list or Code cannot find it.
    assets: [entry, ...supporting.filter((file) => file !== entry)],
    entry,
    projectId: context?.projectId ?? asNullableString(manifest.sourceProjectId),
    workspaceKey: context?.workspaceKey ?? null,
    conversationId: context?.conversationId ?? null,
    designMetadata: pickHandoffMetadata(metadata),
  };
}

/**
 * Choose a handoff kind from what the artifact actually is.
 *
 * A `design-system` or `mini-app` is closer to a deployable app; a plain `html`
 * prototype is a starting point for implementation. Defaulting to `design-only`
 * would under-promise for artifacts that are already buildable.
 */
export function defaultHandoffKind(manifest: Record<string, unknown>): HermesCodeHandoffKind {
  const kind = asNullableString(manifest.kind);
  switch (kind) {
    case "mini-app":
    case "design-system":
      return "deployable-app";
    case "code-snippet":
      return "patch";
    default:
      return "implementation-plan";
  }
}

/**
 * Whitelist the metadata keys that travel with a handoff.
 *
 * `metadata` is an open bag the daemon fills from many sources; forwarding all
 * of it to another module would leak whatever a plugin happened to store there.
 * Only design-describing keys cross.
 */
const HANDOFF_METADATA_KEYS = Object.freeze([
  "designSystemId",
  "sourceSkillId",
  "sourcePluginId",
  "sourcePluginVersion",
  "sourceTaskKind",
  "artifactKind",
  "renderKind",
  "viewport",
  "themeId",
  "templateId",
  "locale",
] as const);

export function pickHandoffMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of HANDOFF_METADATA_KEYS) {
    if (metadata[key] !== undefined) picked[key] = metadata[key];
  }
  return picked;
}
