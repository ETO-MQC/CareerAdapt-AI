import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const outputDir = process.env.PLAN3_P34_AUDIT_DIR ?? "artifacts/plan3-p34-after";
const baseUrl = process.env.PLAN3_BASE_URL ?? "http://127.0.0.1:3000";
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
await page.route("**/api/ai/structured", async (route) => {
  const body = route.request().postDataJSON();
  if (body.task === "resume-tailor") {
    const section = body.input?.sectionTexts?.[0];
    const match = body.input?.matches?.[0];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      ok: true,
      task: "resume-tailor",
      promptVersion: "resume-tailor.p34-visual",
      output: { suggestions: [{
        type: "compress",
        targetSectionId: section?.sectionId,
        originalText: section?.text,
        suggestedText: section?.text ? `${section.text}。` : section?.text,
        reason: "保留已确认事实并压缩岗位相关表达。",
        requirementIds: match ? [match.requirementId] : [],
        usedEvidenceRefs: body.input?.allowedEvidenceRefs ?? [],
        riskLevel: "low"
      }] },
      meta: { provider: "mock", model: "mock-p34", inputLength: 1, outputLength: 1, latencyMs: 1 }
    }) });
    return;
  }
  if (body.task === "fact-guard") {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      ok: true,
      task: "fact-guard",
      promptVersion: "fact-guard.p34-visual",
      output: { status: "pass", riskLevel: "low", findings: body.input?.ruleFindings ?? [], explanation: "未检测到越界事实。" },
      meta: { provider: "mock", model: "mock-p34", inputLength: 1, outputLength: 1, latencyMs: 1 }
    }) });
    return;
  }
  await route.continue();
});

await page.goto(`${baseUrl}/resume`);
await page.getByRole("button").filter({ hasText: "从个人资料库创建" }).click();
await page.getByTestId("resume-studio-shell").waitFor();
await page.goto(`${baseUrl}/jobs`);
await page.getByLabel("来源通用简历").selectOption({ index: 1 });
await page.getByTestId("run-experience-match").click();
await page.getByTestId("generate-job-resume").waitFor({ state: "visible" });
await page.screenshot({ path: `${outputDir}/1366x768-jobs-ready.png`, fullPage: true });
await page.getByTestId("generate-job-resume").click();
await page.getByTestId("resume-job-context").waitFor();
const panel = page.getByTestId("job-optimization-panel");
await panel.getByRole("tab", { name: /岗位匹配/ }).click();
await panel.getByTestId("requirement-sidebar").locator(".match-row").first().click();
await panel.getByRole("button", { name: "压缩表达", exact: true }).click();
await panel.getByTestId("block-suggestion-panel").waitFor();
await page.screenshot({ path: `${outputDir}/1366x768-resume-ai-suggestion.png`, fullPage: true });

const metrics = await page.evaluate(() => {
  const box = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { width: rect.width, height: rect.height, overflowY: style.overflowY, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
  };
  return {
    viewport: `${innerWidth}x${innerHeight}`,
    rootOverflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    pageScroll: Math.max(0, document.documentElement.scrollHeight - innerHeight),
    inspector: box(".resume-inspector"),
    optimizationPanel: box(".optimization-panel"),
    preview: box(".resume-preview-stage"),
    contextBar: box(".resume-job-context-bar"),
    visibleActions: [...document.querySelectorAll("button, a[href], input, select, textarea, summary")].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
    }).length
  };
});
await writeFile(`${outputDir}/resume-ai-metrics.json`, `${JSON.stringify(metrics, null, 2)}\n`);
await browser.close();
