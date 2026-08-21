"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ResumeProfile } from "@/types";
import { api } from "@/lib/client/api";
import { Button, ProgressBar } from "./primitives";

/**
 * "You already started one" — shown above the landing hero when this browser's
 * session already owns a résumé.
 *
 * Why it sits above the hero instead of changing the hero's button: the landing
 * pitch is the BRAND's surface (`components/marketing/*`), and those components are
 * presentational — brand in, markup out. Threading product state through them to
 * relabel a CTA would put funnel logic in the marketing layer. A separate card also
 * keeps the honest reading of the two actions: continuing and starting over are
 * different things, and the person should see both.
 *
 * Renders NOTHING until there is something to continue, so a first-time visitor
 * sees exactly what they saw before. A failed lookup renders nothing too: this is a
 * convenience, and it must never be the reason someone cannot start a résumé.
 */
export function ContinueResume({ onStartNew }: { onStartNew: () => void }) {
  const router = useRouter();
  const [profile, setProfile] = useState<ResumeProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .currentProfile()
      .then(({ profile: found }) => {
        if (!cancelled) setProfile(found);
      })
      .catch(() => {
        /* Nothing to show is the common, correct answer for a new visitor. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!profile) return null;

  // A finalized résumé is finished, so it opens rather than resumes — and its
  // progress bar would be noise next to a document that is already done.
  const finalized = profile.finalizedAt !== null;

  return (
    <section
      aria-labelledby="continue-resume-title"
      className="mx-auto w-full max-w-xl px-6 pt-8"
    >
      <div className="flex flex-col gap-3 rounded-2xl border-2 border-accent bg-white px-5 py-5">
        <h2
          id="continue-resume-title"
          className="font-heading text-xl font-bold text-text-primary"
        >
          {finalized ? "Tu currículum está listo" : "Ya empezaste tu currículum"}
        </h2>
        <p className="text-base leading-snug text-text-secondary">
          {finalized
            ? "Ábrelo para verlo o descargarlo."
            : "No perdiste nada. Sigue donde te quedaste."}
        </p>

        {!finalized && (
          <ProgressBar percent={profile.progressPercentage} label="Lo que ya llevas" />
        )}

        <Button onClick={() => router.push(`/cv/${profile.id}`)}>
          {finalized ? "Ver mi currículum" : "Seguir con mi currículum"}
        </Button>

        <div className="flex flex-col items-center">
          <Button variant="text" onClick={onStartNew}>
            Empezar uno nuevo
          </Button>
          {/* Said plainly: starting over is not an edit of the résumé above, and it
              is the one action here the person cannot undo from this screen. */}
          <p className="text-xs text-text-secondary">Vas a hacer otro currículum desde cero.</p>
        </div>
      </div>
    </section>
  );
}
