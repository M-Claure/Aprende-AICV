import type { Config } from "tailwindcss";

/**
 * Design tokens for the **Aprende+** brand system.
 * Source: https://aprende-plus-landing.vercel.app/design-system.html
 *
 * The palette is "cuatro colores de marca sobre neutros cálidos" — coral, gold,
 * teal and plum over warm neutrals, with one strong accent per block:
 *   coral #FF6F5E (action/CTA) · coral-dk #F0553F (hover)
 *   gold  #FFC24B (warm accents, badges)
 *   teal  #1FB6A6 (community/health) · teal-dk #138B7E (teal text on light)
 *   plum  #3B2E58 (titles, dark anchors) · plum-lt #4A3A6B
 *   cream #FFF9F4 (background) · panel #F7EFEA · ink #2A2340 (text)
 *   grey  #7C748C (secondary text) · line #EADFE6 (borders)
 *   crimson #DB0F3C — RESERVED for the Aprende isotipo mark, never for UI.
 *
 * `accent` is the product's semantic accent, so existing `bg-accent` /
 * `text-accent-dark` / `bg-accent-light` markup picks up the brand automatically.
 *
 * ── Two deliberate departures, both for legibility ────────────────────────────
 * Measured against WCAG 2.1 (4.5:1 for body text, 3:1 for large text and UI):
 *
 * 1. `accent.dark` is plum, NOT coral-dk. `text-accent-dark` styles interactive
 *    14px text in ~20 places; coral-dk scores 3.31:1 on cream and fails AA.
 *    Plum scores 11.71:1. Coral is still the action colour everywhere it appears
 *    as a shape (fills, borders, the progress bar), where it reads fine.
 * 2. `accent.on` (label colour for coral fills) is ink, NOT white. White on coral
 *    is 2.73:1 — well under AA; ink on coral is 5.44:1.
 *
 * This matters more than usual here: the audience is low-literacy learners
 * reading Spanish on phones, often in poor light.
 *
 * `accent.light` is the one derived value — coral at 12% over cream — because the
 * system ships no coral tint and selected states need one.
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
        brand: {
          coral: "#FF6F5E",
          "coral-dk": "#F0553F",
          gold: "#FFC24B",
          teal: "#1FB6A6",
          "teal-dk": "#138B7E",
          plum: "#3B2E58",
          "plum-lt": "#4A3A6B",
          cream: "#FFF9F4",
          panel: "#F7EFEA",
          /** Isotipo mark only — not a UI colour. */
          crimson: "#DB0F3C",
          DEFAULT: "#FF6F5E",
          dark: "#F0553F",
        },
        accent: {
          DEFAULT: "#FF6F5E",
          /** Interactive/emphasis TEXT. Plum for contrast — see note above. */
          dark: "#3B2E58",
          /** Coral 12% over cream: selected states, banners, chips. */
          light: "#FFE8E2",
          /** Label colour on a coral fill. Ink, not white — see note above. */
          on: "#2A2340",
        },
        text: {
          primary: "#2A2340",
          secondary: "#7C748C",
          inverse: "#FFFFFF",
        },
        border: "#EADFE6",
        "bg-primary": "#FFF9F4",
        "ai-bubble": "#F7EFEA",
      },
      fontFamily: {
        // Aprende+ pairs Poppins for display type with Inter for body copy. The
        // vars are set by next/font in app/layout.tsx; the tail of each stack
        // keeps text readable before the font swaps in.
        main: ["var(--font-main)", "Inter", "-apple-system", "Segoe UI", "sans-serif"],
        heading: ["var(--font-heading)", "Poppins", "Segoe UI", "system-ui", "sans-serif"],
      },
      boxShadow: {
        // --shadow from the design system: a soft plum-tinted lift.
        // NOT named `brand`: Tailwind also derives shadow-COLOR utilities from
        // `colors`, so `shadow-brand` would collide with `colors.brand` and
        // recolour the shadow coral instead of applying this value.
        soft: "0 10px 30px rgba(59,46,88,.08)",
      },
      maxWidth: {
        // --container
        brand: "1120px",
      },
    },
  },
  plugins: [],
};

export default config;
