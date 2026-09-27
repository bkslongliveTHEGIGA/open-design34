import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  isHermesActionRequest,
  type HermesActionResult,
  type HermesCapabilities,
  type HermesFloatingControlView,
} from '../desktop-bridge';

/** Task lifecycle, mirroring `HERMES_TASK_STATES` in the desktop bridge. */
export type HermesTaskState =
  | 'idle'
  | 'generating'
  | 'ready'
  | 'comparing'
  | 'failed'
  | 'paused'
  | 'exported';

type Outcome =
  | { kind: 'idle' }
  | { kind: 'running'; action: string }
  | { kind: 'done'; action: string }
  | { kind: 'error'; action: string; message: string };

/**
 * Controls that are agent-tier visibly take time, so they get a spinner state
 * rather than appearing to do nothing.
 */
const LONG_RUNNING_RISKS = new Set(['agent', 'external']);

function outcomeMessage(result: HermesActionResult): string | null {
  if (result.ok) return null;
  return result.error.length > 0 ? result.error : 'Action was not permitted';
}

export interface HermesFloatingControlsProps {
  /** Current Design Studio task state; controls filter themselves against it. */
  taskState: HermesTaskState;
  /** Which slot to render. */
  slot?: 'composer-bar' | 'floating-card';
  /** Called when this renderer services an action Hermes asked for. */
  onActionHandled?: (action: string, result: HermesActionResult) => void;
  className?: string;
}

/**
 * Floating Design Studio controls.
 *
 * Every control here dispatches a real `designStudio.*` action through the same
 * registry Hermes uses, so the permission gate and audit trail apply whether the
 * click came from a person or from Hermes Chat. Nothing is decorative:
 *
 *   • controls are only rendered when the task state allows them;
 *   • controls whose action is not currently permitted are hidden, not greyed
 *     out into a lie — an unavailable action is not an affordance;
 *   • if the capability manifest has not loaded yet, nothing renders at all,
 *     rather than rendering a set that cannot work.
 */
export function HermesFloatingControls({
  taskState,
  slot = 'composer-bar',
  onActionHandled,
  className,
}: HermesFloatingControlsProps): JSX.Element | null {
  const api = typeof window === 'undefined' ? undefined : window.openDesignDesktop?.hermes;
  const [capabilities, setCapabilities] = useState<HermesCapabilities | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const onActionHandledRef = useRef(onActionHandled);
  onActionHandledRef.current = onActionHandled;

  const refresh = useCallback(async () => {
    if (api == null) return;
    try {
      setCapabilities(await api.capabilities());
    } catch {
      // No manifest means no controls. Rendering a guessed set would be worse
      // than rendering none.
      setCapabilities(null);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh, taskState]);

  /** Run an action, whether the click came from here or from Hermes. */
  const run = useCallback(
    async (action: string, args: Record<string, unknown> | undefined, risk: string) => {
      if (api == null) return;
      const longRunning = LONG_RUNNING_RISKS.has(risk);
      if (longRunning) setOutcome({ kind: 'running', action });
      try {
        const result = await api.invokeAction(action, args);
        const message = outcomeMessage(result);
        if (message != null) {
          setOutcome({ kind: 'error', action, message });
        } else {
          setOutcome({ kind: 'done', action });
        }
        onActionHandledRef.current?.(action, result);
      } catch (error) {
        setOutcome({
          kind: 'error',
          action,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        // Permissions and availability can change as a result of what just ran.
        void refresh();
      }
    },
    [api, refresh],
  );

  // Service actions Hermes asks for. Without this the `actionRequested` channel
  // would arrive at a renderer that ignores it.
  useEffect(() => {
    if (api == null) return;
    return api.onActionRequested((payload) => {
      if (!isHermesActionRequest(payload)) return;
      void run(payload.action, payload.args ?? undefined, 'write');
    });
  }, [api, run]);

  const controls = useMemo(() => {
    if (capabilities == null) return [];
    const permitted = new Set(
      capabilities.actions.filter((entry) => entry.available).map((entry) => entry.name),
    );
    return capabilities.controls
      .filter((control) => control.slot === slot)
      .filter((control) => control.when.includes(taskState))
      .filter((control) => permitted.has(control.action))
      .sort((a, b) => a.order - b.order);
  }, [capabilities, slot, taskState]);

  if (controls.length === 0) return null;

  return (
    <div
      className={`hermes-controls hermes-controls--${slot} hermes-font-ui ${className ?? ''}`.trim()}
      data-hermes-task-state={taskState}
    >
      {controls.map((control: HermesFloatingControlView) => {
        const running = outcome.kind === 'running' && outcome.action === control.action;
        return (
          <button
            key={control.id}
            type="button"
            className="hermes-controls__button hermes-focusable"
            title={control.hint}
            data-hermes-control={control.id}
            data-hermes-risk={control.risk}
            disabled={outcome.kind === 'running'}
            onClick={() => void run(control.action, control.args, control.risk)}
          >
            <span className="hermes-controls__label">{running ? 'Working…' : control.label}</span>
          </button>
        );
      })}
      {outcome.kind === 'error' ? (
        <span className="hermes-controls__message hermes-state-danger" role="alert">
          {outcome.message}
        </span>
      ) : null}
    </div>
  );
}

export default HermesFloatingControls;
