/**
 * Final proofreading pass over a generated résumé (spelling, grammar,
 * punctuation, formatting) — the last step before download.
 *
 * SAFETY: only the AI-written PROSE is sent for correction (the professional
 * summary and the experience/education/project bullets). Structured facts
 * (names, organizations, dates, skills, certifications, languages) are never
 * touched, and each corrected bullet keeps its original source trace. The model
 * is instructed not to change meaning or invent/remove information; corrections
 * are applied by stable id, so any item the model drops keeps its original text.
 */
import type {
  GeneratedBullet,
  GeneratedResume,
  ResumeProfile,
} from "@/types";
import type { AIProvider } from "@/lib/ai";
import { Errors } from "@/lib/errors";
import type { Store } from "@/lib/repositories/store";
import { renderResumeHtml, type ResumeRenderModel } from "./resume-renderer";

export interface ProofreadResult {
  resume: GeneratedResume;
  notes: string[];
}

const SUMMARY_ID = "summary";
const bulletId = (kind: string, block: number, i: number) => `${kind}:${block}:${i}`;

export async function proofreadAndRerender(
  store: Store,
  ai: AIProvider,
  profileId: string,
): Promise<ProofreadResult> {
  const profile = await store.getResumeProfile(profileId);
  if (!profile) throw Errors.notFound("Perfil no encontrado");
  const resume = await store.getLatestGeneratedResume(profileId);
  if (!resume) throw Errors.notReady("Aún no se ha generado un currículum para revisar.");

  // 1. Collect the prose snippets with stable ids.
  const items: Array<{ id: string; text: string }> = [];
  if (resume.professionalSummary.trim()) items.push({ id: SUMMARY_ID, text: resume.professionalSummary });
  resume.experience.forEach((b, bi) =>
    b.bullets.forEach((bl, i) => items.push({ id: bulletId("exp", bi, i), text: bl.text })),
  );
  resume.education.forEach((b, bi) =>
    b.details.forEach((bl, i) => items.push({ id: bulletId("edu", bi, i), text: bl.text })),
  );
  resume.projects.forEach((b, bi) =>
    b.bullets.forEach((bl, i) => items.push({ id: bulletId("proj", bi, i), text: bl.text })),
  );

  // 2. Ask the model to correct them (facts preserved).
  const { items: corrected, notes } = await ai.proofreadResume({ items });
  const fixes = new Map(corrected.map((c) => [c.id, c.text]));
  const apply = (id: string, original: string): string => {
    const fixed = fixes.get(id);
    return fixed !== undefined && fixed.trim().length > 0 ? fixed : original;
  };
  const applyBullet = (id: string, b: GeneratedBullet): GeneratedBullet => ({
    ...b, // keep sourceEntryIds + sourceFields exactly
    text: apply(id, b.text),
  });

  // 3. Rebuild the résumé blocks with corrected prose (structure untouched).
  const professionalSummary = apply(SUMMARY_ID, resume.professionalSummary);
  const experience = resume.experience.map((b, bi) => ({
    ...b,
    bullets: b.bullets.map((bl, i) => applyBullet(bulletId("exp", bi, i), bl)),
  }));
  const education = resume.education.map((b, bi) => ({
    ...b,
    details: b.details.map((bl, i) => applyBullet(bulletId("edu", bi, i), bl)),
  }));
  const projects = resume.projects.map((b, bi) => ({
    ...b,
    bullets: b.bullets.map((bl, i) => applyBullet(bulletId("proj", bi, i), bl)),
  }));

  // 4. Re-render and persist as a new version.
  const personal = await store.getPersonalInformation(profileId);
  const renderModel = buildRenderModel(profile, personal, {
    professionalSummary,
    skills: resume.skills,
    experience,
    education,
    certifications: resume.certifications,
    projects,
    languages: resume.languages,
  });
  const html = renderResumeHtml(renderModel);

  const saved = await store.createGeneratedResume(profileId, {
    professionalSummary,
    skills: resume.skills,
    experience,
    education,
    certifications: resume.certifications,
    projects,
    languages: resume.languages,
    html,
  });

  return { resume: saved, notes };
}

function buildRenderModel(
  profile: ResumeProfile,
  personal: Awaited<ReturnType<Store["getPersonalInformation"]>>,
  content: Pick<
    ResumeRenderModel,
    "professionalSummary" | "skills" | "experience" | "education" | "certifications" | "projects" | "languages"
  >,
): ResumeRenderModel {
  const fullName =
    [personal?.firstName, personal?.lastName].filter(Boolean).join(" ").trim() || "Tu Nombre";
  return {
    fullName,
    headline: profile.targetRole ?? profile.careerGoal ?? null,
    location: [personal?.city, personal?.state, personal?.country].filter(Boolean).join(", ") || null,
    contact: {
      email: personal?.email ?? null,
      phone: personal?.phone ?? null,
      linkedIn: personal?.linkedInUrl ?? null,
      portfolio: personal?.portfolioUrl ?? null,
    },
    ...content,
    interests: profile.interests ?? [],
  };
}
