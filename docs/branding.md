# Multi-brand system

One repo, one build, one product — two marketing skins. **Aprende+** (warm,
learner-facing) and **Aprende Institute** (formal, institutional) are served from
the same deployment, chosen per request.

Everything below the marketing layer is shared: the adaptive funnel, the question
engine, skill inference, AI orchestration, the résumé generator and the résumé
document itself. There is no fork, no duplicated route, and no per-brand branch of
product logic.

## What is branded and what is not

| Branded | Shared |
| --- | --- |
| Palette, typography, header, favicon-capable metadata | Every funnel screen and component |
| Landing hero: headline, lede, steps, CTA, layout | Question catalog, completeness engine, prioritizer |
| Contact-step and sign-in copy | AI providers, prompts, Zod schemas |
| Logo assets, consent link | `Store` / Supabase, RLS, analytics |
| | **The generated résumé** — see below |

The résumé is deliberately *not* themed. It is the user's document, sent to
employers, and `lib/resume/resume-renderer.ts` keeps its own neutral print palette
on purpose. Branding the résumé would put our marketing colours on someone else's
job application.

## How a brand is chosen

Host-based, resolved once per request in `middleware.ts` and stamped on the
`x-brand` request header, which `lib/brand/server.ts` reads. Host-based because
the brand is a property of the domain the visitor arrived on: one build serves both
domains at once, URLs stay clean, and no route is duplicated. A build-time env var
would force one deploy per brand; a path prefix (`/plus/…`) would fork every route.

Precedence — first match wins (`lib/brand/resolve.ts`):

1. **`?brand=<id>`** — explicit override, persisted to a `brand` cookie for the
   session. For local work and stakeholder review links on one domain.
2. **`brand` cookie** — a previously chosen override.
3. **`BRAND_HOST_OVERRIDES`** — `host=brandId` pairs, for a campaign or staging
   domain, without a code change.
4. **Host match** against each config's `hosts` (`*.example.com` wildcards allowed).
5. **`DEFAULT_BRAND`** — for preview deploys and `localhost`.
6. **`FALLBACK_BRAND_ID`** — `aprende-plus`, so an unconfigured deploy looks exactly
   as the app did before the brand system existed.

`?brand=auto` (or any unrecognised value) clears the override and returns to
host-based resolution, taking effect on that same response.

The brand gates **styling and copy only** — never data access, and never a
permission. It is not a security boundary, which is why an unauthenticated query
override is fine.

## How the theme is applied

`BrandConfig` holds readable hex. `lib/brand/theme-css.ts` converts each colour to
an `"R G B"` channel triplet and emits a `:root { … }` block that `app/layout.tsx`
inlines into `<head>`. `tailwind.config.ts` contains **no brand colours at all** —
every token resolves to `rgb(var(--c-…) / <alpha-value>)`.

Consequences worth knowing:

- Shared components keep the class names they already had (`bg-accent`,
  `text-accent-dark`, `border-border`) and re-theme for free.
- Only the active brand's values reach the browser, applied before first paint —
  no flash of the wrong brand.
- Opacity modifiers (`bg-accent/50`) keep working; that is why the vars are channel
  triplets rather than hex.
- Adding a brand needs **no CSS change anywhere**.

Tokens are **semantic, not literal** — `accent`, `text-primary`, `border`, never
`coral` or `plum`. A literal name stops being true the moment a second brand
exists. The literal brand colours are reachable as `brand-strong`, `brand-mark` and
`brand-support`, for the marketing layer only.

## Accessibility contract

The audience is low-literacy learners reading Spanish on phones, often in poor
light, so contrast is a hard requirement rather than a nice-to-have.
`tests/unit/brand-theme.test.ts` asserts WCAG AA (4.5:1) for every brand across
body text, secondary text, interactive text, accent-filled button labels and the
instruction banner.

Two consequences show up in every brand config:

- **`accentDark` is not the accent.** A saturated brand accent almost never clears
  4.5:1 as 14px text on a light surface, so interactive text uses the dark brand
  anchor (plum for Aprende+, navy for Aprende).
- **`accentOn` differs per brand.** Ink on Aprende+'s light coral (5.44:1); white on
  Aprende's darker crimson (4.80:1).

Two inherited Aprende+ values sit just below AA and are pinned as documented
exceptions in that test rather than silently changed — see `KNOWN_BELOW_AA`.

## Reuse vs. per-brand components

Reuse first. A shared, config-driven component with a *layout variant* covers most
brand differences: `MarketingHero` serves both brands from one file, switching
between a `centered` and an `editorial` layout while sharing the step list, the
consent block and the CTA.

Register a dedicated component in `components/marketing/registry.tsx` only when the
designs diverge structurally enough that one component would need a flag per visual
decision. The headers are the honest example — Aprende+ leads with a coral rule and
a Poppins isologo, Aprende Institute with a hairline and a serif lockup — and even
they share the isologo renderer (`BrandWordmark`).

A registered component must be **presentational**: it takes `brand` as a prop and
calls no server API. The registry is reached from both a Server Component (the
layout) and a Client Component (`app/page.tsx`).

## Layout

```
lib/brand/
  types.ts        BrandConfig — pure, serializable data (no React, no I/O)
  brands/*.ts     one file per brand: colours, fonts, logo, copy, hosts
  registry.ts     BRANDS + BrandId (derived from the keys) + guards
  resolve.ts      PURE resolution: host matching, precedence, env parsing
  css-vars.ts     the Tailwind contract — must stay import-free
  theme-css.ts    BrandConfig → :root custom properties
  server.ts       getActiveBrand() for Server Components (reads x-brand)
  context.tsx     BrandProvider / useBrand() for Client Components
  constants.ts    header / cookie / query names (edge-safe)

components/marketing/
  registry.tsx        BrandId → { Header, Hero }
  BrandHeader.tsx     server dispatcher
  MarketingHeroSlot.tsx  client dispatcher
  BrandWordmark.tsx   shared isologo renderer (lockup | mark + live wordmark)
  MarketingHero.tsx   shared hero, two layouts
  brands/*Header.tsx  per-brand headers

app/fonts.ts          BrandId → next/font variables
public/brands/<id>/   per-brand assets
```

The dependency arrow points one way: components import configs, configs import
nothing but `lib/legal/terms`. That is what lets edge middleware read a brand
config at all.

## Adding a brand

1. `lib/brand/brands/<id>.ts` — export a `BrandConfig`. Every colour token is
   required, so a new brand cannot silently inherit another's palette.
2. Add one line to `BRANDS` in `lib/brand/registry.ts`. `BrandId` widens
   automatically, which turns every `Record<BrandId, …>` into a compile error until
   it handles the new brand.
3. Add its fonts to `app/fonts.ts` (a compile error until you do).
4. Drop assets in `public/brands/<id>/`.
5. Optionally register a header/hero in `components/marketing/registry.tsx`.
6. Point a domain at it: add `hosts` to the config, or set `BRAND_HOST_OVERRIDES`.

Then `npm run typecheck && npm test`. The brand tests run over every registered
brand automatically — the new one is covered for palette completeness, contrast,
asset namespacing, copy completeness and font wiring without writing a test.

## Local development

```bash
npm run dev
open 'http://localhost:3000/?brand=aprende'       # switch, sticky for the session
open 'http://localhost:3000/?brand=aprende-plus'
open 'http://localhost:3000/?brand=auto'          # back to host-based
```

Or set `DEFAULT_BRAND=aprende` in `.env.local` to make it the default on
`localhost`. `data-brand` on `<html>` always tells you which brand rendered.
