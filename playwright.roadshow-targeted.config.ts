import { defineConfig, devices } from "@playwright/test";

// These tests require a separately started Hermes/provider harness and must
// never silently use the normal UI suite's default server.
export default defineConfig({
  testDir: "./tests/roadshow",
  outputDir: `.tmp/roadshow-targeted-${Date.now()}`,
  timeout: 180_000,
  workers: 1,
  use: { baseURL: process.env.HERMES_INTEGRATION_BASE_URL || process.env.PLAYWRIGHT_BASE_URL, trace: "on" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "msedge" } }]
});
