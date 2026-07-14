import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const outputDir = process.env.PLAN3_RECYCLE_AUDIT_DIR ?? "artifacts/plan3-recycle-jobs-before";
const baseUrl = process.env.PLAN3_BASE_URL ?? "http://127.0.0.1:3000";
const viewports = [[1920, 1080], [1440, 900], [1366, 768], [1280, 800], [1024, 768]];
const routes = ["profile", "resume", "jobs", "recycle"];
const metrics = [];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });

for (const [width, height] of viewports) {
  for (const route of routes) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/${route}`, { waitUntil: "networkidle" });
    await page.locator("main").waitFor();
    await page.screenshot({ path: `${outputDir}/${width}x${height}-${route}.png`, fullPage: true });
    metrics.push(await page.evaluate(({ width, height, route }) => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const listSelectors = [".profile-managed-list", ".resume-card-list", ".job-list", ".job-card-list"];
      return {
        route,
        viewport: `${width}x${height}`,
        rootOverflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        pageScroll: Math.max(0, document.documentElement.scrollHeight - innerHeight),
        visibleActions: [...document.querySelectorAll("button, a[href], input, select, textarea, summary")].filter(visible).length,
        nestedScrollRegions: [...document.querySelectorAll("*")].filter((element) => {
          const style = getComputedStyle(element);
          return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
        }).length,
        listBoxes: listSelectors.map((selector) => {
          const element = document.querySelector(selector);
          if (!element || !visible(element)) return null;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { selector, width: rect.width, height: rect.height, minHeight: style.minHeight, maxHeight: style.maxHeight, overflowY: style.overflowY };
        }).filter(Boolean),
        navigation: [...document.querySelectorAll("nav a")].filter(visible).map((element) => element.textContent?.trim())
      };
    }, { width, height, route }));
    await context.close();
  }
}

await browser.close();
await writeFile(`${outputDir}/metrics.json`, `${JSON.stringify(metrics, null, 2)}\n`);
