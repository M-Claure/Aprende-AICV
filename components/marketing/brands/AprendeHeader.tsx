import { BrandWordmark } from "@/components/marketing/BrandWordmark";
import type { BrandConfig } from "@/lib/brand/types";

/**
 * **Aprende Institute** brand bar — deliberately more restrained than the
 * Rumbo Latino one: no coloured rule, a single hairline, and the product name set as
 * letterspaced small caps to echo the "INSTITUTE" lettering in the lockup.
 *
 * This is the case the per-brand override exists for. The two headers share the
 * isologo renderer (`BrandWordmark`) but nothing else — reproducing this chrome
 * through props on one component would have meant a flag for the top rule, a flag
 * for the divider, a flag for the type treatment, and a component nobody can read.
 *
 * Height must stay in sync with `headerHeight` in the Aprende config
 * (64px bar + 1px hairline = 65px = 4.0625rem).
 */
export function AprendeHeader({ brand }: { brand: BrandConfig }) {
  return (
    <header className="border-b border-border bg-white">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-5 sm:gap-5">
        <BrandWordmark brand={brand} />

        <span className="h-7 w-px shrink-0 bg-border" aria-hidden />

        <span className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-strong sm:text-xs">
          {brand.productName}
        </span>
      </div>
    </header>
  );
}
