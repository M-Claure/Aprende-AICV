import { headers } from "next/headers";
import { BRAND_HEADER } from "@/lib/brand/constants";
import { getBrandConfig, isBrandId, type BrandId } from "@/lib/brand/registry";
import { brandEnv, resolveBrand } from "@/lib/brand/resolve";
import type { BrandConfig } from "@/lib/brand/types";

/**
 * Server-side access to the active brand, for Server Components, route handlers
 * and `generateMetadata`.
 *
 * The middleware normally resolves the brand once per request and stamps it on
 * `x-brand`, so this is just a header read. When that header is missing — the
 * middleware matcher skips a path, or middleware is bypassed entirely — we
 * re-resolve from the request's own host and cookie rather than guessing, so a
 * page never renders in the wrong brand just because it sits outside the matcher.
 */
export function getActiveBrandId(): BrandId {
  const requestHeaders = headers();

  const stamped = requestHeaders.get(BRAND_HEADER);
  if (isBrandId(stamped)) return stamped;

  const { envDefault, hostOverrides } = brandEnv();
  return resolveBrand({
    host: requestHeaders.get("host"),
    // `cookies()` would work too, but reading the Cookie header keeps this to a
    // single dynamic API and one code path.
    cookie: readCookie(requestHeaders.get("cookie"), "brand"),
    envDefault,
    hostOverrides,
  }).brandId;
}

/** The active brand's full config. */
export function getActiveBrand(): BrandConfig {
  return getBrandConfig(getActiveBrandId());
}

/** Minimal `Cookie:` header parse — one name, no dependencies. */
function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.split("=");
    if (key?.trim() === name) return decodeURIComponent(rest.join("=").trim());
  }
  return null;
}
