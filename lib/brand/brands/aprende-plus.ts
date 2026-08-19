import { TERMS_LABEL, TERMS_URL } from "@/lib/legal/terms";
import type { BrandConfig } from "@/lib/brand/types";

/**
 * **Aprende+** — the warm, learner-facing consumer brand.
 * Source: https://aprende-plus-landing.vercel.app/design-system.html
 *
 * The palette is "cuatro colores de marca sobre neutros cálidos": coral, gold,
 * teal and plum over warm neutrals, with one strong accent per block. Display
 * type is Poppins (800 for Display/H1/H2, 700 for H3) over Inter body copy.
 *
 * ── Two deliberate departures from the design system, both for legibility ────
 * Measured against WCAG 2.1 (4.5:1 body text, 3:1 large text and UI):
 *
 * 1. `accentDark` is plum, NOT coral-dk. It styles interactive 14px text in ~20
 *    places; coral-dk scores 3.31:1 on cream and fails AA. Plum scores 11.71:1.
 *    Coral is still the action colour everywhere it appears as a *shape* (fills,
 *    borders, the progress bar), where it reads fine.
 * 2. `accentOn` (the label on a coral fill) is ink, NOT white. White on coral is
 *    2.73:1 — well under AA; ink on coral is 5.44:1.
 *
 * `accentLight` is the one derived value — coral at 12% over cream — because the
 * system ships no coral tint and selected states need one.
 */
export const aprendePlusBrand: BrandConfig = {
  id: "aprende-plus",
  name: "Aprende+",
  productName: "Mi CV con IA",
  hosts: ["aprendeplus.com", "www.aprendeplus.com", "plus.aprende.com", "*.aprendeplus.com"],

  colors: {
    accent: "#FF6F5E",
    accentHover: "#F0553F",
    /** Plum, not coral-dk — see note above. */
    accentDark: "#3B2E58",
    /** Coral at 12% over cream. */
    accentLight: "#FFE8E2",
    /** Ink, not white — see note above. */
    accentOn: "#2A2340",
    brandStrong: "#3B2E58",
    brandStrongLight: "#4A3A6B",
    /**
     * The flame isotipo's own colour, sampled from `aprende-plus-isotipo.png`.
     * Reference only: the mark is never recoloured and this is never a UI colour.
     */
    brandMark: "#FC1244",
    brandSupport: "#FFC24B",
    brandSupportAlt: "#1FB6A6",
    surface: "#FFF9F4",
    panel: "#F7EFEA",
    textPrimary: "#2A2340",
    textSecondary: "#7C748C",
    textInverse: "#FFFFFF",
    border: "#EADFE6",
  },

  fonts: {
    bodyStack: ["var(--font-body)", "Inter", "-apple-system", "Segoe UI", "sans-serif"],
    headingStack: ["var(--font-heading)", "Poppins", "Segoe UI", "system-ui", "sans-serif"],
  },

  /** `--shadow` from the design system: a soft plum-tinted lift. */
  softShadow: "0 10px 30px rgba(59, 46, 88, 0.08)",

  /** 4px accent rule + 64px bar. Kept in sync with `AprendePlusHeader`. */
  headerHeight: "4.25rem",

  logo: {
    kind: "mark-and-wordmark",
    mark: { src: "/brands/aprende-plus/isotipo.png", width: 48, height: 48, alt: "" },
    displayHeight: 28,
    wordmark: { text: "Aprende", accentSuffix: "+" },
  },

  metadata: {
    title: "Mi CV con IA — Aprende+",
    description: "Crea tu currículum profesional con ayuda de inteligencia artificial.",
  },

  hero: {
    layout: "centered",
    badge: "Gratis y en español",
    headline: "Crea tu currículum para buscar trabajo",
    lede:
      "Un currículum es el papel que muestra lo que sabes hacer. Te ayudamos a hacer el tuyo, " +
      "paso a paso. Es gratis.",
    steps: [
      { icon: "💬", text: "Te hacemos preguntas fáciles, una por una." },
      { icon: "✍️", text: "Tú respondes con tus propias palabras." },
      { icon: "📄", text: "Nosotros lo escribimos bonito y tú lo descargas." },
    ],
    reassurance: {
      body:
        "No necesitas haber tenido un trabajo antes. Sirve lo que aprendiste en tu casa, " +
        "estudiando o ayudando a otros. ",
      emphasis: "Solo ponemos lo que tú digas que es verdad.",
    },
    ctaLabel: "Empezar",
    ctaBlockedHint: "Marca la casilla para poder empezar.",
  },

  contactStep: {
    bannerTitle: "Escribe tus datos",
    bannerBody:
      "Pon tu nombre y cómo te pueden contactar. Esto va en tu currículum para que te puedan llamar.",
    ctaLabel: "Continuar",
  },

  auth: {
    bannerBody:
      "Necesitas una cuenta para guardar tu currículum y que no se pierda. Escribe tu correo y " +
      "una contraseña.",
    subtitle: "Tu currículum para buscar trabajo",
  },

  legal: { termsUrl: TERMS_URL, termsLabel: TERMS_LABEL },
};
