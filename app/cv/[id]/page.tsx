"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdaptiveQuestion } from "@/lib/ai/schemas";
import type { ResumeProfileState } from "@/types";
import { api, type AnswerPayload } from "@/lib/client/api";
import { answerCharLimitForQuestion } from "@/lib/answer-limits";
import { MAX_EXPERIENCE_ENTRIES } from "@/lib/config/limits";
import { InstructionBanner, ProgressBar, Spinner } from "@/components/primitives";
import { QuestionCard } from "@/components/QuestionCard";
import { SkillConfirm } from "@/components/SkillConfirm";
import { EditableReview } from "@/components/EditableReview";
import { ResumeWorkspace } from "@/components/ResumeWorkspace";
import { stepInstruction } from "@/components/instructions";

type Phase = "loading" | "asking" | "generating" | "done" | "error";

/**
 * A fresh "add another experience" question (client-initiated, creates a new entry).
 *
 * Deliberately TYPE-LESS, unlike the catalog's describe question, which names the
 * position and type the person counted ("Experiencia 2 de 3: tu voluntariado").
 * Nobody chose a type for this one, so the wording stays broad and the entry is
 * stored as `other` until the description tells us what it was.
 */
const NEW_EXPERIENCE_QUESTION: AdaptiveQuestion = {
  questionId: "experience_add",
  section: "experience",
  questionText: "Cuéntame sobre otra experiencia. ¿De qué se trataba y qué hacías?",
  supportingText: "Trabajo, negocio, voluntariado, cuidado de personas, proyecto… todo cuenta.",
  inputType: "long_text",
  required: false,
  // Matches the catalog: no experience question offers "Omitir". Reaching this one
  // is an explicit choice ("Agregar otra experiencia"), and "← Volver" undoes it.
  allowSkip: false,
  // Same limit the server will enforce for this questionId.
  charLimit: answerCharLimitForQuestion("experience_add"),
  contextUsed: [],
  suggestedSkills: [],
  nextAction: "ask_question",
};

/**
 * Coarse device bucket for funnel analysis (are students dropping off on
 * phones?). Width-based, no fingerprinting; undefined during SSR.
 */
function deviceCategory(): "mobile" | "tablet" | "desktop" | undefined {
  if (typeof window === "undefined") return undefined;
  if (window.innerWidth < 640) return "mobile";
  return window.innerWidth < 1024 ? "tablet" : "desktop";
}

export default function CvFlowPage({ params }: { params: { id: string } }) {
  const profileId = params.id;

  const [phase, setPhase] = useState<Phase>("loading");
  const [question, setQuestion] = useState<AdaptiveQuestion | null>(null);
  const [state, setState] = useState<ResumeProfileState | null>(null);
  const [interpretation, setInterpretation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Client-side history of questions shown (with the entry each produced), so the
  // user can step back and re-answer — overwriting that entry instead of adding.
  const [history, setHistory] = useState<{ question: AdaptiveQuestion; affectedEntryId: string | null }[]>([]);
  // When set, the current answer overwrites this entry (we backed into it).
  const [targetEntryId, setTargetEntryId] = useState<string | undefined>(undefined);

  /**
   * `fatal` replaces the whole screen — only correct when there is nothing to
   * show (the initial load failed). A failure while answering must NOT do that:
   * the question and the typed answer stay on screen so the person can just
   * press Continuar again. Losing a half-finished résumé to one transient error
   * is a guaranteed abandonment.
   */
  const handleError = useCallback((err: unknown, { fatal = false }: { fatal?: boolean } = {}) => {
    setError(err instanceof Error ? err.message : "Ocurrió un error.");
    if (fatal) setPhase("error");
  }, []);

  // Load the first question.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.nextQuestion(profileId);
        if (cancelled) return;
        setQuestion(res.nextQuestion);
        setState(res.state);
        setPhase("asking");
        setStartedAt(Date.now());
      } catch (err) {
        // Nothing to fall back to — there is no question on screen yet.
        if (!cancelled) handleError(err, { fatal: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, handleError]);

  const applyResult = useCallback(
    (res: Awaited<ReturnType<typeof api.submitAnswer>>) => {
      // Remember the question we're leaving + the entry it produced.
      setHistory((h) => (question ? [...h, { question, affectedEntryId: res.affectedEntryId }] : h));
      setState(res.state);
      setQuestion(res.nextQuestion);
      setInterpretation(res.interpretation?.summary ?? null);
      setError(null);
      setTargetEntryId(undefined); // moving forward creates fresh entries
      setStartedAt(Date.now());
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [question],
  );

  const goBack = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1]!;
      setQuestion(prev.question);
      // Re-answering this question overwrites the entry it originally created.
      setTargetEntryId(prev.affectedEntryId ?? undefined);
      setInterpretation(null);
      setError(null);
      setStartedAt(Date.now());
      window.scrollTo({ top: 0, behavior: "smooth" });
      return h.slice(0, -1);
    });
  }, []);

  // Explicitly add another experience (create a new entry rather than overwrite).
  const addAnotherExperience = useCallback(() => {
    setHistory((h) => (question ? [...h, { question, affectedEntryId: null }] : h));
    setQuestion(NEW_EXPERIENCE_QUESTION);
    setTargetEntryId(undefined);
    setInterpretation(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [question]);

  const send = useCallback(
    async (payload: Omit<AnswerPayload, "questionId" | "section">) => {
      if (!question) return;
      setBusy(true);
      setError(null);
      try {
        const res = await api.submitAnswer(profileId, {
          questionId: question.questionId,
          section: question.section,
          timeSpentMs: startedAt ? Date.now() - startedAt : undefined,
          deviceCategory: deviceCategory(),
          targetEntryId,
          // This exact object is only ever set by "Agregar otra experiencia", so
          // identity tells the server the answer is an ADDITIONAL experience and
          // must not be absorbed by an entry from the counter step that is still
          // waiting to be described. A back-edit still wins: the server prefers
          // `targetEntryId` when both arrive.
          forceNewEntry: question === NEW_EXPERIENCE_QUESTION || undefined,
          ...payload,
        });
        applyResult(res);
      } catch (err) {
        handleError(err);
      } finally {
        setBusy(false);
      }
    },
    [question, profileId, startedAt, targetEntryId, applyResult, handleError],
  );

  const generate = useCallback(async () => {
    setPhase("generating");
    setError(null);
    try {
      await api.generate(profileId);
      setPhase("done");
    } catch (err) {
      // Fall back to the review screen so generation can be retried.
      setPhase("asking");
      handleError(err);
    }
  }, [profileId, handleError]);

  // ── Render ──
  if (phase === "loading") {
    return (
      <Shell>
        <Spinner label="Cargando…" />
      </Shell>
    );
  }

  if (phase === "error") {
    return (
      <Shell>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {error ?? "Ocurrió un error."}
        </div>
      </Shell>
    );
  }

  if (phase === "generating") {
    return (
      <Shell>
        <InstructionBanner icon="⏳" title="Estamos creando tu currículum">
          Espera un momento, por favor. No cierres esta página.
        </InstructionBanner>
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <Spinner />
          <p className="text-text-secondary">Estamos escribiendo tu currículum con lo que nos contaste…</p>
        </div>
      </Shell>
    );
  }

  if (phase === "done") {
    return (
      <Shell wide>
        <ResumeWorkspace profileId={profileId} />
      </Shell>
    );
  }

  // asking
  const instruction = question ? stepInstruction(question) : null;
  return (
    <Shell>
      {instruction && (
        <InstructionBanner icon={instruction.icon} title={instruction.title}>
          {instruction.body}
        </InstructionBanner>
      )}

      {history.length > 0 && (
        <button
          type="button"
          onClick={goBack}
          disabled={busy}
          className="self-start text-sm font-medium text-accent-dark hover:underline disabled:opacity-50"
        >
          ← Volver
        </button>
      )}

      {state && <ProgressBar percent={state.funnelProgress} label="Progreso" />}

      {interpretation && (
        <p className="text-xs text-text-secondary">✓ {interpretation}</p>
      )}

      {/*
        Recoverable failure: the answer is still in the field above, so pressing
        Continuar again retries it. Nothing already saved is lost.
      */}
      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          <p className="font-medium">No pudimos guardar tu respuesta.</p>
          <p className="mt-1">{error}</p>
          <p className="mt-2 text-xs">
            Tu respuesta sigue escrita abajo. Vuelve a tocar “Continuar” para intentarlo de nuevo.
            Lo que ya guardaste no se perdió.
          </p>
        </div>
      )}

      <div data-qid={question?.questionId ?? "none"}>
      {question &&
        (question.inputType === "review" || question.nextAction === "review_profile" ? (
          <EditableReview profileId={profileId} onGenerate={generate} busy={busy} explainNext />
        ) : question.inputType === "skill_confirmation" ? (
          <SkillConfirm
            key={question.questionId}
            question={question}
            suggestedSkills={state?.suggestedSkills ?? []}
            onSubmit={(decisions) => send({ skillDecisions: decisions })}
            busy={busy}
          />
        ) : (
          <QuestionCard
            key={question.questionId}
            question={question}
            onSubmit={(rawAnswer) => send({ rawAnswer })}
            onSkip={() => send({ skipped: true })}
            busy={busy}
          />
        ))}
      </div>

      {/* Hidden at the cap: the server would create nothing, so offering it would
          be a button that silently does nothing. */}
      {question &&
        question.inputType !== "review" &&
        (state?.experience.length ?? 0) > 0 &&
        (state?.experience.length ?? 0) < MAX_EXPERIENCE_ENTRIES && (
          <button
            type="button"
            onClick={addAnotherExperience}
            disabled={busy}
            className="self-start text-sm font-medium text-accent-dark hover:underline disabled:opacity-50"
          >
            ➕ Agregar otra experiencia
          </button>
        )}
    </Shell>
  );
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    // The product/brand bar lives in app/layout.tsx, so this shell only carries
    // the save hint and the content column.
    <div className="min-h-page bg-bg-primary">
      <main className={`mx-auto flex flex-col gap-4 px-5 py-8 ${wide ? "max-w-5xl" : "max-w-xl"}`}>
        <p className="self-end text-xs text-text-secondary">Guardado automáticamente</p>
        {children}
      </main>
    </div>
  );
}
