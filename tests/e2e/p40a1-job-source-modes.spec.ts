import { expect, test, type Page } from "@playwright/test";

type DbBranch = {
  id: string;
  branchPurpose: "general" | "job_specific";
  sourceBranchId?: string;
  sourceRevisionId?: string;
  sourceProfileSnapshotId?: string;
  revision: number;
  currentRevisionId?: string;
  resumeBasics?: { targetRole?: string };
  contentItems: unknown[];
};

test.describe("P4.0a.1 job resume source modes", () => {
  test("selects canonical profile content and creates an isolated job branch", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page.getByRole("tab", { name: "生成岗位简历" })).toHaveAttribute("aria-selected", "true");
    const profileBefore = await readAllFromStore(page, "profiles");

    await page.getByRole("radio", { name: /从资料库生成/ }).click();
    await page.getByTestId("analyze-profile-source").click();
    await expect(page.locator(".profile-recommendation-item").first()).toBeVisible();
    await expect(page.getByText(/已选择 \d+ 项内容/)).toBeVisible();
    await page.getByTestId("create-from-profile-source").click();

    await expect(page).toHaveURL(/\/resume\?.*branchId=/, { timeout: 20_000 });
    const branchId = new URL(page.url()).searchParams.get("branchId")!;
    const branch = await readFromStore<DbBranch>(page, "resumeBranches", branchId);
    expect(branch).toMatchObject({ branchPurpose: "job_specific", sourceProfileSnapshotId: expect.any(String) });
    expect(branch?.sourceBranchId).toBeUndefined();
    expect(branch?.contentItems.length).toBeGreaterThan(0);
    expect(await readAllFromStore(page, "profiles")).toEqual(profileBefore);

    await page.reload();
    expect(await readFromStore<DbBranch>(page, "resumeBranches", branchId)).toBeTruthy();
  });

  test("analyzes one general resume and creates a branch without changing its source", async ({ page }) => {
    await ensureGeneralResume(page);
    const generalBranches = (await readAllFromStore(page, "resumeBranches") as DbBranch[]).filter((branch) => branch.branchPurpose === "general");
    const sourceId = generalBranches.sort((left, right) => right.id.localeCompare(left.id))[0].id;
    const sourceBefore = await readFromStore<DbBranch>(page, "resumeBranches", sourceId);
    expect(sourceBefore?.branchPurpose).toBe("general");

    await page.goto("/jobs");
    await page.getByRole("radio", { name: /优化已有简历/ }).click();
    await page.getByLabel("来源通用简历").selectOption(sourceId);
    await page.getByTestId("analyze-and-generate-job-resume").click();

    await expect(page).toHaveURL(/\/resume\?.*branchId=/, { timeout: 20_000 });
    const derivedId = new URL(page.url()).searchParams.get("branchId")!;
    const derived = await readFromStore<DbBranch>(page, "resumeBranches", derivedId);
    expect(derived).toMatchObject({
      branchPurpose: "job_specific",
      sourceBranchId: sourceId,
      sourceRevisionId: sourceBefore?.currentRevisionId
    });
    const sourceAfter = await readFromStore<DbBranch>(page, "resumeBranches", sourceId);
    expect(sourceAfter).toEqual(sourceBefore);
  });
});

async function ensureGeneralResume(page: Page) {
  await page.goto("/resume");
  await page.getByRole("button").filter({ hasText: "从个人资料库创建" }).click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
}

async function readFromStore<T>(page: Page, storeName: string, key: string): Promise<T | undefined> {
  return page.evaluate(async ({ storeName, key }) => {
    const request = indexedDB.open("CareerAdaptDb");
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    return new Promise<T | undefined>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const getRequest = transaction.objectStore(storeName).get(key);
      getRequest.onsuccess = () => resolve(getRequest.result as T | undefined);
      getRequest.onerror = () => reject(getRequest.error);
    });
  }, { storeName, key });
}

async function readAllFromStore(page: Page, storeName: string): Promise<unknown[]> {
  return page.evaluate(async (name) => {
    const request = indexedDB.open("CareerAdaptDb");
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    return new Promise<unknown[]>((resolve, reject) => {
      const transaction = database.transaction(name, "readonly");
      const getRequest = transaction.objectStore(name).getAll();
      getRequest.onsuccess = () => resolve(getRequest.result);
      getRequest.onerror = () => reject(getRequest.error);
    });
  }, storeName);
}
