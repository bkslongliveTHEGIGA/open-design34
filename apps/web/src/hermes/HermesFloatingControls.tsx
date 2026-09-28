/**
 * Floating Ecosystem UX
 * When invoked from Hermes: display contextual Design Studio controls
 * Support floating action cards above the Hermes prompt
 * Support subtle animation, show live generation state, previews inline
 */

import React, { useState, useEffect } from "react";
import { useHermes } from "./HermesProvider";

export interface FloatingAction {
  id: string;
  label: string;
  icon?: string;
  action: () => void;
  primary?: boolean;
  disabled?: boolean;
}

export interface HermesFloatingControlsProps {
  designId?: string;
  projectId?: string;
  isGenerating?: boolean;
  progress?: number;
  previewUrl?: string;
  actions?: FloatingAction[];
  onOpenInDesignStudio?: () => void;
}

export function HermesFloatingControls({
  designId,
  projectId,
  isGenerating,
  progress,
  previewUrl,
  actions,
  onOpenInDesignStudio,
}: HermesFloatingControlsProps) {
  const { isConnected } = useHermes();
  const [isVisible, setIsVisible] = useState(true);

  if (!isConnected) return null;

  const defaultActions: FloatingAction[] = [
    {
      id: "open",
      label: "Open in Design Studio",
      primary: true,
      action: () => {
        if (onOpenInDesignStudio) onOpenInDesignStudio();
        else if (designId) window.open(`/project/${projectId}/design/${designId}`, "_blank");
      },
    },
    {
      id: "preview",
      label: "Preview",
      action: () => {
        if (previewUrl) window.open(previewUrl, "_blank");
      },
      disabled: !previewUrl,
    },
    {
      id: "export",
      label: "Export",
      action: () => {
        // Trigger export via API
        if (designId) {
          void fetch(`/api/designs/${designId}/export`, { method: "POST" });
        }
      },
    },
  ];

  const allActions = actions || defaultActions;

  return (
    <div
      className="hermes-floating-card"
      style={{
        position: "fixed",
        bottom: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        display: isVisible ? "flex" : "none",
        flexDirection: "column",
        gap: "12px",
        padding: "16px",
        minWidth: "320px",
        maxWidth: "480px",
        zIndex: 10000,
        backgroundColor: "#FFFFFF",
        border: "1px solid #0000F2",
        borderRadius: "12px",
        boxShadow: "0 8px 32px rgba(0, 0, 242, 0.2)",
        fontFamily: "Rules, system-ui, sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "24px",
              height: "24px",
              borderRadius: "6px",
              backgroundColor: "#0000F2",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#FFFFFF",
              fontSize: "12px",
              fontWeight: "bold",
            }}
          >
            H
          </div>
          <span style={{ fontWeight: 600, color: "#0000F2", fontSize: "14px" }}>Design Studio</span>
          {isGenerating && (
            <span
              style={{
                fontSize: "11px",
                color: "#1A1AFF",
                backgroundColor: "#E9ECEF",
                padding: "2px 8px",
                borderRadius: "10px",
                animation: "pulse 1.5s infinite",
              }}
            >
              Generating...
            </span>
          )}
        </div>
        <button
          onClick={() => setIsVisible(false)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#A0A0A0",
            fontSize: "16px",
          }}
        >
          ×
        </button>
      </div>

      {/* Progress */}
      {isGenerating && typeof progress === "number" && (
        <div style={{ width: "100%" }}>
          <div
            style={{
              width: "100%",
              height: "4px",
              backgroundColor: "#E9ECEF",
              borderRadius: "2px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                backgroundColor: "#0000F2",
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <div style={{ fontSize: "11px", color: "#A0A0A0", marginTop: "4px" }}>{progress}% complete</div>
        </div>
      )}

      {/* Preview */}
      {previewUrl && (
        <div
          style={{
            width: "100%",
            height: "120px",
            borderRadius: "8px",
            overflow: "hidden",
            backgroundColor: "#F5F5F5",
            border: "1px solid #E9ECEF",
          }}
        >
          <img
            src={previewUrl}
            alt="Design preview"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {allActions.map((action) => (
          <button
            key={action.id}
            onClick={action.action}
            disabled={action.disabled}
            style={{
              padding: "8px 16px",
              borderRadius: "20px",
              border: action.primary ? "none" : "1px solid #0000F2",
              backgroundColor: action.primary ? "#0000F2" : "#FFFFFF",
              color: action.primary ? "#FFFFFF" : "#0000F2",
              fontSize: "13px",
              fontWeight: 500,
              cursor: action.disabled ? "not-allowed" : "pointer",
              opacity: action.disabled ? 0.5 : 1,
              transition: "all 0.2s ease",
              fontFamily: "Rules, system-ui, sans-serif",
            }}
            onMouseEnter={(e) => {
              if (!action.disabled) {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(0, 0, 242, 0.2)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Inline preview component for Hermes Chat
 */
export function HermesInlinePreview({ previewUrl, designId }: { previewUrl: string; designId?: string }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "400px",
        borderRadius: "12px",
        overflow: "hidden",
        border: "1px solid #E9ECEF",
        backgroundColor: "#F5F5F5",
        position: "relative",
      }}
    >
      {!loaded && (
        <div
          style={{
            width: "100%",
            height: "200px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#A0A0A0",
          }}
        >
          Loading preview...
        </div>
      )}
      <img
        src={previewUrl}
        alt="Design preview"
        style={{
          width: "100%",
          display: loaded ? "block" : "none",
          maxHeight: "400px",
          objectFit: "contain",
        }}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
      {designId && loaded && (
        <div
          style={{
            position: "absolute",
            bottom: "8px",
            right: "8px",
            display: "flex",
            gap: "4px",
          }}
        >
          <button
            style={{
              padding: "4px 12px",
              borderRadius: "16px",
              backgroundColor: "#0000F2",
              color: "#FFFFFF",
              border: "none",
              fontSize: "11px",
              cursor: "pointer",
            }}
            onClick={() => window.open(`/design/${designId}`, "_blank")}
          >
            Open
          </button>
        </div>
      )}
    </div>
  );
}
