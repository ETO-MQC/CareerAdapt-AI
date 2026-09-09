import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const uiBaseUrl = externalBaseUrl ?? "http://127.0.0.1:3000";
const nonUiSuites = [
  "**/hermes-p46h-integration.spec.ts",
  "**/hermes-career-agent-eval.spec.ts",
  "**/hermes-career-agent-real-eval.spec.ts",
  "**/p43c3-real-provider-import.spec.ts",
  "**/p43c4-local-real-files.spec.ts",
  "**/p43d-real-provider-tailoring.spec.ts",
  "**/p43g-real-provider-workflows.spec.ts",
  "**/p43h-authoritative-recovery.spec.ts",
  "**/p44e-real-hermes-reproduction.spec.ts",
  "**/p45c1-real-resume-artifacts.spec.ts"
];

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: nonUiSuites,
  timeout: 45_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL: uiBaseUrl,
    trace: "on-first-retry"
  },
  webServer: externalBaseUrl ? undefined : {
    command: "pnpm dev:next",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    env: {
      HERMES_WEB_CONTROL_ENABLED: "false",
      HERMES_RUNTIME_API_KEY: "",
      API_SERVER_KEY: ""
    },
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL === "bundled" ? undefined : "msedge"
      }
    }
  ]
});
