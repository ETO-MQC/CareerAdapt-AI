import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const outputDir = process.env.PLAN3_PROFILE_AUDIT_DIR ?? "artifacts/plan3-profile-fields-before";
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

async function inspect(page, scenario, width, height) {
  await page.screenshot({ path: `${outputDir}/${width}x${height}-${scenario}.png`, fullPage: true });
  metrics.push(await page.evaluate(({ scenario, width, height }) => {
    const visible = (element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element || !visible(element)) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        selector,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        display: style.display,
        gridTemplateColumns: style.gridTemplateColumns,
        padding: style.padding,
        gap: style.gap,
        overflowY: style.overflowY,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight
      };
    };
    const detail = document.querySelector(".profile-detail-panel");
    return {
      scenario,
      viewport: `${width}x${height}`,
      rootOverflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      pageScroll: Math.max(0, document.body.scrollHeight - innerHeight),
      nestedScrollRegions: [...document.querySelectorAll("*")].filter((element) => {
        const style = getComputedStyle(element);
        return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
      }).length,
      visibleActions: [...document.querySelectorAll("button, a[href], input, textarea, select, summary")].filter(visible).length,
      categories: [...document.querySelectorAll(".profile-category-button")].map((element) => element.textContent?.trim()),
      detailLabels: detail ? [...detail.querySelectorAll("label")].map((element) => element.textContent?.trim()) : [],
      detailControlTypes: detail ? [...detail.querySelectorAll("input, textarea, select")].map((element) => {
        if (element instanceof HTMLInputElement) return `input:${element.type}`;
        return element.tagName.toLowerCase();
      }) : [],
      elements: [
        ".page-shell",
        ".profile-manager-grid",
        ".profile-category-panel",
        ".profile-list-panel",
        ".profile-detail-panel",
        ".profile-detail-scroll",
        ".profile-detail-actions",
        ".form-grid"
      ].map(rect).filter(Boolean)
    };
  }, { scenario, width, height }));
}

for (const [width, height] of viewports) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/profile`, { waitUntil: "networkidle" });
  await page.locator(".profile-manager-grid").waitFor();
  await inspect(page, "overview", width, height);

  const categoryCount = await page.locator(".profile-category-button").count();
  for (let index = 0; index < categoryCount; index += 1) {
    const category = page.locator(".profile-category-button").nth(index);
    const label = (await category.innerText()).trim().replace(/\s+/g, "-").replace(/[\\/:*?"<>|]/g, "-");
    await category.click();
    const addButton = page.locator(".profile-list-panel button.primary-button").first();
    if (await addButton.isVisible()) {
      await addButton.click();
    }
    await inspect(page, `category-${index}-${label}`, width, height);
  }
  await context.close();
}

await browser.close();
await writeFile(`${outputDir}/metrics.json`, `${JSON.stringify(metrics, null, 2)}\n`);
