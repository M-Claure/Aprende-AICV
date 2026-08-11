import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Throwaway config for the worst-case cost run. Lives outside the project's own
// include globs (tests/unit/**, lib/**/*.test.ts) so `npm test` never picks it
// up and starts making real API calls.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["wc-tmp/worstcase.test.ts"],
    testTimeout: 900_000,
    hookTimeout: 900_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../", import.meta.url)),
      "server-only": fileURLToPath(new URL("../tests/stubs/empty.ts", import.meta.url)),
    },
  },
});
