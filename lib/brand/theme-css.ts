import { COLOR_VARS, FONT_BODY_VAR, FONT_HEADING_VAR, HEADER_HEIGHT_VAR, SOFT_SHADOW_VAR } from "@/lib/brand/css-vars";
import type { BrandColorTokens, BrandConfig } from "@/lib/brand/types";

/**
 * Turns a `BrandConfig` into the `:root` custom-property block that themes the
 * whole app.
 *
 * The active brand's block is inlined into `<head>` by `app/layout.tsx`, so:
 *   - only one brand's values are ever sent to the browser,
 *   - the palette is applied before first paint (no flash of the wrong brand),
 *   - and adding a brand needs no CSS edit anywhere — the config *is* the theme.
 */

/**
 * Exhaustiveness guard: `COLOR_VARS` is untyped (its module must stay
 * import-free), so this is where TypeScript checks that it covers every token
 * exactly. Adding a field to `BrandColorTokens` without adding its variable is a
 * compile error here.
 */
const COLOR_VAR_MAP: Record<keyof BrandColorTokens, string> = COLOR_VARS;

/** `#RGB` / `#RRGGBB` → `"R G B"`. */
export function hexToRgbChannels(hex: string): string {
  const value = hex.trim().replace(/^#/, "");
  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    // Loud on purpose: a mistyped colour would otherwise render as an invisible
    // `rgb()` and be near-impossible to spot in review.
    throw new Error(`Brand colour must be a 3- or 6-digit hex value, received "${hex}"`);
  }
  const int = parseInt(expanded, 16);
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
}

/**
 * The CSS custom-property declarations for a brand, without the wrapping
 * selector — so callers can scope it to `:root`, to `[data-brand="…"]`, or inline
 * it as a `style` attribute.
 */
export function brandThemeDeclarations(brand: BrandConfig): string {
  const lines: string[] = [];
  for (const key of Object.keys(COLOR_VAR_MAP) as (keyof BrandColorTokens)[]) {
    lines.push(`${COLOR_VAR_MAP[key]}: ${hexToRgbChannels(brand.colors[key])};`);
  }
  lines.push(`${FONT_BODY_VAR}: ${brand.fonts.bodyStack.join(", ")};`);
  lines.push(`${FONT_HEADING_VAR}: ${brand.fonts.headingStack.join(", ")};`);
  lines.push(`${SOFT_SHADOW_VAR}: ${brand.softShadow};`);
  lines.push(`${HEADER_HEIGHT_VAR}: ${brand.headerHeight};`);
  return lines.join(" ");
}

/**
 * The full `:root { … }` rule for a brand, ready to inline in a `<style>` tag.
 *
 * Safe to inject as raw CSS: every value is a hex-validated colour triplet, a
 * font stack, a shadow or a length taken from an in-repo config file — none of it
 * is user input. Still belt-and-braces stripped of `<` so a stray character can
 * never close the style element.
 */
export function brandThemeCss(brand: BrandConfig): string {
  return `:root { ${brandThemeDeclarations(brand)} }`.replace(/</g, "");
}
