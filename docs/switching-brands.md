# Switching the brand

The app ships two marketing brands from one build:

| Brand id | Name | Feel |
| --- | --- | --- |
| `rumbo-latino` | Rumbo Latino | Warm, learner-facing. Coral/plum, Poppins. |
| `aprende` | Aprende Institute | Formal, institutional. Navy/crimson, serif. |

Only marketing changes — colours, typography, header, landing copy, logo, favicon,
metadata. The funnel, the AI, the résumé itself and the database are identical.

**Valid ids are exactly `rumbo-latino` and `aprende`.** Anything else — `Aprende`,
`aprende-institute`, `rumbolatino` — is rejected at startup with a message listing
the valid values, rather than silently serving the wrong brand.

---

## Which lever do I pull?

This is the part that trips people up, so start here.

The brand is chosen **per request, from the host**. `DEFAULT_BRAND` is only the
fallback for hosts that no brand claims. So the right lever depends on the domain
you are serving:

| Your domain | What decides the brand | What to set |
| --- | --- | --- |
| `*.vercel.app` preview, `localhost` | nothing claims it → `DEFAULT_BRAND` | **`DEFAULT_BRAND`** |
| `rumbolatino.com`, `www.`, `*.rumbolatino.com` | claimed by `rumbo-latino` | **`BRAND_HOST_OVERRIDES`** |
| `aprende.com`, `www.`, `cv.aprende.com` | claimed by `aprende` | **`BRAND_HOST_OVERRIDES`** |
| any other custom domain | nothing claims it → `DEFAULT_BRAND` | **`DEFAULT_BRAND`** |

> **`DEFAULT_BRAND` does not override a host a brand already claims.**
> Setting `DEFAULT_BRAND=aprende` on a deployment served at `rumbolatino.com`
> does nothing at all — the host match wins and you still get Rumbo Latino. This
> is deliberate: it is what lets one deployment serve both domains at once. If
> the switch "isn't working", this is almost always why.

Not sure which case you are in? Load the site and look at `<html data-brand="…">`
in the page source. It always names the brand that actually rendered.

---

## Case 1 — preview deploys, localhost, or an unclaimed domain

Set one environment variable:

```
DEFAULT_BRAND=aprende
```

**In Vercel:** Dashboard → your project → **Settings → Environment Variables** →
Add. Tick the environments you want it in (Production / Preview / Development),
save, then **redeploy** — Vercel only picks up environment changes on a new
deployment. Re-running an old deployment will not do it.

**Locally:** add the same line to `.env.local` and restart `npm run dev`.

To go back to Rumbo Latino, delete the variable (it is the fallback) or set it
explicitly to `rumbo-latino`. Redeploy either way.

## Case 2 — a domain one of the brands already claims

Point the host at the brand you want:

```
BRAND_HOST_OVERRIDES=rumbolatino.com=aprende,www.rumbolatino.com=aprende
```

Comma-separated `host=brandId` pairs. This is consulted **before** each brand's
own `hosts` list, so it wins. List every hostname you actually serve — the apex
and the `www.` form are different hosts.

Same Vercel steps as above, and the same redeploy requirement.

> Unlike `DEFAULT_BRAND`, an unparseable *entry* in this list is skipped rather
> than fatal, so one bad pair cannot take the site down. That also means a typo
> here fails quietly — check `data-brand` after deploying.

## Case 3 — permanent switch, not a config toggle

If a domain should belong to the other brand for good, move it in the code rather
than carrying an override forever. In `lib/brand/brands/<id>.ts`, cut the hostname
from one brand's `hosts` array and paste it into the other's. That is the whole
change; `tests/unit/brand-resolution.test.ts` will fail if two brands end up
claiming the same host.

---

## Checking it worked

```bash
curl -s https://your-domain.com | grep -o 'data-brand="[^"]*"'
```

Expect `data-brand="aprende"` or `data-brand="rumbo-latino"`. The page `<title>`
is a second confirmation — it ends in the brand name.

To preview the other brand on any deployment without changing configuration, add
`?brand=aprende` to the URL. The choice sticks for the session via a cookie;
`?brand=auto` clears it. Handy for stakeholder review links, and it changes
nothing for anyone else.

---

## If it does not work

**Nothing changed after setting the variable.**
Either you did not redeploy, or you are in Case 2 and the host is overriding you.
Check `data-brand` — if it names the brand you did *not* ask for and the domain is
in the table above, you need `BRAND_HOST_OVERRIDES`.

**Every request returns 500 after the change.**
Almost certainly a misspelled `DEFAULT_BRAND`. The Vercel function log will carry:

```
DEFAULT_BRAND="Aprende" is not a registered brand. Valid values: rumbo-latino, aprende.
```

Ids are lowercase and hyphenated. Fix the value and redeploy. This failure is
deliberate — the alternative is a deployment that silently serves the wrong
company's branding.

**A cookie is pinning you to one brand.**
If you previously visited with `?brand=…`, that choice persists for 30 days.
Load `?brand=auto` to clear it, or use a private window.

---

## Adding a third brand

See [`branding.md`](./branding.md#adding-a-brand). Short version: a config file in
`lib/brand/brands/`, one line in the registry, fonts in `app/fonts.ts`, assets in
`public/brands/<id>/`. `BrandId` derives from the registry, so TypeScript will
point at every place that needs updating.
