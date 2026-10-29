import { defineConfig } from "@playwright/test";
import config from "./playwright.hermes-integration.config";
export default defineConfig({ ...config, grep: /BEHAVIOR /u });
