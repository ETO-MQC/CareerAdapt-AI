import { expect, test, type Page } from "@playwright/test";

type DbApplication = {
  id: string;
  status: string;
};

type AppMetaRow = {
  key: string;
  value: unknown;
};

test.describe("V2-G6b Application materials", () => {
  test("generates, edits and prepares application materials without changing application status", async ({ page }) => {
    test.setTimeout(150_000);
    const branchName = `G6b Branch ${Date.now()}`;

    await createC2DraftForSelectedJob(page);
    await createResumeBranchFromFirstDraft(page, branchName);
    await page.getByTestId("open-or-create-application").click();
    await expect(page).toHaveURL(/\/applications\?applicationId=/);
    await expect(page.getByTestId("application-detail")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("application-materials-panel")).toBeVisible();

    const [applicationBefore] = await readAllFromStore<DbApplication>(page, "applications");
    expect(applicationBefore.status).toBe("preparing");

    const panel = page.getByTestId("application-materials-panel");
    await panel.getByRole("button", { name: "生成求职信" }).click();
    await expect(panel.getByTestId("cover-letter-material")).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByTestId("material-evidence").first()).toContainText("已确认事实");

    const cover = panel.getByTestId("cover-letter-material");
    const body = await cover.getByLabel("正文段落").inputValue();
    await cover.getByLabel("正文段落").fill(`${body}\n${body.split("\n")[0]}`);
    await cover.getByRole("button", { name: "保存草稿" }).click();
    await expect(page.locator(".notice")).toContainText("申请材料已保存", { timeout: 15_000 });
    await cover.getByRole("button", { name: "标记完成" }).click();
    await expect(page.locator(".notice")).toContainText("申请材料已保存", { timeout: 15_000 });

    await panel.getByRole("button", { name: "生成邮件草稿" }).click();
    await expect(panel.getByTestId("application-email-material")).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByTestId("application-email-material")).toContainText("当前草稿未声明附件");

    await panel.getByRole("button", { name: "生成自我介绍" }).click();
    await expect(panel.getByTestId("self-introduction-material")).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByTestId("self-introduction-material")).toContainText("预计");

    await panel.getByRole("button", { name: "生成面试问题" }).click();
    await expect(panel.getByTestId("interview-questions-material")).toBeVisible({ timeout: 15_000 });
    await panel.getByTestId("interview-questions-material").getByRole("button", { name: "标记已准备" }).first().click();
    await expect(page.locator(".notice")).toContainText("申请材料已保存", { timeout: 15_000 });

    await panel.getByRole("button", { name: "生成STAR案例" }).click();
    await expect(panel.getByTestId("star-story-material")).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByTestId("fact-gaps-panel")).toBeVisible();
    await expect(panel.getByTestId("materials-readiness")).toContainText("求职信");

    const [applicationAfter] = await readAllFromStore<DbApplication>(page, "applications");
    expect(applicationAfter.id).toBe(applicationBefore.id);
    expect(applicationAfter.status).toBe("preparing");

    const appMeta = await readAllFromStore<AppMetaRow>(page, "appMeta");
    const packRow = appMeta.find((row) => row.key === `applicationPreparationPack:${applicationBefore.id}`);
    expect(packRow).toBeTruthy();
    const serializedPack = JSON.stringify(packRow?.value);
    expect(serializedPack).toContain("cover_letter");
    expect(serializedPack).not.toContain("pdfBlob");
    expect(serializedPack).not.toContain("apiKey");
    expect(serializedPack).not.toContain("sk-");
    expect(serializedPack).not.toContain("fullPrompt");
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
  await expect(page.locator("main")).toBeVisible();
  await page.getByTestId("job-suggestion-draft-select").selectOption({ index: 0 });
  await page.locator("article.panel").first().locator("input").fill(branchName);
  await page.locator("article.panel").first().locator("button.primary-button").click();
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
