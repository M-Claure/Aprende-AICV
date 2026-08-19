import "server-only";
import { getEnv } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { MemoryResumeFileStore, type ResumeFileStore } from "./resume-file-store";
import { SupabaseResumeFileStore } from "./supabase-resume-file-store";

export type { ResumeFileStore, ResumePdfRef } from "./resume-file-store";
export { RESUME_BUCKET, resumePdfPath } from "./resume-file-store";

/**
 * The memory file store must outlive a single request, for the same reason
 * `getMemoryStore()` does: Next re-instantiates route modules in dev, so a
 * module-scoped singleton would give each route its own empty store.
 */
const globalForFiles = globalThis as unknown as { __mcvResumeFiles?: MemoryResumeFileStore };

export function getMemoryResumeFileStore(): MemoryResumeFileStore {
  if (!globalForFiles.__mcvResumeFiles) {
    globalForFiles.__mcvResumeFiles = new MemoryResumeFileStore();
  }
  return globalForFiles.__mcvResumeFiles;
}

/** Resolve the artifact backend from configuration, mirroring `getStore()`. */
export function getResumeFileStore(): ResumeFileStore {
  const env = getEnv();
  if (env.PERSISTENCE === "supabase") {
    return new SupabaseResumeFileStore(getSupabaseServerClient());
  }
  return getMemoryResumeFileStore();
}
