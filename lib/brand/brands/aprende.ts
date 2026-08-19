import { TERMS_LABEL, TERMS_URL } from "@/lib/legal/terms";
import type { BrandConfig } from "@/lib/brand/types";

/**
 * **Aprende Institute** — the institutional parent brand.
 *
 * Where Rumbo Latino is warm and conversational, Aprende Institute is formal and
 * academic: navy and crimson over cool neutrals, a serif wordmark, and copy that
 * reads as an institution addressing a student rather than an app addressing a
 * user. Substantially different enough to warrant its own header component
 * (`components/marketing/brands/AprendeHeader.tsx`) and hero layout, while every
 * product screen below the marketing layer stays shared.
 *
 * Palette provenance — navy `#030A64` and the flame crimson `#FC1244` are sampled
 * from the official logo (`public/brands/aprende/lockup.png`). The neutrals and
 * the two support colours are **derived**, not official: the Institute brand
 * ships no public token set, so they were built to satisfy this repo's contrast
 * contract and should be replaced if an official palette lands.
 *
 * ── Contrast decisions (WCAG 2.1, verified in tests/unit/brand-theme.test.ts) ──
 * 1. `accent` is `#E30840`, a slightly deepened flame crimson — NOT the logo's
 *    `#FC1244`. White on `#FC1244` is 3.96:1 and fails AA for a 14px semibold
 *    button label; white on `#E30840` is 4.80:1 and passes. The logo mark itself
 *    keeps its exact colour via `brandMark`, which is never a UI colour.
 * 2. `accentDark` is navy, NOT the crimson accent. Crimson as text is 3.76:1 on
 *    the surface; navy is 16.21:1. This mirrors the same call made for Rumbo Latino.
 * 3. `accentOn` is therefore white (4.80:1 on `accent`) rather than ink — the
 *    opposite of Rumbo Latino, because this accent is dark where coral is light.
 */
export const aprendeBrand: BrandConfig = {
  id: "aprende",
  name: "Aprende Institute",
  productName: "Mi CV con IA",
  hosts: ["aprende.com", "www.aprende.com", "cv.aprende.com"],

  colors: {
    /** Deepened flame crimson so white labels clear AA — see note 1. */
    accent: "#E30840",
    accentHover: "#C40036",
    /** Navy, not crimson — see note 2. */
    accentDark: "#030A64",
    /** Crimson at 10% over the surface. */
    accentLight: "#F8E2EB",
    /** White, not ink — see note 3. */
    accentOn: "#FFFFFF",
    brandStrong: "#030A64",
    brandStrongLight: "#1B2585",
    /** The flame's exact colour, sampled from the logo. Never a UI colour. */
    brandMark: "#FC1244",
    /** Derived — no official secondary palette exists. */
    brandSupport: "#E0A02C",
    /** Derived — no official secondary palette exists. */
    brandSupportAlt: "#0F7C8A",
    surface: "#F8F9FD",
    panel: "#EDF0F9",
    textPrimary: "#141A3D",
    textSecondary: "#5A6183",
    textInverse: "#FFFFFF",
    border: "#DCE1F0",
  },

  /**
   * Serif display type to match the logo's serif wordmark, over a humanist sans
   * for body copy. Source Sans 3 is also what the résumé document itself is set
   * in (`lib/resume/resume-renderer.ts`), so the two read as one family.
   */
  fonts: {
    bodyStack: ["var(--font-body)", "Source Sans 3", "-apple-system", "Segoe UI", "sans-serif"],
    headingStack: ["var(--font-heading)", "Source Serif 4", "Georgia", "serif"],
  },

  /** A navy-tinted lift, matching the cooler palette. */
  softShadow: "0 10px 30px rgba(3, 10, 100, 0.08)",

  /** 64px bar + 1px hairline. Kept in sync with `AprendeHeader`. */
  headerHeight: "4.0625rem",

  /**
   * One lockup image: the flame and the serif "Aprende INSTITUTE" wordmark are a
   * single locked-up asset in this brand and must not be re-typeset.
   */
  logo: {
    kind: "lockup",
    lockup: {
      src: "/brands/aprende/lockup.png",
      width: 412,
      height: 64,
      alt: "Aprende Institute",
    },
    displayHeight: 26,
  },

  metadata: {
    title: "Mi CV con IA — Aprende Institute",
    description:
      "Crea tu currículum profesional con ayuda de inteligencia artificial. " +
      "Una herramienta de Aprende Institute.",
    icon: "/brands/aprende/icon.png",
    appleIcon: "/brands/aprende/apple-icon.png",
  },

  hero: {
    layout: "editorial",
    headline: "Tu currículum profesional, paso a paso",
    lede:
      "El currículum es el documento que presenta lo que sabes hacer. Te acompañamos a " +
      "escribirlo con tus propias palabras. Sin costo.",
    stepsTitle: "Cómo funciona",
    steps: [
      { icon: "1", text: "Respondes preguntas sencillas, una por una." },
      { icon: "2", text: "Escribes tus respuestas con tus propias palabras." },
      { icon: "3", text: "Recibes tu currículum listo para descargar." },
    ],
    reassurance: {
      body:
        "No se necesita experiencia laboral previa. Cuenta lo que aprendiste estudiando, " +
        "en tu casa o apoyando a otras personas. ",
      emphasis: "Solo incluimos la información que tú confirmes.",
    },
    ctaLabel: "Comenzar",
    ctaBlockedHint: "Acepta el aviso de privacidad para comenzar.",
  },

  contactStep: {
    bannerTitle: "Tus datos de contacto",
    bannerBody:
      "Escribe tu nombre y la forma en que pueden contactarte. Estos datos aparecen en tu " +
      "currículum.",
    ctaLabel: "Continuar",
  },

  auth: {
    bannerBody:
      "Necesitas una cuenta para guardar tu currículum. Escribe tu correo y una contraseña.",
    subtitle: "Tu currículum profesional",
  },

  legal: { termsUrl: TERMS_URL, termsLabel: TERMS_LABEL },
};
