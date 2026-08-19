import type { BrandConfig } from "@/lib/brand/types";
import { aprendeBrand } from "@/lib/brand/brands/aprende";
import { aprendePlusBrand } from "@/lib/brand/brands/aprende-plus";

/**
 * The brand registry — the single place a brand is added.
 *
 * ## Adding a brand
 * 1. Add `lib/brand/brands/<id>.ts` exporting a `BrandConfig` (copy the closest
 *    existing one; fill in every colour token — `BrandColorTokens` is exhaustive
 *    on purpose so a new brand cannot silently inherit another's colours).
 * 2. Add one line below. `BrandId` widens automatically, so every switch and
 *    `Record<BrandId, …>` in the codebase becomes a type error until it handles
 *    the new brand — including the font registry in `app/fonts.ts`.
 * 3. Drop its assets in `public/brands/<id>/`.
 * 4. Optionally register a brand-specific header/hero in
 *    `components/marketing/registry.tsx`. Without one it gets the shared,
 *    config-driven defaults.
 *
 * Nothing else needs to change: product components read semantic tokens, and
 * host resolution reads `hosts` off the config.
 */
export const BRANDS = {
  "aprende-plus": aprendePlusBrand,
  aprende: aprendeBrand,
} as const satisfies Record<string, BrandConfig>;

/** Every valid brand slug, derived from the registry. */
export type BrandId = keyof typeof BRANDS;

/** Registry keys as an array — stable order, useful for tests and tooling. */
export const BRAND_IDS = Object.keys(BRANDS) as BrandId[];

/**
 * The brand served when nothing else resolves (unknown host, no override, no
 * `DEFAULT_BRAND`). Aprende+ because that is what the app shipped as, so an
 * un-configured deploy looks exactly as it did before the brand system existed.
 */
export const FALLBACK_BRAND_ID: BrandId = "aprende-plus";

/** Type guard for untrusted input — a cookie value, a query param, an env var. */
export function isBrandId(value: unknown): value is BrandId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BRANDS, value);
}

/** Look up a brand config. Falls back rather than throwing: an unknown brand
 *  must degrade to a styled page, never to a 500. */
export function getBrandConfig(id: string | null | undefined): BrandConfig {
  return isBrandId(id) ? BRANDS[id] : BRANDS[FALLBACK_BRAND_ID];
}
