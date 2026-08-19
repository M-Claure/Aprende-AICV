import { AprendeHeader } from "@/components/marketing/brands/AprendeHeader";
import { AprendePlusHeader } from "@/components/marketing/brands/AprendePlusHeader";
import { MarketingHero, type MarketingHeroProps } from "@/components/marketing/MarketingHero";
import type { BrandId } from "@/lib/brand/registry";
import type { BrandConfig } from "@/lib/brand/types";

/**
 * Per-brand marketing components.
 *
 * The brand *configs* stay pure data (they have to — edge middleware reads them),
 * so component overrides are registered here instead, in the UI layer. That keeps
 * the dependency arrow pointing one way: components import configs, never the
 * reverse.
 *
 * ## The rule for what goes here
 * Reuse first. A shared, config-driven component with a layout variant covers
 * most brand differences — that is how `MarketingHero` serves both brands today.
 * Register a dedicated component only when the designs diverge structurally
 * enough that expressing both in one component would mean a flag per visual
 * decision. The headers are the honest example: Aprende+ leads with a coral rule
 * and a Poppins isologo, Aprende Institute with a hairline and a serif lockup, and
 * they share only the isologo renderer.
 *
 * ## The one constraint on a registered component
 * It must be **presentational**: it takes `brand` as a prop and calls no
 * server-side API. This module is reached from both a Server Component (the
 * layout, via `BrandHeader`) and a Client Component (`app/page.tsx`, via
 * `MarketingHeroSlot`), so a component that called `headers()` or imported
 * `lib/env` would break the client build.
 */
export interface BrandMarketingComponents {
  Header: (props: { brand: BrandConfig }) => JSX.Element;
  Hero: (props: MarketingHeroProps) => JSX.Element;
}

/**
 * Every brand's marketing components. `Record<BrandId, …>` on purpose: a new
 * brand is a compile error here until it declares what it renders, which is
 * cheaper than discovering at runtime that it fell back to another brand's header.
 * Point `Hero` at the shared `MarketingHero` unless the brand truly needs its own.
 */
export const BRAND_MARKETING: Record<BrandId, BrandMarketingComponents> = {
  "aprende-plus": { Header: AprendePlusHeader, Hero: MarketingHero },
  aprende: { Header: AprendeHeader, Hero: MarketingHero },
};
