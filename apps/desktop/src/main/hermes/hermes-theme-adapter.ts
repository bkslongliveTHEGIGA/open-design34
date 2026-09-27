// Hermes theme adapter.
//
// Maps the *real* Hermes dashboard theme model onto Design Studio tokens. The
// shape is taken from `web/src/themes/types.ts` and `web/src/themes/presets.ts`
// at the pinned commit, not from a guess:
//
//   • `palette` — a 3-layer triplet (`background` / `midground` / `foreground`),
//     each `{hex, alpha}`. `midground` is "primary text + accent; most UI chrome
//     reads this", and `foreground` is a top-layer highlight that is *invisible
//     by default* (`#ffffff` @ alpha 0). Treating `foreground` as the accent
//     would be the obvious wrong mapping.
//   • `typography` — `fontSans`, `fontMono`, optional `fontDisplay` and
//     `fontUrl`, plus `baseSize` / `lineHeight` / `letterSpacing`.
//   • `layout` — `radius` (a CSS token) and `density`.
//   • `colorOverrides` — an escape hatch pinning specific tokens.
//
// Section 5 makes Hermes authoritative for global theme, so this adapter is
// one-way: Hermes → Design Studio. Design Studio never writes a theme back, and
// never invents a theme when Hermes has none.

/** `web/src/themes/types.ts::ThemeLayer`. */
export interface HermesThemeLayer {
  hex: string;
  alpha: number;
}

/** `web/src/themes/types.ts::ThemeTypography`. */
export interface HermesThemeTypography {
  fontSans: string;
  fontMono: string;
  fontDisplay?: string;
  fontUrl?: string;
  baseSize: string;
  lineHeight: string;
  letterSpacing: string;
}

/** `web/src/themes/types.ts::ThemeLayout`. */
export interface HermesThemeLayout {
  radius: string;
  density: string;
}

/** `web/src/themes/types.ts::DashboardTheme`, narrowed to what we read. */
export interface HermesTheme {
  name: string;
  label?: string;
  description?: string;
  palette: {
    background: HermesThemeLayer;
    midground: HermesThemeLayer;
    /** Invisible by default (alpha 0); see the module note. */
    foreground: HermesThemeLayer;
    warmGlow?: string;
    noiseOpacity?: number;
  };
  typography: HermesThemeTypography;
  layout: HermesThemeLayout;
  colorOverrides?: Record<string, string>;
  terminalBackground?: string;
}

/**
 * Theme names Hermes ships as presets, from `web/src/themes/presets.ts`.
 *
 * Used to validate a `themeId` arriving over the wire. A name outside this set
 * is still accepted (users can author theme YAML), but it is reported as
 * `custom` so the UI can say so instead of pretending it is a preset.
 */
export const HERMES_THEME_PRESET_NAMES = Object.freeze([
  "default",
  "midnight",
  "ember",
  "mono",
  "cyberpunk",
  "rose",
  "nous-blue",
  "default-large",
] as const);

export function isHermesThemePreset(name: unknown): boolean {
  return typeof name === "string" && (HERMES_THEME_PRESET_NAMES as readonly string[]).includes(name);
}

/** Design Studio's own token set, derived from the Hermes theme. */
export interface DesignStudioThemeTokens {
  /** Source theme name, so the UI can show "Theme: Nous Blue (from Hermes)". */
  sourceThemeName: string;
  isPreset: boolean;
  canvas: string;
  surface: string;
  text: string;
  accent: string;
  /** Alpha-composited accent over the canvas, for chrome that needs a solid color. */
  accentSolid: string;
  fontDisplay: string;
  fontUi: string;
  fontMono: string;
  baseSize: string;
  lineHeight: string;
  letterSpacing: string;
  radius: string;
  density: string;
  /** Pinned overrides, applied last so they win over the derived values. */
  colorOverrides: Record<string, string>;
}

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function isHex(value: unknown): value is string {
  return typeof value === "string" && HEX_PATTERN.test(value.trim());
}

function clampAlpha(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const value = hex.trim().replace(/^#/, "");
  const expanded =
    value.length === 3 || value.length === 4
      ? value
          .slice(0, 3)
          .split("")
          .map((char) => char + char)
          .join("")
      : value.slice(0, 6);
  if (expanded.length !== 6) return null;
  const int = Number.parseInt(expanded, 16);
  if (!Number.isFinite(int)) return null;
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff };
}

/** Composite a layer over the canvas so chrome can use a single solid color. */
export function compositeHermesThemeLayer(layer: HermesThemeLayer, overHex: string): string {
  const alpha = clampAlpha(layer.alpha);
  const base = hexToRgb(overHex);
  const top = hexToRgb(layer.hex);
  if (!base || !top) return isHex(layer.hex) ? layer.hex : overHex;

  const channel = (over: number, under: number): number => Math.round(over * alpha + under * (1 - alpha));
  const toHex = (value: number): string => value.toString(16).padStart(2, "0");

  return `#${toHex(channel(top.r, base.r))}${toHex(channel(top.g, base.g))}${toHex(channel(top.b, base.b))}`;
}

/**
 * Derive Design Studio tokens from a Hermes theme.
 *
 * Returns null when the payload is not a Hermes theme — a missing or malformed
 * theme must leave Design Studio on its own identity rather than silently
 * adopting a half-read one.
 */
export function mapHermesThemeToDesignTokens(payload: unknown): DesignStudioThemeTokens | null {
  if (!payload || typeof payload !== "object") return null;
  const theme = payload as Partial<HermesTheme> & Record<string, unknown>;

  if (typeof theme.name !== "string" || theme.name.trim().length === 0) return null;
  if (!theme.palette || typeof theme.palette !== "object") return null;

  const palette = theme.palette;
  const background = palette.background;
  const midground = palette.midground;
  if (!background || !midground || !isHex(background.hex) || !isHex(midground.hex)) return null;

  const canvas = background.hex.trim();
  const typography = theme.typography;
  const layout = theme.layout;

  return {
    sourceThemeName: theme.name,
    isPreset: isHermesThemePreset(theme.name),
    canvas,
    surface: compositeHermesThemeLayer({ hex: midground.hex, alpha: 0.06 }, canvas),
    text: midground.hex.trim(),
    accent: midground.hex.trim(),
    accentSolid: compositeHermesThemeLayer(midground, canvas),
    fontDisplay: typography?.fontDisplay ?? typography?.fontSans ?? "inherit",
    fontUi: typography?.fontSans ?? "inherit",
    fontMono: typography?.fontMono ?? "inherit",
    baseSize: typography?.baseSize ?? "16px",
    lineHeight: typography?.lineHeight ?? "1.5",
    letterSpacing: typography?.letterSpacing ?? "normal",
    radius: layout?.radius ?? "0",
    density: layout?.density ?? "default",
    colorOverrides:
      theme.colorOverrides && typeof theme.colorOverrides === "object" && !Array.isArray(theme.colorOverrides)
        ? { ...theme.colorOverrides }
        : {},
  };
}

/**
 * CSS custom properties for the renderer.
 *
 * Prefixed `--hermes-*` so a Hermes-driven theme is visible in devtools as
 * exactly that, and cannot collide with Design Studio's own tokens.
 */
export function designThemeTokensToCssVariables(tokens: DesignStudioThemeTokens): Record<string, string> {
  return {
    "--hermes-theme-name": tokens.sourceThemeName,
    "--hermes-canvas": tokens.canvas,
    "--hermes-surface": tokens.surface,
    "--hermes-text": tokens.text,
    "--hermes-accent": tokens.accent,
    "--hermes-accent-solid": tokens.accentSolid,
    "--hermes-font-display": tokens.fontDisplay,
    "--hermes-font-ui": tokens.fontUi,
    "--hermes-font-mono": tokens.fontMono,
    "--hermes-base-size": tokens.baseSize,
    "--hermes-line-height": tokens.lineHeight,
    "--hermes-letter-spacing": tokens.letterSpacing,
    "--hermes-radius": tokens.radius,
    "--hermes-density": tokens.density,
    ...Object.fromEntries(
      Object.entries(tokens.colorOverrides).map(([key, value]) => [`--hermes-override-${key}`, value]),
    ),
  };
}

/** True when two token sets differ in anything the renderer paints. */
export function designThemeTokensChanged(
  previous: DesignStudioThemeTokens | null,
  next: DesignStudioThemeTokens | null,
): boolean {
  if (previous === next) return false;
  if (!previous || !next) return true;
  return (
    previous.sourceThemeName !== next.sourceThemeName ||
    previous.canvas !== next.canvas ||
    previous.surface !== next.surface ||
    previous.text !== next.text ||
    previous.accent !== next.accent ||
    previous.fontDisplay !== next.fontDisplay ||
    previous.fontUi !== next.fontUi ||
    previous.fontMono !== next.fontMono ||
    previous.baseSize !== next.baseSize ||
    previous.lineHeight !== next.lineHeight ||
    previous.letterSpacing !== next.letterSpacing ||
    previous.radius !== next.radius ||
    previous.density !== next.density
  );
}
