import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "roadshow-entry.hermes.spec.ts",
  outputDir: `.tmp/roadshow-entry-${Date.now()}`,
  preserveOutput: "always",
  timeout: 240_000,
  expect: { timeout: 10_000 },
  workers: 1,
  use: { baseURL: process.env.HERMES_INTEGRATION_BASE_URL, trace: "on" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "msedge" } }]
});
