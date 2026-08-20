/**
 * Entry lookups by id must send JSONB containment, not a Postgres array literal.
 *
 * `postgrest-js` branches on the type of the value passed to `.contains()`: an
 * ARRAY is encoded as a Postgres array literal with `value.join(',')`, so
 * `.contains("experience", [{ id }])` serialized to the literal text
 * `cs.{[object Object]}` and Postgres rejected every such query with "invalid
 * input syntax for type json". A pre-serialized STRING is passed through
 * untouched, which is the containment the GIN indexes are for.
 *
 * Nothing caught this: the unit suite and the e2e suite both run on MemoryStore,
 * so it only ever failed against a real database — on getEducation/getExperience,
 * every entry edit and delete, and the answer pipeline's back-edit path.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseStore } from "@/lib/repositories/supabase-store";

/** Records what the store passes to `.contains()`, and returns "no row found". */
function recordingClient(): { client: SupabaseClient; calls: [string, unknown][] } {
  const calls: [string, unknown][] = [];
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    select: chain,
    eq: chain,
    limit: chain,
    order: chain,
    contains: (column: string, value: unknown) => {
      calls.push([column, value]);
      return builder;
    },
    maybeSingle: async () => ({ data: null, error: null }),
  });
  return { client: { from: () => builder } as unknown as SupabaseClient, calls };
}

describe("entry lookup by id", () => {
  const entryId = "a93ce414-1138-483c-b346-bfc020affd8c";

  it("sends a JSON string, never an array", async () => {
    const { client, calls } = recordingClient();
    await new SupabaseStore(client).getExperience(entryId);

    expect(calls).toHaveLength(1);
    const [column, value] = calls[0]!;
    expect(column).toBe("experience");
    // An array here is the bug: postgrest would join it into `{[object Object]}`.
    expect(Array.isArray(value)).toBe(false);
    expect(typeof value).toBe("string");
    expect(value).toBe(`[{"id":"${entryId}"}]`);
    expect(JSON.parse(value as string)).toEqual([{ id: entryId }]);
  });

  it("uses the same encoding for every list column", async () => {
    const cases: [keyof SupabaseStore, string][] = [
      ["getEducation", "education"],
      ["getExperience", "experience"],
      ["getSkill", "skills"],
      ["getProject", "projects"],
      ["getCertification", "certifications"],
      ["getLanguage", "languages"],
      ["getAchievement", "achievements"],
    ];
    for (const [method, column] of cases) {
      const { client, calls } = recordingClient();
      const store = new SupabaseStore(client);
      await (store[method] as (id: string) => Promise<unknown>)(entryId);
      expect(calls[0]?.[0], method as string).toBe(column);
      expect(typeof calls[0]?.[1], method as string).toBe("string");
    }
  });
});
