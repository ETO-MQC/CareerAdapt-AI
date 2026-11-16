import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: `.tmp/h4b2-browser-results-${Date.now()}`,
  testMatch: ["profile-intake-first-user.hermes.spec.ts", "profile-intake-diagnostic.hermes.spec.ts", "profile-intake-official-service.hermes.spec.ts", "profile-intake-recovery-ui.spec.ts"],
  timeout: 180_000,
  preserveOutput: "always",
  expect: { timeout: 5_000 },
  workers: 1,
  use: { baseURL: process.env.HERMES_INTEGRATION_BASE_URL, trace: "on", actionTimeout: 10_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "msedge" } }]
});
