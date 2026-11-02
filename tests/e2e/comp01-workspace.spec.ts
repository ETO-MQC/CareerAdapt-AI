import { expect, test } from "@playwright/test";
import { installHermesRuntimeFixture } from "./support/hermesRuntimeFixture";

test.beforeEach(async ({ page }) => {
  await installHermesRuntimeFixture(page);
  await page.goto("/");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  const setupVisible = await skip.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  if (setupVisible) { await skip.click(); await page.waitForURL(/\/$/); }
  await page.goto("/ai-workspace");
  const context = page.locator(".career-context-trigger");
  await expect(context).toBeVisible();
  if ((await context.innerText()).includes("选择人物")) {
    await context.click();
    await page.getByRole("tab", { name: "新增人物" }).click();
    await page.getByLabel("人物名称").fill("COMP01 合成测试人物");
    await page.getByRole("button", { name: "创建人物" }).click();
    await page.getByRole("button", { name: "使用此版本" }).click();
    for (const close of await page.getByRole("button", { name: /^关闭通知：/ }).all()) await close.click();
  }
});

test("COMP01 theme and viewport matrix keeps composer, menus and sidebar usable", async ({ page }) => {
  await page.getByLabel("描述你的求职任务").fill("你好，请帮我整理项目经历");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator('.agent-workflow-status[data-agent-run-state="completed"]')).toBeVisible();
  await expect(page.getByRole("button", { name: /^关闭通知：/ })).toHaveCount(0, { timeout: 10_000 });
  const sidebarWidth = await page.getByRole("complementary", { name: "AI 工作区导航" }).evaluate((el) => el.getBoundingClientRect().width);
  const accents: Record<string, string> = {};
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 });
    for (const theme of ["light", "dark"]) {
      for (const accent of ["green", "burgundy"]) {
        await page.evaluate(({ theme, accent }) => {
          localStorage.setItem("careeradapt.theme", theme);
          localStorage.setItem("careeradapt.appAccent", accent);
          document.documentElement.dataset.theme = theme;
          document.documentElement.dataset.appAccent = accent;
          window.dispatchEvent(new Event("careeradapt-preferences-change"));
        }, { theme, accent });
        await page.getByRole("button", { name: "添加材料与工具" }).click();
        const menu = page.getByRole("group", { name: "添加材料与工具" });
        await expect(menu).toBeVisible();
        for (const name of ["上传文件", "选择简历", "导入岗位", "从资料库", "工具"]) await expect(menu.getByRole("button", { name, exact: true })).toBeVisible();
        const geometry = await page.evaluate(() => {
          const input = document.querySelector(".agent-composer")!.getBoundingClientRect();
          const menu = document.querySelector(".agent-composer-add-menu")!.getBoundingClientRect();
          return { overflow: document.documentElement.scrollWidth > innerWidth, composerBottom: input.bottom, height: innerHeight, menuTop: menu.top, menuRight: menu.right, width: innerWidth, accent: getComputedStyle(document.documentElement).getPropertyValue("--ai-accent").trim() };
        });
        expect(geometry.overflow).toBe(false);
        expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.height);
        expect(geometry.menuTop).toBeGreaterThanOrEqual(0);
        expect(geometry.menuRight).toBeLessThanOrEqual(geometry.width);
        accents[`${width}-${theme}-${accent}`] = geometry.accent;
        await page.screenshot({ path: `artifacts/comp01-${width}-${theme}-${accent}.png`, fullPage: true });
        await menu.press("Escape");
        await expect(menu).toHaveCount(0);
        expect(await page.getByRole("complementary", { name: "AI 工作区导航" }).evaluate((el) => el.getBoundingClientRect().width)).toBe(sidebarWidth);
      }
      expect(accents[`${width}-${theme}-green`]).not.toBe(accents[`${width}-${theme}-burgundy`]);
    }
  }
  await page.getByRole("button", { name: "更多任务操作" }).click();
  await expect(page.getByRole("menuitem", { name: "导出对话", exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "导出对话", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^ai-conversation-.*\.json$/);
});

test("COMP01 attachment stays session-owned on reload and removal excludes submission", async ({ page }) => {
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({ name: "comp01-fixture.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic fixture only") });
  await expect(page.getByRole("button", { name: "预览附件 comp01-fixture.txt" })).toBeVisible();
  await expect(page.locator(".agent-attachment-chip")).toContainText("TXT · 1 KB");
  // Wait for the existing Repository metadata receipt, not an arbitrary delay.
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<Array<{ key: string; value: unknown }>>((resolve, reject) => {
      const request = db.transaction("appMeta").objectStore("appMeta").getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    db.close();
    return rows.some((row) => row.key.startsWith("composer-attachments:") && Array.isArray(row.value) && row.value.length === 1);
  })).toBe(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "预览附件 comp01-fixture.txt" })).toBeVisible();
  await page.getByRole("button", { name: "预览附件 comp01-fixture.txt" }).click();
  await expect(page.getByText("Synthetic fixture only", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭导入窗口", exact: true }).click();
  await page.getByRole("button", { name: "移除附件 comp01-fixture.txt" }).click();
  await expect(page.locator(".agent-attachment-chip")).toHaveCount(0);
  await page.getByLabel("描述你的求职任务").fill("你好，请帮我整理项目经历");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator('.agent-workflow-status[data-agent-run-state="completed"]')).toBeVisible();
  await expect(page.locator(".agent-message-row.is-user")).not.toContainText("comp01-fixture.txt");
});


test("COMP01 edited message keeps the old branch readable without another Run", async ({ page }) => {
  let runStarts = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/agent/runtime/hermes") && request.postDataJSON()?.action === "run_start") runStarts++; });
  const composer = page.getByLabel("描述你的求职任务");
  await composer.fill("原始问题：整理项目经历");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator('.agent-workflow-status[data-agent-run-state="completed"]')).toBeVisible();
  await page.locator(".agent-message-row.is-user").first().getByRole("button", { name: "编辑并重发" }).click();
  const edit = page.locator(".agent-message-row.is-user").first();
  await edit.getByRole("textbox", { name: "编辑消息" }).fill("修改问题：整理项目经历");
  await edit.getByRole("button", { name: "确认并重发" }).click();
  await expect.poll(() => runStarts).toBe(2);
  await expect(page.locator('.agent-workflow-status[data-agent-run-state="completed"]')).toBeVisible();
  await expect(page.locator(".agent-message-row.is-user")).toHaveCount(1);
  const activeId = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
  let requestsAfterInspection = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/agent/runtime/hermes") && request.postDataJSON()?.action === "run_start") requestsAfterInspection++; });
  await page.getByRole("button", { name: "打开历史记录" }).click();
  await page.locator(`[data-history-session-id="${activeId}"]`).getByRole("button", { name: /^查看分支：/ }).click();
  const branchSelect = page.getByRole("combobox", { name: "查看会话分支" });
  const oldBranch = await branchSelect.locator("option").evaluateAll((options) => options.filter((option) => option.textContent?.startsWith("历史分支")).map((option) => (option as HTMLOptionElement).value));
  expect(oldBranch.length).toBeGreaterThan(0);
  await branchSelect.selectOption(oldBranch[0]);
  await expect(page.locator(".agent-history-transcript")).toContainText("原始问题：整理项目经历");
  await expect(page.locator(".agent-history-transcript")).not.toContainText("修改问题：整理项目经历");
  await page.screenshot({ path: "artifacts/comp01-branch-history.png", fullPage: true });
  await page.getByRole("dialog", { name: "历史记录", exact: true }).press("Escape");
  await expect(page.getByRole("dialog", { name: "历史记录", exact: true })).toHaveCount(0);
  await expect(page.locator(".agent-message-row.is-user")).toContainText("修改问题：整理项目经历");
  expect(requestsAfterInspection).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"))).toBe(activeId);
});
