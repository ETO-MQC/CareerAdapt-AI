import { expect, test, type Page } from "@playwright/test";

type DbBranch = {
  id: string;
  name?: string;
  revision?: number;
  branchPurpose?: string;
};

type DbSuggestion = {
  id: string;
  branchId?: string;
  status?: string;
  targetContentItemId?: string;
  requirementsHash?: string;
};

test.describe("V2-G5a block-level job optimization", () => {
  test("generates a block suggestion, shows diff, and accepts it into a branch revision", async ({ page }) => {
    test.setTimeout(90_000);
    const branchName = `G5a Branch ${Date.now()}`;

    await createC2DraftForSelectedJob(page);
    await createResumeBranchFromFirstDraft(page, branchName);

    const panel = page.getByTestId("job-optimization-panel");
    await expect(panel).toBeVisible();
    await panel.locator(".section-heading button").click();
    await expect(panel.locator(".optimization-grid")).toBeVisible();

    await panel.locator(".optimization-column").first().locator(".action-row button").first().click();
    const firstRequirement = panel.getByTestId("requirement-sidebar").locator(".match-row").first();
    await expect(firstRequirement).toBeVisible({ timeout: 15_000 });
    await firstRequirement.click();

    const generateRow = panel.locator(".optimization-column").nth(1).locator(".action-row").first();
    const compressButton = generateRow.locator("button").nth(1);
    await expect(compressButton).toBeEnabled();
    await compressButton.click();

    await expect(panel.getByTestId("block-suggestion-panel")).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId("inline-diff")).toBeVisible();

    const before = await findBranchByName(page, branchName);
    expect(before?.revision).toBeDefined();
    await panel.getByTestId("block-suggestion-panel").locator(".action-row button.primary-button").first().click();

    await expect.poll(async () => {
      const accepted = await getAcceptedSuggestions(page, before!.id);
      return accepted.length;
    }, { timeout: 45_000 }).toBeGreaterThan(0);

    await expect.poll(async () => {
      const branch = await findBranchByName(page, branchName);
      return branch?.revision ?? -1;
    }, { timeout: 45_000 }).toBe((before?.revision ?? 0) + 1);

    const accepted = await getAcceptedSuggestions(page, before!.id);
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted[0].targetContentItemId).toBeTruthy();
    expect(accepted[0].requirementsHash).toBeTruthy();
  });
});

async function createC2DraftForSelectedJob(page: Page) {
  await page.goto("/jobs");
  await expect(page.locator("main")).toBeVisible();
  await page.locator("button").filter({ hasText: "C1" }).first().click();
  await expect(page.locator(".match-row").first()).toBeVisible({ timeout: 15_000 });
  await page.locator("button").filter({ hasText: "C2" }).first().click();
  await expect(page.locator(".notice")).toContainText("C2", { timeout: 15_000 });
}

async function createResumeBranchFromFirstDraft(page: Page, branchName: string) {
  await page.goto("/resume");
  await expect(page.locator("main")).toBeVisible();
  await page.locator("label").filter({ hasText: "C2" }).locator("select").selectOption({ index: 0 });
  await page.locator("article.panel").first().locator("input").fill(branchName);
  await page.locator("article.panel").first().locator("button.primary-button").click();
  await expect(page.locator(".branch-list .match-row").filter({ hasText: branchName })).toBeVisible({ timeout: 15_000 });
}

async function findBranchByName(page: Page, name: string): Promise<DbBranch | undefined> {
  const branches = await readAllFromStore<DbBranch>(page, "resumeBranches");
  return branches.find((branch) => branch.name === name);
}

async function getAcceptedSuggestions(page: Page, branchId: string): Promise<DbSuggestion[]> {
  const suggestions = await readAllFromStore<DbSuggestion>(page, "aiSuggestions");
  return suggestions.filter((suggestion) => suggestion.branchId === branchId && suggestion.status === "accepted");
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
