import type { Config } from "tailwindcss";
import {
  COLOR_VARS,
  FONT_BODY_VAR,
  FONT_HEADING_VAR,
  SOFT_SHADOW_VAR,
  tailwindColor,
} from "./lib/brand/css-vars";

/**
 * Design tokens for the **multi-brand** system.
 *
 * No brand's colours appear here. Every token resolves to a CSS custom property
 * that the active brand's theme block fills in at render time
 * (`lib/brand/theme-css.ts`, inlined by `app/layout.tsx`). The concrete palettes
 * live with their brands, in `lib/brand/brands/*.ts`.
 *
 * That indirection is what makes a brand swap free: shared product components
 * keep the exact class names they already had (`bg-accent`, `text-accent-dark`,
 * `border-border`), and the values behind them change per request. Adding a brand
 * touches no CSS and no component.
 *
 * ## Tokens are semantic, not literal
 * `accent`, `text-primary`, `border` — never `coral` or `plum`. A literal name
 * stops being true the moment a second brand exists ("plum" resolving to navy is
 * worse than no name at all). The literal brand colours are reachable as
 * `brand-strong` / `brand-mark` / `brand-support` for the marketing layer, which
 * is the one place a brand is allowed to be specific about itself.
 *
 * Opacity modifiers (`bg-accent/50`) keep working: see the channel-triplet note
 * in `lib/brand/css-vars.ts`.
 *
 * Accessibility decisions (why `accent-dark` is not the accent, why `accent-on`
 * differs per brand) are documented per brand in `lib/brand/brands/*.ts` and
 * enforced in `tests/unit/brand-theme.test.ts`.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/resume/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: tailwindColor(COLOR_VARS.accent),
          /** Hover state for an accent fill. */
          hover: tailwindColor(COLOR_VARS.accentHover),
          /** Interactive/emphasis TEXT — AA-safe on the brand surface. */
          dark: tailwindColor(COLOR_VARS.accentDark),
          /** Accent tint: selected states, instruction banners, chips. */
          light: tailwindColor(COLOR_VARS.accentLight),
          /** Label colour on an accent fill. */
          on: tailwindColor(COLOR_VARS.accentOn),
        },
        brand: {
          /** Dark brand anchor: wordmarks and display headings. */
          strong: tailwindColor(COLOR_VARS.brandStrong),
          "strong-lt": tailwindColor(COLOR_VARS.brandStrongLight),
          /** Isotipo mark only — not a UI colour. */
          mark: tailwindColor(COLOR_VARS.brandMark),
          support: tailwindColor(COLOR_VARS.brandSupport),
          "support-alt": tailwindColor(COLOR_VARS.brandSupportAlt),
        },
        text: {
          primary: tailwindColor(COLOR_VARS.textPrimary),
          secondary: tailwindColor(COLOR_VARS.textSecondary),
          inverse: tailwindColor(COLOR_VARS.textInverse),
        },
        border: tailwindColor(COLOR_VARS.border),
        "bg-primary": tailwindColor(COLOR_VARS.surface),
        "bg-panel": tailwindColor(COLOR_VARS.panel),
        /** Alias of `bg-panel`, kept for the chat-bubble markup that predates it. */
        "ai-bubble": tailwindColor(COLOR_VARS.panel),
      },
      fontFamily: {
        // Each brand supplies its own stack, including the fallbacks — the leading
        // entry is the variable `app/fonts.ts` binds via next/font.
        main: `var(${FONT_BODY_VAR})`,
        heading: `var(${FONT_HEADING_VAR})`,
      },
      boxShadow: {
        // NOT named `brand`: Tailwind also derives shadow-COLOR utilities from
        // `colors`, so `shadow-brand` would collide with `colors.brand` and
        // recolour the shadow instead of applying this value.
        soft: `var(${SOFT_SHADOW_VAR})`,
      },
      maxWidth: {
        brand: "1120px",
      },
    },
  },
  plugins: [],
};

export default config;
