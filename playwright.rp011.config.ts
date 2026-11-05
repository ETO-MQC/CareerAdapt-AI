import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e', testMatch: ['hermes-p46h-integration.spec.ts', 'resume01-hermes.spec.ts'],
  grep: /CASE D |CASE L |RESUME01 real Hermes/, workers: 1, retries: 0, timeout: 180_000,
  expect: { timeout: 30_000 }, outputDir: '.tmp/rp011-playwright',
  use: { baseURL: process.env.HERMES_INTEGRATION_BASE_URL, headless: true, trace: 'retain-on-failure' }
});
