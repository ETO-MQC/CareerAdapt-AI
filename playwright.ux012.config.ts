import { defineConfig } from "@playwright/test";
import hermes from "./playwright.hermes-integration.config";

// Same UX012 test identity, routed to the real staging Hermes harness.
export default defineConfig(hermes, {
  testMatch: "ux012-business-recovery.spec.ts",
  grep: /UX012 persisted rate-limit recovery preserves input and requires an explicit new request$/,
  retries: 0,
  outputDir: `${process.env.UX012_EVIDENCE_DIR || "docs/quality/ux-01.2-r-logs"}/${process.env.HERMES_INTEGRATION_PREFLIGHT_ONLY === "1" ? "initialization" : "business"}-browser-results`,
  use: { ...hermes.use, trace: "on", screenshot: "only-on-failure" }
});
