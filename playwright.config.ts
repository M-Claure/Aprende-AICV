import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Tests boot the Next.js app in mock mode (AI_PROVIDER=mock,
 * PERSISTENCE=memory) so the full funnel runs with no external services.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Production build: the in-memory store singleton is shared across route
    // bundles in `next start` (Next dev isolates route modules, which breaks
    // the process-local store used for offline e2e).
    command: "npm run build && npx next start -p 3000",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      AI_PROVIDER: "mock",
      PERSISTENCE: "memory",
      E2E_AUTH_BYPASS: "1",
    },
  },
});
