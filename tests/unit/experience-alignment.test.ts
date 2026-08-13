/**
 * The experiences a person describes must line up with the ones they counted.
 *
 * Two guarantees:
 *   1. The describe question names the position and the TYPE they picked, in the
 *      order the counter created them ("Experiencia 2 de 3: tu voluntariado").
 *   2. That type is never overwritten by the description they then write. Prose
 *      mentioning a relative used to flip a chosen "trabajo informal" to
 *      "cuidado de personas", which silently mislabelled every later question.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/repositories/memory-store";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { NoopAnalytics } from "@/lib/analytics";
import { processAnswer, type PipelineContext } from "@/lib/services/answer-pipeline";
import { assembleProfileState } from "@/lib/profile-state";
import { getCatalogQuestion } from "@/lib/question-engine/question-catalog";

let store: MemoryStore;
let ctx: PipelineContext;
let profileId: string;

beforeEach(async () => {
  store = new MemoryStore();
  ctx = { store, ai: new MockAIProvider(), analytics: new NoopAnalytics(), userId: "user-1" };
  const profile = await store.createResumeProfile("user-1", { targetRole: "Recepcionista" });
  profileId = profile.id;
});

/** Resolves the describe question's state-dependent wording. */
async function describeText(): Promise<string> {
  const state = await assembleProfileState(store, profileId);
  const q = getCatalogQuestion("experience_add")!;
  return typeof q.text === "function" ? q.text(state) : q.text;
}

const answerCounts = (counts: Record<string, number>) =>
  processAnswer(ctx, {
    profileId,
    questionId: "experience_type_counts",
    section: "experience",
    rawAnswer: JSON.stringify(counts),
  });

const describe1 = (rawAnswer: string) =>
  processAnswer(ctx, { profileId, questionId: "experience_add", section: "experience", rawAnswer });

describe("the describe question names position and chosen type", () => {
  it("walks the counted list in order, naming each type", async () => {
    await answerCounts({ informal_work: 2, volunteering: 1 });

    expect(await describeText()).toBe(
      "Experiencia 1 de 3: tu trabajo informal. Cuéntame de qué se trataba y qué hacías.",
    );

    await describe1("Ayudaba en la tienda de la esquina atendiendo a los clientes");
    expect(await describeText()).toBe(
      "Experiencia 2 de 3: tu trabajo informal. Cuéntame de qué se trataba y qué hacías.",
    );

    await describe1("Repartía volantes y acomodaba la mercancía");
    expect(await describeText()).toBe(
      "Experiencia 3 de 3: tu voluntariado. Cuéntame de qué se trataba y qué hacías.",
    );
  });

  it("drops the numbering when there is only one experience", async () => {
    await answerCounts({ caregiving: 1 });
    expect(await describeText()).toBe(
      "Cuéntame de tu cuidado de personas: ¿de qué se trataba y qué hacías?",
    );
  });
});

describe("a chosen type survives the description", () => {
  it("keeps 'trabajo informal' even when the answer talks about caregiving", async () => {
    await answerCounts({ informal_work: 1 });
    // The mock's detector reads "cuidaba a mi abuela" as caregiving — the explicit
    // selection must still win.
    await describe1("Cuidaba a mi abuela y también limpiaba la casa por un pago");

    const list = await store.listExperience(profileId);
    expect(list).toHaveLength(1);
    expect(list[0]!.experienceType).toBe("informal_work");
    // The description itself is still captured verbatim.
    expect(list[0]!.rawDescription).toContain("Cuidaba a mi abuela");
  });

  it("keeps every counted type stable across the whole describe loop", async () => {
    await answerCounts({ volunteering: 1, informal_work: 1 });
    await describe1("Cuidaba a los niños de la parroquia");
    await describe1("Vendía comida en la calle con mi mamá");

    const types = (await store.listExperience(profileId)).map((e) => e.experienceType);
    expect(types).toEqual(["volunteering", "informal_work"]);
  });

  it("still learns the type for an entry nobody classified", async () => {
    // The broad "Agregar otra experiencia" path stores `other`, so detection fills it.
    await store.createExperience(profileId, { experienceType: "other" });
    await describe1("Monté mi propio negocio de venta de ropa y manejaba el inventario");

    const list = await store.listExperience(profileId);
    expect(list[0]!.experienceType).toBe("business_owner");
  });
});

describe("dates are asked for every experience, not just the latest", () => {
  /** Resolves the date question's state-dependent wording. */
  async function datesText(): Promise<string> {
    const state = await assembleProfileState(store, profileId);
    const q = getCatalogQuestion("experience_dates")!;
    return typeof q.text === "function" ? q.text(state) : q.text;
  }

  const answerDates = (rawAnswer: string) =>
    processAnswer(ctx, {
      profileId,
      questionId: "experience_dates",
      section: "experience",
      rawAnswer,
    });

  it("names each experience in turn and stores the date on THAT entry", async () => {
    await answerCounts({ informal_work: 1, volunteering: 1 });
    await describe1("Atendía la caja de la tienda");
    await describe1("Ayudaba en la parroquia los domingos");

    expect(await datesText()).toBe(
      "Experiencia 1 de 2, tu trabajo informal: ¿En qué fechas fue? Una fecha aproximada está bien.",
    );
    await answerDates("de 2015 a 2017");

    // The first entry got the date; the second is now the one being asked about.
    let list = await store.listExperience(profileId);
    expect(list[0]!.startDate).toContain("2015");
    expect(list[1]!.startDate).toBeNull();

    expect(await datesText()).toBe(
      "Experiencia 2 de 2, tu voluntariado: ¿En qué fechas fue? Una fecha aproximada está bien.",
    );
    await answerDates("de marzo 2022 a la actualidad");

    list = await store.listExperience(profileId);
    expect(list[1]!.startDate).toContain("marzo 2022");
  });

  it("stops asking once every experience is dated", async () => {
    await answerCounts({ informal_work: 2 });
    await describe1("Vendía comida en la calle");
    await describe1("Repartía volantes");
    await answerDates("2019");
    const last = await answerDates("2021");

    const q = getCatalogQuestion("experience_dates")!;
    const state = await assembleProfileState(store, profileId);
    expect(q.precondition(state)).toBe(false);
    expect(last.nextQuestion.questionId).not.toBe("experience_dates");
  });

  it("gives the résumé something to order by", async () => {
    // The whole point of asking per entry: an undated entry cannot be placed.
    await answerCounts({ informal_work: 1, volunteering: 1 });
    await describe1("Atendía la caja");
    await describe1("Ayudaba en la parroquia");
    await answerDates("de 2012 a 2014");
    await answerDates("de 2023 a la actualidad");

    const dated = (await store.listExperience(profileId)).filter(
      (e) => e.startDate || e.endDate || e.isCurrent,
    );
    expect(dated).toHaveLength(2);
  });
});

describe("'Agregar otra experiencia' adds rather than absorbing a pending entry", () => {
  it("creates a new entry even while a counted one is still undescribed", async () => {
    await answerCounts({ informal_work: 2 });
    expect((await store.listExperience(profileId)).length).toBe(2);

    await processAnswer(ctx, {
      profileId,
      questionId: "experience_add",
      section: "experience",
      rawAnswer: "Además hice un proyecto escolar de reciclaje",
      forceNewEntry: true,
    });

    const list = await store.listExperience(profileId);
    expect(list).toHaveLength(3);
    // The two counted entries are untouched — still typed, still undescribed.
    expect(list.slice(0, 2).every((e) => e.experienceType === "informal_work")).toBe(true);
    expect(list.slice(0, 2).every((e) => !e.rawDescription)).toBe(true);
    expect(list[2]!.rawDescription).toContain("proyecto escolar");
  });

  it("without the flag, the answer fills the pending entry (the describe loop)", async () => {
    await answerCounts({ informal_work: 2 });
    await describe1("Atendía la caja de la tienda");

    const list = await store.listExperience(profileId);
    expect(list).toHaveLength(2); // filled, not added
    expect(list[0]!.rawDescription).toContain("Atendía la caja");
  });

  it("respects the cap: a forced new entry cannot exceed it", async () => {
    await answerCounts({ informal_work: 4 });

    await processAnswer(ctx, {
      profileId,
      questionId: "experience_add",
      section: "experience",
      rawAnswer: "Una más que no debería entrar",
      forceNewEntry: true,
    });

    expect((await store.listExperience(profileId)).length).toBe(4);
  });
});
