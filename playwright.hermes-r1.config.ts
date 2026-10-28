import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "hermes-config-r1.spec.ts",
  timeout: 180_000,
  workers: 1,
  reporter: "line",
  expect: { timeout: 30_000 },
  use: { baseURL: process.env.HERMES_INTEGRATION_BASE_URL, headless: true, trace: "off" }
});
