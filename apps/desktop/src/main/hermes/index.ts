/**
 * Hermes Design Studio Bridge - Main Export
 * Implements STEP 6: Hermes Bridge
 */

export * from "./types.js";
export * from "./detection.js";
export * from "./context.js";
export * from "./events.js";
export * from "./actions.js";
export * from "./bridge.js";

export { HERMES_DESIGN_STUDIO_THEME, createHermesThemeSync } from "./context.js";

// Re-export bridge as default integration point
import { createHermesBridge, getHermesBridge, resetHermesBridge } from "./bridge.js";

export { createHermesBridge, getHermesBridge, resetHermesBridge };

/**
 * Initialize Hermes Bridge for desktop main process
 * Should be called early in desktop startup
 */
export async function initializeHermesBridge() {
  const bridge = getHermesBridge({
    autoReconnect: true,
    reconnectIntervalMs: 5000,
    maxReconnectAttempts: 50,
  });

  await bridge.start();

  // Log initial status
  const status = bridge.status();
  console.log(`[Hermes Bridge] Initial state: ${status.connectionState}`, {
    isHermesInstalled: status.isHermesInstalled,
    isHermesRunning: status.isHermesRunning,
    endpoint: status.context?.hermesHome,
  });

  return bridge;
}
