"use client";

import { useMemo, useState } from "react";
import type { AdaptiveQuestion } from "@/lib/ai/schemas";
import type { SkillState } from "@/types";
import { AiBubble, Button, Card } from "./primitives";

type Decision = "pending" | "confirm" | "reject";

/**
 * Skill confirmation step (spec §10). Every suggested skill shows its evidence
 * and must be explicitly confirmed or rejected — nothing is added by default.
 */
export function SkillConfirm({
  question,
  suggestedSkills,
  onSubmit,
  busy,
}: {
  question: AdaptiveQuestion;
  suggestedSkills: SkillState[];
  onSubmit: (decisions: { confirm: string[]; reject: string[] }) => void;
  busy: boolean;
}) {
  const skills = useMemo(() => suggestedSkills, [suggestedSkills]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  const set = (id: string, d: Decision) =>
    setDecisions((prev) => ({ ...prev, [id]: prev[id] === d ? "pending" : d }));

  const submit = () => {
    const confirm = skills.filter((s) => decisions[s.id] === "confirm").map((s) => s.id);
    const reject = skills.filter((s) => decisions[s.id] === "reject").map((s) => s.id);
    onSubmit({ confirm, reject });
  };

  return (
    <Card>
      <AiBubble>{question.questionText}</AiBubble>

      <div className="mt-4 flex flex-col gap-3">
        {skills.map((s) => {
          const d = decisions[s.id] ?? "pending";
          return (
            <div key={s.id} className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-sm">{s.name}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => set(s.id, "confirm")}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      d === "confirm"
                        ? "bg-accent text-accent-on"
                        : "bg-accent-light text-accent-dark"
                    }`}
                  >
                    ✓ Confirmar
                  </button>
                  <button
                    type="button"
                    onClick={() => set(s.id, "reject")}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      d === "reject" ? "bg-gray-700 text-white" : "bg-gray-100 text-text-secondary"
                    }`}
                  >
                    No incluir
                  </button>
                </div>
              </div>
              {s.evidence && (
                <p className="mt-1 text-xs text-text-secondary">{s.evidence}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex justify-end">
        <Button onClick={submit} disabled={busy}>
          Continuar
        </Button>
      </div>
    </Card>
  );
}
