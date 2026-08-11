import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

/**
 * Auth-scoped client: reads the user's session from cookies and operates under
 * that user's RLS policies. Use this for all per-user data access.
 */
export function getSupabaseServerClient(): SupabaseClient {
  const env = getEnv();
  const cookieStore = cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet: { name: string; value: string; options?: Record<string, unknown> }[]) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // `set` throws in Server Components; middleware/route handlers refresh sessions.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS — SERVER ONLY. Use only for privileged
 * operations (e.g. user provisioning). Never expose to the browser.
 */
let serviceClient: SupabaseClient | null = null;
export function getSupabaseServiceClient(): SupabaseClient {
  if (serviceClient) return serviceClient;
  const env = getEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase service client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  serviceClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}
