import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      ".agents/**",
      ".claude/**",
      ".codex/**",
      ".next/**",
      "artifacts/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "public/pdfjs/**",
      "coverage/**",
      "next-env.d.ts"
    ]
  }
];

export default eslintConfig;
