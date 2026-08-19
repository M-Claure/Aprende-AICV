/**
 * Brand system — type surface.
 *
 * A *brand* is a marketing/branding skin: colours, typography, logo, metadata
 * and marketing copy. Everything else in the product (funnel, question engine,
 * AI orchestration, résumé generation and the résumé document itself) is shared
 * and brand-agnostic — a résumé is the *user's* document, so it is deliberately
 * NOT themed (see `lib/resume/resume-renderer.ts`, which keeps its own neutral
 * print palette).
 *
 * A `BrandConfig` is PURE, SERIALIZABLE DATA — no imports of React, `next/*`,
 * `server-only` or anything with I/O. That is what lets the same object be read
 * from edge middleware, from Server Components, and (after crossing the
 * server/client boundary as props) from Client Components.
 *
 * Per-brand *components* live in `components/marketing/registry.tsx` instead,
 * so this layer never depends on the UI layer.
 */

/**
 * The semantic colour tokens every brand must fill in.
 *
 * These are **semantic**, not literal: shared product components ask for
 * "the accent" or "secondary text", never for "coral" or "plum". That is what
 * lets a brand be swapped without touching a single product component.
 *
 * Contrast contract (WCAG 2.1 — the audience is low-literacy learners reading
 * Spanish on phones, often in poor light, so this is enforced by review, and
 * spot-checked in `tests/unit/brand-theme.test.ts`):
 *   - `textPrimary`, `textSecondary`, `accentDark` must clear **4.5:1** on `surface`.
 *   - `accentOn` must clear **4.5:1** on `accent` (it labels accent-filled buttons,
 *     which are 14px semibold — not "large text").
 *   - `accentDark` must clear **4.5:1** on `accentLight` (banner titles sit on the tint).
 */
export interface BrandColorTokens {
  /** Primary action colour: CTA fills, progress bar, focus borders, banner stripe. */
  accent: string;
  /** Hover state for an accent fill. */
  accentHover: string;
  /**
   * Interactive/emphasis **text** colour. Usually the dark brand anchor rather
   * than the accent itself: saturated brand accents almost never clear 4.5:1 on
   * a light surface at 14px.
   */
  accentDark: string;
  /** A light tint of the accent — selected states, instruction banners, chips. */
  accentLight: string;
  /** Label colour placed **on** an accent fill. */
  accentOn: string;
  /** The dark brand anchor: wordmarks, display headings. */
  brandStrong: string;
  /** A lighter step of `brandStrong`, for secondary display type. */
  brandStrongLight: string;
  /** The isotipo/logo mark colour. Reference only — never a UI colour. */
  brandMark: string;
  /** Warm secondary accent (badges, highlights). */
  brandSupport: string;
  /** Cool secondary accent (informational highlights). */
  brandSupportAlt: string;
  /** Page background. */
  surface: string;
  /** Raised/secondary surface: panels, the AI chat bubble. */
  panel: string;
  /** Body text. */
  textPrimary: string;
  /** Supporting/secondary text. */
  textSecondary: string;
  /** Text on a dark fill. */
  textInverse: string;
  /** Hairlines, input borders, dividers. */
  border: string;
}

/** Font stacks. The leading entry is the CSS variable `app/fonts.ts` binds. */
export interface BrandFontTokens {
  /**
   * Body copy stack, e.g. `["var(--font-body)", "Inter", "sans-serif"]`.
   * The tail keeps text readable before the webfont swaps in.
   */
  bodyStack: readonly string[];
  /** Display/heading stack, same shape. */
  headingStack: readonly string[];
}

/** A single raster asset with its intrinsic size (required by `next/image`). */
export interface BrandImageAsset {
  src: string;
  width: number;
  height: number;
  /** Empty string when the image is decorative and the label is live text. */
  alt: string;
}

/**
 * How this brand's isologo is assembled.
 *
 * `lockup` — one image containing mark + wordmark.
 * `mark-and-wordmark` — the mark as an image, the wordmark as **live text**, so
 * it stays crisp at any zoom, inherits the theme, and stays selectable and
 * translatable.
 */
export type BrandLogo =
  | {
      kind: "lockup";
      lockup: BrandImageAsset;
      /** Rendered height in the header, in px. */
      displayHeight: number;
    }
  | {
      kind: "mark-and-wordmark";
      mark: BrandImageAsset;
      /** Rendered mark size in the header, in px. */
      displayHeight: number;
      /** Space between the mark and the wordmark, in px. */
      markGap: number;
      /** The wordmark text, split so one trailing glyph can take the accent. */
      wordmark: { text: string; accentSuffix?: string };
    };

/** One "how it works" step on the landing page. */
export interface BrandHeroStep {
  icon: string;
  text: string;
}

/**
 * Landing-page copy and layout.
 *
 * `layout` picks a variant of the shared `MarketingHero` component. Prefer a new
 * variant over a new component; register a brand-specific component in
 * `components/marketing/registry.tsx` only when the design genuinely diverges.
 */
export interface BrandHero {
  layout: "centered" | "editorial";
  /** Small pill above the headline. Omit to hide it. */
  badge?: string;
  headline: string;
  /** One-paragraph lede under the headline. */
  lede: string;
  stepsTitle?: string;
  steps: readonly BrandHeroStep[];
  /** Reassurance paragraph under the steps. Rendered as two parts so the
   *  second half can be emphasised. */
  reassurance: { body: string; emphasis: string };
  /** Primary CTA label. */
  ctaLabel: string;
  /** Nudge shown while the consent checkbox is unticked. */
  ctaBlockedHint: string;
}

/** Copy for the contact step that follows the hero. */
export interface BrandContactStep {
  bannerTitle: string;
  bannerBody: string;
  ctaLabel: string;
}

/** Copy for the sign-in screen. */
export interface BrandAuthCopy {
  bannerBody: string;
  subtitle: string;
}

/** Consent link. `TERMS_VERSION` stays global — see `lib/legal/terms.ts`. */
export interface BrandLegal {
  termsUrl: string;
  termsLabel: string;
}

/** `<head>` metadata. */
export interface BrandMetadata {
  title: string;
  description: string;
  /**
   * Per-brand favicon and apple-touch icon, served from `public/brands/<id>/`.
   *
   * Both current brands set these, because their marks genuinely differ (Rumbo
   * Latino's coral arrow vs Aprende Institute's flame). There is deliberately no
   * `app/icon.*` convention file: the file convention emits its own
   * `<link rel="icon">` that would compete with these per-brand ones, so the two
   * mechanisms must not both be in play. Leave unset only for a brand that is
   * content with no icon at all.
   */
  icon?: string;
  appleIcon?: string;
}

/** Everything that makes one marketing skin. */
export interface BrandConfig {
  /** Stable slug. Also the value of the `brand` cookie / `?brand=` override. */
  id: string;
  /** Organisation name, used in metadata and aria labels. */
  name: string;
  /** Product name shown next to the logo. Shared across brands today. */
  productName: string;
  /**
   * Hostnames this brand serves. Matched case-insensitively against the request
   * host with the port stripped. A leading `*.` matches any single-or-multi
   * label subdomain (`*.aprende.com` matches `cv.aprende.com`).
   */
  hosts: readonly string[];
  colors: BrandColorTokens;
  fonts: BrandFontTokens;
  /** `box-shadow` value for the `shadow-soft` utility. */
  softShadow: string;
  /**
   * Total height of this brand's header, as a CSS length. MUST match what the
   * brand's header component actually renders — `.min-h-page` subtracts it to
   * size full-height screens.
   */
  headerHeight: string;
  logo: BrandLogo;
  metadata: BrandMetadata;
  hero: BrandHero;
  contactStep: BrandContactStep;
  auth: BrandAuthCopy;
  legal: BrandLegal;
}
