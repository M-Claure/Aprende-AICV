import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client (auth only, in the UI). Returns null when Supabase is
 * not configured — in that mode the app runs against the in-memory store with a
 * dev user and needs no login. NEXT_PUBLIC_* values are inlined at build time.
 */
let cached: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  if (!cached) cached = createBrowserClient(url, anon);
  return cached;
}

/** Whether Supabase auth is configured (drives whether login is required). */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
