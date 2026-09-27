/**
 * Hermes Theme Control
 * When Hermes is connected: Hermes global theme should synchronize into Design Studio
 * When disconnected: Design Studio uses default theme
 * Visual identity: Primary #0000F2, Light #F5F5F5, White #FFFFFF, Accent #EDFF45
 */

import React, { createContext, useContext, useEffect, useState } from "react";
import { useHermes } from "./HermesProvider.js";
import { HERMES_BRAND, HERMES_THEME_CSS_VARS } from "./types.js";

export interface HermesThemeContextValue {
  isHermesThemeActive: boolean;
  primaryColor: string;
  accentColor: string;
  applyHermesTheme: () => void;
  applyDefaultTheme: () => void;
}

const HermesThemeContext = createContext<HermesThemeContextValue>({
  isHermesThemeActive: false,
  primaryColor: HERMES_BRAND.primaryColor,
  accentColor: HERMES_BRAND.accentColor,
  applyHermesTheme: () => {},
  applyDefaultTheme: () => {},
});

export function useHermesTheme() {
  return useContext(HermesThemeContext);
}

function applyCssVars(vars: Record<string, string>) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}

function removeCssVars(vars: Record<string, string>) {
  const root = document.documentElement;
  for (const key of Object.keys(vars)) {
    root.style.removeProperty(key);
  }
}

export function HermesThemeProvider({ children }: { children: React.ReactNode }) {
  const { status, isConnected } = useHermes();
  const [isHermesThemeActive, setIsHermesThemeActive] = useState(false);

  const applyHermesTheme = () => {
    applyCssVars(HERMES_THEME_CSS_VARS);

    // Also apply Hermes global theme if available
    if (status.theme?.colors) {
      const colors = status.theme.colors;
      applyCssVars({
        "--hermes-primary": colors.primary || HERMES_BRAND.primaryColor,
        "--hermes-accent": colors.accent || HERMES_BRAND.accentColor,
        "--hermes-light": colors.light || HERMES_BRAND.lightColor,
        "--hermes-white": colors.white || HERMES_BRAND.whiteColor,
      });
    }

    // Apply typography
    const root = document.documentElement;
    root.style.setProperty("--font-display", `${HERMES_BRAND.typography.display}, serif`);
    root.style.setProperty("--font-ui", `${HERMES_BRAND.typography.ui}, system-ui, sans-serif`);
    root.style.setProperty("--font-technical", `${HERMES_BRAND.typography.technical}, monospace`);

    // Add class for theme-specific styling
    root.classList.add("hermes-theme-active");
    setIsHermesThemeActive(true);
  };

  const applyDefaultTheme = () => {
    // Keep Hermes brand colors as default (per STEP 15)
    applyCssVars(HERMES_THEME_CSS_VARS);
    const root = document.documentElement;
    root.style.setProperty("--font-display", `${HERMES_BRAND.typography.display}, serif`);
    root.style.setProperty("--font-ui", `${HERMES_BRAND.typography.ui}, system-ui, sans-serif`);
    root.style.setProperty("--font-technical", `${HERMES_BRAND.typography.technical}, monospace`);
    root.classList.add("hermes-theme-active");
    setIsHermesThemeActive(true);
  };

  useEffect(() => {
    // Always apply Hermes Design Studio default theme
    // When connected, Hermes global theme synchronizes into Design Studio
    if (isConnected && status.theme) {
      applyHermesTheme();
    } else {
      applyDefaultTheme();
    }
  }, [isConnected, status.theme]);

  // Also inject global styles for Hermes branding
  useEffect(() => {
    const styleId = "hermes-design-studio-theme";
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;

    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    styleEl.textContent = `
      :root {
        --hermes-primary: ${HERMES_BRAND.primaryColor};
        --hermes-light: ${HERMES_BRAND.lightColor};
        --hermes-white: ${HERMES_BRAND.whiteColor};
        --hermes-accent: ${HERMES_BRAND.accentColor};
      }
      
      /* Hermes Design Studio brand transformation */
      .hermes-theme-active {
        --accent: var(--hermes-primary);
        --accent-strong: var(--hermes-primary);
      }

      /* Primary buttons use Hermes primary */
      .hermes-theme-active button[data-primary="true"],
      .hermes-theme-active .btn-primary {
        background-color: var(--hermes-primary) !important;
        color: var(--hermes-white) !important;
      }

      /* Accent highlights */
      .hermes-theme-active .accent-highlight {
        background-color: var(--hermes-accent);
        color: var(--hermes-primary);
      }

      /* Typography */
      .hermes-theme-active h1, .hermes-theme-active h2, .hermes-theme-active .display-text {
        font-family: var(--font-display, 'Sigurd', serif);
      }
      
      .hermes-theme-active body, .hermes-theme-active .ui-text {
        font-family: var(--font-ui, 'Rules', system-ui, sans-serif);
      }
      
      .hermes-theme-active code, .hermes-theme-active .technical-text {
        font-family: var(--font-technical, 'Courier Prime', monospace);
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      /* Floating ecosystem UX */
      .hermes-floating-card {
        background: var(--hermes-white);
        border: 1px solid var(--hermes-primary);
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0, 0, 242, 0.15);
        animation: floatIn 0.3s ease-out;
      }

      @keyframes floatIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;

    return () => {
      // Keep theme styles
    };
  }, []);

  return (
    <HermesThemeContext.Provider
      value={{
        isHermesThemeActive,
        primaryColor: HERMES_BRAND.primaryColor,
        accentColor: HERMES_BRAND.accentColor,
        applyHermesTheme,
        applyDefaultTheme,
      }}
    >
      {children}
    </HermesThemeContext.Provider>
  );
}
