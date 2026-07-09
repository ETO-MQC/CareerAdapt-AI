import { expect, test, type Page } from "@playwright/test";
import { openApplicationOverviewTab, openApplicationResumeTab, openApplicationTimelineTab } from "./support/g7b2Ui";

type DbApplication = {
  id: string;
  status: string;
  priority: string;
  note?: string;
  tags: string[];
  jobSpecificBranchId: string;
  timeline: Array<{ type: string; summary: string; operationId: string }>;
};

test.describe("V2-G6a Application Workspace", () => {
  test("creates and manages an application from a job-specific branch", async ({ page }) => {
    test.setTimeout(120_000);
    const branchName = `G6a Branch ${Date.now()}`;

    await page.goto("/applications");
    await expect(page.locator(".application-workspace")).toBeVisible();
    await expect(page.getByTestId("applications-empty-state")).toBeVisible();

    await createC2DraftForSelectedJob(page);
    await createResumeBranchFromFirstDraft(page, branchName);

    // Open the "更多" dropdown to access "加入求职进度"
    const workbar = page.getByTestId("resume-studio-workbar");
    await workbar.locator(".toolbar-more summary").click();
    await workbar.locator(".toolbar-more-popover").getByTestId("open-or-create-application").click();
    await expect(page).toHaveURL(/\/applications\?applicationId=/);
    await expect(page.getByTestId("application-card").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("application-detail")).toBeVisible();

    let applications = await readAllFromStore<DbApplication>(page, "applications");
    expect(applications).toHaveLength(1);
    expect(applications[0].status).toBe("preparing");
    const applicationId = applications[0].id;
    const branchId = applications[0].jobSpecificBranchId;

    await page.goto(`/resume?branchId=${encodeURIComponent(branchId)}`);
    await expect(page.locator(".branch-list .match-row").filter({ hasText: branchName })).toBeVisible({ timeout: 15_000 });
    // Open the "更多" dropdown to access "加入求职进度"
    const workbar2 = page.getByTestId("resume-studio-workbar");
    await workbar2.locator(".toolbar-more summary").click();
    await workbar2.locator(".toolbar-more-popover").getByTestId("open-or-create-application").click();
    await expect(page).toHaveURL(/\/applications\?applicationId=/);
    applications = await readAllFromStore<DbApplication>(page, "applications");
    expect(applications).toHaveLength(1);
    expect(applications[0].id).toBe(applicationId);

    const detail = page.getByTestId("application-detail");
    await detail.getByLabel("当前状态").selectOption("ready");
    await expect(page.locator(".notice")).toContainText("状态已更新", { timeout: 15_000 });
    await detail.getByLabel("当前状态").selectOption("applied");
    await openApplicationResumeTab(page);
    await expect(detail.getByTestId("applied-version-lock")).toBeVisible({ timeout: 15_000 });
    await openApplicationOverviewTab(page);

    await detail.getByLabel("优先级").selectOption("high");
    await detail.getByLabel("来源渠道").selectOption("referral");
    await detail.getByLabel("岗位链接").fill("https://jobs.example.com/g6a");
    await detail.getByLabel("截止日期").fill("2026-07-20");
    await detail.getByLabel("下次跟进").fill("2026-07-15");
    await detail.getByLabel("标签").fill("内推, 重点");
    await detail.getByLabel("备注").fill("<script>alert(1)</script> 联系内推人");
    await detail.getByRole("button", { name: "保存详情" }).click();
    await expect(page.locator(".notice")).toContainText("详情已保存", { timeout: 15_000 });
    await openApplicationTimelineTab(page);
    await expect(page.getByTestId("application-timeline")).toContainText("备注");

    await page.getByRole("button", { name: "列表" }).click();
    await expect(page.getByTestId("application-list")).toBeVisible();
    await expect(page.getByTestId("application-list")).toContainText("已投递");
    await page.getByRole("button", { name: "看板" }).click();
    await expect(page.getByTestId("application-board")).toBeVisible();

    await openApplicationOverviewTab(page);
    await detail.getByLabel("当前状态").selectOption("archived");
    await expect(detail.getByRole("button", { name: "恢复" })).toBeVisible({ timeout: 15_000 });
    await detail.getByRole("button", { name: "恢复" }).click();
    await expect(page.locator(".notice")).toContainText("已恢复", { timeout: 15_000 });

    await page.reload();
    await expect(page.getByTestId("application-detail")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("application-detail").getByLabel("当前状态")).toHaveValue("applied");

    applications = await readAllFromStore<DbApplication>(page, "applications");
    expect(applications).toHaveLength(1);
    expect(applications[0]).toMatchObject({
      id: applicationId,
      status: "applied",
      priority: "high",
      tags: ["内推", "重点"]
    });
    expect(applications[0].note).toContain("<script>");
    expect(applications[0].timeline.some((event) => event.type === "status_changed")).toBe(true);
    expect(applications[0].timeline.some((event) => event.type === "restored")).toBe(true);

    await page.getByRole("link", { name: "打开关联简历" }).click();
    await expect(page).toHaveURL(/\/resume\?branchId=/);
    await expect(page.locator(".branch-list .match-row").filter({ hasText: branchName })).toBeVisible({ timeout: 15_000 });
  });
});

async function createC2DraftForSelectedJob(page: Page) {
  await page.goto("/jobs");
  await expect(page.locator("main")).toBeVisible();
  await page.getByTestId("run-experience-match").click();
  await expect(page.locator(".match-row").first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("create-suggestion-draft").click();
  await expect(page.locator(".notice")).toBeVisible({ timeout: 15_000 });
}

async function createResumeBranchFromFirstDraft(page: Page, branchName: string) {
  await page.goto("/resume");
  await page.getByTestId("resume-import-strip").waitFor({ state: "visible" });
  await expect(page.locator("main")).toBeVisible();
  await page.getByTestId("job-suggestion-draft-select").selectOption({ index: 0 });
  await page.getByTestId("new-resume-branch-name").fill(branchName);
  await page.getByTestId("create-job-resume").click();
  await expect(page.locator(".branch-list .match-row").filter({ hasText: branchName })).toBeVisible({ timeout: 15_000 });
}

async function readAllFromStore<T>(page: Page, storeName: string): Promise<T[]> {
  return page.evaluate((name) => {
    return new Promise<T[]>((resolveRows, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(name, "readonly");
        const getAll = tx.objectStore(name).getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => resolveRows(getAll.result as T[]);
        tx.oncomplete = () => db.close();
      };
    });
  }, storeName);
}
