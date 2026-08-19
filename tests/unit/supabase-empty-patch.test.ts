import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseStore } from "@/lib/repositories/supabase-store";

/**
 * Entry edits against the simplified schema.
 *
 * Two behaviours worth pinning, both about the JSONB list model
 * (`supabase/migrations/0007_simplified_schema.sql`):
 *
 *  1. An all-undefined patch writes nothing. It originally mattered because an
 *     empty PostgREST body returns zero rows and raised PGRST116; it still
 *     matters because a needless write bumps `revision` and makes any concurrent
 *     writer lose its optimistic guard and retry.
 *  2. A real patch rewrites only the target entry inside its array, leaving its
 *     siblings and the rest of the funnel row untouched.
 */

/** A minimal PostgREST fake covering the query shapes SupabaseStore builds. */
function stubDb(row: Record<string, unknown>) {
  const calls: { updates: Record<string, unknown>[]; selects: number } = { updates: [], selects: 0 };
  let current = { ...row };

  const rowResult = () => {
    calls.selects += 1;
    return { data: { ...current }, error: null };
  };

  const from = () => ({
    select() {
      const chain: any = {
        eq: () => chain,
        contains: () => chain,
        limit: () => chain,
        order: () => chain,
        maybeSingle: async () => rowResult(),
        single: async () => rowResult(),
      };
      return chain;
    },
    update(patch: Record<string, unknown>) {
      calls.updates.push(patch);
      current = { ...current, ...patch };
      const chain: any = {
        eq: () => chain,
        select: () => ({
          ...chain,
          then: undefined,
          maybeSingle: async () => ({ data: { ...current }, error: null }),
          single: async () => ({ data: { ...current }, error: null }),
        }),
      };
      // `.update().eq().eq().select()` resolves to a rows array in mutateRow.
      chain.select = () => Object.assign(Promise.resolve({ data: [{ id: current.id }], error: null }), {
        maybeSingle: async () => ({ data: { ...current }, error: null }),
        single: async () => ({ data: { ...current }, error: null }),
      });
      return chain;
    },
  });

  return { db: { from } as unknown as SupabaseClient, calls, read: () => current };
}

const EXPERIENCE = {
  id: "exp-1",
  resumeProfileId: "p1",
  experienceType: "family_business",
  title: "Ayudante",
  organization: null,
  location: null,
  startDate: null,
  endDate: null,
  isCurrent: false,
  rawDescription: "Ayudaba en el negocio",
  responsibilities: [],
  accomplishments: [],
  tools: [],
  peopleServed: null,
  metrics: [],
  source: "ai_extracted",
  confirmationStatus: "needs_review",
};

const SIBLING = { ...EXPERIENCE, id: "exp-2", title: "Cajera" };

/** A funnel row carrying two experience entries and one of everything else. */
const funnelRow = () => ({
  id: "p1",
  user_id: "u1",
  revision: 7,
  experience: [{ ...EXPERIENCE }, { ...SIBLING }],
  projects: [{ id: "x", resumeProfileId: "p1", name: "Existente" }],
  achievements: [{ id: "x", resumeProfileId: "p1", title: "Existente" }],
  certifications: [{ id: "x", resumeProfileId: "p1", name: "Existente" }],
  languages: [{ id: "x", resumeProfileId: "p1", name: "Existente" }],
  skills: [{ id: "x", resumeProfileId: "p1", name: "Existente", status: "suggested" }],
  education: [{ id: "x", resumeProfileId: "p1", institution: "Existente" }],
});

describe("SupabaseStore — an all-undefined patch is a no-op, not an error", () => {
  it("returns the entry unchanged instead of writing", async () => {
    const { db, calls } = stubDb(funnelRow());
    const store = new SupabaseStore(db);

    const result = await store.updateExperience("exp-1", {});

    expect(result.id).toBe("exp-1");
    expect(result.rawDescription).toBe("Ayudaba en el negocio");
    expect(calls.updates).toHaveLength(0);
  });

  it("applies to every entity that supports partial updates", async () => {
    const { db, calls } = stubDb(funnelRow());
    const store = new SupabaseStore(db);

    await store.updateProject("x", {});
    await store.updateAchievement("x", {});
    await store.updateCertification("x", {});
    await store.updateLanguage("x", {});
    await store.updateSkill("x", {});
    await store.updateEducation("x", {});

    expect(calls.updates).toHaveLength(0);
  });
});

describe("SupabaseStore — a real patch rewrites only its own entry", () => {
  it("writes the whole array back with just that entry changed", async () => {
    const { db, calls } = stubDb(funnelRow());
    const store = new SupabaseStore(db);

    const result = await store.updateExperience("exp-1", { title: "Encargada" });

    expect(result.title).toBe("Encargada");
    expect(calls.updates).toHaveLength(1);

    const written = calls.updates[0]!;
    const list = written.experience as Array<Record<string, unknown>>;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: "exp-1", title: "Encargada" });
    // The sibling must survive the read-modify-write untouched.
    expect(list[1]).toMatchObject({ id: "exp-2", title: "Cajera" });
    // Unrelated columns are not part of the patch at all.
    expect(written).not.toHaveProperty("skills");
  });

  it("guards the write with the revision it read", async () => {
    const { db, calls } = stubDb(funnelRow());
    const store = new SupabaseStore(db);

    await store.updateExperience("exp-1", { title: "Encargada" });

    // Optimistic concurrency: the new revision is the one that was read, plus one.
    expect(calls.updates[0]).toMatchObject({ revision: 8 });
  });
});
