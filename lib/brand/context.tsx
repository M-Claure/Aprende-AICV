"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { BrandConfig } from "@/lib/brand/types";

/**
 * Client-side access to the active brand.
 *
 * The brand is resolved once on the server (`lib/brand/server.ts`) and handed
 * down as props — a `BrandConfig` is plain serializable data precisely so it can
 * cross the server/client boundary. Client components therefore never re-derive
 * the brand from the URL, which would risk a hydration mismatch and a visible
 * flash of the wrong brand.
 *
 * Colours and fonts do NOT come through here — those are CSS custom properties
 * applied to `:root`, so shared components stay brand-agnostic and only need this
 * context for *content*: copy, CTA labels, logo assets, legal links.
 */
const BrandContext = createContext<BrandConfig | null>(null);

export function BrandProvider({ brand, children }: { brand: BrandConfig; children: ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

/** The active brand. Throws if used outside the provider — that is a wiring bug,
 *  and a silent fallback would ship the wrong brand's copy to real users. */
export function useBrand(): BrandConfig {
  const brand = useContext(BrandContext);
  if (!brand) {
    throw new Error("useBrand() must be used inside <BrandProvider> (see app/layout.tsx)");
  }
  return brand;
}
