import { expect, test, type Page } from "@playwright/test";
import { installHermesRuntimeFixture } from "./support/hermesRuntimeFixture";

async function openWorkspace(page: Page) {
  await page.goto("/");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  await skip.click();
  await page.waitForURL(/\/$/);
  await page.goto("/ai-workspace");
  const context = page.locator(".career-context-trigger");
  await expect(context).toBeVisible();
  if ((await context.innerText()).includes("选择人物")) {
    await context.click(); await page.getByRole("tab", { name: "新增人物" }).click();
    await page.getByLabel("人物名称").fill("过程展示测试人物");
    await page.getByRole("button", { name: "创建人物" }).click();
    await page.getByRole("button", { name: "使用此版本" }).click();
    await expect(context).toContainText("过程展示测试人物");
  }
  const closeNotices = page.getByRole("button", { name: /^关闭通知：/ });
  while (await closeNotices.count()) await closeNotices.first().click();
}

test("UX02 long running presentation, completion collapse and structured answer", async ({ page }) => {
  let release!: () => void;
  const eventsReady = new Promise<void>(resolve => { release = resolve; });
  await page.setViewportSize({ width: 1440, height: 900 });
  await installHermesRuntimeFixture(page, { eventsReady, output: "# 岗位信息分析\n\n主要内容：请根据实际经历补充职责。\n\n## 下一步\n\n核对来源后再保存。\n\n> [!NOTE]\n> 当前分析不会自动写入资料库。\n\n> [!WARNING]\n> 新事实需要你的确认。" });
  await openWorkspace(page);
  await page.getByLabel("描述你的求职任务").fill("请帮我分析岗位信息");
  await page.getByRole("button", { name: "发送消息" }).click();
  const card = page.locator('.agent-tool-status-row').last();
  await expect(card).toHaveAttribute("open", "");
  await expect(card).toContainText(/正在处理当前任务|任务已接收/);
  await expect(card.locator('.agent-activity-duration')).toContainText(/已用时 [1-9]\d* 秒/);
  await page.screenshot({ path: "artifacts/ux02-running-1440.png", fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await card.locator('summary > strong').evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  release();
  await expect(page.getByRole("heading", { level: 1, name: "岗位信息分析" })).toBeVisible();
  await expect(card).not.toHaveAttribute("open", "");
  await expect(card).toContainText(/用时.*秒/);
  await card.locator("summary").click();
  await expect(card.locator("li")).toBeVisible();
  await expect(card).not.toContainText(/toolId|operationId|career\.|hermes-e2e|raw/);
  await expect(page.getByLabel("说明", { exact: true })).toContainText("当前分析不会自动写入资料库");
  await expect(page.getByLabel("提醒", { exact: true })).toContainText("新事实需要你的确认");
  const sizes = await page.locator('.agent-markdown').last().evaluate(element => ({
    h1: parseFloat(getComputedStyle(element.querySelector('h1')!).fontSize),
    h2: parseFloat(getComputedStyle(element.querySelector('h2')!).fontSize),
    p: parseFloat(getComputedStyle(element.querySelector('p')!).fontSize),
    note: parseFloat(getComputedStyle(element.querySelector('aside p')!).fontSize)
  }));
  expect(sizes.h1).toBeGreaterThan(sizes.h2); expect(sizes.h2).toBeGreaterThan(sizes.p); expect(sizes.p).toBeGreaterThanOrEqual(sizes.note);
  await card.locator("summary").click();
  await page.screenshot({ path: "artifacts/ux02-completed-1440.png", fullPage: true });
  await page.setViewportSize({ width: 1024, height: 768 });
  await card.locator("summary").click();
  await expect(card.locator('li')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/ux02-expanded-1024.png", fullPage: true });
  await card.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(card).not.toHaveAttribute("open", "");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator('.agent-streaming-indicator')).toHaveCount(0);
});

test("UX02 tool activities use business wording and preserve source selection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installHermesRuntimeFixture(page);
  await openWorkspace(page);
  await page.getByLabel("描述你的求职任务").fill("优化已有简历");
  await page.getByRole("button", { name: "发送消息" }).click();
  const card = page.locator('.agent-tool-status-row').last();
  await expect(page.getByText("请选择用于岗位定制的通用简历。", { exact: true })).toBeVisible();
  await expect(card).not.toHaveAttribute("open", "");
  await card.locator('summary').click();
  await expect(card).toContainText("准备岗位简历优化");
  await expect(card).not.toContainText(/career\.workflow|tool-call-|operation-/);
  await expect(page.locator('textarea[data-agent-checkpoint-kind="resume_choice"]')).toBeVisible();
  await page.screenshot({ path: "artifacts/ux02-tools-1440.png", fullPage: true });
});
