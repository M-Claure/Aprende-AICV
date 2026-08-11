import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "lib/**/*.test.ts"],
    // Playwright specs live in tests/e2e and run via `npm run test:e2e`.
    exclude: ["node_modules/**", "tests/e2e/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` throws when imported outside Next's bundler; stub it so
      // server-only modules (env, supabase) can be imported in unit tests.
      "server-only": fileURLToPath(new URL("./tests/stubs/empty.ts", import.meta.url)),
    },
  },
});
