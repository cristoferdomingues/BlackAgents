import { defineConfig, devices } from "@playwright/test"

/**
 * E2E config for BlackAgents. Runs the specs in `e2e/` against a dev server.
 * The server is started with an isolated `BLACK_AGENTS_CONFIG_DIR` so tests
 * never touch the developer's real workspaces or secrets.
 *
 * First run: `npx playwright install` to download browsers, then `npm run test:e2e`.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "next dev -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      BLACK_AGENTS_CONFIG_DIR: ".e2e-tmp/config",
    },
  },
})
