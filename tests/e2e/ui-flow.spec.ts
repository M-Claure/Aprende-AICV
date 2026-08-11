import { test, expect, type Page } from "@playwright/test";

/**
 * Browser-driven test of the actual React UI: it walks the full funnel by
 * reacting to whatever control the current question renders (text, multi-select,
 * skill chips, review) — the same way a user would.
 */

function answerFor(questionText: string): string {
  const t = questionText.toLowerCase();
  if (t.includes("trabajo te gustaría") || t.includes("objetivo")) return "Asistente administrativa";
  if (t.includes("nombre")) return "María García López";
  if (t.includes("correo") || t.includes("teléfono") || t.includes("contact")) return "maria@example.com";
  if (t.includes("educación") || t.includes("estudios") || t.includes("nivel"))
    return "Terminé la secundaria y estudié seis meses de administración";
  if (t.includes("día normal")) return "Respondía llamadas y organizaba las citas de los clientes";
  if (t.includes("cuéntame") || t.includes("de qué se trataba") || t.includes("experiencia"))
    return "Ayudaba en el negocio de limpieza de mi mamá";
  return "Sí, con gusto lo comparto";
}

async function currentQuestionText(page: Page): Promise<string> {
  const bubble = page.locator(".bg-ai-bubble").first();
  await bubble.waitFor({ state: "visible", timeout: 10_000 });
  return (await bubble.innerText()).trim();
}

test("full resume flow through the web UI", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Crear mi CV" }).click();
  await page.waitForURL(/\/cv\/.+/, { timeout: 20_000 });

  const continuar = () => page.getByRole("button", { name: "Continuar" });
  const currentQid = () => page.locator("[data-qid]").getAttribute("data-qid");

  // Wait until the step actually advances (the data-qid changes) or the resume
  // appears — the click's fetch is async, so we can't rely on network idle.
  const waitAdvance = (prevQid: string | null) =>
    page.waitForFunction(
      (prev) =>
        document.body.innerText.includes("Tu currículum está listo") ||
        (document.querySelector("[data-qid]")?.getAttribute("data-qid") ?? null) !== prev,
      prevQid,
      { timeout: 15_000 },
    );

  const atWorkspace = () => page.getByRole("button", { name: "Revisar y finalizar" }).isVisible().catch(() => false);

  // Back navigation: answer the first question, then step back to it.
  await page.locator("[data-qid]").waitFor();
  const firstQid = await currentQid();
  await page.locator("textarea, input:not([type])").first().fill("Asistente administrativa");
  await continuar().click();
  await waitAdvance(firstQid);
  const backBtn = page.getByRole("button", { name: "← Volver" });
  await expect(backBtn).toBeVisible();
  await backBtn.click();
  await expect(page.locator(".bg-ai-bubble").first()).toContainText("trabajo te gustaría");

  // Drive the adaptive flow until the resume is generated.
  for (let step = 0; step < 25; step++) {
    if (await atWorkspace()) break;
    const qid = await currentQid();

    const generate = page.getByRole("button", { name: "Generar mi currículum" });
    if (await generate.isVisible().catch(() => false)) {
      // The review screen is editable — exercise it before generating.
      await expect(page.getByText("Información personal")).toBeVisible();
      const skillInput = page.getByPlaceholder("Agregar habilidades (separadas por comas)");
      await skillInput.fill("Organización");
      await page.getByRole("button", { name: "Agregar", exact: true }).first().click();
      await expect(page.getByText("Organización", { exact: true })).toBeVisible();

      await expect(generate).toBeEnabled({ timeout: 10_000 });
      await generate.click();
      await page.getByRole("button", { name: "Revisar y finalizar" }).waitFor({ timeout: 30_000 });
      break;
    }

    const confirmButtons = page.getByRole("button", { name: /Confirmar/ });
    if ((await confirmButtons.count()) > 0) {
      const n = await confirmButtons.count();
      for (let i = 0; i < n; i++) await confirmButtons.nth(i).click();
      await continuar().click();
      await waitAdvance(qid);
      continue;
    }

    const checkboxes = page.locator('input[type="checkbox"]');
    if ((await checkboxes.count()) > 0) {
      await checkboxes.first().check();
      await continuar().click();
      await waitAdvance(qid);
      continue;
    }

    const radios = page.locator('input[type="radio"]');
    if ((await radios.count()) > 0) {
      await radios.first().check();
      await continuar().click();
      await waitAdvance(qid);
      continue;
    }

    const field = page.locator("textarea, input:not([type]), input[type='text']").first();
    if (await field.isVisible().catch(() => false)) {
      const q = await currentQuestionText(page);
      await field.fill(answerFor(q));
      await expect(continuar()).toBeEnabled({ timeout: 5000 });
      await continuar().click();
      await waitAdvance(qid);
      continue;
    }

    await page.waitForTimeout(400);
  }

  // Resume is generated and previewed in the workspace.
  await expect(page.getByRole("button", { name: "Revisar y finalizar" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("iframe")).toBeVisible();

  // Edit menu: open it, confirm the editable fields, then return.
  await page.getByRole("button", { name: "Editar mi información" }).click();
  await expect(page.getByText("Información personal")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Volver al currículum" }).first().click();
  await expect(page.getByRole("button", { name: "Revisar y finalizar" })).toBeVisible();

  // Improvement loop: answer a follow-up, then regenerate (anytime header button).
  const respond = page.getByRole("button", { name: "Responder" }).first();
  await expect(respond).toBeVisible({ timeout: 20_000 });
  await page.locator("textarea, input").first().fill("Español nativo, inglés básico");
  await respond.click();

  const regenerate = page.getByRole("button", { name: "Regenerar", exact: true });
  await expect(regenerate).toBeVisible({ timeout: 10_000 });
  await regenerate.click();

  // After regeneration the workspace is still there and re-analyzed.
  await expect(page.getByRole("button", { name: "Revisar y finalizar" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("iframe")).toBeVisible();
});
