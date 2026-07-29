import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    storageState: {
      cookies: [{
        name: "careeradapt_workspace_mode",
        value: "manual",
        domain: "127.0.0.1",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: "Lax"
      }],
      origins: [{
        origin: baseURL,
        localStorage: [{
          name: "careeradapt.workspaceMode.v1",
          value: "manual"
        }]
      }]
    }
  },
  webServer: {
    command: "pnpm dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      channel: "msedge"
    }
  }]
});
