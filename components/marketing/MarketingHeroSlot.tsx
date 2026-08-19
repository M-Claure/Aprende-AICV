"use client";

import { BRAND_MARKETING } from "@/components/marketing/registry";
import { useBrand } from "@/lib/brand/context";
import { isBrandId } from "@/lib/brand/registry";
import { MarketingHero, type MarketingHeroProps } from "@/components/marketing/MarketingHero";

/**
 * Client-side counterpart to `BrandHeader`: renders the active brand's hero.
 *
 * Kept separate from the hero itself so `app/page.tsx` stays free of brand
 * dispatch — it just owns the consent state and hands it down.
 */
export function MarketingHeroSlot(props: Omit<MarketingHeroProps, "brand">) {
  const brand = useBrand();
  const Hero = isBrandId(brand.id) ? BRAND_MARKETING[brand.id].Hero : MarketingHero;
  return <Hero brand={brand} {...props} />;
}
