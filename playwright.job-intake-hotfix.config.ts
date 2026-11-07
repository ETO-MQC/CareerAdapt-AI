import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./tests/e2e", testMatch: "job-intake-hotfix.hermes.ts", workers: 1,
  timeout: 180_000, expect: { timeout: 30_000 }, reporter: "line",
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL, headless: true, trace: "on", screenshot: "only-on-failure" }
});
