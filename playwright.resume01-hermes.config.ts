import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "tests/e2e", testMatch: "resume01-hermes.spec.ts", timeout: 180_000,
  expect: { timeout: 30_000 }, workers: 1, use: { baseURL: process.env.HERMES_INTEGRATION_BASE_URL, headless: true, trace: "retain-on-failure" } });
