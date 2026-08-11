import "server-only";
import { getEnv } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { MemoryStore } from "./memory-store";
import { SupabaseStore } from "./supabase-store";
import type { Store } from "./store";

export type { Store } from "./store";

/**
 * A single MemoryStore must persist across requests for the whole process.
 * We stash it on `globalThis` (not a module-level `let`) because Next.js dev
 * re-instantiates route modules — a module-scoped singleton would give each
 * route its own empty store, so a profile created by one route wouldn't be
 * found by the next ("Perfil no encontrado"). `globalThis` is shared across all
 * module instances in the process, so the store survives.
 */
const globalForStore = globalThis as unknown as { __mcvMemoryStore?: MemoryStore };

export function getMemoryStore(): MemoryStore {
  if (!globalForStore.__mcvMemoryStore) {
    globalForStore.__mcvMemoryStore = new MemoryStore();
  }
  return globalForStore.__mcvMemoryStore;
}

/**
 * Resolve the persistence backend from configuration.
 * - memory   → process-local singleton (dev/tests, no external services)
 * - supabase → request-scoped, RLS-enforced client
 */
export function getStore(): Store {
  const env = getEnv();
  if (env.PERSISTENCE === "supabase") {
    return new SupabaseStore(getSupabaseServerClient());
  }
  return getMemoryStore();
}
