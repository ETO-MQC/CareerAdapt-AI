import { defineConfig } from "@playwright/test";
import base from "./playwright.hermes-integration.config";
export default defineConfig({ ...base, testMatch: "hermes-slow-provider.spec.ts", grep: undefined, timeout: 300000 });
