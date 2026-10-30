import { defineConfig } from "@playwright/test";
import integration from "./playwright.hermes-integration.config";

export default defineConfig({ ...integration, grep: /SQ1 CLAIM/u });
