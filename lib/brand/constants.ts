/**
 * Wire names shared by the brand plumbing. No imports — this module is read from
 * edge middleware, Server Components and Client Components alike.
 */

/**
 * Request header the middleware stamps with the resolved brand id, so Server
 * Components and route handlers read one already-resolved value instead of each
 * re-deriving it from the host.
 */
export const BRAND_HEADER = "x-brand";

/**
 * Cookie that pins an explicitly chosen brand (via `?brand=`) for the rest of the
 * session. Not a security boundary — the brand selects styling and marketing copy
 * only, and gates no data whatsoever.
 */
export const BRAND_COOKIE = "brand";

/** Query parameter that overrides the brand and sets the cookie. */
export const BRAND_QUERY = "brand";

/** `data-brand` attribute set on `<html>`; handy for brand-specific CSS escapes. */
export const BRAND_ATTRIBUTE = "data-brand";
