import { useCallback, useEffect, useRef, useState } from 'react';

import { isHermesBridgeSnapshot, type HermesBridgeSnapshotView } from '../desktop-bridge';

/**
 * The three user-visible states. The spec is explicit that standalone must not
 * read as an error, so it gets neutral styling and no warning affordance.
 */
type Presentation =
  | { kind: 'connected'; label: string; detail: string | null; tone: 'primary' }
  | { kind: 'unavailable'; label: string; detail: string | null; tone: 'danger' }
  | { kind: 'standalone'; label: string; detail: string | null; tone: 'neutral' }
  | { kind: 'unknown'; label: string; detail: null; tone: 'neutral' };

function present(snapshot: HermesBridgeSnapshotView | null, bridgePresent: boolean): Presentation {
  if (!bridgePresent) {
    // No desktop bridge at all: running in a plain browser, not in Design
    // Studio. That is different from "Hermes not installed".
    return { kind: 'standalone', label: 'Standalone mode', detail: 'Running outside the desktop app', tone: 'neutral' };
  }
  if (snapshot == null) {
    return { kind: 'unknown', label: 'Checking Hermes…', detail: null, tone: 'neutral' };
  }

  const modelName =
    snapshot.model != null && snapshot.model.model != null && snapshot.model.model.length > 0
      ? snapshot.model.provider != null && snapshot.model.provider.length > 0
        ? `${snapshot.model.provider}/${snapshot.model.model}`
        : snapshot.model.model
      : null;
  const project = snapshot.context?.hermesProjectId ?? null;

  switch (snapshot.state) {
    case 'connected': {
      const detail = [modelName, project != null ? `project ${project}` : null]
        .filter((part): part is string => part != null)
        .join(' · ');
      return { kind: 'connected', label: 'Hermes connected', detail: detail.length > 0 ? detail : null, tone: 'primary' };
    }
    case 'installed-idle':
    case 'reconnecting':
    case 'connecting':
    case 'discovering':
      // Found but not attached yet. Honest about it, and visibly transient.
      return {
        kind: 'unavailable',
        label: snapshot.state === 'installed-idle' ? 'Hermes unavailable' : 'Reconnecting to Hermes…',
        detail: snapshot.reason,
        tone: 'danger',
      };
    case 'not-installed':
    case 'disconnected':
    default:
      return { kind: 'standalone', label: 'Standalone mode', detail: null, tone: 'neutral' };
  }
}

export interface HermesConnectionStatusProps {
  /** Called with each snapshot so the host can react (e.g. theme sync). */
  onSnapshot?: (snapshot: HermesBridgeSnapshotView | null) => void;
}

/**
 * Connection indicator for Hermes Design Studio.
 *
 * Reads the real bridge snapshot from the Desktop preload bridge and keeps
 * itself current through the `hermes:state-changed` event, so a Hermes instance
 * that appears after launch shows up without a reload. It never asserts a
 * connection it has not observed.
 */
export function HermesConnectionStatus({ onSnapshot }: HermesConnectionStatusProps): JSX.Element {
  const api = typeof window === 'undefined' ? undefined : window.openDesignDesktop?.hermes;
  const [snapshot, setSnapshot] = useState<HermesBridgeSnapshotView | null>(null);
  const [busy, setBusy] = useState(false);
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;

  const apply = useCallback((value: unknown) => {
    const next = isHermesBridgeSnapshot(value) ? value : null;
    setSnapshot(next);
    onSnapshotRef.current?.(next);
  }, []);

  useEffect(() => {
    if (api == null) return;
    let cancelled = false;

    void api
      .getState()
      .then((value) => {
        if (!cancelled) apply(value);
      })
      .catch(() => {
        // A failed probe is not a connection; leave the indicator on its
        // "checking" state and let the next transition update it.
      });

    const unsubscribe = api.onStateChanged(apply);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api, apply]);

  const reconnect = useCallback(async () => {
    if (api == null || busy) return;
    setBusy(true);
    try {
      apply(await api.reconnect());
    } catch {
      // Leave the current state displayed; the poll will retry on its own.
    } finally {
      setBusy(false);
    }
  }, [api, apply, busy]);

  const view = present(snapshot, api != null);
  const toneClass =
    view.tone === 'primary'
      ? 'hermes-surface-primary'
      : view.tone === 'danger'
        ? 'hermes-state-danger'
        : 'hermes-surface-light';

  return (
    <div
      className={`hermes-connection-status hermes-font-ui ${toneClass}`}
      data-hermes-state={snapshot?.state ?? 'no-bridge'}
      data-hermes-presentation={view.kind}
      role="status"
      aria-live="polite"
    >
      <span className="hermes-connection-status__label">{view.label}</span>
      {view.detail != null && view.detail.length > 0 ? (
        <span className="hermes-connection-status__detail hermes-font-technical">{view.detail}</span>
      ) : null}
      {/* Standalone is not an error, so it gets no retry affordance — there is
          nothing to retry until an install exists. */}
      {view.kind === 'unavailable' ? (
        <button
          type="button"
          className="hermes-connection-status__action hermes-focusable"
          onClick={() => void reconnect()}
          disabled={busy}
        >
          {busy ? 'Reconnecting…' : 'Reconnect'}
        </button>
      ) : null}
    </div>
  );
}

export default HermesConnectionStatus;
