// Hermes Design Studio ⇄ Hermes integration layer.
//
// This directory is the *only* place that knows Hermes exists. Everything the
// rest of Design Studio needs comes through `createHermesBridge`, the action
// registry, and the event bus; nothing else imports a Hermes type.
//
// Deliberately electron-free. Every module here is pure or dependency-injected,
// which is both this repository's existing convention (`invite-deeplink-core.ts`)
// and upstream Hermes' own (`backend-discovery.ts`: "pure / dependency-injected
// so the decision is testable without Electron"). It also means the whole
// integration is unit-testable without a Hermes installation present.
//
// Layout:
//   upstream-pin.ts            the pinned Hermes commit + the surface it uses
//   hermes-paths.ts            HERMES_HOME, machine root, control-socket paths
//   hermes-discovery.ts        spawn-ledger parsing + ordered discovery
//   hermes-control-protocol.ts the `identify`/`status` wire format
//   hermes-control-client.ts   unix socket / named-pipe transport
//   hermes-runtime-adapter.ts  loopback HTTP (`/api/status`, `/api/model/*`)
//   hermes-context.ts          the shared context object
//   hermes-permissions.ts      Hermes approval-mode gate
//   hermes-actions.ts          `designStudio.*` registry + intent matching
//   hermes-events.ts           typed events over `/api/pub`
//   hermes-model-adapter.ts    read-only model sync
//   hermes-theme-adapter.ts    Hermes theme → Design Studio tokens
//   hermes-artifact-adapter.ts artifact descriptors + Hermes Code handoff
//   hermes-bridge.ts           lifecycle: discover → connect → sync → reconnect
//   hermes-deeplink.ts         `hermes://design-studio/*` parsing and planning
//   hermes-controls.ts         the floating composer controls
//   hermes-brand.ts            product identity, palette, fonts

export * from "./upstream-pin.js";
export * from "./hermes-paths.js";
export * from "./hermes-discovery.js";
export * from "./hermes-control-protocol.js";
export * from "./hermes-control-client.js";
export * from "./hermes-runtime-adapter.js";
export * from "./hermes-context.js";
export * from "./hermes-permissions.js";
export * from "./hermes-actions.js";
export * from "./hermes-events.js";
export * from "./hermes-model-adapter.js";
export * from "./hermes-theme-adapter.js";
export * from "./hermes-artifact-adapter.js";
export * from "./hermes-bridge.js";
export * from "./hermes-deeplink.js";
export * from "./hermes-controls.js";
export * from "./hermes-brand.js";
