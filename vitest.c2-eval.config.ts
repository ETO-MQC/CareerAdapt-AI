import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// 加载 .env.local（与 vitest.c1-eval.config.ts 相同模式）
const envLocalPath = resolve(fileURLToPath(new URL(".", import.meta.url)), ".env.local");
if (existsSync(envLocalPath)) {
  const content = readFileSync(envLocalPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/c2-eval/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/ai-real/_server-only-mock.ts", import.meta.url))
    }
  }
});
