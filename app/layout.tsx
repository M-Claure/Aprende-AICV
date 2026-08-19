import type { Metadata } from "next";
import "./globals.css";
import { BRAND_FONT_CLASS } from "./fonts";
import { BrandHeader } from "@/components/marketing/BrandHeader";
import { BrandProvider } from "@/lib/brand/context";
import { BRAND_ATTRIBUTE } from "@/lib/brand/constants";
import { getBrandConfig } from "@/lib/brand/registry";
import { getActiveBrandId } from "@/lib/brand/server";
import { brandThemeCss } from "@/lib/brand/theme-css";

/**
 * The root layout is where a request becomes a *branded* request.
 *
 * Four things happen here, all before first paint so nothing flashes the wrong
 * brand: the brand's fonts are bound, its palette is inlined as CSS custom
 * properties, its config is provided to Client Components, and its header is
 * rendered. Everything below this layout is brand-agnostic and reads semantic
 * tokens — see `docs/branding.md`.
 */

/**
 * Per-brand `<head>` metadata. Dynamic because the brand comes from the request
 * (see `lib/brand/resolve.ts`), so it cannot be a static `metadata` export.
 */
export function generateMetadata(): Metadata {
  const brand = getBrandConfig(getActiveBrandId());
  return {
    title: brand.metadata.title,
    description: brand.metadata.description,
    // Only set when a brand ships its own icons; otherwise the shared
    // file-convention icons in `app/` apply (both brands use the same flame mark).
    ...(brand.metadata.icon
      ? {
          icons: {
            icon: brand.metadata.icon,
            ...(brand.metadata.appleIcon ? { apple: brand.metadata.appleIcon } : {}),
          },
        }
      : {}),
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const brandId = getActiveBrandId();
  const brand = getBrandConfig(brandId);

  return (
    <html
      lang="es"
      className={BRAND_FONT_CLASS[brandId]}
      // Exposed for the rare brand-specific CSS escape hatch and for debugging
      // which brand a page rendered as.
      {...{ [BRAND_ATTRIBUTE]: brandId }}
    >
      <head>
        {/*
          The active brand's palette, fonts and metrics as `:root` custom
          properties. Inlined rather than shipped as a stylesheet so only one
          brand's values ever reach the browser and they apply on first paint.
          The content is generated from an in-repo config and hex-validated —
          never user input. See lib/brand/theme-css.ts.
        */}
        <style
          id="brand-theme"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: brandThemeCss(brand) }}
        />
      </head>
      <body className="bg-bg-primary font-main text-text-primary antialiased">
        <BrandProvider brand={brand}>
          <BrandHeader />
          {children}
        </BrandProvider>
      </body>
    </html>
  );
}
