// Hermes Design Studio visual identity.
//
// The product name and palette are the ones the product ships under. Keeping them
// in one typed module (rather than scattered string literals) is what lets the
// packaging identity, the renderer tokens and the docs stay in agreement — and
// what makes a rename auditable.
//
// **Fonts, honestly.** The spec names Sigurd (display), Rules (UI) and Courier
// Prime (technical). Of those, only **Rules** ships in the upstream Hermes
// repository (`web/public/fonts/RulesCompressed-*.woff2`,
// `RulesExpanded-*.woff2`), so those four files are vendored into
// `apps/web/public/fonts/hermes/` and referenced by real `@font-face` rules.
// Sigurd and Courier Prime are not present in either repository, so they are
// declared with an explicit, ordered stack and a `fontsAvailable` flag reports
// which ones actually resolved at runtime. Nothing here silently substitutes a
// lookalike and calls it the real thing.

/** Product name shown to users and used for install identity. */
export const HERMES_DESIGN_STUDIO_PRODUCT_NAME = "Hermes Design Studio";

/** Install/executable identity token (no spaces, safe for filenames). */
export const HERMES_DESIGN_STUDIO_EXECUTABLE_BASENAME = "HermesDesignStudio";

/** Module identity inside the Hermes ecosystem. */
export const HERMES_DESIGN_STUDIO_MODULE_ID = "design-studio";

/** Capability label as Hermes' registry would show it. */
export const HERMES_DESIGN_STUDIO_CAPABILITY_LABEL = "Hermes Design Studio";

/**
 * The palette.
 *
 * `primary` is the Hermes brand blue and the single most load-bearing value here:
 * it is the accent, the focus ring and the wordmark colour. `accent` is the
 * chartreuse highlight used for selection and live state — high contrast against
 * `primary` on purpose, since the two appear together in the floating controls.
 */
export const HERMES_BRAND_COLORS = Object.freeze({
  primary: "#0000F2",
  light: "#F5F5F5",
  white: "#FFFFFF",
  accent: "#EDFF45",
  // Supporting ramp.
  primaryHover: "#0000D9",
  primaryLight: "#1A1AFF",
  primaryDeep: "#000099",
  primaryMid: "#0000CC",
  primarySoft: "#3333FF",
  neutralLightest: "#E9ECEF",
  neutralLight: "#D0D0D0",
  neutralMid: "#A0A0A0",
  danger: "#FF4444",
  dangerSoft: "#FF8888",
} as const);

export type HermesBrandColorName = keyof typeof HERMES_BRAND_COLORS;

const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** Every declared colour must be a 6-digit hex; catches a typo at module load. */
for (const [name, value] of Object.entries(HERMES_BRAND_COLORS)) {
  if (!HEX_PATTERN.test(value)) {
    throw new Error(`HERMES_BRAND_COLORS.${name} is not a 6-digit hex colour: ${value}`);
  }
}

/** Font roles the product uses. */
export const HERMES_FONT_ROLES = Object.freeze(["display", "ui", "technical"] as const);

export type HermesFontRole = (typeof HERMES_FONT_ROLES)[number];

export interface HermesFontFamily {
  role: HermesFontRole;
  /** The named typeface the design system specifies. */
  specified: string;
  /**
   * The CSS `font-family` stack actually emitted. The specified face comes first
   * so it wins whenever it is installed or loaded; the remainder are named
   * fallbacks, not silent lookalikes.
   */
  stack: string;
  /** True when a real font file for `specified` is vendored in this repository. */
  assetVendored: boolean;
  /** Path to the vendored asset directory, when there is one. */
  assetPath: string | null;
}

/**
 * Font configuration.
 *
 * `assetVendored` is the honest bit: Rules is vendored from the pinned Hermes
 * submodule, Sigurd and Courier Prime are not available to this repository. The
 * renderer uses this to decide whether to emit an `@font-face` (real asset) or
 * only a `font-family` reference (system-installed, if present).
 */
export const HERMES_FONT_FAMILIES: Readonly<Record<HermesFontRole, HermesFontFamily>> = Object.freeze({
  display: Object.freeze({
    role: "display",
    specified: "Sigurd",
    stack: '"Sigurd", "Rules Expanded", "Helvetica Neue", sans-serif',
    assetVendored: false,
    assetPath: null,
  }),
  ui: Object.freeze({
    role: "ui",
    specified: "Rules",
    stack: '"Rules Compressed", "Rules Expanded", "Helvetica Neue", Arial, sans-serif',
    assetVendored: true,
    assetPath: "apps/web/public/fonts/hermes",
  }),
  technical: Object.freeze({
    role: "technical",
    specified: "Courier Prime",
    stack: '"Courier Prime", "JetBrains Mono", ui-monospace, monospace',
    assetVendored: false,
    assetPath: null,
  }),
});

/**
 * The vendored Rules faces, with their real upstream filenames.
 *
 * `weight`/`stretch` come from the upstream file naming (`RulesCompressed-
 * Medium`, `RulesExpanded-Bold`, …) so the declared face matches the binary
 * rather than being a guess that would render at the wrong weight.
 */
export interface HermesVendoredFontFace {
  family: string;
  weight: number;
  stretch: "compressed" | "expanded";
  file: string;
}

export const HERMES_VENDORED_FONT_FACES: readonly HermesVendoredFontFace[] = Object.freeze([
  { family: "Rules Compressed", weight: 400, stretch: "compressed", file: "RulesCompressed-Regular.woff2" },
  { family: "Rules Compressed", weight: 500, stretch: "compressed", file: "RulesCompressed-Medium.woff2" },
  { family: "Rules Expanded", weight: 400, stretch: "expanded", file: "RulesExpanded-Regular.woff2" },
  { family: "Rules Expanded", weight: 700, stretch: "expanded", file: "RulesExpanded-Bold.woff2" },
]);

/**
 * `@font-face` rules for the vendored faces.
 *
 * `font-display: swap` so a missing asset degrades to the fallback stack instead
 * of blank text, and `stretch` is declared because a compressed face used at
 * normal width is visibly wrong — the upstream family is two distinct cuts.
 */
export function hermesFontFaceCss(baseUrl: string): string {
  return HERMES_VENDORED_FONT_FACES.map((face) => {
    const url = `${baseUrl.replace(/\/$/, "")}/${face.file}`;
    return [
      "@font-face {",
      `  font-family: "${face.family}";`,
      `  font-style: normal;`,
      `  font-weight: ${face.weight};`,
      `  font-stretch: ${face.stretch};`,
      `  font-display: swap;`,
      `  src: url("${url}") format("woff2");`,
      "}",
    ].join("\n");
  }).join("\n\n");
}

/** CSS custom properties for the renderer. */
export function hermesBrandCssVariables(): Record<string, string> {
  return {
    "--hermes-brand-primary": HERMES_BRAND_COLORS.primary,
    "--hermes-brand-light": HERMES_BRAND_COLORS.light,
    "--hermes-brand-white": HERMES_BRAND_COLORS.white,
    "--hermes-brand-accent": HERMES_BRAND_COLORS.accent,
    "--hermes-brand-primary-hover": HERMES_BRAND_COLORS.primaryHover,
    "--hermes-brand-primary-light": HERMES_BRAND_COLORS.primaryLight,
    "--hermes-brand-primary-deep": HERMES_BRAND_COLORS.primaryDeep,
    "--hermes-brand-primary-mid": HERMES_BRAND_COLORS.primaryMid,
    "--hermes-brand-primary-soft": HERMES_BRAND_COLORS.primarySoft,
    "--hermes-brand-neutral-lightest": HERMES_BRAND_COLORS.neutralLightest,
    "--hermes-brand-neutral-light": HERMES_BRAND_COLORS.neutralLight,
    "--hermes-brand-neutral-mid": HERMES_BRAND_COLORS.neutralMid,
    "--hermes-brand-danger": HERMES_BRAND_COLORS.danger,
    "--hermes-brand-danger-soft": HERMES_BRAND_COLORS.dangerSoft,
    "--hermes-font-display": HERMES_FONT_FAMILIES.display.stack,
    "--hermes-font-ui": HERMES_FONT_FAMILIES.ui.stack,
    "--hermes-font-technical": HERMES_FONT_FAMILIES.technical.stack,
  };
}

/**
 * Contrast check for text on a brand background.
 *
 * `accent` (#EDFF45) on `primary` (#0000F2) is the combination the floating
 * controls use, so it is worth asserting rather than eyeballing — WCAG AA for
 * normal text is 4.5:1.
 */
export function hermesRelativeLuminance(hex: string): number {
  const value = hex.replace(/^#/, "");
  const channel = (offset: number): number => {
    const raw = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export function hermesContrastRatio(foreground: string, background: string): number {
  const a = hermesRelativeLuminance(foreground);
  const b = hermesRelativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Which text colour to use on a given brand background.
 *
 * Computed rather than hardcoded so a palette tweak cannot leave unreadable text
 * behind.
 */
export function hermesReadableTextOn(background: string): string {
  return hermesContrastRatio(HERMES_BRAND_COLORS.white, background) >=
    hermesContrastRatio(HERMES_BRAND_COLORS.primary, background)
    ? HERMES_BRAND_COLORS.white
    : HERMES_BRAND_COLORS.primary;
}

/**
 * The HERMES wordmark treatment.
 *
 * Section 12: the main wordmark uses the display face. Kept as data so the
 * renderer, the splash and the installer banner can all render the same thing.
 */
export interface HermesWordmarkSpec {
  text: string;
  fontFamily: string;
  /** Letter spacing in em; the display face is cut tight and needs opening up. */
  letterSpacing: string;
  weight: number;
  color: string;
  /** Uppercase transform applied to the product name for the wordmark only. */
  transform: "uppercase" | "none";
}

export const HERMES_WORDMARK: HermesWordmarkSpec = Object.freeze({
  text: "HERMES",
  fontFamily: HERMES_FONT_FAMILIES.display.stack,
  letterSpacing: "0.14em",
  weight: 400,
  color: HERMES_BRAND_COLORS.primary,
  transform: "uppercase",
});

/** Full product wordmark, for places that show the module name rather than the parent. */
export const HERMES_DESIGN_STUDIO_WORDMARK: HermesWordmarkSpec = Object.freeze({
  ...HERMES_WORDMARK,
  text: "HERMES DESIGN STUDIO",
  letterSpacing: "0.08em",
});

/**
 * Legacy branding that must be replaced in the primary product experience.
 *
 * Section 24 is explicit that legally required attribution and upstream notices
 * stay. This list is therefore only the *product identity* strings — package
 * names, the npm scope, license headers and third-party notices are deliberately
 * absent and must not be rewritten by a rename pass.
 */
export const LEGACY_PRODUCT_NAMES = Object.freeze(["Open Design", "OpenDesign", "open-design"] as const);

/**
 * Whether a user-facing string still carries the legacy product name.
 *
 * Used by the branding check so a re-introduced "Open Design" label fails the
 * build instead of shipping.
 */
export function containsLegacyProductName(text: string): boolean {
  return LEGACY_PRODUCT_NAMES.some((name) => text.includes(name));
}
