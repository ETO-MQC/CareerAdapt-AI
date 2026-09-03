import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "hermes-career-agent-real-eval.spec.ts",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: process.env.HERMES_INTEGRATION_BASE_URL || "http://127.0.0.1:3010",
    headless: true,
    trace: "retain-on-failure"
  }
});
