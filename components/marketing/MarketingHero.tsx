"use client";

import { Button } from "@/components/primitives";
import type { BrandConfig, BrandHeroStep } from "@/lib/brand/types";

/**
 * The landing pitch — the app's main marketing surface.
 *
 * Every string, the CTA label and the consent link come from `brand.hero` and
 * `brand.legal`, so a brand changes its whole pitch without touching this file.
 * Two layouts cover the visual difference between the current brands:
 *
 *   `centered`  — Rumbo Latino: centred, a pill badge, emoji step cards. Warm and
 *                 conversational.
 *   `editorial` — Aprende Institute: left-aligned, serif headline, numbered
 *                 steps. Formal and institutional.
 *
 * A *layout variant* is the right tool while the pieces are the same content in a
 * different arrangement — which is why the consent block, the CTA and the step
 * list below are shared by both. Register a separate component in
 * `components/marketing/registry.tsx` only when a brand's landing page stops
 * being this page (different sections, different order, different content model).
 */
export interface MarketingHeroProps {
  brand: BrandConfig;
  /** Consent state — owned by the page, since it gates profile creation. */
  agreed: boolean;
  onAgreedChange: (agreed: boolean) => void;
  onStart: () => void;
}

export function MarketingHero({ brand, agreed, onAgreedChange, onStart }: MarketingHeroProps) {
  return brand.hero.layout === "editorial" ? (
    <EditorialHero brand={brand} agreed={agreed} onAgreedChange={onAgreedChange} onStart={onStart} />
  ) : (
    <CenteredHero brand={brand} agreed={agreed} onAgreedChange={onAgreedChange} onStart={onStart} />
  );
}

/** Rumbo Latino — centred, warm, emoji-led. */
function CenteredHero({ brand, agreed, onAgreedChange, onStart }: MarketingHeroProps) {
  const { hero } = brand;
  return (
    <main className="mx-auto flex min-h-page max-w-2xl flex-col items-center justify-center px-6 py-16 text-center">
      {/* The product name is in the brand header, so this badge carries the offer instead. */}
      {hero.badge && (
        <span className="mb-4 rounded-full bg-accent-light px-4 py-1 text-sm font-semibold text-accent-dark">
          {hero.badge}
        </span>
      )}

      <h1 className="font-heading text-4xl font-bold leading-tight text-text-primary">
        {hero.headline}
      </h1>

      <p className="mt-4 max-w-lg text-lg leading-relaxed text-text-primary">{hero.lede}</p>

      {/* Cómo funciona: pasos simples, con dibujos */}
      <ol className="mt-8 flex w-full max-w-md flex-col gap-3 text-left">
        {hero.steps.map((step, i) => (
          <StepRow key={i} step={step} variant="icon" />
        ))}
      </ol>

      <Reassurance hero={hero} className="mt-6 max-w-lg text-center" />

      <ConsentBox brand={brand} agreed={agreed} onAgreedChange={onAgreedChange} className="mt-8 max-w-md" />

      <div className="mt-6">
        <Button onClick={onStart} disabled={!agreed}>
          {hero.ctaLabel}
        </Button>
      </div>
      {!agreed && <p className="mt-2 text-xs text-text-secondary">{hero.ctaBlockedHint}</p>}
    </main>
  );
}

/** Aprende Institute — left-aligned, serif, numbered. */
function EditorialHero({ brand, agreed, onAgreedChange, onStart }: MarketingHeroProps) {
  const { hero } = brand;
  return (
    <main className="mx-auto flex min-h-page max-w-2xl flex-col justify-center px-6 py-16">
      {hero.badge && (
        <span className="mb-4 self-start text-xs font-semibold uppercase tracking-[0.16em] text-accent-dark">
          {hero.badge}
        </span>
      )}

      <h1 className="font-heading text-4xl font-semibold leading-tight text-brand-strong">
        {hero.headline}
      </h1>

      {/* A short accent rule under the headline — the institutional equivalent of
          the pill badge the centred layout uses. */}
      <span className="mt-5 h-0.5 w-16 bg-accent" aria-hidden />

      <p className="mt-5 text-lg leading-relaxed text-text-primary">{hero.lede}</p>

      {hero.stepsTitle && (
        <h2 className="mt-10 text-sm font-semibold uppercase tracking-[0.14em] text-text-secondary">
          {hero.stepsTitle}
        </h2>
      )}
      <ol className="mt-4 flex flex-col gap-3">
        {hero.steps.map((step, i) => (
          <StepRow key={i} step={step} variant="numeral" />
        ))}
      </ol>

      <Reassurance hero={hero} className="mt-8" />

      <ConsentBox brand={brand} agreed={agreed} onAgreedChange={onAgreedChange} className="mt-8" />

      <div className="mt-6 self-start">
        <Button onClick={onStart} disabled={!agreed}>
          {hero.ctaLabel}
        </Button>
      </div>
      {!agreed && <p className="mt-2 text-xs text-text-secondary">{hero.ctaBlockedHint}</p>}
    </main>
  );
}

/**
 * One "how it works" step. `icon` renders the config string as a large glyph
 * (emoji); `numeral` renders it inside an accent badge, for configs that supply
 * "1", "2", "3".
 */
function StepRow({ step, variant }: { step: BrandHeroStep; variant: "icon" | "numeral" }) {
  return (
    <li className="flex items-center gap-4 rounded-2xl border border-border bg-white px-4 py-3">
      {variant === "numeral" ? (
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-on"
          aria-hidden
        >
          {step.icon}
        </span>
      ) : (
        <span className="text-2xl" aria-hidden>
          {step.icon}
        </span>
      )}
      <span className="text-base leading-snug text-text-primary">{step.text}</span>
    </li>
  );
}

/** The "you don't need prior work experience / we only include what you confirm"
 *  paragraph, with its second half emphasised. */
function Reassurance({
  hero,
  className = "",
}: {
  hero: BrandConfig["hero"];
  className?: string;
}) {
  return (
    <p className={`text-base leading-relaxed text-text-secondary ${className}`}>
      {hero.reassurance.body}
      <strong className="text-text-primary">{hero.reassurance.emphasis}</strong>
    </p>
  );
}

/** Aviso de privacidad: hay que aceptarlo para empezar. */
function ConsentBox({
  brand,
  agreed,
  onAgreedChange,
  className = "",
}: {
  brand: BrandConfig;
  agreed: boolean;
  onAgreedChange: (agreed: boolean) => void;
  className?: string;
}) {
  return (
    <div
      className={`flex w-full items-start gap-3 rounded-2xl border border-border bg-white px-4 py-3 text-left ${className}`}
    >
      <input
        id="accept-terms"
        type="checkbox"
        checked={agreed}
        onChange={(e) => onAgreedChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0"
      />
      <label
        htmlFor="accept-terms"
        className="cursor-pointer text-base leading-snug text-text-primary"
      >
        He leído y acepto el{" "}
        <a
          href={brand.legal.termsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-accent-dark underline"
        >
          {brand.legal.termsLabel}
        </a>
        .
      </label>
    </div>
  );
}
