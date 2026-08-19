import { BrandWordmark } from "@/components/marketing/BrandWordmark";
import type { BrandConfig } from "@/lib/brand/types";

/**
 * **Rumbo Latino** brand bar: a coral rule across the top, then a bar carrying
 * the isologo, a divider, and the product name in Poppins caps.
 *
 * The coral rule is this product's own header treatment (rumbolatino.com's nav is
 * a sticky translucent cream bar with a hairline). It is kept because it reads as
 * the app chrome that carries "MI CV CON IA", and it uses the brand's own accent.
 *
 * Height must stay in sync with `headerHeight` in the Rumbo Latino config
 * (4px rule + 64px bar = 68px = 4.25rem) — `.min-h-page` subtracts it.
 */
export function RumboLatinoHeader({ brand }: { brand: BrandConfig }) {
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
