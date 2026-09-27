// Hermes model adapter.
//
// Section 5 makes Hermes authoritative for the model and for provider routing,
// so this adapter is read-only *by construction*: there is no setter. The
// upstream surface that would allow writing (`POST /api/model/set`) is
// deliberately not wrapped, because a Design Studio model picker that fought
// Hermes' own would be exactly the "second independent AI brain" this module
// exists to avoid.
//
// Real endpoints, from `hermes_cli/web_routers/models.py` at the pinned commit:
//   • `GET /api/model/options`  — authenticated providers + curated model lists;
//     the REST twin of the `model.options` JSON-RPC, same response shape
//   • `GET /api/model/info`     — the currently selected model
//   • `GET /api/model/recommended-default` — `{"provider","model","free_tier"}`
//     for onboarding a fresh provider
//
// `model_config` is carried as an opaque object and never interpreted: it can
// reference provider credentials, and section 14 forbids those reaching the
// renderer or a log line.

/** The selected model, as Hermes reports it. */
export interface HermesModelSelection {
  /** Provider slug, e.g. `nous`, `openrouter`, `anthropic`. */
  provider: string | null;
  /** Model id within the provider. */
  model: string | null;
  /**
   * Composite id Design Studio displays and echoes back in context
   * (`provider/model`). Never sent to Hermes as an authority — Hermes resolves
   * the model from its own profile config.
   */
  modelId: string | null;
  /** Free-tier flag, present only for Nous. */
  freeTier: boolean | null;
  /** Opaque; may reference credentials. Never logged, never sent to a renderer. */
  modelConfig: Record<string, unknown> | null;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalise a `/api/model/info` (or session row) payload.
 *
 * Hermes spells the selection `model` and sometimes `provider` + `model`;
 * session rows carry `model` and `model_config`. Accepting both lets the same
 * mapper serve the model endpoint and the session read, which is how the bridge
 * keeps the context's `modelId` and the model panel in agreement.
 */
export function mapHermesModelSelection(payload: unknown): HermesModelSelection {
  const empty: HermesModelSelection = {
    provider: null,
    model: null,
    modelId: null,
    freeTier: null,
    modelConfig: null,
  };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return empty;

  const value = payload as Record<string, unknown>;
  const provider = asNullableString(value.provider ?? value.provider_slug ?? value.providerSlug);
  const model = asNullableString(value.model ?? value.model_id ?? value.modelId ?? value.name);
  const modelId = model == null ? null : provider == null ? model : `${provider}/${model}`;

  const modelConfig =
    value.model_config && typeof value.model_config === "object" && !Array.isArray(value.model_config)
      ? (value.model_config as Record<string, unknown>)
      : null;

  return {
    provider,
    model,
    modelId,
    freeTier: typeof value.free_tier === "boolean" ? value.free_tier : null,
    modelConfig,
  };
}

/** One entry of `/api/model/options`, narrowed to what a picker needs. */
export interface HermesModelOption {
  provider: string;
  model: string;
  label: string;
  /** True when the provider has usable credentials in this profile. */
  configured: boolean;
  contextLength: number | null;
}

/**
 * Flatten the `/api/model/options` payload.
 *
 * Upstream returns a provider-keyed structure; the exact nesting varies with the
 * picker context, so this walks any object whose leaves look like models rather
 * than asserting one shape. A shape change upstream then degrades to "fewer
 * options listed", not a crash.
 */
export function flattenHermesModelOptions(payload: unknown): HermesModelOption[] {
  const options: HermesModelOption[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown, providerHint: string | null): void => {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (const entry of node) visit(entry, providerHint);
      return;
    }

    const record = node as Record<string, unknown>;
    const model = asNullableString(record.model ?? record.id ?? record.model_id ?? record.modelId);
    const provider = asNullableString(record.provider ?? record.slug ?? record.provider_slug) ?? providerHint;

    if (model != null && provider != null) {
      const key = `${provider}/${model}`;
      if (!seen.has(key)) {
        seen.add(key);
        options.push({
          provider,
          model,
          label: asNullableString(record.label ?? record.display_name ?? record.displayName) ?? key,
          configured: record.configured !== false,
          contextLength:
            typeof record.context_length === "number"
              ? record.context_length
              : typeof record.contextLength === "number"
                ? record.contextLength
                : null,
        });
      }
      return;
    }

    for (const [key, value] of Object.entries(record)) visit(value, provider ?? key);
  };

  visit(payload, null);
  return options;
}

/**
 * Redacted copy for the renderer.
 *
 * The whole point of this function's existence: the picker needs ids and labels,
 * and must never receive `model_config`.
 */
export function redactHermesModelSelection(selection: HermesModelSelection): HermesModelSelection {
  return { ...selection, modelConfig: null };
}

export function hermesModelSelectionChanged(
  previous: HermesModelSelection | null,
  next: HermesModelSelection | null,
): boolean {
  if (previous === next) return false;
  if (!previous || !next) return true;
  return previous.modelId !== next.modelId || previous.provider !== next.provider;
}
