// The shared Hermes ⇄ Design Studio context object.
//
// Section 6 of the integration spec asked for `hermesProjectId`, `workspaceId`,
// `conversationId`, ... — and also for the schema to be *adapted to the actual
// Hermes source* rather than guessed. Reading the vendored source changed the
// shape, and the differences matter:
//
//   • Core Hermes has **no** `project_id`. Sessions are grouped by a *workspace
//     key* — `hermes_state_sessions.workspace_key()` returns `git_repo_root`,
//     else `cwd`, else null. So `workspaceKey` is the real grouping identity and
//     `projectId` is an optional alias that is only populated when the task came
//     from a surface that actually has one (`hermes_cli/kanban_db.py` carries a
//     `project_id`). Inventing a project id here would create a field Hermes can
//     never fill.
//   • A conversation is a **session**: `sessions.id`, minted by
//     `hermes_state_ids.new_session_id()` as `YYYYMMDD_HHMMSS_<hex>`. The
//     Desktop's candidate regex is pinned to 6 hex chars; gateway keys use 8 and
//     portability imports 12, so the validator accepts 6+.
//   • Identity is a **profile**, not an account: `<home>/active_profile` /
//     `profile_name`, and one backend may serve several (`served_profiles`).
//   • The model is `sessions.model` + `sessions.model_config` (a JSON column),
//     not a provider/route pair.
//
// Every field is optional except `origin`, so a partial context — the normal
// case for a deep link — is representable without inventing values.

/** How this context reached Design Studio. */
export type HermesContextOrigin =
  /** Hermes invoked a `designStudio.*` action. */
  | "hermes-action"
  /** A `hermes://design-studio/...` deep link. */
  | "deeplink"
  /** Design Studio read it from the connected backend at handshake. */
  | "bridge-sync"
  /** Constructed locally in standalone mode. */
  | "local";

/**
 * The typed context carried by every Design Studio operation that originates
 * from Hermes.
 *
 * Stable Design Studio interface over the real Hermes structures; the mapping
 * from upstream payloads lives in `mapHermesContext`.
 */
export interface HermesSharedContext {
  origin: HermesContextOrigin;

  /**
   * Profile label (`active_profile` / `identify.profile`). Hermes identity is a
   * profile on one machine root, so this — not a user id — is what scopes
   * permissions and memory.
   */
  hermesProfile: string | null;

  /**
   * Real Hermes workspace grouping key: the session's `git_repo_root`, else its
   * `cwd`. Null when the session predates per-session git metadata and has no
   * cwd.
   */
  workspaceKey: string | null;

  /**
   * Optional project alias. Populated only when the originating surface carries
   * a real `project_id` (Hermes Kanban). Core Hermes sessions do not.
   */
  projectId: string | null;

  /** `sessions.id` — the conversation this work belongs to. */
  conversationId: string | null;

  /**
   * Agent session/turn identifier. Distinct from `conversationId` because a
   * single conversation can drive several agent runs.
   */
  agentSessionId: string | null;

  /** Task/mission identifier when the work arrived as a Hermes task. */
  taskId: string | null;

  /** `sessions.model`. Hermes owns model selection; Design Studio only reads it. */
  modelId: string | null;

  /**
   * `sessions.model_config` as an opaque JSON object. Design Studio must not
   * interpret it — it may carry provider credentials references, and section 14
   * forbids those reaching the renderer. Kept opaque and never logged.
   */
  modelConfig: Record<string, unknown> | null;

  /** Theme name from the Hermes theme model (e.g. `default`, `nous-blue`). */
  themeId: string | null;

  /**
   * Opaque handle to the Hermes memory slice authorized for this operation.
   * Design Studio passes it back verbatim when it needs memory; it never
   * receives memory *contents* through this field.
   */
  memoryContextId: string | null;

  /** Hermes artifacts handed *into* Design Studio for this operation. */
  artifactIds: string[];

  /**
   * Opaque permission grant handle. Every privileged action is checked against
   * it (see `hermes-permissions.ts`); Design Studio never derives permissions
   * from the context's other fields.
   */
  permissionContextId: string | null;

  /** Machine root of the Hermes install this context belongs to. */
  hermesHome: string | null;

  /** Free-form, non-secret extras forwarded from the caller. */
  extra: Record<string, unknown>;
}

/** `hermes_state_ids.SESSION_ID_PATTERN` — `^\d{8}_\d{6}_` plus a hex tail. */
export const HERMES_SESSION_ID_PATTERN = /^\d{8}_\d{6}_[0-9a-f]{6,}$/i;

/** True when the value is shaped like a real Hermes session id. */
export function isHermesSessionId(value: unknown): value is string {
  return typeof value === "string" && HERMES_SESSION_ID_PATTERN.test(value);
}

/** An empty context: standalone mode, or a deep link carrying nothing. */
export function emptyHermesContext(origin: HermesContextOrigin = "local"): HermesSharedContext {
  return {
    origin,
    hermesProfile: null,
    workspaceKey: null,
    projectId: null,
    conversationId: null,
    agentSessionId: null,
    taskId: null,
    modelId: null,
    modelConfig: null,
    themeId: null,
    memoryContextId: null,
    artifactIds: [],
    permissionContextId: null,
    hermesHome: null,
    extra: {},
  };
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNullableRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

/**
 * Map a Hermes payload onto the stable Design Studio context.
 *
 * Accepts either a session-ish row (snake_case, as the state layer stores it) or
 * an already-camelCase bridge payload, so the same mapper serves the REST read
 * path and the action path. Unknown keys are preserved in `extra` — a newer
 * Hermes can add context without a Design Studio release.
 *
 * A `conversationId` that is not shaped like a real session id is dropped rather
 * than trusted: an event keyed to a bogus session id would be unroutable, and
 * silently accepting it hides the bug.
 */
export function mapHermesContext(
  payload: Record<string, unknown> | null | undefined,
  origin: HermesContextOrigin = "bridge-sync",
): HermesSharedContext {
  const context = emptyHermesContext(origin);
  if (!payload) return context;

  const pick = (...keys: string[]): unknown => {
    for (const key of keys) {
      if (payload[key] !== undefined) return payload[key];
    }
    return undefined;
  };

  context.hermesProfile = asNullableString(pick("hermes_profile", "profile", "profile_name", "hermesProfile"));
  context.workspaceKey = asNullableString(pick("workspace_key", "git_repo_root", "cwd", "workspaceKey", "workspaceId"));
  context.projectId = asNullableString(pick("project_id", "hermes_project_id", "hermesProjectId", "projectId"));

  const conversationId = asNullableString(pick("session_id", "conversation_id", "conversationId", "sessionId"));
  context.conversationId = conversationId != null && isHermesSessionId(conversationId) ? conversationId : null;

  context.agentSessionId = asNullableString(pick("agent_session_id", "agentSessionId", "run_id", "runId"));
  context.taskId = asNullableString(pick("task_id", "taskId", "mission_id", "missionId"));
  context.modelId = asNullableString(pick("model", "model_id", "modelId"));
  context.modelConfig = asNullableRecord(pick("model_config", "modelConfig"));
  context.themeId = asNullableString(pick("theme", "theme_id", "themeId", "theme_name", "themeName"));
  context.memoryContextId = asNullableString(pick("memory_context_id", "memoryContextId"));
  context.artifactIds = asStringArray(pick("artifact_ids", "artifactIds", "artifacts"));
  context.permissionContextId = asNullableString(pick("permission_context_id", "permissionContextId"));
  context.hermesHome = asNullableString(pick("hermes_home", "hermesHome"));

  const known = new Set([
    "hermes_profile",
    "profile",
    "profile_name",
    "hermesProfile",
    "workspace_key",
    "git_repo_root",
    "cwd",
    "workspaceKey",
    "workspaceId",
    "project_id",
    "hermes_project_id",
    "hermesProjectId",
    "projectId",
    "session_id",
    "conversation_id",
    "conversationId",
    "sessionId",
    "agent_session_id",
    "agentSessionId",
    "run_id",
    "runId",
    "task_id",
    "taskId",
    "mission_id",
    "missionId",
    "model",
    "model_id",
    "modelId",
    "model_config",
    "modelConfig",
    "theme",
    "theme_id",
    "themeId",
    "theme_name",
    "themeName",
    "memory_context_id",
    "memoryContextId",
    "artifact_ids",
    "artifactIds",
    "artifacts",
    "permission_context_id",
    "permissionContextId",
    "hermes_home",
    "hermesHome",
    "origin",
  ]);

  for (const [key, value] of Object.entries(payload)) {
    if (!known.has(key)) context.extra[key] = value;
  }

  return context;
}

/**
 * A redacted copy safe to log or send to the renderer.
 *
 * `modelConfig` is replaced wholesale: upstream stores provider and credential
 * references in it, and section 14 forbids those reaching the renderer or a log
 * line. The permission handle is dropped for the same reason — it is a grant,
 * not a label.
 */
export function redactHermesContext(context: HermesSharedContext): HermesSharedContext {
  return {
    ...context,
    modelConfig: null,
    permissionContextId: null,
    extra: {},
  };
}

/**
 * True when the two contexts differ in a field Design Studio reflects in its UI.
 *
 * This is the diff the live-sync layer uses to decide whether to re-render, so
 * it deliberately ignores `extra`, `modelConfig` and the permission handle:
 * those change without any visible consequence and re-rendering on them would
 * thrash the canvas.
 */
export function hermesContextVisibleDiff(
  previous: HermesSharedContext,
  next: HermesSharedContext,
): (keyof HermesSharedContext)[] {
  const fields: (keyof HermesSharedContext)[] = [
    "hermesProfile",
    "workspaceKey",
    "projectId",
    "conversationId",
    "agentSessionId",
    "taskId",
    "modelId",
    "themeId",
    "memoryContextId",
    "hermesHome",
  ];

  const changed = fields.filter((field) => previous[field] !== next[field]);
  if (previous.artifactIds.join("\u0000") !== next.artifactIds.join("\u0000")) changed.push("artifactIds");
  return changed;
}
