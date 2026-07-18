import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const beforeCaptureDir = resolve(process.cwd(), "artifacts", "p3-resume-save-before");
const afterCaptureDir = resolve(process.cwd(), "artifacts", "p3-resume-save-after");

test.describe("P3 structured resume editing", () => {
  test("does not save or notify while editing fields or switching sections", async ({ page }) => {
    await openProfileBackedResume(page);
    const notifications = page.locator(".app-notification");
    await dismissNotifications(page);

    const sectionNav = page.getByTestId("resume-section-nav");
    await sectionNav.getByRole("button", { name: /实习.*经历/ }).click();
    const fields = page.getByTestId("resume-active-section-fields");
    await fields.getByLabel("公司 / 组织").first().fill("不会在输入时自动提交");
    await sectionNav.getByRole("button", { name: /项目.*经历/ }).click();

    const captureDir = process.env.CAPTURE_RESUME_SAVE_AFTER === "1" ? afterCaptureDir
      : process.env.CAPTURE_RESUME_SAVE_BEFORE === "1" ? beforeCaptureDir
        : undefined;
    if (captureDir) {
      mkdirSync(captureDir, { recursive: true });
      const viewports = [
        { width: 1024, height: 768 },
        { width: 1366, height: 768 },
        { width: 1440, height: 900 }
      ];
      if (captureDir === afterCaptureDir) viewports.push({ width: 1280, height: 800 }, { width: 1920, height: 1080 });
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.screenshot({
          path: resolve(captureDir, `${viewport.width}x${viewport.height}.png`),
          fullPage: false
        });
      }
      const metrics = await page.evaluate(() => ({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        pageScrollHeight: document.documentElement.scrollHeight,
        pageClientHeight: document.documentElement.clientHeight,
        notificationCount: document.querySelectorAll(".app-notification").length,
        notificationTexts: Array.from(document.querySelectorAll(".app-notification")).map((node) => node.textContent?.trim()),
        notificationViewport: (() => {
          const node = document.querySelector(".notification-viewport");
          if (!(node instanceof HTMLElement)) return undefined;
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, position: style.position, overflowY: style.overflowY };
        })()
      }));
      console.log("P3 resume save before metrics", JSON.stringify(metrics));
    }

    await expect(page.getByTestId("resume-autosave-status")).toHaveText("已自动保存");
    await expect(notifications).toHaveCount(0);
    await sectionNav.getByRole("button", { name: /实习.*经历/ }).click();
    await expect(fields.getByLabel("公司 / 组织").first()).toHaveValue("不会在输入时自动提交");
    await expect(notifications).toHaveCount(0);
  });

  test("saves an older imported structured item by its branch item id", async ({ page }) => {
    await openProfileBackedResume(page);
    await dismissNotifications(page);
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("CareerAdaptDb");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("resumeBranches", "readwrite");
          const store = tx.objectStore("resumeBranches");
          const getAll = store.getAll();
          getAll.onerror = () => reject(getAll.error);
          getAll.onsuccess = () => {
            const branch = getAll.result.find((candidate) => candidate.lifecycleStatus === "active" && candidate.branchPurpose === "general");
            const structured = branch?.structuredContentItems?.find((candidate: { data?: { sectionType?: string } }) => candidate.data?.sectionType === "project");
            if (!branch || !structured) {
              reject(new Error("project item missing"));
              return;
            }
            structured.data = { ...structured.data, id: "import-item-legacy-id" };
            store.put(branch);
          };
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      });
    });
    await page.reload();
    const sectionNav = page.getByTestId("resume-section-nav");
    await sectionNav.getByRole("button", { name: /项目.*经历/ }).click();
    const fields = page.getByTestId("resume-active-section-fields");
    await fields.getByRole("button", { name: "保存", exact: true }).first().click();

    await expect(page.locator(".app-notification-success")).toContainText("结构字段和自定义字段已保存到当前简历");
    await expect(page.getByText("找不到对应的简历条目。", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("resume-a4-page").first()).toBeVisible();
  });
});

async function openProfileBackedResume(page: Page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/resume");
  await page.getByRole("button").filter({ hasText: "从个人资料库创建" }).click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
}

async function dismissNotifications(page: Page) {
  const closeButtons = page.locator(".notification-close");
  while (await closeButtons.count()) {
    await closeButtons.first().click();
  }
}
