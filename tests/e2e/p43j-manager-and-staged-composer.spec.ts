import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const managerViewports = [
  [1600, 900],
  [1440, 900],
  [1366, 768],
  [1024, 768],
  [390, 844]
] as const;

test.describe("P4.3j manager and staged composer", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/setup");
    await page.getByRole("button", { name: "跳过，先体验其他功能" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("captures the split manager at required viewports and restores launcher focus", async ({ page }) => {
    let nativeDialogOpened = false;
    page.on("dialog", async (dialog) => {
      nativeDialogOpened = true;
      await dialog.dismiss();
    });

    await page.goto("/profile");
    await expect(page.locator(".career-context-entry-bar")).toBeVisible();
    const launcher = page.getByRole("button", { name: "管理人物与版本" });
    await launcher.click();
    const manager = page.getByRole("dialog", { name: "人物与版本" });
    await expect(manager).toBeVisible();
    await expect(manager.getByRole("tab", { name: "全部人物" })).toHaveAttribute("aria-selected", "true");
    await expect(manager.getByLabel("搜索人物或版本")).toBeVisible();

    for (const [width, height] of managerViewports) {
      await page.setViewportSize({ width, height });
      await expect(manager).toBeVisible();
      await page.screenshot({ path: `artifacts/p43j-manager-${width}x${height}.png`, fullPage: true });
      if (width === 390) {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        expect(overflow).toBe(false);
      }
    }

    await page.keyboard.press("Escape");
    await expect(manager).toHaveCount(0);
    await expect(launcher).toBeFocused();
    expect(nativeDialogOpened).toBe(false);
  });

  test("runs create, rename, archive, restore, trash and restore for a version", async ({ page }) => {
    await page.goto("/profile");
    const entry = page.locator(".career-context-entry-bar");
    await entry.getByRole("button", { name: "管理人物与版本" }).click();
    const manager = page.getByRole("dialog", { name: "人物与版本" });
    await manager.getByRole("button", { name: "新建版本", exact: true }).click();
    await expect(manager.getByRole("heading", { level: 3 })).toContainText("V2");
    await expect(entry).toContainText("V1");

    await manager.getByRole("button", { name: "重命名", exact: true }).click();
    const renameDialog = page.getByRole("dialog", { name: "重命名版本" });
    await renameDialog.locator("input[name='version-label']").fill("演示快照");
    await renameDialog.getByRole("button", { name: "保存名称", exact: true }).click();
    await expect(manager.getByRole("option", { name: /V2/ })).toContainText("演示快照");

    await manager.getByRole("button", { name: "归档", exact: true }).click();
    const archiveDialog = page.getByRole("dialog", { name: "归档版本" });
    await archiveDialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(manager.locator(".person-version-detail-badges .is-archived")).toBeVisible();
    await manager.getByRole("button", { name: "恢复归档", exact: true }).click();
    await expect(manager.locator(".person-version-detail-badges .is-archived")).toHaveCount(0);

    await manager.getByRole("button", { name: "移入回收站", exact: true }).click();
    const trashDialog = page.getByRole("dialog", { name: "移入回收站" });
    await trashDialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(manager.locator(".person-version-detail-badges .is-trashed")).toBeVisible();
    await manager.getByRole("button", { name: "恢复", exact: true }).click();
    await expect(manager.locator(".person-version-detail-badges .is-trashed")).toHaveCount(0);
  });

  test("shows a trashed Profile Version in Recycle Bin with blocker status and restore", async ({ page }) => {
    await page.goto("/profile");
    const entry = page.locator(".career-context-entry-bar");
    await entry.getByRole("button", { name: "管理人物与版本" }).click();
    const manager = page.getByRole("dialog", { name: "人物与版本" });
    await manager.getByRole("button", { name: "新建版本", exact: true }).click();
    await manager.getByRole("button", { name: "归档", exact: true }).click();
    await page.getByRole("dialog", { name: "归档版本" }).getByRole("button", { name: "确认", exact: true }).click();
    await manager.getByRole("button", { name: "移入回收站", exact: true }).click();
    await page.getByRole("dialog", { name: "移入回收站" }).getByRole("button", { name: "确认", exact: true }).click();
    await manager.getByRole("button", { name: "关闭人物与版本选择器" }).click();

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/recycle");
    await page.getByRole("button", { name: /人物与版本/ }).click();
    const row = page.locator(".recycle-row").filter({ hasText: /V2/ });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "查看阻塞", exact: true }).click();
    await expect(page.locator(".notification-viewport")).toContainText("引用保护状态");
    await row.getByRole("button", { name: "恢复", exact: true }).click();
    await expect(row).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  });

  test("restores a Resume and a Profile item from Recycle Bin", async ({ page }) => {
    await page.goto("/resume");
    const createResume = page.getByRole("button", { name: "新建简历", exact: true });
    await expect(createResume).toBeVisible();
    await createResume.click();
    const studio = page.getByTestId("resume-studio-workbar");
    await expect(studio).toBeVisible();
    const resumeTitle = (await studio.locator("h2").innerText()).trim();
    await studio.getByRole("button", { name: "返回", exact: true }).click();

    const resumeCard = page.locator(".resume-card").filter({ hasText: resumeTitle }).first();
    await expect(resumeCard).toBeVisible();
    await resumeCard.locator("summary").click();
    await resumeCard.getByRole("button", { name: "归档", exact: true }).click();
    await page.locator(".resume-filter-row").getByRole("button", { name: /归档/ }).click();
    const archivedResume = page.locator(".resume-card").filter({ hasText: resumeTitle }).first();
    await archivedResume.getByRole("button", { name: "移至回收站", exact: true }).click();

    await page.goto("/recycle");
    await page.locator(".resume-filter-row").getByRole("button", { name: /简历/ }).click();
    const recycledResume = page.locator(".recycle-row").filter({ hasText: resumeTitle });
    await expect(recycledResume).toBeVisible();
    await recycledResume.getByRole("button", { name: "恢复", exact: true }).click();
    await expect(recycledResume).toHaveCount(0);

    await page.goto("/profile");
    await page.locator(".profile-category-button").filter({ hasText: "技能" }).first().click();
    const profileRows = page.getByTestId("profile-managed-list").locator(".profile-managed-row");
    await expect(profileRows.first()).toBeVisible();
    const profileItemTitle = (await profileRows.first().locator("strong").innerText()).trim();
    await profileRows.first().getByRole("button", { name: `删除 ${profileItemTitle}` }).click();
    await expect(profileRows.filter({ hasText: profileItemTitle })).toHaveCount(0);

    await page.goto("/recycle");
    await page.locator(".resume-filter-row").getByRole("button", { name: /资料条目/ }).click();
    const recycledProfileItem = page.locator(".recycle-row").filter({ hasText: profileItemTitle });
    await expect(recycledProfileItem).toBeVisible();
    await recycledProfileItem.getByRole("button", { name: "恢复", exact: true }).click();
    await expect(recycledProfileItem).toHaveCount(0);
  });

  test("keeps attachments staged until send and isolated by session", async ({ page }) => {
    let streamRequests = 0;
    let structuredRequests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/agent/stream")) streamRequests += 1;
      if (request.url().includes("/api/ai/structured")) structuredRequests += 1;
    });

    await page.goto("/ai-workspace");
    const file = page.locator(".agent-composer input[type='file']");
    const fixture = resolve(process.cwd(), "tests/fixtures/resume-import/ordinary.docx");
    await file.setInputFiles(fixture);
    await expect(page.getByText("待发送")).toBeVisible();
    await expect(page.locator(".agent-message-row.is-user")).toHaveCount(0);
    expect(streamRequests).toBe(0);
    expect(structuredRequests).toBe(0);

    await page.getByRole("button", { name: "移除附件 ordinary.docx" }).click();
    await expect(page.getByText("待发送")).toHaveCount(0);
    await expect(page.locator(".agent-message-row.is-user")).toHaveCount(0);
    expect(streamRequests).toBe(0);
    expect(structuredRequests).toBe(0);

    await file.setInputFiles(fixture);
    await expect(page.getByText("待发送")).toBeVisible();
    await page.getByRole("button", { name: "新任务" }).click();
    await expect(page.getByRole("heading", { name: "今天想从哪一步开始？" })).toBeVisible();
    await expect(page.getByText("待发送")).toHaveCount(0);

    await file.setInputFiles(fixture);
    await page.getByLabel("描述你的求职任务").fill("请把附件作为当前人物资料来源。");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByLabel("描述你的求职任务")).toHaveValue("");
    const sent = page.locator(".agent-message-row.is-user").filter({ hasText: "请把附件作为当前人物资料来源。" });
    await expect(sent).toHaveCount(1);
    await expect(sent).toContainText("ordinary.docx");
    await expect(page.getByTestId("agent-import-ai-consent")).toBeVisible();
    await expect(page.getByRole("button", { name: "产物 1", exact: true })).toHaveCount(0);
    expect(streamRequests).toBe(0);
    expect(structuredRequests).toBe(0);
  });
});
