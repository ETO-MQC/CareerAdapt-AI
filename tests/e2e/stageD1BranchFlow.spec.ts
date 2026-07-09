import { expect, test } from "@playwright/test";
import { openManualContentTab, openManualHistoryTab } from "./support/g7b2Ui";

async function createC2DraftForSelectedJob(page: import("@playwright/test").Page) {
  await openJobResumesTab(page);
  await page.getByTestId("run-experience-match").click();
  await expect(page.locator(".match-row").first()).toBeVisible();
  await page.getByTestId("create-suggestion-draft").click();
  await expect(page.locator(".notice")).toBeVisible();
}

async function openJobResumesTab(page: import("@playwright/test").Page) {
  const tabs = page.locator(".jobs-tablist button");
  await expect(tabs.nth(2)).toBeVisible();
  await tabs.nth(2).click();
  await expect(page.getByTestId("run-experience-match")).toBeVisible();
}

async function selectJobByIndex(page: import("@playwright/test").Page, index: number) {
  const jobRows = page.locator(".jobs-list-panel .job-list .match-row");
  await expect(jobRows.nth(index)).toBeVisible();
  await jobRows.nth(index).click();
}

test.describe("Stage D1 resume branches", () => {
  test("creates two isolated branches, edits one, restores, undoes, and refreshes sync status", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page.locator("main")).toBeVisible();

    await createC2DraftForSelectedJob(page);

    await selectJobByIndex(page, 1);
    await createC2DraftForSelectedJob(page);

    await page.goto("/resume");
    await page.getByTestId("resume-import-strip").waitFor({ state: "visible" });

    await page.getByTestId("job-suggestion-draft-select").selectOption({ index: 0 });
    await page.getByTestId("new-resume-branch-name").fill("D1 Branch A");
    await page.getByTestId("create-job-resume").click();
    await expect(page.locator(".branch-list .match-row").filter({ hasText: "D1 Branch A" })).toBeVisible();

    // 返回简历中心再创建第二个分支
    await page.goto("/resume");
    await page.getByTestId("resume-import-strip").waitFor({ state: "visible" });

    await page.getByTestId("job-suggestion-draft-select").selectOption({ index: 1 });
    await page.getByTestId("new-resume-branch-name").fill("D1 Branch B");
    await page.getByTestId("create-job-resume").click();
    await expect(page.locator(".branch-list .match-row").filter({ hasText: "D1 Branch B" })).toBeVisible();

    await expect(page.locator(".branch-list .match-row")).toHaveCount(2);

    await page.locator(".branch-list .match-row").filter({ hasText: "D1 Branch A" }).click();
    await openManualContentTab(page);
    await page.getByTestId("resume-section-nav").getByRole("button", { name: /工作经历/ }).click();
    const branchATextarea = page.getByTestId("resume-active-section-fields").locator("textarea").first();
    const originalA = await branchATextarea.inputValue();
    const editedA = `${originalA}.`;
    await branchATextarea.fill(editedA);
    await page.getByTestId("resume-active-section-fields").locator(".suggestion-card").first().locator("button.primary-button").click();
    await expect(page.locator(".notice")).toBeVisible();
    await openManualHistoryTab(page);
    await expect(page.locator(".revision-list .review-row").filter({ hasText: "版本 2" })).toBeVisible();

    await page.locator(".branch-list .match-row").filter({ hasText: "D1 Branch B" }).click();
    await openManualContentTab(page);
    await page.getByTestId("resume-section-nav").getByRole("button", { name: /工作经历/ }).click();
    await expect(page.getByTestId("resume-active-section-fields").locator("textarea").first()).not.toHaveValue(editedA);

    await page.locator(".branch-list .match-row").filter({ hasText: "D1 Branch A" }).click();
    await openManualHistoryTab(page);
    await page.locator(".revision-list .review-row").filter({ hasText: "版本 1" }).locator("button").click();
    await expect(page.locator(".notice")).toContainText("已恢复旧版本");
    await page.getByTestId("resume-studio-workbar").getByRole("button", { name: "撤销" }).click();
    await expect(page.locator(".notice")).toContainText("已撤销最近一次简历修改");
    await openManualContentTab(page);
    await page.getByTestId("resume-section-nav").getByRole("button", { name: /工作经历/ }).click();
    await expect(page.getByTestId("resume-active-section-fields").locator("textarea").first()).toHaveValue(editedA);

    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("CareerAdaptDb");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("profiles", "readwrite");
          const store = tx.objectStore("profiles");
          const getRequest = store.get("profile-demo-student");
          getRequest.onerror = () => reject(getRequest.error);
          getRequest.onsuccess = () => {
            const profile = getRequest.result;
            profile.version += 1;
            profile.updatedAt = new Date().toISOString();
            store.put(profile);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    });

    await page.getByTestId("resume-studio-workbar").getByRole("button", { name: "重新检查" }).click();
    await expect(page.locator(".notice")).toContainText("个人资料");
  });
});
