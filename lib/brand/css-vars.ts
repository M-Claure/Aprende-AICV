/**
 * The contract between the brand configs and Tailwind.
 *
 * **This module must stay import-free.** `tailwind.config.ts` loads it directly
 * (relative path, via Tailwind's own loader), which does not resolve the `@/`
 * path alias — so anything imported here would break the CSS build.
 *
 * ## Why channel triplets
 * Each colour ships as an `"R G B"` triplet rather than a hex string so Tailwind
 * can inject the alpha channel: `rgb(var(--c-accent) / <alpha-value>)` keeps
 * `bg-accent/50` and `border-accent/20` working. A hex `var()` would silently
 * break every opacity modifier — a footgun worth 20 lines of conversion.
 */

/** `BrandColorTokens` key → CSS custom property holding its `"R G B"` triplet. */
export const COLOR_VARS = {
  accent: "--c-accent",
  accentHover: "--c-accent-hover",
  accentDark: "--c-accent-dark",
  accentLight: "--c-accent-light",
  accentOn: "--c-accent-on",
  brandStrong: "--c-brand-strong",
  brandStrongLight: "--c-brand-strong-light",
  brandMark: "--c-brand-mark",
  brandSupport: "--c-brand-support",
  brandSupportAlt: "--c-brand-support-alt",
  surface: "--c-surface",
  panel: "--c-panel",
  textPrimary: "--c-text-primary",
  textSecondary: "--c-text-secondary",
  textInverse: "--c-text-inverse",
  border: "--c-border",
};

/** Non-colour custom properties the brand style block also sets. */
export const FONT_BODY_VAR = "--font-body-stack";
export const FONT_HEADING_VAR = "--font-heading-stack";
export const SOFT_SHADOW_VAR = "--shadow-soft";
/** Total header height. `.min-h-page` subtracts it — see `app/globals.css`. */
export const HEADER_HEIGHT_VAR = "--brand-header-h";

/**
 * Tailwind colour value for a token: alpha-aware, so opacity modifiers work.
 * Used by `tailwind.config.ts`; nothing else should need it.
 */
export function tailwindColor(varName: string): string {
  return `rgb(var(${varName}) / <alpha-value>)`;
}

/**
 * Same colour with no alpha slot, for hand-written CSS where Tailwind is not
 * doing the substitution (`app/globals.css`).
 */
export function cssColor(varName: string): string {
  return `rgb(var(${varName}))`;
}
