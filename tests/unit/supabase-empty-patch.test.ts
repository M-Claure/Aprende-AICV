import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseStore } from "@/lib/repositories/supabase-store";

/**
 * Reproduces the PostgREST behaviour that caused "Cannot coerce the result to a
 * single JSON object" (PGRST116): an EMPTY patch body updates nothing and
 * returns ZERO rows, even when the filter matches an existing row. Verified
 * against the live database before writing this stub.
 */
function stubDb(row: Record<string, unknown>) {
  const calls: { updates: Record<string, unknown>[]; selects: number } = { updates: [], selects: 0 };

  const builder = (table: string) => ({
    select() {
      return {
        eq() {
          return {
            maybeSingle: async () => {
              calls.selects += 1;
              return { data: row, error: null };
            },
          };
        },
      };
    },
    update(patch: Record<string, unknown>) {
      calls.updates.push(patch);
      const empty = Object.keys(patch).length === 0;
      return {
        eq() {
          return {
            select() {
              return {
                single: async () =>
                  empty
                    ? {
                        data: null,
                        error: {
                          code: "PGRST116",
                          message: "Cannot coerce the result to a single JSON object",
                        },
                      }
                    : { data: { ...row, ...patch }, error: null },
              };
            },
          };
        },
      };
    },
    _table: table,
  });

  return { db: { from: builder } as unknown as SupabaseClient, calls };
}

const EXPERIENCE_ROW = {
  id: "exp-1",
  resume_profile_id: "p1",
  experience_type: "family_business",
  title: "Ayudante",
  organization: null,
  location: null,
  start_date: null,
  end_date: null,
  is_current: false,
  raw_description: "Ayudaba en el negocio",
  responsibilities: [],
  accomplishments: [],
  tools: [],
  people_served: null,
  metrics: [],
  source: "ai_extracted",
  confirmation_status: "needs_review",
};

describe("SupabaseStore — an all-undefined patch is a no-op, not an error", () => {
  it("returns the row unchanged instead of throwing PGRST116", async () => {
    const { db, calls } = stubDb(EXPERIENCE_ROW);
    const store = new SupabaseStore(db);

    // Every field undefined — what a back-edit produced when the normalizer
    // returned an entry with no mappable fields.
    const result = await store.updateExperience("exp-1", {});

    expect(result.id).toBe("exp-1");
    expect(result.rawDescription).toBe("Ayudaba en el negocio");
    // It must not even attempt the doomed empty UPDATE.
    expect(calls.updates).toHaveLength(0);
    expect(calls.selects).toBe(1);
  });

  it("still issues a real update when there is something to write", async () => {
    const { db, calls } = stubDb(EXPERIENCE_ROW);
    const store = new SupabaseStore(db);

    const result = await store.updateExperience("exp-1", { title: "Encargada" });

    expect(result.title).toBe("Encargada");
    expect(calls.updates).toEqual([{ title: "Encargada" }]);
  });

  it("applies to every entity that supports partial updates", async () => {
    const { db, calls } = stubDb({ id: "x", resume_profile_id: "p1", name: "Existente" });
    const store = new SupabaseStore(db);

    await store.updateProject("x", {});
    await store.updateAchievement("x", {});
    await store.updateCertification("x", {});
    await store.updateLanguage("x", {});
    await store.updateSkill("x", {});
    await store.updateEducation("x", {});

    expect(calls.updates).toHaveLength(0);
    expect(calls.selects).toBe(6);
  });
});
