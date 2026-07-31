import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL: externalBaseUrl ?? "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  webServer: externalBaseUrl ? undefined : {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "msedge"
      }
    }
  ]
});
