import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pdfHtml = readFileSync(join(process.cwd(), "src", "services", "export", "pdfHtml.tsx"), "utf8");
const globalsCss = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");

/**
 * The PDF is produced by feeding raw globals.css to the browser, so `@tailwind base` never
 * survives and the UA stylesheet takes over. Measured drift between preview and PDF reached
 * 11.1mm before the reset below; scripts/verification/render-parity.mjs reproduces the check.
 */
describe("pdf print contract", () => {
  it("still strips @tailwind from the source stylesheet", () => {
    expect(pdfHtml).toContain("replace(/@tailwind\\s+[^;]+;/g, \"\")");
  });

  it("re-establishes the preflight rules the layout depends on", () => {
    expect(pdfHtml).toMatch(/box-sizing:\s*border-box/);
    expect(pdfHtml).toMatch(/h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6,\s*p,\s*figure,\s*blockquote,\s*dl,\s*dd,\s*pre\s*\{\s*margin:\s*0/);
    expect(pdfHtml).toMatch(/ul,\s*ol\s*\{\s*margin:\s*0/);
  });

  it("resets canvas zoom when printing so the page emits true size", () => {
    expect(globalsCss).toMatch(/@media print[\s\S]*?\.resume-preview-pages\s*\{[^}]*zoom:\s*1\s*!important/);
  });

  it("keeps the on-canvas zoom as a reading aid only", () => {
    expect(globalsCss).toMatch(/\.resume-preview-pages\s*\{[^}]*zoom:\s*var\(--resume-preview-zoom,\s*1\)/);
  });
});
