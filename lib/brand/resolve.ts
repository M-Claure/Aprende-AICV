import { BRANDS, FALLBACK_BRAND_ID, isBrandId, type BrandId } from "@/lib/brand/registry";

/**
 * Brand resolution — PURE. Every input is passed in, so this is testable without
 * Next, and callable from edge middleware and Server Components alike.
 *
 * ## Why host-based
 * The brand is a property of the *domain the visitor arrived on*, so the host is
 * the only signal that needs no URL noise, no duplicated page files, and no
 * separate deploy: one build serves `aprende.com` and `aprendeplus.com` at the
 * same time. The alternatives were each worse — a build-time env var forces one
 * deploy per brand, and a path prefix (`/plus/…`) would fork every route.
 *
 * ## Precedence (first match wins)
 * 1. `?brand=<id>` — explicit override. Persisted to a cookie so the rest of the
 *    session keeps it. Exists for local development and for stakeholder review
 *    links on a single domain.
 * 2. `brand` cookie — a previously chosen override. Skipped entirely when a
 *    `brand` query parameter is present but unrecognised (`?brand=auto`), since
 *    that is an explicit request to stop overriding — honouring the stale cookie
 *    for one more response would make the reset appear not to work.
 * 3. Host match against each config's `hosts`.
 * 4. `DEFAULT_BRAND` env var — for preview deploys and single-brand hosting where
 *    the domain is not one of the real ones (`*.vercel.app`, `localhost`).
 * 5. `FALLBACK_BRAND_ID`.
 *
 * Putting the override ABOVE the host match is deliberate: an override is always
 * explicit, and its whole purpose is to disagree with the host.
 */
export interface BrandResolutionInput {
  /** Request `Host` header. Port and case are handled here. */
  host?: string | null;
  /** Value of the `brand` cookie, if any. */
  cookie?: string | null;
  /**
   * Value of the `?brand=` query parameter. `null`/`undefined` means *absent*;
   * any string — including `""` — means *present*, which is what makes
   * `?brand=auto` a reset rather than a no-op.
   */
  query?: string | null;
  /** `DEFAULT_BRAND` env value, if set. */
  envDefault?: string | null;
  /** Parsed `BRAND_HOST_OVERRIDES`; consulted before the configs' own `hosts`. */
  hostOverrides?: Readonly<Record<string, BrandId>>;
}

export interface BrandResolution {
  brandId: BrandId;
  /** Which rule decided it — surfaced for debugging and asserted in tests. */
  source: "query" | "cookie" | "host-override" | "host" | "env-default" | "fallback";
}

/** Lowercase and strip the port, IPv6 brackets and any trailing dot. */
function normalizeHost(host: string): string {
  const withoutBrackets = host.trim().replace(/^\[(.+)\]$/, "$1");
  // Strip the port, but not an IPv6 address's own colons.
  const hostOnly = withoutBrackets.includes(":") && !withoutBrackets.includes("]")
    ? withoutBrackets.split(":")[0] ?? withoutBrackets
    : withoutBrackets;
  return hostOnly.toLowerCase().replace(/\.$/, "");
}

/**
 * `*.example.com` matches any subdomain of `example.com` at any depth, but not
 * the apex — list the apex explicitly when a brand should serve it too.
 */
function hostMatchesPattern(host: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  if (p.startsWith("*.")) {
    const suffix = p.slice(1); // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === p;
}

/** The brand whose `hosts` match, or null. */
export function brandIdForHost(host: string | null | undefined): BrandId | null {
  if (!host) return null;
  const normalized = normalizeHost(host);
  if (!normalized) return null;
  for (const id of Object.keys(BRANDS) as BrandId[]) {
    if (BRANDS[id].hosts.some((pattern) => hostMatchesPattern(normalized, pattern))) return id;
  }
  return null;
}

/**
 * Parse `BRAND_HOST_OVERRIDES` — `"host=brandId,host=brandId"`. Lets ops point an
 * extra domain (a campaign domain, a staging host) at a brand without a code
 * change. Unparseable or unknown entries are skipped rather than thrown: a typo
 * in an env var must not take the site down.
 */
export function parseHostOverrides(raw: string | null | undefined): Record<string, BrandId> {
  const map: Record<string, BrandId> = {};
  if (!raw) return map;
  for (const pair of raw.split(",")) {
    const [host, brand] = pair.split("=", 2).map((part) => part?.trim() ?? "");
    if (!host || !isBrandId(brand)) continue;
    map[normalizeHost(host)] = brand;
  }
  return map;
}

/** Apply the documented precedence. */
export function resolveBrand(input: BrandResolutionInput): BrandResolution {
  if (isBrandId(input.query)) return { brandId: input.query, source: "query" };

  // A present-but-unrecognised `?brand=` is an explicit reset (`?brand=auto`), so
  // the cookie is ignored on this request too — not just deleted for the next one.
  const queryPresent = input.query !== null && input.query !== undefined;
  if (!queryPresent && isBrandId(input.cookie)) {
    return { brandId: input.cookie, source: "cookie" };
  }

  if (input.host && input.hostOverrides) {
    const override = input.hostOverrides[normalizeHost(input.host)];
    if (override) return { brandId: override, source: "host-override" };
  }

  const fromHost = brandIdForHost(input.host);
  if (fromHost) return { brandId: fromHost, source: "host" };

  if (isBrandId(input.envDefault)) return { brandId: input.envDefault, source: "env-default" };

  return { brandId: FALLBACK_BRAND_ID, source: "fallback" };
}

/**
 * Read the brand env vars straight off `process.env`.
 *
 * Deliberately not routed through `lib/env.ts`: that module is `server-only` and
 * this one has to work inside edge middleware, which is the earliest place the
 * brand must be known. `lib/env.ts` still declares and validates the same two
 * variables so an invalid value is caught at startup rather than silently
 * ignored here.
 *
 * Neither variable is `NEXT_PUBLIC_`: the brand reaches the browser as resolved
 * props, so the hosting map never needs to ship in the client bundle.
 */
export function brandEnv(): { envDefault: string | null; hostOverrides: Record<string, BrandId> } {
  return {
    envDefault: process.env.DEFAULT_BRAND ?? null,
    hostOverrides: parseHostOverrides(process.env.BRAND_HOST_OVERRIDES),
  };
}
