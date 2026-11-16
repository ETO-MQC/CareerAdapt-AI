import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: { alias: { "@": fileURLToPath(new URL("../../../src", import.meta.url)),
    "server-only": fileURLToPath(new URL("../../ai-real/_server-only-mock.ts", import.meta.url)) } },
  server: { fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] } },
  optimizeDeps: { noDiscovery: true, include: ["dexie", "zod"] }
});
