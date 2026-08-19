"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Button, InstructionBanner, Spinner } from "@/components/primitives";
import { CONTACT_FIELD_CHAR_LIMITS } from "@/lib/answer-limits";
import { isEmail, isPhone } from "@/lib/personal-contact";
import { useBrand } from "@/lib/brand/context";
import { MarketingHeroSlot } from "@/components/marketing/MarketingHeroSlot";

/**
 * Two steps before the funnel:
 *   "intro"   — the landing pitch + terms consent.
 *   "contact" — name, email and phone. Submitting this is what creates the
 *               profile, so nothing reaches Supabase until we can reach the
 *               person. The adaptive funnel (career goal, education, experience,
 *               …) picks up afterwards on /cv/[id].
 */
type Step = "intro" | "contact";

export default function HomePage() {
  const router = useRouter();
  // Marketing copy, CTA labels and the consent link are per-brand; every field
  // and validator below is shared product behaviour and stays brand-agnostic.
  const brand = useBrand();
  const [step, setStep] = useState<Step>("intro");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // The same per-field validators and limits the server uses, so Continuar never
  // enables for a body the API would reject. Either contact channel alone is
  // enough, but being over a field's limit always blocks continuing.
  const overName = fullName.length > CONTACT_FIELD_CHAR_LIMITS.fullName;
  const overEmail = email.length > CONTACT_FIELD_CHAR_LIMITS.email;
  const overPhone = phone.length > CONTACT_FIELD_CHAR_LIMITS.phone;
  const anyOver = overName || overEmail || overPhone;

  const nameOk = fullName.trim().length > 0 && !overName;
  const emailFilled = email.trim().length > 0;
  const phoneFilled = phone.trim().length > 0;
  const emailOk = emailFilled && isEmail(email) && !overEmail;
  const phoneOk = phoneFilled && isPhone(phone) && !overPhone;
  // A filled-but-malformed field blocks continuing even when the other one is
  // valid — otherwise a typo would be silently dropped from the résumé.
  const contactOk = (emailOk || phoneOk) && (!emailFilled || emailOk) && (!phoneFilled || phoneOk);
  const canSubmit = nameOk && contactOk && agreed;

  // One nudge at a time — whichever step is still missing.
  const hint = anyOver
    ? "Acorta lo que escribiste para continuar."
    : fullName.trim().length === 0
      ? "Escribe tu nombre para continuar."
      : !emailFilled && !phoneFilled
        ? "Escribe tu correo o tu teléfono para continuar."
        : !contactOk
          ? "Revisa lo que escribiste para continuar."
          : null;

  async function submit() {
    // Guard mirrors the disabled button; the server re-checks everything anyway.
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const { profile } = await api.createProfile({
        acceptTerms: agreed,
        fullName: fullName.trim(),
        // Send only what was actually filled in; blanks stay absent.
        ...(emailFilled ? { email: email.trim() } : {}),
        ...(phoneFilled ? { phone: phone.trim() } : {}),
      });
      router.push(`/cv/${profile.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "unauthorized") {
        router.push("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "No se pudo iniciar. Intenta de nuevo.");
      setLoading(false);
    }
  }

  const inputClass =
    "mt-1.5 w-full rounded-xl border border-border bg-white px-4 py-3 text-base outline-none focus:border-accent";
  const overInputClass = `${inputClass} border-red-500 focus:border-red-500`;

  /** Live "used / limit" count, red once the field is over its limit. */
  function CharCount({ used, limit }: { used: number; limit: number }) {
    const over = used - limit;
    return (
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span className={`text-sm font-semibold text-red-600 ${over > 0 ? "" : "invisible"}`}>
          {over > 0 ? `Quita ${over} ${over === 1 ? "letra" : "letras"}.` : ""}
        </span>
        <span
          className={`shrink-0 text-xs tabular-nums ${over > 0 ? "font-semibold text-red-600" : "text-text-secondary"}`}
          aria-live="polite"
        >
          {used} / {limit}
        </span>
      </div>
    );
  }

  // ── Paso 2: datos de contacto ──
  if (step === "contact") {
    return (
      <main className="mx-auto flex min-h-page max-w-xl flex-col justify-center gap-4 px-6 py-12">
        <InstructionBanner icon="✍️" title={brand.contactStep.bannerTitle}>
          {brand.contactStep.bannerBody}
        </InstructionBanner>

        <button
          type="button"
          onClick={() => setStep("intro")}
          disabled={loading}
          className="self-start text-sm font-medium text-accent-dark hover:underline disabled:opacity-50"
        >
          ← Volver
        </button>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-4 rounded-2xl border border-border bg-white px-5 py-5"
        >
          <div>
            <label htmlFor="full-name" className="block text-base font-semibold text-text-primary">
              ¿Cómo te llamas?
            </label>
            <input
              id="full-name"
              name="name"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="María García López"
              className={overName ? overInputClass : inputClass}
              aria-invalid={overName}
              autoFocus
            />
            <CharCount used={fullName.length} limit={CONTACT_FIELD_CHAR_LIMITS.fullName} />
          </div>

          <div>
            <p className="text-base font-semibold text-text-primary">¿Cómo te pueden contactar?</p>
            <p id="contact-help" className="mt-0.5 text-sm leading-snug text-text-secondary">
              Con uno de los dos basta. Puedes poner los dos si quieres.
            </p>

            <label htmlFor="email" className="mt-3 block text-sm font-medium text-text-primary">
              Correo electrónico
            </label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              aria-describedby="contact-help"
              aria-invalid={overEmail || (emailFilled && !emailOk)}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="maria@correo.com"
              className={overEmail ? overInputClass : inputClass}
            />
            <CharCount used={email.length} limit={CONTACT_FIELD_CHAR_LIMITS.email} />
            {emailFilled && !emailOk && !overEmail && (
              <p className="mt-1 text-sm text-red-600">
                Eso no parece un correo. Revísalo, por favor.
              </p>
            )}

            <label htmlFor="phone" className="mt-3 block text-sm font-medium text-text-primary">
              Teléfono
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              aria-describedby="contact-help"
              aria-invalid={overPhone || (phoneFilled && !phoneOk)}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="555 123 4567"
              className={overPhone ? overInputClass : inputClass}
            />
            <CharCount used={phone.length} limit={CONTACT_FIELD_CHAR_LIMITS.phone} />
            {phoneFilled && !phoneOk && !overPhone && (
              <p className="mt-1 text-sm text-red-600">
                Eso no parece un teléfono. Revísalo, por favor.
              </p>
            )}
          </div>

          <div className="flex flex-col items-center gap-2">
            {loading ? (
              <Spinner label="Preparando todo…" />
            ) : (
              <>
                <Button type="submit" disabled={!canSubmit}>
                  {brand.contactStep.ctaLabel}
                </Button>
                {hint && <p className="text-xs text-text-secondary">{hint}</p>}
              </>
            )}
          </div>
        </form>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </main>
    );
  }

  // ── Paso 1: presentación ──
  // The landing pitch is the app's marketing surface, so it is rendered by the
  // active brand's hero (colours, copy, CTA and layout all come from the brand).
  // Consent state stays here because it gates profile creation, not styling.
  return (
    <MarketingHeroSlot
      agreed={agreed}
      onAgreedChange={setAgreed}
      onStart={() => setStep("contact")}
    />
  );
}
