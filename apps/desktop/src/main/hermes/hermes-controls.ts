// The floating Design Studio controls that appear above the Hermes prompt bar.
//
// Section 11's constraint is the important one: "These controls must be actual
// functional controls connected to Design Studio actions. Do not create
// decorative UI that has no backend behavior."
//
// So a control *is* an action binding plus presentation metadata — there is no
// way to declare a control without naming the `designStudio.*` action it
// dispatches. `controlsForTask` then filters to what the action registry says is
// currently permitted and handled, which means a control that cannot work in the
// present state is absent rather than greyed-out-and-broken.

import {
  HERMES_DESIGN_STUDIO_ACTIONS,
  hermesActionRisk,
  type HermesDesignStudioActionName,
} from "./hermes-actions.js";
import { HERMES_BRAND_COLORS } from "./hermes-brand.js";
import type { HermesActionRisk } from "./hermes-permissions.js";

/** Where a control renders relative to the composer. */
export type HermesControlSlot =
  /** Inline chips above the prompt bar. */
  | "composer-bar"
  /** A small floating card (previews, comparisons). */
  | "floating-card";

export interface HermesFloatingControl {
  /** Stable id for analytics and e2e selectors. */
  id: string;
  label: string;
  /** The action this control dispatches. Required — see module note. */
  action: HermesDesignStudioActionName;
  slot: HermesControlSlot;
  risk: HermesActionRisk;
  /** Short affordance text shown on hover. */
  hint: string;
  /** Render order within the slot. */
  order: number;
  /** Only offer when the task is in this state. */
  when: readonly HermesTaskState[];
  /** Arguments supplied verbatim with the dispatch. */
  args?: Record<string, unknown>;
}

/** The lifecycle of a Design Studio task, as the controls see it. */
export const HERMES_TASK_STATES = Object.freeze([
  "idle",
  "generating",
  "ready",
  "comparing",
  "failed",
  "paused",
  "exported",
] as const);

export type HermesTaskState = (typeof HERMES_TASK_STATES)[number];

const ALL_STATES: readonly HermesTaskState[] = HERMES_TASK_STATES;

/**
 * The control set.
 *
 * Labels are the section-11 examples (Design, Generate, Variant, Refine,
 * Preview, Compare, Export, Send to Code) plus the lifecycle controls the
 * existing OpenDesign architecture already supports, so a task can be paused,
 * resumed or cancelled from the same bar.
 */
export const HERMES_FLOATING_CONTROLS: readonly HermesFloatingControl[] = Object.freeze([
  {
    id: "design",
    label: "Design",
    action: "create",
    slot: "composer-bar",
    risk: hermesActionRisk("create"),
    hint: "Start a new design",
    order: 10,
    when: ["idle", "failed"],
  },
  {
    id: "generate",
    label: "Generate",
    action: "generate",
    slot: "composer-bar",
    risk: hermesActionRisk("generate"),
    hint: "Run the design agent",
    order: 20,
    when: ["idle", "ready", "failed"],
  },
  {
    id: "variant",
    label: "Variant",
    action: "generateVariant",
    slot: "composer-bar",
    risk: hermesActionRisk("generateVariant"),
    hint: "Create an alternate version",
    order: 30,
    when: ["ready", "comparing"],
  },
  {
    id: "refine",
    label: "Refine",
    action: "edit",
    slot: "composer-bar",
    risk: hermesActionRisk("edit"),
    hint: "Adjust the current design",
    order: 40,
    when: ["ready", "comparing", "exported"],
  },
  {
    id: "preview",
    label: "Preview",
    action: "preview",
    slot: "floating-card",
    risk: hermesActionRisk("preview"),
    hint: "Float a preview above the composer",
    order: 50,
    when: ["ready", "comparing", "exported"],
  },
  {
    id: "compare",
    label: "Compare",
    action: "compare",
    slot: "floating-card",
    risk: hermesActionRisk("compare"),
    hint: "Show variants side by side",
    order: 60,
    when: ["ready", "comparing"],
  },
  {
    id: "export",
    label: "Export",
    action: "export",
    slot: "composer-bar",
    risk: hermesActionRisk("export"),
    hint: "Export the design",
    order: 70,
    when: ["ready", "comparing", "exported"],
  },
  {
    id: "send-to-code",
    label: "Send to Code",
    action: "sendToCode",
    slot: "composer-bar",
    risk: hermesActionRisk("sendToCode"),
    hint: "Hand off to Hermes Code",
    order: 80,
    when: ["ready", "comparing", "exported"],
  },
  {
    id: "approve",
    label: "Approve",
    action: "approve",
    slot: "composer-bar",
    risk: hermesActionRisk("approve"),
    hint: "Mark this design approved",
    order: 85,
    when: ["ready", "comparing"],
  },
  {
    id: "pause",
    label: "Pause",
    action: "pause",
    slot: "composer-bar",
    risk: hermesActionRisk("pause"),
    hint: "Pause the running task",
    order: 90,
    when: ["generating"],
  },
  {
    id: "resume",
    label: "Resume",
    action: "resume",
    slot: "composer-bar",
    risk: hermesActionRisk("resume"),
    hint: "Resume the paused task",
    order: 100,
    when: ["paused"],
  },
  {
    id: "cancel",
    label: "Cancel",
    action: "cancel",
    slot: "composer-bar",
    risk: hermesActionRisk("cancel"),
    hint: "Cancel the running task",
    order: 110,
    when: ["generating", "paused"],
  },
  {
    id: "status",
    label: "Status",
    action: "getStatus",
    slot: "floating-card",
    risk: hermesActionRisk("getStatus"),
    hint: "Show task status",
    order: 120,
    when: ALL_STATES,
  },
]);

/**
 * Controls to show for a task in `state`, restricted to what is actually
 * available.
 *
 * `available` is the action registry's own answer (`availableActions()`), so a
 * control disappears when its handler is missing or Hermes has not granted the
 * permission — the bar never offers something that would fail.
 */
export function controlsForTask(
  state: HermesTaskState,
  available: readonly HermesDesignStudioActionName[],
): HermesFloatingControl[] {
  return HERMES_FLOATING_CONTROLS.filter(
    (control) => control.when.includes(state) && available.includes(control.action),
  ).sort((left, right) => left.order - right.order);
}

/** Split a control list by slot, for the two render surfaces. */
export function groupControlsBySlot(
  controls: readonly HermesFloatingControl[],
): Record<HermesControlSlot, HermesFloatingControl[]> {
  return {
    "composer-bar": controls.filter((control) => control.slot === "composer-bar"),
    "floating-card": controls.filter((control) => control.slot === "floating-card"),
  };
}

/**
 * Presentation tokens for the floating surfaces.
 *
 * The spec asks for controls that "animate subtly" and a UI that "feels
 * lightweight rather than like a second full application layered on top". These
 * are the values that produce that: a small radius, a short duration and a
 * translucent card so the composer stays visible underneath.
 */
export const HERMES_CONTROL_PRESENTATION = Object.freeze({
  /** Card corner radius. */
  radius: "12px",
  /** Entrance/exit duration; long enough to read as motion, short enough not to wait on. */
  transitionMs: 160,
  /** Easing; a slight overshoot reads as responsive without bouncing. */
  easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  /** Vertical offset the controls rise from. */
  risePx: 6,
  /** Card translucency over the composer. */
  cardBackground: "rgba(255, 255, 255, 0.92)",
  cardBorder: `1px solid ${HERMES_BRAND_COLORS.neutralLightest}`,
  chipBackground: HERMES_BRAND_COLORS.white,
  chipBackgroundHover: HERMES_BRAND_COLORS.light,
  chipForeground: HERMES_BRAND_COLORS.primary,
  chipAccent: HERMES_BRAND_COLORS.accent,
  /** Shadow that lifts the card without a hard edge. */
  cardShadow: "0 8px 24px rgba(0, 0, 242, 0.10)",
} as const);

/**
 * The inline card Hermes Chat renders for a Design Studio result.
 *
 * Section 10's action list. Like the floating controls, every entry is an action
 * binding, so the card cannot offer an action the bridge cannot perform.
 */
export interface HermesChatCardAction {
  id: string;
  label: string;
  action: HermesDesignStudioActionName;
  /** Shown as the secondary style; the first primary leads the card. */
  primary: boolean;
}

export const HERMES_CHAT_CARD_ACTIONS: readonly HermesChatCardAction[] = Object.freeze([
  { id: "open", label: "Open in Design Studio", action: "open", primary: true },
  { id: "edit", label: "Edit", action: "edit", primary: false },
  { id: "variant", label: "Create Variant", action: "generateVariant", primary: false },
  { id: "compare", label: "Compare", action: "compare", primary: false },
  { id: "approve", label: "Approve", action: "approve", primary: false },
  { id: "export", label: "Export", action: "export", primary: false },
  { id: "send-to-code", label: "Send to Hermes Code", action: "sendToCode", primary: false },
]);

export function chatCardActionsFor(available: readonly HermesDesignStudioActionName[]): HermesChatCardAction[] {
  return HERMES_CHAT_CARD_ACTIONS.filter((entry) => available.includes(entry.action));
}

/**
 * Sanity check that every declared control binds a real action.
 *
 * Wired into the test suite: adding a control whose action does not exist would
 * otherwise be a silent no-op button — exactly the decorative UI section 11
 * forbids.
 */
export function validateFloatingControls(): string[] {
  const problems: string[] = [];
  const known = new Set(Object.keys(HERMES_DESIGN_STUDIO_ACTIONS));

  for (const control of HERMES_FLOATING_CONTROLS) {
    if (!known.has(control.action)) {
      problems.push(`control "${control.id}" binds unknown action "${control.action}"`);
    }
    if (control.when.length === 0) {
      problems.push(`control "${control.id}" can never be shown (empty \`when\`)`);
    }
    if (control.label.trim().length === 0) {
      problems.push(`control "${control.id}" has an empty label`);
    }
  }

  for (const entry of HERMES_CHAT_CARD_ACTIONS) {
    if (!known.has(entry.action)) {
      problems.push(`chat card action "${entry.id}" binds unknown action "${entry.action}"`);
    }
  }

  const ids = HERMES_FLOATING_CONTROLS.map((control) => control.id);
  for (const id of new Set(ids)) {
    if (ids.filter((entry) => entry === id).length > 1) problems.push(`duplicate control id "${id}"`);
  }

  return problems;
}
