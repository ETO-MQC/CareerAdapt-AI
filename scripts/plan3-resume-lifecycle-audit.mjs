import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const outputDir = process.env.PLAN3_LIFECYCLE_AUDIT_DIR ?? "artifacts/plan3-resume-lifecycle-after";
const baseUrl = process.env.PLAN3_BASE_URL ?? "http://127.0.0.1:3000";
const viewports = [
  [1920, 1080],
  [1440, 900],
  [1366, 768],
  [1280, 800],
  [1024, 768]
];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const metrics = [];

for (const [width, height] of viewports) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/resume`, { waitUntil: "networkidle" });
  await page.getByRole("button").filter({ hasText: "从零创建" }).click();
  await page.getByTestId("resume-studio-workbar").getByRole("button", { name: "返回", exact: true }).click();

  let card = page.locator(".resume-card").filter({ hasText: "空白简历" }).first();
  await card.locator("summary").click();
  await card.getByRole("button", { name: "归档", exact: true }).click();
  await page.locator(".resume-filter-row").getByRole("button", { name: /归档/ }).click();
  card = page.locator(".resume-card").filter({ hasText: "空白简历" }).first();
  await card.getByRole("button", { name: "移至回收站" }).click();
  await page.locator(".resume-filter-row").getByRole("button", { name: /回收站/ }).click();
  await page.locator(".resume-card").filter({ hasText: "空白简历" }).waitFor();

  await page.screenshot({ path: `${outputDir}/${width}x${height}-trash.png`, fullPage: true });
  metrics.push(await page.evaluate(({ width, height }) => {
    const filter = document.querySelector(".resume-filter-row");
    const cards = document.querySelector(".resume-card-list");
    const dangerButton = document.querySelector(".resume-card .danger-button");
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        alignItems: style.alignItems,
        justifyContent: style.justifyContent,
        textAlign: style.textAlign
      };
    };
    return {
      viewport: `${width}x${height}`,
      rootOverflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      selectedFilter: document.querySelector(".resume-filter-row .filter-active")?.textContent?.trim() ?? null,
      cardCount: document.querySelectorAll(".resume-card").length,
      stayedInCenter: !document.querySelector("[data-testid='resume-studio-shell']"),
      filter: box(filter),
      cards: box(cards),
      dangerButton: box(dangerButton)
    };
  }, { width, height }));
  await context.close();
}

await browser.close();
await writeFile(`${outputDir}/metrics.json`, `${JSON.stringify(metrics, null, 2)}\n`);
