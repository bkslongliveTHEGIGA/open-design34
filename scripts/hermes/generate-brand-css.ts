#!/usr/bin/env tsx
/**
 * Generate `apps/web/src/styles/hermes-brand.css` from the single source of
 * truth in `apps/desktop/src/main/hermes/hermes-brand.ts`.
 *
 * The palette, the font stacks and the vendored `@font-face` descriptors all
 * already live in that module, where the Desktop tests assert them. Hand-writing
 * a stylesheet alongside it would give two sources that drift — so this emits
 * the file instead, and the file is checked in because the web build does not
 * run TypeScript from `apps/desktop`.
 *
 * Usage:
 *   pnpm exec tsx scripts/hermes/generate-brand-css.ts [--check]
 *
 * `--check` exits non-zero when the committed file differs from what would be
 * generated, which is what CI wants.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HERMES_BRAND_COLORS,
  HERMES_DESIGN_STUDIO_PRODUCT_NAME,
  HERMES_FONT_FAMILIES,
  HERMES_VENDORED_FONT_FACES,
  HERMES_WORDMARK,
  hermesBrandCssVariables,
  hermesFontFaceCss,
} from "../../apps/desktop/src/main/hermes/hermes-brand.ts";
import { HERMES_UPSTREAM_COMMIT } from "../../apps/desktop/src/main/hermes/upstream-pin.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outPath = join(repoRoot, "apps", "web", "src", "styles", "hermes-brand.css");

/**
 * The web app serves `public/` at the site root, so a face vendored at
 * `apps/web/public/fonts/hermes/X.woff2` is fetched from `/fonts/hermes/X.woff2`.
 */
const FONT_BASE_URL = "/fonts/hermes";

function render(): string {
  const variables = hermesBrandCssVariables();
  const variableLines = Object.entries(variables)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");

  const faces = hermesFontFaceCss(FONT_BASE_URL);

  const unvendored = Object.values(HERMES_FONT_FAMILIES)
    .filter((family) => !family.assetVendored)
    .map((family) => ` *   - ${family.role}: "${family.specified}" is not vendored; the stack below resolves to it only if it is installed on the host.`)
    .join("\n");

  const faceList = HERMES_VENDORED_FONT_FACES.map(
    (face) => ` *   - ${face.file} (${face.family}, ${face.weight}, ${face.stretch})`,
  ).join("\n");

  return `/*
 * Hermes Design Studio brand tokens.
 *
 * GENERATED FILE — do not edit by hand.
 * Regenerate with:  pnpm exec tsx scripts/hermes/generate-brand-css.ts
 * Verify with:      pnpm exec tsx scripts/hermes/generate-brand-css.ts --check
 *
 * Source of truth: apps/desktop/src/main/hermes/hermes-brand.ts
 * Upstream Hermes pin: ${HERMES_UPSTREAM_COMMIT}
 *
 * Fonts
 * -----
 * Vendored from the pinned Hermes submodule into apps/web/public/fonts/hermes:
${faceList}
 *
 * Not vendored, and therefore not guaranteed to render:
${unvendored}
 *
 * No silent lookalike substitution happens here: the specified face is always
 * first in the stack, and the fallbacks are named faces rather than a generic
 * guess. If a face is missing the text still renders, in the fallback.
 */

${faces}

:root {
${variableLines}

  /* Wordmarks. The product wordmark is set in the display face per the brand
   * spec; \`letter-spacing\` and \`text-transform\` are part of the lockup, not
   * incidental styling. */
  --hermes-wordmark-text: ${HERMES_WORDMARK.text};
  --hermes-wordmark-font: ${HERMES_WORDMARK.fontFamily};
  --hermes-wordmark-weight: ${HERMES_WORDMARK.weight};
  --hermes-wordmark-letter-spacing: ${HERMES_WORDMARK.letterSpacing};
  --hermes-wordmark-transform: ${HERMES_WORDMARK.transform};
  --hermes-product-name: "${HERMES_DESIGN_STUDIO_PRODUCT_NAME}";
}

/* The HERMES wordmark. */
.hermes-wordmark {
  font-family: var(--hermes-wordmark-font);
  font-weight: var(--hermes-wordmark-weight);
  letter-spacing: var(--hermes-wordmark-letter-spacing);
  text-transform: var(--hermes-wordmark-transform);
  color: var(--hermes-brand-primary);
  /* The lockup is a brand mark, not body copy: keep it out of translation and
   * out of hyphenation. */
  white-space: nowrap;
  hyphens: none;
}

/* The full product name, used where the wordmark alone is ambiguous. */
.hermes-product-name {
  font-family: var(--hermes-font-ui);
  font-weight: 500;
  color: var(--hermes-brand-primary);
}

/* Role helpers. These are the only places the font stacks should be consumed,
 * so a stack change lands everywhere at once. */
.hermes-font-display { font-family: var(--hermes-font-display); }
.hermes-font-ui { font-family: var(--hermes-font-ui); }
.hermes-font-technical { font-family: var(--hermes-font-technical); }

/*
 * Accent-on-primary is the combination the floating Design Studio controls use
 * (chartreuse on Hermes blue). apps/desktop/tests/main/hermes/
 * hermes-deeplink-controls-brand.test.ts asserts this pair clears WCAG AA for
 * normal text, so the values below are not free to change independently.
 */
.hermes-surface-primary {
  background-color: var(--hermes-brand-primary);
  color: var(--hermes-brand-accent);
}

.hermes-surface-light {
  background-color: var(--hermes-brand-light);
  color: var(--hermes-brand-primary);
}

/* Focus ring: primary blue on light, accent on primary. */
.hermes-focusable:focus-visible {
  outline: 2px solid var(--hermes-brand-primary);
  outline-offset: 2px;
}

.hermes-surface-primary .hermes-focusable:focus-visible {
  outline-color: var(--hermes-brand-accent);
}

/* Danger states, e.g. a failed generation surfaced in the floating controls. */
.hermes-state-danger {
  color: var(--hermes-brand-danger);
  border-color: var(--hermes-brand-danger-soft);
}

/*
 * Connection indicator (apps/web/src/components/HermesConnectionStatus.tsx).
 *
 * Standalone deliberately shares the neutral surface rather than the danger
 * one: running without Hermes is a supported mode, not a fault, and styling it
 * as an error would misrepresent it.
 */
.hermes-connection-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border: 1px solid var(--hermes-brand-neutral-light);
  border-radius: 999px;
  font-size: 12px;
  line-height: 1.4;
}

.hermes-connection-status__label {
  font-weight: 500;
  white-space: nowrap;
}

.hermes-connection-status__detail {
  color: inherit;
  opacity: 0.75;
  /* Model ids and project ids are machine strings; keep them out of the
   * proportional face and stop them forcing the pill to wrap. */
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 32ch;
}

.hermes-connection-status__action {
  appearance: none;
  border: 1px solid currentColor;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  padding: 2px 8px;
}

.hermes-connection-status__action:disabled {
  cursor: progress;
  opacity: 0.6;
}
`;
}

async function main(): Promise<void> {
  const generated = render();
  const check = process.argv.includes("--check");

  if (check) {
    const existing = await readFile(outPath, "utf8").catch(() => null);
    if (existing === generated) {
      process.stdout.write(`hermes-brand.css is up to date\n`);
      return;
    }
    process.stderr.write(
      "hermes-brand.css is out of date with apps/desktop/src/main/hermes/hermes-brand.ts.\n" +
        "Run: pnpm exec tsx scripts/hermes/generate-brand-css.ts\n",
    );
    process.exit(1);
  }

  await writeFile(outPath, generated, "utf8");
  process.stdout.write(
    `wrote ${outPath}\n` +
      `  ${Object.keys(hermesBrandCssVariables()).length} custom properties, ` +
      `${HERMES_VENDORED_FONT_FACES.length} @font-face rules, ` +
      `${Object.keys(HERMES_BRAND_COLORS).length} palette entries\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`generate-brand-css: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
