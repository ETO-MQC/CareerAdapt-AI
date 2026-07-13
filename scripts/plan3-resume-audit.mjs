import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const outputDir = process.env.PLAN3_RESUME_AUDIT_DIR ?? "artifacts/plan3-resume-before";
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
        position: style.position,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        padding: style.padding,
        gap: style.gap,
        alignItems: style.alignItems,
        justifyContent: style.justifyContent,
        textAlign: style.textAlign
      };
    };
    const actionElements = [...document.querySelectorAll("button, a[href], summary, input, textarea, select")].filter(visible);
    const main = document.querySelector("main");
    const mainBox = main?.getBoundingClientRect();
    return {
      scenario,
      viewport: `${width}x${height}`,
      url: location.href,
      title: document.querySelector("h1")?.textContent?.trim() ?? null,
      visibleActions: actionElements.length,
      rootOverflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      rootOverflowY: Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight),
      pageScroll: Math.max(0, document.body.scrollHeight - innerHeight),
      nestedScrollRegions: [...document.querySelectorAll("*")].filter((element) => {
        const style = getComputedStyle(element);
        return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
      }).length,
      visibleResumeCards: [...document.querySelectorAll(".resume-card")].filter(visible).length,
      visibleJsonTextarea: [...document.querySelectorAll(".import-json-details textarea")].filter(visible).length,
      mainBottomWhitespace: mainBox ? Math.max(0, innerHeight - mainBox.bottom) : null,
      elements: [
        ".page-shell",
        ".resume-import-strip",
        ".resume-import-modal-backdrop",
        ".resume-import-modal",
        ".resume-import-modal-body",
        ".import-dropzone",
        ".import-json-details",
        ".resume-entry-grid",
        ".resume-library-panel",
        ".resume-card-list",
        ".resume-card",
        ".resume-card-more > summary",
        ".resume-studio-shell",
        ".resume-preview-stage"
      ].map(rect).filter(Boolean)
    };
  }, { scenario, width, height }));
}

for (const [width, height] of viewports) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/resume`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "我的简历", exact: true }).waitFor();
  await inspect(page, "center", width, height);

  await page.getByTestId("resume-entry-import-primary").click();
  await page.getByTestId("resume-import-dock").waitFor();
  await inspect(page, "import-file-open", width, height);

  await page.getByTestId("resume-import-dock").getByRole("button", { name: "关闭导入窗口", exact: true }).click();
  await page.getByRole("button", { name: "粘贴 JSON", exact: true }).click();
  await page.getByTestId("resume-import-dock").waitFor();
  await inspect(page, "import-json-open", width, height);

  await page.getByTestId("resume-import-dock").getByRole("button", { name: "关闭导入窗口", exact: true }).click();
  for (let index = 0; index < 4; index += 1) {
    const createBlank = page.getByRole("button").filter({ hasText: "从零创建" });
    if (await createBlank.count() !== 1 || !(await createBlank.isEnabled())) break;
    await createBlank.click();
    await page.getByTestId("resume-studio-shell").waitFor();
    if (index === 0) await inspect(page, "studio", width, height);
    await page.getByTestId("resume-studio-workbar").getByRole("button", { name: "返回", exact: true }).click();
    await page.getByRole("heading", { name: "我的简历", exact: true }).waitFor();
  }
  await inspect(page, "center-cards", width, height);
  await context.close();
}

await browser.close();
await writeFile(`${outputDir}/metrics.json`, `${JSON.stringify(metrics, null, 2)}\n`);
