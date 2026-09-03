import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "hermes-p46h-integration.spec.ts",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: process.env.HERMES_INTEGRATION_BASE_URL || "http://127.0.0.1:3010",
    headless: true,
    trace: "retain-on-failure"
  }
});
