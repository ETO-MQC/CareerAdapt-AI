import { expect, test, type Page } from "@playwright/test";
import { openAiDiagnosticsTab, openManualTypographyTab } from "./support/g7b2Ui";

type DbBranch = {
  id: string;
  name?: string;
  revision?: number;
  currentRevisionId?: string;
};

type AppMetaRow = {
  key: string;
  value?: {
    presentationRevision?: number;
    typography?: {
      lineHeight?: string;
    };
  };
};

test.describe("V2-G5b resume diagnostics", () => {
  test("runs diagnostics and applies a presentation-only readability fix", async ({ page }) => {
    test.setTimeout(100_000);
    const branchName = `G5b Diagnostics ${Date.now()}`;

    await createC2DraftForSelectedJob(page);
    await createResumeBranchFromFirstDraft(page, branchName);
    const branchBefore = await findBranchByName(page, branchName);
    expect(branchBefore?.id).toBeTruthy();

    await openManualTypographyTab(page);
    await page.getByLabel("正文字号").selectOption("small");
    await page.getByLabel("行距").selectOption("tight");
    await expect(page.locator(".notice")).toContainText("行距", { timeout: 15_000 });

    await openAiDiagnosticsTab(page);
    const panel = page.getByTestId("resume-diagnostics-panel");
    await expect(panel).toBeVisible();
    await panel.getByTestId("run-resume-diagnostics").click();
    await expect(panel.getByTestId("diagnostics-summary")).toBeVisible({ timeout: 15_000 });
    await expect(panel).not.toContainText(/ATS通过率|录用概率|面试概率|保证通过|ATS评分/);

    await panel.getByTestId("diagnostic-category-filters").getByRole("button", { name: "可读性" }).click();
    const readabilityIssue = panel.getByTestId("diagnostic-issue-SMALL_AND_TIGHT_READABILITY_RISK");
    await expect(readabilityIssue).toBeVisible();
    await readabilityIssue.getByRole("button", { name: "定位" }).click();
    await expect(page.locator(".notice")).toContainText(/定位|关联/);

    const presentationBefore = await getPresentationRevision(page, branchBefore!.id);
    await readabilityIssue.getByRole("button", { name: "调为标准行距" }).click();
    await expect.poll(async () => getPresentationRevision(page, branchBefore!.id), { timeout: 15_000 })
      .toBeGreaterThan(presentationBefore);
    await expect.poll(async () => getPresentationLineHeight(page, branchBefore!.id), { timeout: 15_000 }).toBe("normal");

    const branchAfter = await findBranchByName(page, branchName);
    expect(branchAfter?.revision).toBe(branchBefore?.revision);
    expect(branchAfter?.currentRevisionId).toBe(branchBefore?.currentRevisionId);
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

async function findBranchByName(page: Page, name: string): Promise<DbBranch | undefined> {
  const branches = await readAllFromStore<DbBranch>(page, "resumeBranches");
  return branches.find((branch) => branch.name === name);
}

async function getPresentationRevision(page: Page, branchId: string) {
  const row = await getAppMeta(page, `resumePresentationConfig:${branchId}`);
  return row?.value?.presentationRevision ?? -1;
}

async function getPresentationLineHeight(page: Page, branchId: string) {
  const row = await getAppMeta(page, `resumePresentationConfig:${branchId}`);
  return row?.value?.typography?.lineHeight;
}

async function getAppMeta(page: Page, key: string): Promise<AppMetaRow | undefined> {
  const rows = await readAllFromStore<AppMetaRow>(page, "appMeta");
  return rows.find((row) => row.key === key);
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
