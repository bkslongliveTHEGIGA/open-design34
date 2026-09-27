/**
 * Hermes Status Indicator - Shows connection state
 * Clearly shows: "Hermes connected" or "Hermes unavailable" or "Standalone mode"
 * Do not make standalone mode feel like an error state.
 */

import React from "react";
import { useHermes } from "./HermesProvider";
import { HERMES_CONNECTION_STATES } from "./types";

export function HermesStatusIndicator() {
  const { status, isConnected, isStandalone, connectionState, reconnect } = useHermes();

  const getStatusConfig = () => {
    switch (connectionState) {
      case HERMES_CONNECTION_STATES.CONNECTED:
        return {
          label: "Hermes connected",
          color: "#0000F2",
          bgColor: "#E9ECEF",
          dotColor: "#0000F2",
          description: status.project ? `Project: ${status.project.name}` : "Connected to Hermes",
        };
      case HERMES_CONNECTION_STATES.RUNNING:
        return {
          label: "Hermes running",
          color: "#1A1AFF",
          bgColor: "#E9ECEF",
          dotColor: "#1A1AFF",
          description: "Hermes detected, connecting...",
        };
      case HERMES_CONNECTION_STATES.INSTALLED_NOT_RUNNING:
        return {
          label: "Hermes installed",
          color: "#A0A0A0",
          bgColor: "#F5F5F5",
          dotColor: "#A0A0A0",
          description: "Hermes installed but not running",
        };
      case HERMES_CONNECTION_STATES.CONNECTION_LOST:
        return {
          label: "Hermes connection lost",
          color: "#FF4444",
          bgColor: "#FFEEEE",
          dotColor: "#FF4444",
          description: "Attempting to reconnect...",
        };
      case HERMES_CONNECTION_STATES.RECONNECTING:
        return {
          label: "Reconnecting to Hermes",
          color: "#1A1AFF",
          bgColor: "#E9ECEF",
          dotColor: "#1A1AFF",
          description: "Reconnecting...",
        };
      case HERMES_CONNECTION_STATES.NOT_INSTALLED:
      default:
        return {
          label: "Standalone mode",
          color: "#3333FF",
          bgColor: "#F5F5F5",
          dotColor: "#D0D0D0",
          description: "Hermes unavailable - running standalone",
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div
      className="hermes-status-indicator"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 12px",
        borderRadius: "20px",
        backgroundColor: config.bgColor,
        border: `1px solid ${config.dotColor}20`,
        fontSize: "12px",
        fontFamily: "Rules, system-ui, sans-serif",
        cursor: connectionState === HERMES_CONNECTION_STATES.CONNECTION_LOST ? "pointer" : "default",
      }}
      onClick={() => {
        if (connectionState === HERMES_CONNECTION_STATES.CONNECTION_LOST) {
          void reconnect();
        }
      }}
      title={config.description}
    >
      <span
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          backgroundColor: config.dotColor,
          display: "inline-block",
          animation:
            connectionState === HERMES_CONNECTION_STATES.RECONNECTING ||
            connectionState === HERMES_CONNECTION_STATES.CONNECTION_LOST
              ? "pulse 1.5s infinite"
              : "none",
        }}
      />
      <span style={{ color: config.color, fontWeight: 500 }}>{config.label}</span>
      {status.model && isConnected && (
        <span style={{ color: "#A0A0A0", marginLeft: "4px" }}>{status.model.label || status.model.id}</span>
      )}
    </div>
  );
}

export function HermesConnectionBanner() {
  const { isStandalone, connectionState } = useHermes();

  if (!isStandalone && connectionState !== HERMES_CONNECTION_STATES.CONNECTION_LOST) {
    return null;
  }

  if (connectionState === HERMES_CONNECTION_STATES.CONNECTION_LOST) {
    return (
      <div
        style={{
          padding: "8px 16px",
          backgroundColor: "#FFF3CD",
          borderBottom: "1px solid #FFE69C",
          fontSize: "13px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: "Rules, system-ui, sans-serif",
        }}
      >
        <span>Hermes connection lost. Attempting to reconnect automatically...</span>
      </div>
    );
  }

  // Standalone mode - subtle, not error
  return (
    <div
      style={{
        padding: "6px 16px",
        backgroundColor: "#F5F5F5",
        borderBottom: "1px solid #E9ECEF",
        fontSize: "12px",
        color: "#A0A0A0",
        fontFamily: "Rules, system-ui, sans-serif",
      }}
    >
      Running in standalone mode. Install Hermes for full ecosystem features.
    </div>
  );
}
