import "server-only";
import { z } from "zod";

/**
 * Server-side environment configuration.
 *
 * This module is `server-only`: importing it from a client component is a build
 * error, which guarantees secrets (Anthropic key, Supabase service role key,
 * Amplitude key) never reach the browser. Public values are also mirrored here
 * for server use; the browser reads them via `NEXT_PUBLIC_*` directly.
 */

/**
 * Online-only mode. When true, the offline-capable backends are rejected at
 * startup so the app can never boot without its external services:
 *   - AI_PROVIDER=mock       (the deterministic, offline mock)
 *   - PERSISTENCE=memory     (the in-process, no-database store)
 * This forces AI_PROVIDER=anthropic + PERSISTENCE=supabase, both of which
 * require a network connection. Paired with the runtime connectivity guard in
 * `middleware.ts`, it guarantees the product does not function offline.
 *
 * This is a hard build/runtime constant (not an env override) on purpose:
 * "cannot work offline" must not be defeatable by setting an environment
 * variable. Flip to `false` only to intentionally restore offline support
 * (e.g. to run the mock-based test suite as originally designed).
 */
const ONLINE_ONLY = true;
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    AI_PROVIDER: z.enum(["mock", "anthropic"]).default("mock"),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default("claude-opus-4-8"),

    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

    AMPLITUDE_API_KEY: z.string().optional(),

    PERSISTENCE: z.enum(["supabase", "memory"]).default("memory"),

    // Test-only escape hatch: bypass Supabase auth for e2e runs.
    E2E_AUTH_BYPASS: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (ONLINE_ONLY && env.AI_PROVIDER === "mock") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "AI_PROVIDER=mock is disabled: this app runs online-only and requires AI_PROVIDER=anthropic (+ ANTHROPIC_API_KEY)",
        path: ["AI_PROVIDER"],
      });
    }
    if (ONLINE_ONLY && env.PERSISTENCE === "memory") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "PERSISTENCE=memory is disabled: this app runs online-only and requires PERSISTENCE=supabase (+ Supabase URL/keys)",
        path: ["PERSISTENCE"],
      });
    }
    if (env.AI_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic",
        path: ["ANTHROPIC_API_KEY"],
      });
    }
    if (env.PERSISTENCE === "supabase") {
      if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required when PERSISTENCE=supabase",
          path: ["NEXT_PUBLIC_SUPABASE_URL"],
        });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  // Treat blank env vars (common in copied .env files) as unset, so an empty
  // NEXT_PUBLIC_SUPABASE_URL="" doesn't fail `.url()` — it just means "not set".
  const raw: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    raw[key] = value === "" ? undefined : value;
  }
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  cached = parsed.data;
  return cached;
}

/** Reset the cache — used by tests that mutate process.env. */
export function resetEnvCache(): void {
  cached = null;
}
