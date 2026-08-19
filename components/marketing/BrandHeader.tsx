import { BRAND_MARKETING } from "@/components/marketing/registry";
import { getBrandConfig } from "@/lib/brand/registry";
import { getActiveBrandId } from "@/lib/brand/server";

/**
 * The brand bar rendered above every screen by `app/layout.tsx`.
 *
 * A Server Component: it resolves the active brand from the request and renders
 * that brand's header, so no brand-switching logic reaches the client and there is
 * no flash of the wrong brand on first paint. `BRAND_MARKETING` is total over
 * `BrandId`, so there is no fallback to get wrong.
 */
export function BrandHeader() {
  const brandId = getActiveBrandId();
  const { Header } = BRAND_MARKETING[brandId];
  return <Header brand={getBrandConfig(brandId)} />;
}
