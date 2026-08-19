import { Inter, Poppins, Source_Sans_3, Source_Serif_4 } from "next/font/google";
import type { BrandId } from "@/lib/brand/registry";

/**
 * Per-brand webfonts.
 *
 * `next/font` must be called at module scope — it is a build-time transform, not
 * a runtime API — so every brand's fonts are declared here and only the active
 * brand's CSS variables are applied to `<html>`. The unused brand's `@font-face`
 * rules are inert (a browser downloads a face only when something matches it) and
 * next/font only preloads the faces the render tree actually uses.
 *
 * Each brand binds the same two variables, `--font-body` and `--font-heading`;
 * the brand config's `fonts.bodyStack` / `headingStack` reference those, and add
 * the fallbacks that keep text readable before the webfont swaps in.
 *
 * Adding a brand: add an entry below. The `Record<BrandId, …>` type makes a
 * missing entry a compile error rather than an unstyled page.
 */

/** Rumbo Latino body copy. */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

/** Rumbo Latino display type. 800 for Display/H1/H2, 700 for H3. */
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-heading",
  display: "swap",
});

/** Aprende Institute body copy — the same family the résumé document is set in. */
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

/** Aprende Institute display type, matching the logo's serif wordmark. */
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});

/** The `<html>` className that binds a brand's font variables. */
export const BRAND_FONT_CLASS: Record<BrandId, string> = {
  "rumbo-latino": `${inter.variable} ${poppins.variable}`,
  aprende: `${sourceSans.variable} ${sourceSerif.variable}`,
};
