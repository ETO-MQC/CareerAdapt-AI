import { defineConfig } from "@playwright/test";
import config from "./playwright.hermes-integration.config";

export default defineConfig({ ...config, grep: /SCENARIO [BC]/u });
