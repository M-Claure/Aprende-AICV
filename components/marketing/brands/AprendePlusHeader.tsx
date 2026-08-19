import { BrandWordmark } from "@/components/marketing/BrandWordmark";
import type { BrandConfig } from "@/lib/brand/types";

/**
 * **Aprende+** brand bar: a coral rule across the top, then a white bar carrying
 * the isologo, a divider, and the product name in Poppins caps.
 *
 * Height must stay in sync with `headerHeight` in the Aprende+ config
 * (4px rule + 64px bar = 68px = 4.25rem) — `.min-h-page` subtracts it.
 */
export function AprendePlusHeader({ brand }: { brand: BrandConfig }) {
  return (
    <header className="border-b border-border bg-white">
      <div className="h-1 w-full bg-accent" aria-hidden />
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-5 sm:gap-4">
        <BrandWordmark brand={brand} className="text-[22px]" />

        <span className="h-6 w-px shrink-0 bg-border" aria-hidden />

        <span className="truncate font-heading text-base font-bold uppercase tracking-wide text-brand-strong sm:text-lg">
          {brand.productName}
        </span>
      </div>
    </header>
  );
}
