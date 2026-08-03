import { expect, test, type Page } from "@playwright/test";
import { openManualPageTab } from "./support/g7b2Ui";

test.use({ trace: "on", video: "on", screenshot: "on" });

test("P4.3d.2 Preview/PDF boundaries are observable and finite", async ({ page }, testInfo) => {
  test.setTimeout(100_000);
  const events: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") events.push(`console:${message.type()}:${message.text()}`);
  });
  page.on("pageerror", (error) => events.push(`pageerror:${error.message}`));
  page.on("requestfailed", (request) => events.push(`requestfailed:${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`));

  const checkpoint = async (label: string) => {
    const state = await readBrowserState(page);
    const entry = `${label} url=${state.url} task=${state.taskState?.rootGoal ?? "-"}/${state.taskState?.stage ?? "-"}/${state.taskState?.completionStatus ?? "-"} activeTurn=${state.taskState?.activeTurnStatus ?? "-"} pending=${state.pendingToolName ?? "-"} pages=${state.pageCount} dialogs=${state.dialogs.join("|")} artifact=${state.artifactState ?? "-"} lastAssistant=${state.lastAssistant ?? "-"} lastTool=${state.lastTool ?? "-"}`;
    events.push(entry);
    console.log(entry);
    await testInfo.attach(`${label}-state`, { body: JSON.stringify({ state, events: events.slice(-20) }, null, 2), contentType: "application/json" });
    await testInfo.attach(`${label}-screenshot`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  };

  await page.goto("/resume");
  await bypassSetupIfNeeded(page);
  await checkpoint("A-before-import");

  await page.getByRole("button", { name: "导入", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入简历" });
  await expect(dialog).toBeVisible();
  await dialog.getByText("粘贴 JSON", { exact: true }).click();
  await dialog.getByLabel("JSON 内容").fill(JSON.stringify(diagnosticFixture()));
  await checkpoint("B-import-dialog");
  await dialog.getByRole("button", { name: "导入 JSON", exact: true }).click();
  await expect(dialog.locator("label.import-target-option").filter({ hasText: "创建新人物" })).toBeVisible({ timeout: 20_000 });
  await dialog.locator("label.import-target-option").filter({ hasText: "创建新人物" }).click();
  await checkpoint("C-after-import-submit");

  await clickUntilGone(page, "确认此字段", "D-confirm-fields", checkpoint);
  await clickUntilGone(page, "核对并保留来源", "E-confirm-source", checkpoint);
  const footer = page.locator(".import-review-footer button.primary-button");
  await expect(footer).toBeVisible({ timeout: 20_000 });
  await footer.click();
  await checkpoint("F-after-import-commit");

  const open = page.getByRole("button", { name: "打开", exact: true });
  if (await open.isVisible().catch(() => false)) await open.click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("resume-a4-page").first()).toBeVisible({ timeout: 20_000 });
  await checkpoint("G-editor-open");

  await openManualPageTab(page);
  await checkpoint("H-before-export-listener");
  const responsePromise = page.waitForResponse((response) => response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST", { timeout: 30_000 });
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await checkpoint("I-listeners-registered");
  await page.getByRole("button", { name: "下载 PDF" }).click();
  await checkpoint("J-after-export-click");
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  expect(response.status()).toBe(200);
  expect((await download.createReadStream())?.readable).toBeTruthy();
  await checkpoint("K-after-download");
});

async function clickUntilGone(
  page: Page,
  label: string,
  checkpointLabel: string,
  checkpoint: (label: string) => Promise<void>
) {
  for (let index = 0; index < 20; index += 1) {
    const button = page.getByRole("button", { name: label, exact: true }).first();
    if (!(await button.isVisible().catch(() => false))) return;
    await button.click();
    await checkpoint(`${checkpointLabel}-${index + 1}`);
  }
  throw new Error(`${label} did not settle after 20 clicks`);
}

async function bypassSetupIfNeeded(page: Page) {
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await skip.click();
    await page.goto("/resume");
  }
}

async function readBrowserState(page: Page) {
  return page.evaluate(async () => {
    const openStore = (storeName: string) => new Promise<unknown[]>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (!Array.from(db.objectStoreNames).includes(storeName)) {
          db.close();
          resolve([]);
          return;
        }
        const get = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          db.close();
          resolve(get.result as unknown[]);
        };
      };
    });
    const sessions = await openStore("agentSessions") as Array<Record<string, unknown>>;
    const messages = await openStore("agentMessages") as Array<Record<string, unknown>>;
    const session = [...sessions].sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0];
    const sessionMessages = messages.filter((message) => message.sessionId === session?.id).sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0));
    const task = session?.taskState && typeof session.taskState === "object" ? session.taskState as Record<string, unknown> : undefined;
    const known = task?.knownSlots && typeof task.knownSlots === "object" ? task.knownSlots as Record<string, unknown> : {};
    const visible = (selector: string) => Array.from(document.querySelectorAll(selector)).filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    });
    const assistant = [...sessionMessages].reverse().find((message) => message.role === "assistant" && String(message.content ?? "").trim());
    const tool = [...sessionMessages].reverse().find((message) => message.role === "tool" || message.toolName);
    const taskActive = session?.activeTurn && typeof session.activeTurn === "object" ? session.activeTurn as Record<string, unknown> : undefined;
    return {
      url: location.href,
      taskState: task ? {
        rootGoal: task.rootGoal,
        stage: task.stage,
        completionStatus: task.completionStatus,
        activeTurnStatus: taskActive?.status,
        remainingDiffCount: known.remainingDiffCount,
        selectedDiffIds: known.selectedDiffIds,
        rejectedDiffIds: known.rejectedDiffIds
      } : undefined,
      pendingToolName: (session?.pendingToolCall as Record<string, unknown> | undefined)?.toolName ?? (known.pendingConfirmation as Record<string, unknown> | undefined)?.toolName,
      pageCount: document.querySelectorAll('[data-testid="resume-a4-page"]').length,
      dialogs: visible('[role="dialog"]').map((element) => element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 80) ?? "dialog"),
      artifactState: document.querySelector(".agent-artifact-drawer")?.className,
      lastAssistant: String(assistant?.content ?? "").trim().slice(-240),
      lastTool: `${String(tool?.toolName ?? "")} ${String(tool?.status ?? "")}`.trim()
    };
  });
}

function diagnosticFixture() {
  const common = { customFields: [] };
  return {
    schemaVersion: "careeradapt-resume-v2",
    locale: "zh-CN",
    basics: {
      name: "演示候选人",
      targetRole: "AI 测试工程师",
      phone: "13800000000",
      email: "candidate@example.com",
      location: "示例城市",
      portfolioLinks: [],
      otherLinks: [],
      customFields: []
    },
    unclassifiedBlocks: [],
    sections: [
      { id: "summary", sectionType: "summary", title: "自我评价", order: 0, visible: true, items: [{ ...common, id: "summary-1", sectionType: "summary", text: "负责可追溯的 AI 测试与回归验证。" }] },
      { id: "work", sectionType: "work", title: "工作经历", order: 1, visible: true, items: [{ ...common, id: "work-1", sectionType: "work", organization: "示例公司", role: "测试工程师", startDate: "2024-01", current: true, highlights: ["建立自动化回归验证闭环。"] }] },
      { id: "skills", sectionType: "skills", title: "专业技能", order: 2, visible: true, items: [{ ...common, id: "skill-1", sectionType: "skills", name: "自动化测试", description: "Playwright、TypeScript" }] }
    ]
  };
}
