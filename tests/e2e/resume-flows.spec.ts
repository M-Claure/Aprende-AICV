import { test, expect } from "@playwright/test";
import { answer, completeness, createProfile } from "./helpers";

/**
 * The seven major end-to-end flows (spec §19). Driven through the API with the
 * mocked AI provider and in-memory persistence.
 */

test("1. user with formal work experience reaches a ready profile", async ({ request }) => {
  const id = await createProfile(request);
  await answer(request, id, { questionId: "career_goal_target", section: "career_goal", rawAnswer: "Contadora" });
  await answer(request, id, { questionId: "personal_name", section: "personal_information", rawAnswer: "Sofía Ramírez" });
  await answer(request, id, { questionId: "personal_contact", section: "personal_information", rawAnswer: "sofia@example.com" });
  await answer(request, id, { questionId: "education_highest", section: "education", rawAnswer: "Licenciatura en Contabilidad" });
  await answer(request, id, {
    questionId: "experience_add",
    section: "experience",
    rawAnswer: "Trabajé en una empresa llevando la contabilidad y atendiendo a clientes",
  });
  const detail = await answer(request, id, {
    questionId: "experience_daily_tasks",
    section: "experience",
    rawAnswer: "Registraba facturas, manejaba dinero y atendía a los clientes",
  });
  expect(detail.state.suggestedSkills.length).toBeGreaterThan(0);
  const confirm = await answer(request, id, {
    questionId: "skills_confirm",
    section: "skills",
    skillDecisions: { confirm: detail.state.suggestedSkills.map((s: any) => s.id) },
  });
  expect(confirm.state.completeness.readyToGenerate).toBe(true);
});

test("2. user with NO formal work experience still completes via transferable experience", async ({ request }) => {
  const id = await createProfile(request);
  await answer(request, id, { questionId: "career_goal_target", section: "career_goal", rawAnswer: "Recepcionista" });
  await answer(request, id, { questionId: "personal_name", section: "personal_information", rawAnswer: "Ana López" });
  await answer(request, id, { questionId: "personal_contact", section: "personal_information", rawAnswer: "999888777" });
  await answer(request, id, { questionId: "education_highest", section: "education", rawAnswer: "Secundaria completa" });
  await answer(request, id, {
    questionId: "experience_add",
    section: "experience",
    rawAnswer: "Ayudaba en el negocio de limpieza de mi mamá",
  });
  const detail = await answer(request, id, {
    questionId: "experience_daily_tasks",
    section: "experience",
    rawAnswer: "Respondía llamadas y organizaba las citas de los clientes",
  });
  const confirm = await answer(request, id, {
    questionId: "skills_confirm",
    section: "skills",
    skillDecisions: { confirm: detail.state.suggestedSkills.map((s: any) => s.id) },
  });
  expect(confirm.state.completeness.readyToGenerate).toBe(true);
  expect(confirm.state.completeness.readiness).not.toBe("insufficient_information");
});

test("3. entrepreneur flow", async ({ request }) => {
  const id = await createProfile(request);
  await answer(request, id, { questionId: "career_goal_target", section: "career_goal", rawAnswer: "Gerente de ventas" });
  await answer(request, id, { questionId: "personal_name", section: "personal_information", rawAnswer: "Carlos Díaz" });
  await answer(request, id, { questionId: "personal_contact", section: "personal_information", rawAnswer: "carlos@example.com" });
  const add = await answer(request, id, {
    questionId: "experience_add",
    section: "experience",
    rawAnswer: "Monté mi propio negocio de venta de ropa y manejaba el inventario",
  });
  expect(add.state.experience[0].experienceType).toBe("business_owner");
  const detail = await answer(request, id, {
    questionId: "experience_daily_tasks",
    section: "experience",
    rawAnswer: "Vendía productos, manejaba dinero y organizaba el inventario",
  });
  const confirm = await answer(request, id, {
    questionId: "skills_confirm",
    section: "skills",
    skillDecisions: { confirm: detail.state.suggestedSkills.map((s: any) => s.id) },
  });
  expect(confirm.state.completeness.readyToGenerate).toBe(true);
});

test("4. user who skips multiple optional questions", async ({ request }) => {
  const id = await createProfile(request);
  await answer(request, id, { questionId: "career_goal_target", section: "career_goal", rawAnswer: "Vendedora" });
  await answer(request, id, { questionId: "personal_name", section: "personal_information", rawAnswer: "Rosa Núñez" });
  await answer(request, id, { questionId: "personal_contact", section: "personal_information", rawAnswer: "rosa@example.com" });
  // Skip optional location.
  const skip1 = await answer(request, id, { questionId: "personal_location", section: "personal_information", skipped: true });
  expect(skip1.nextQuestion.questionId).not.toBe("personal_location");
  await answer(request, id, { questionId: "experience_add", section: "experience", rawAnswer: "Vendía comida en la calle" });
  // Skip an optional experience detail.
  const skip2 = await answer(request, id, { questionId: "experience_dates", section: "experience", skipped: true });
  expect(skip2.state.skippedQuestionIds).toContain("experience_dates");
  expect(skip2.state.skippedQuestionIds).toContain("personal_location");
});

test("5. user who rejects suggested skills", async ({ request }) => {
  const id = await createProfile(request);
  await answer(request, id, { questionId: "career_goal_target", section: "career_goal", rawAnswer: "Asistente" });
  await answer(request, id, { questionId: "personal_name", section: "personal_information", rawAnswer: "Elena Soto" });
  await answer(request, id, { questionId: "personal_contact", section: "personal_information", rawAnswer: "elena@example.com" });
  await answer(request, id, { questionId: "experience_add", section: "experience", rawAnswer: "Atendía clientes en una tienda" });
  const detail = await answer(request, id, {
    questionId: "experience_daily_tasks",
    section: "experience",
    rawAnswer: "Respondía llamadas y atendía a los clientes",
  });
  const suggestedIds = detail.state.suggestedSkills.map((s: any) => s.id);
  expect(suggestedIds.length).toBeGreaterThan(0);
  // Reject all suggestions.
  const rejected = await answer(request, id, {
    questionId: "skills_confirm",
    section: "skills",
    skillDecisions: { reject: suggestedIds },
  });
  expect(rejected.state.confirmedSkills.length).toBe(0);
  expect(rejected.state.rejectedSkills.length).toBeGreaterThan(0);
  // Rejected skills must not be re-suggested.
  const suggestRes = await request.post(`/api/resume-profiles/${id}/skills/suggest`, {});
  const again = (await suggestRes.json()).data.suggestedSkills;
  const rejectedNames = new Set(rejected.state.rejectedSkills.map((s: any) => s.name));
  for (const s of again) expect(rejectedNames.has(s.name)).toBe(false);
});

test("6. returning user with a partially completed profile resumes correctly", async ({ request }) => {
  const id = await createProfile(request);
  await answer(request, id, { questionId: "career_goal_target", section: "career_goal", rawAnswer: "Diseñadora" });
  await answer(request, id, { questionId: "personal_name", section: "personal_information", rawAnswer: "Paula Vega" });

  // Simulate "returning" — fetch state fresh and ask for the next question.
  const nq = await request.get(`/api/resume-profiles/${id}/next-question`);
  expect(nq.status()).toBe(200);
  const body = (await nq.json()).data;
  // Already-answered questions are not re-asked.
  expect(body.state.answeredQuestionIds).toContain("career_goal_target");
  expect(body.nextQuestion.questionId).not.toBe("career_goal_target");
  const comp = await completeness(request, id);
  expect(comp.readyToGenerate).toBe(false);
});

test("7. resume generation and PDF export", async ({ request }) => {
  const id = await createProfile(request);
  await answer(request, id, { questionId: "career_goal_target", section: "career_goal", rawAnswer: "Asistente administrativa" });
  await answer(request, id, { questionId: "personal_name", section: "personal_information", rawAnswer: "María García" });
  await answer(request, id, { questionId: "personal_contact", section: "personal_information", rawAnswer: "maria@example.com" });
  await answer(request, id, { questionId: "education_highest", section: "education", rawAnswer: "Secundaria y curso de administración" });
  await answer(request, id, { questionId: "experience_add", section: "experience", rawAnswer: "Ayudaba en el negocio de mi mamá" });
  const detail = await answer(request, id, {
    questionId: "experience_daily_tasks",
    section: "experience",
    rawAnswer: "Respondía llamadas y organizaba las citas de los clientes",
  });
  await answer(request, id, {
    questionId: "skills_confirm",
    section: "skills",
    skillDecisions: { confirm: detail.state.suggestedSkills.map((s: any) => s.id) },
  });

  const gen = await request.post(`/api/resume-profiles/${id}/generate`, {});
  expect(gen.status()).toBe(200);
  const resume = (await gen.json()).data.resume;
  expect(resume.professionalSummary.length).toBeGreaterThan(0);

  const preview = await request.get(`/api/resume-profiles/${id}/resume/preview`);
  expect(preview.status()).toBe(200);
  expect(preview.headers()["content-type"]).toContain("text/html");

  // Download is gated behind finalization.
  const blocked = await request.post(`/api/resume-profiles/${id}/export-pdf`, {});
  expect(blocked.status()).toBe(409);

  const finalize = await request.post(`/api/resume-profiles/${id}/finalize`, {});
  expect(finalize.status()).toBe(200);
  expect((await finalize.json()).data.profile.finalizedAt).toBeTruthy();

  const pdf = await request.post(`/api/resume-profiles/${id}/export-pdf`, {});
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  const bytes = await pdf.body();
  expect(bytes.byteLength).toBeGreaterThan(1000);
  expect(bytes.subarray(0, 5).toString("utf8")).toBe("%PDF-");
});
