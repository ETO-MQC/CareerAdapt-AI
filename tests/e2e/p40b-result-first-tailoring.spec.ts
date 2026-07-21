import { expect, test, type Page } from "@playwright/test";

type DbBranch = { id: string; revision: number; currentRevisionId?: string; branchPurpose: string; sourceBranchId?: string; contentItems: unknown[] };

test.describe("P4.0b result-first tailoring", () => {
  test("creates a job resume even when some requirements are uncovered", async ({ page }) => {
    const { derivedId } = await createJobResume(page);
    const branch = await readStore<DbBranch>(page, "resumeBranches", derivedId);
    expect(branch?.branchPurpose).toBe("job_specific");
    await expect(page.getByTestId("tailoring-overview")).toBeVisible();
    await expect(page.getByTestId("tailoring-overview")).toContainText("主要缺口");
    await expect(page.getByTestId("tailoring-overview")).toContainText("岗位适配度，不代表 ATS 通过率或录取概率");
  });

  test("balanced mode groups suggestions and confirmation-required inferences", async ({ page }) => {
    await createJobResume(page);
    const panel = page.getByTestId("job-optimization-panel");
    await panel.getByLabel("推荐改写力度").selectOption("balanced");
    await panel.getByRole("button", { name: "生成改写建议" }).click();
    await expect(panel.getByTestId("tailoring-suggestions")).toBeVisible();
    await expect(panel.getByTestId("tailoring-suggestions")).toContainText(/可直接采用|需要确认/);
    await expect(panel.getByRole("button", { name: "采用全部可直接应用建议" })).toBeVisible();
  });

  test("confirmed resume-only claim creates a revision without changing source resume or profile", async ({ page }) => {
    const { sourceId, derivedId } = await createJobResume(page);
    const sourceBefore = await readStore<DbBranch>(page, "resumeBranches", sourceId);
    const derivedBefore = await readStore<DbBranch>(page, "resumeBranches", derivedId);
    const profileBefore = await readFirstStore(page, "profiles");
    const panel = page.getByTestId("job-optimization-panel");
    await panel.getByRole("button", { name: "生成改写建议" }).click();
    await panel.getByRole("button", { name: "确认并应用" }).last().click();
    const confirmations = panel.locator(".tailoring-confirmation-card");
    for (let index = 0; index < await confirmations.count(); index += 1) {
      const confirmation = confirmations.nth(index);
      const aware = confirmation.getByRole("button", { name: "了解", exact: true });
      if (await aware.count()) await aware.click();
      else await confirmation.getByRole("button", { name: "确认采用", exact: true }).click();
    }
    await panel.getByRole("button", { name: "应用选择并保存新版本" }).click();
    await expect.poll(async () => (await readStore<DbBranch>(page, "resumeBranches", derivedId))?.revision).toBe((derivedBefore?.revision ?? 0) + 1);
    expect(await readStore<DbBranch>(page, "resumeBranches", sourceId)).toEqual(sourceBefore);
    expect(await readFirstStore(page, "profiles")).toEqual(profileBefore);
  });
});

async function createJobResume(page: Page) {
  await page.goto("/resume");
  await page.getByRole("button", { name: /从个人资料库创建/ }).click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
  await page.goto("/jobs");
  await page.getByRole("radio", { name: /优化已有简历/ }).click();
  const source = page.getByLabel("来源通用简历");
  await source.selectOption({ index: 1 });
  const sourceId = await source.inputValue();
  const create = page.getByTestId("analyze-and-generate-job-resume");
  await expect(create).toBeEnabled({ timeout: 20_000 });
  await create.click();
  await expect(page).toHaveURL(/\/resume\?.*branchId=/, { timeout: 20_000 });
  await expect(page.getByTestId("job-optimization-panel")).toBeVisible({ timeout: 20_000 });
  return { sourceId, derivedId: new URL(page.url()).searchParams.get("branchId")! };
}

async function readStore<T>(page: Page, storeName: string, key: string): Promise<T | undefined> {
  return page.evaluate(({ storeName, key }) => new Promise<T | undefined>((resolve, reject) => {
    const request = indexedDB.open("CareerAdaptDb");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const get = db.transaction(storeName, "readonly").objectStore(storeName).get(key); get.onerror = () => reject(get.error); get.onsuccess = () => { resolve(get.result as T | undefined); db.close(); }; };
  }), { storeName, key });
}

async function readFirstStore(page: Page, storeName: string): Promise<unknown> {
  return page.evaluate((storeName) => new Promise((resolve, reject) => {
    const request = indexedDB.open("CareerAdaptDb");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const get = db.transaction(storeName, "readonly").objectStore(storeName).getAll(); get.onerror = () => reject(get.error); get.onsuccess = () => { resolve(get.result[0]); db.close(); }; };
  }), storeName);
}
