import { TERMS_LABEL, TERMS_URL } from "@/lib/legal/terms";
import type { BrandConfig } from "@/lib/brand/types";

/**
 * **Rumbo Latino** — the warm, learner-facing consumer brand.
 * Source: https://rumbolatino.com (tokens read from its `styles.css` `:root`).
 *
 * Rumbo Latino is a free membership that connects Hispanic communities in the US
 * with tools, opportunities and community; "Mi CV con IA" is one of those tools.
 * Its voice is warm and direct — "Hecho por latinos para latinos".
 *
 * It runs on the same design system this app previously carried under the
 * Aprende+ name: the palette below is byte-for-byte the one in rumbolatino.com's
 * stylesheet (coral, gold, teal and plum over warm neutrals, one strong accent
 * per block), and the type pairing is the same Poppins display over Inter body.
 * The mark and the wordmark are what changed.
 *
 * ── Fidelity to the live site, and the one remaining departure ────────────────
 * Measured against WCAG 2.1 (4.5:1 body text, 3:1 large text and UI):
 *
 * 1. `accentOn` is **white**, matching rumbolatino.com's
 *    `.btn--primary { color:#fff }` exactly. This is a deliberate, owner-approved
 *    brand-fidelity choice over contrast: white on coral is 2.73:1 and white on
 *    coral-dk (hover) is 3.46:1, both below AA for the 14px semibold labels these
 *    fills carry. Ink would score 5.44:1. Both pairs are pinned in
 *    `tests/unit/brand-theme.test.ts` so the gap stays visible and cannot widen.
 * 2. `accentDark` is plum, NOT coral-dk. It styles interactive 14px text in ~20
 *    places; coral-dk scores 3.31:1 on cream and fails AA. Plum scores 11.71:1.
 *    Coral is still the action colour everywhere it appears as a *shape* (fills,
 *    borders, the progress bar), where it reads fine. The site has no equivalent
 *    token, so nothing is being contradicted here.
 *
 * `accentLight` is the one derived value — coral at 12% over cream — because the
 * system ships no coral tint and selected states need one.
 */
export const rumboLatinoBrand: BrandConfig = {
  id: "rumbo-latino",
  name: "Rumbo Latino",
  productName: "Mi CV con IA",
  hosts: ["rumbolatino.com", "www.rumbolatino.com", "*.rumbolatino.com"],

  colors: {
    accent: "#FF6F5E",
    accentHover: "#F0553F",
    /** Plum, not coral-dk — see note above. */
    accentDark: "#3B2E58",
    /** Coral at 12% over cream. */
    accentLight: "#FFE8E2",
    /** White, matching the site's button label — see note 1 above. */
    accentOn: "#FFFFFF",
    brandStrong: "#3B2E58",
    brandStrongLight: "#4A3A6B",
    /**
     * The mark's own colour. Rumbo Latino's isotipo is the coral rising arrow,
     * so this tracks `accent` rather than the crimson the previous brand's flame
     * used. Reference only — never a UI colour.
     */
    brandMark: "#FF6F5E",
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

  /** `--shadow` from the site's stylesheet: a soft plum-tinted lift. */
  softShadow: "0 10px 30px rgba(59, 46, 88, 0.08)",

  /** 4px accent rule + 64px bar. Kept in sync with `RumboLatinoHeader`. */
  headerHeight: "4.25rem",

  /**
   * The isologo is assembled the way rumbolatino.com assembles it: the rising
   * arrow as a mark, then the wordmark as live text in Poppins 800 — "Rumbo" in
   * plum with " Latino" in coral. (The site's own markup does the same, down to
   * the second `<span>` carrying the accent colour.)
   */
  logo: {
    kind: "mark-and-wordmark",
    mark: { src: "/brands/rumbo-latino/isotipo.png", width: 120, height: 120, alt: "" },
    displayHeight: 30,
    /** 9px, matching the site's `.brand { gap:9px }`. */
    markGap: 9,
    wordmark: { text: "Rumbo", accentSuffix: " Latino" },
  },

  metadata: {
    title: "Mi CV con IA — Rumbo Latino",
    description: "Crea tu currículum profesional con ayuda de inteligencia artificial.",
    icon: "/brands/rumbo-latino/icon.png",
    appleIcon: "/brands/rumbo-latino/apple-icon.png",
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
