import { describe, expect, it } from "vitest";
import { COLOR_VARS } from "@/lib/brand/css-vars";
import { BRANDS, BRAND_IDS } from "@/lib/brand/registry";
import { brandThemeCss, hexToRgbChannels } from "@/lib/brand/theme-css";
import type { BrandColorTokens, BrandConfig } from "@/lib/brand/types";

/**
 * The theme layer: a brand config must produce a complete, *legible* palette.
 *
 * The contrast block is the important half. This product's readers are
 * low-literacy learners reading Spanish on phones, often in poor light, so the
 * palette carries deliberate departures from both brands' design systems to hit
 * WCAG AA (documented in `lib/brand/brands/*.ts`). A future brand added by
 * copy-pasting a marketing deck would quietly undo that; these assertions make it
 * a failing test instead.
 */

/** Relative luminance, per WCAG 2.1. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgbChannels(hex)
    .split(" ")
    .map((channel) => {
      const v = Number(channel) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA for body text. Every pair below carries 14px+ text, never "large" text. */
const AA_BODY = 4.5;
const WHITE = "#FFFFFF";

describe("hexToRgbChannels", () => {
  it("converts 6- and 3-digit hex to space-separated channels", () => {
    expect(hexToRgbChannels("#FF6F5E")).toBe("255 111 94");
    expect(hexToRgbChannels("030A64")).toBe("3 10 100");
    expect(hexToRgbChannels("#fff")).toBe("255 255 255");
    expect(hexToRgbChannels("#000")).toBe("0 0 0");
  });

  it("throws on anything that is not a hex colour", () => {
    // Loud on purpose: a mistyped colour would otherwise render as an invisible
    // rgb() and be near-impossible to spot in review.
    expect(() => hexToRgbChannels("rgb(255,0,0)")).toThrow(/hex/i);
    expect(() => hexToRgbChannels("#GGGGGG")).toThrow(/hex/i);
    expect(() => hexToRgbChannels("")).toThrow(/hex/i);
  });
});

describe("brandThemeCss", () => {
  it.each(BRAND_IDS)("emits every custom property for %s", (id) => {
    const css = brandThemeCss(BRANDS[id]);
    expect(css.startsWith(":root {")).toBe(true);
    for (const varName of Object.values(COLOR_VARS)) {
      // Channel triplets, not hex — that is what keeps `bg-accent/50` working.
      expect(css).toMatch(new RegExp(`${varName}: \\d+ \\d+ \\d+;`));
    }
    expect(css).toContain("--font-body-stack:");
    expect(css).toContain("--font-heading-stack:");
    expect(css).toContain("--shadow-soft:");
    expect(css).toContain("--brand-header-h:");
  });

  it.each(BRAND_IDS)("cannot break out of the <style> element for %s", (id) => {
    expect(brandThemeCss(BRANDS[id])).not.toContain("<");
  });

  it("produces a different palette per brand", () => {
    // Guards the copy-paste failure mode: a new brand that forgot to change its
    // colours and silently inherits another brand's look.
    const emitted = BRAND_IDS.map((id) => brandThemeCss(BRANDS[id]));
    expect(new Set(emitted).size).toBe(BRAND_IDS.length);
  });
});

describe("brand config shape", () => {
  it.each(BRAND_IDS)("%s uses valid hex for every colour token", (id) => {
    const colors = BRANDS[id].colors;
    for (const key of Object.keys(COLOR_VARS) as (keyof BrandColorTokens)[]) {
      expect(() => hexToRgbChannels(colors[key]), `${id}.${key}`).not.toThrow();
    }
  });

  it.each(BRAND_IDS)("%s declares hosts, a CSS header height and namespaced assets", (id) => {
    const brand: BrandConfig = BRANDS[id];
    expect(brand.hosts.length).toBeGreaterThan(0);
    expect(brand.headerHeight).toMatch(/^[\d.]+(rem|px|em)$/);
    // Assets live under public/brands/<id>/ so brands can never collide.
    const assets =
      brand.logo.kind === "lockup" ? [brand.logo.lockup.src] : [brand.logo.mark.src];
    for (const src of assets) {
      expect(src).toBe(`/brands/${id}/${src.split("/").pop()}`);
    }
  });

  it.each(BRAND_IDS)("%s supplies the marketing copy the hero renders", (id) => {
    const { hero, contactStep, auth, legal } = BRANDS[id];
    expect(hero.headline.length).toBeGreaterThan(0);
    expect(hero.lede.length).toBeGreaterThan(0);
    expect(hero.ctaLabel.length).toBeGreaterThan(0);
    expect(hero.ctaBlockedHint.length).toBeGreaterThan(0);
    expect(hero.steps.length).toBeGreaterThan(0);
    expect(contactStep.bannerTitle.length).toBeGreaterThan(0);
    expect(auth.bannerBody.length).toBeGreaterThan(0);
    expect(legal.termsUrl).toMatch(/^https:\/\//);
  });

  it.each(BRAND_IDS)("%s binds the font variables app/fonts.ts sets", (id) => {
    // The stacks must lead with the next/font variable, or the webfont never applies.
    expect(BRANDS[id].fonts.bodyStack[0]).toBe("var(--font-body)");
    expect(BRANDS[id].fonts.headingStack[0]).toBe("var(--font-heading)");
    // …and carry a fallback, so text is readable before the font swaps in.
    expect(BRANDS[id].fonts.bodyStack.length).toBeGreaterThan(1);
    expect(BRANDS[id].fonts.headingStack.length).toBeGreaterThan(1);
  });
});

/**
 * Pairs that are knowingly below AA, pinned at the value they ship at today.
 *
 * Both are **inherited Aprende+ design-system values**, not choices this repo
 * made, and changing a live brand's palette is a design decision rather than a
 * refactor — so they are recorded here instead of quietly "fixed". Pinning them
 * means they cannot get worse, and any NEW brand still has to clear AA outright.
 *
 * Worth raising with design: darkening `textSecondary` from `#7C748C` to about
 * `#736A84` would clear AA on all three surfaces with no perceptible hue shift.
 * The hover pair cannot be fixed by deepening the coral — that lowers ink
 * contrast further; it needs a lighter hover or a different label colour.
 */
const KNOWN_BELOW_AA: Record<string, number> = {
  // #7C748C on cream / white / #F7EFEA — the design system's secondary grey.
  "aprende-plus:textSecondary/surface": 4.24,
  "aprende-plus:textSecondary/white": 4.43,
  "aprende-plus:textSecondary/panel": 3.9,
  // Ink on coral-dk. Hover-only, and the resting state (5.44:1) does clear AA.
  "aprende-plus:accentOn/accentHover": 4.3,
};

/** Assert a pair clears AA, or clears its pinned floor if it is a known exception. */
function expectLegible(brandId: string, fgName: string, fg: string, bgName: string, bg: string) {
  const key = `${brandId}:${fgName}/${bgName}`;
  const floor = KNOWN_BELOW_AA[key] ?? AA_BODY;
  expect(contrast(fg, bg), `${key} (floor ${floor}:1)`).toBeGreaterThanOrEqual(floor);
}

describe("contrast contract", () => {
  it.each(BRAND_IDS)("%s keeps text legible on its surfaces", (id) => {
    const c = BRANDS[id].colors;
    // Body and supporting text on the page background, on white cards, and on
    // the panel colour the AI bubble uses.
    const surfaces: [string, string][] = [
      ["surface", c.surface],
      ["white", WHITE],
      ["panel", c.panel],
    ];
    for (const [bgName, bg] of surfaces) {
      expectLegible(id, "textPrimary", c.textPrimary, bgName, bg);
      expectLegible(id, "textSecondary", c.textSecondary, bgName, bg);
      // `text-accent-dark` styles interactive 14px text in ~20 places.
      expectLegible(id, "accentDark", c.accentDark, bgName, bg);
    }
  });

  it.each(BRAND_IDS)("%s keeps accent-filled button labels legible", (id) => {
    const c = BRANDS[id].colors;
    // Button labels are 14px semibold — not WCAG "large text", so 4.5:1 applies.
    expectLegible(id, "accentOn", c.accentOn, "accent", c.accent);
    expectLegible(id, "accentOn", c.accentOn, "accentHover", c.accentHover);
  });

  it.each(BRAND_IDS)("%s keeps instruction-banner text legible on the accent tint", (id) => {
    const c = BRANDS[id].colors;
    // InstructionBanner: a bold accent-dark title over bg-accent-light, shown at
    // the top of every screen.
    expectLegible(id, "accentDark", c.accentDark, "accentLight", c.accentLight);
    expectLegible(id, "textPrimary", c.textPrimary, "accentLight", c.accentLight);
  });

  it.each(BRAND_IDS)("%s keeps the accent tint distinguishable from the surface", (id) => {
    const c = BRANDS[id].colors;
    // A tint that matches the background makes the banner invisible as a banner.
    expect(contrast(c.accentLight, c.surface)).toBeGreaterThan(1.05);
  });

  it.each(BRAND_IDS)("%s keeps borders and the accent visible as shapes on the surface", (id) => {
    const c = BRANDS[id].colors;
    // Borders are hairlines, so this is the looser "perceptible" bar the existing
    // palette already sits at; the accent has to read as a filled shape.
    expect(contrast(c.border, c.surface)).toBeGreaterThan(1.05);
    expect(contrast(c.accent, c.surface)).toBeGreaterThan(2);
  });

  it("has no stale entries in the known-exception list", () => {
    // If a palette is fixed, the exception must be deleted rather than left to
    // quietly lower the bar for that pair forever.
    const resolve = (id: string, name: string): string => {
      const c = BRANDS[id as keyof typeof BRANDS].colors;
      return name === "white" ? WHITE : (c as unknown as Record<string, string>)[name]!;
    };
    for (const [key, floor] of Object.entries(KNOWN_BELOW_AA)) {
      const [id, pair] = key.split(":") as [string, string];
      const [fgName, bgName] = pair.split("/") as [string, string];
      const actual = contrast(resolve(id, fgName), resolve(id, bgName));
      expect(actual, `${key} now clears AA — delete its exception`).toBeLessThan(AA_BODY);
      expect(actual, `${key} improved past its pinned floor — tighten it`).toBeLessThan(floor + 0.1);
    }
  });
});
