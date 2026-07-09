import { expect, test, type Page } from "@playwright/test";
import { openManualHistoryTab, openManualLayoutTab, openManualTemplateTab } from "./support/g7b2Ui";

type DbResumeBranch = {
  id: string;
  name: string;
  revision: number;
  currentRevisionId?: string;
  migrationStatus: string;
};

type RenderGroup = {
  sectionType: string;
  itemIds: string[];
};

async function createBranchFromDraft(page: Page, branchName: string) {
  await page.goto("/jobs");
  await page.getByTestId("run-experience-match").click();
  await expect(page.locator(".match-row").first()).toBeVisible();
  await page.getByTestId("create-suggestion-draft").click();
  await expect(page.locator(".notice")).toBeVisible();

  await page.goto("/resume");
  await page.getByTestId("resume-import-strip").waitFor({ state: "visible" });
  await page.getByTestId("job-suggestion-draft-select").selectOption({ index: 0 });
  await page.getByTestId("new-resume-branch-name").fill(branchName);
  await page.getByTestId("create-job-resume").click();
  await expect(page.locator(".branch-list .match-row").filter({ hasText: branchName })).toBeVisible();
  await expect(page.getByTestId("resume-a4-page")).toBeVisible();
}

async function getBranchByName(page: Page, branchName: string): Promise<DbResumeBranch> {
  return page.evaluate(async (targetName: string) => {
    return new Promise<DbResumeBranch>((resolveBranch, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("resumeBranches", "readonly");
        const getAll = tx.objectStore("resumeBranches").getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => {
          const found = (getAll.result as DbResumeBranch[])
            .find((branch) => branch.name === targetName && branch.migrationStatus === "verified");
          if (!found) {
            reject(new Error("branch_not_found"));
            return;
          }
          resolveBranch(found);
        };
        tx.oncomplete = () => db.close();
      };
    });
  }, branchName);
}

async function getResumeRevisionCount(page: Page, branchId: string): Promise<number> {
  return page.evaluate(async (targetBranchId: string) => {
    return new Promise<number>((resolveCount, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("resumeRevisions", "readonly");
        const index = tx.objectStore("resumeRevisions").index("branchId");
        const countRequest = index.count(targetBranchId);
        countRequest.onerror = () => reject(countRequest.error);
        countRequest.onsuccess = () => resolveCount(countRequest.result);
        tx.oncomplete = () => db.close();
      };
    });
  }, branchId);
}

async function getSortableRenderGroup(page: Page): Promise<RenderGroup> {
  return page.getByTestId("resume-a4-page").evaluate((pageElement) => {
    const sections = Array.from(pageElement.querySelectorAll<HTMLElement>("[data-render-section]"));
    for (const section of sections) {
      const itemIds = Array.from(section.querySelectorAll<HTMLElement>("[data-source-item-id]:not([data-profile-field-id]):not([data-section-title-id])"))
        .map((item) => item.dataset.sourceItemId)
        .filter((itemId): itemId is string => Boolean(itemId));
      if (itemIds.length >= 2) {
        return {
          sectionType: section.dataset.renderSection ?? "",
          itemIds
        };
      }
    }
    throw new Error("sortable_group_not_found");
  });
}

async function getSectionItemIds(page: Page, sectionType: string): Promise<string[]> {
  return page.getByTestId("resume-a4-page").evaluate((pageElement, targetSectionType) => {
    const section = pageElement.querySelector<HTMLElement>(`[data-render-section="${targetSectionType}"]`);
    if (!section) {
      return [];
    }
    return Array.from(section.querySelectorAll<HTMLElement>("[data-source-item-id]:not([data-profile-field-id]):not([data-section-title-id])"))
      .map((item) => item.dataset.sourceItemId)
      .filter((itemId): itemId is string => Boolean(itemId));
  }, sectionType);
}

test.describe("V2-G1a structure editing", () => {
  test("排序、显示隐藏、模板切换和展示撤销不创建内容 Revision", async ({ page }) => {
    const branchName = `V2 G1a 结构编辑 ${Date.now()}`;
    await createBranchFromDraft(page, branchName);

    const branch = await getBranchByName(page, branchName);
    const revisionsBefore = await getResumeRevisionCount(page, branch.id);
    const preview = page.locator(".resume-preview-pages").getByTestId("resume-a4-page");

    // Navigate to the experience section in the field panel
    await page.locator(".resume-mode-rail button").nth(0).click();
    await page.getByTestId("resume-section-nav").getByRole("button", { name: /工作经历/ }).click();
    const fields = page.getByTestId("resume-active-section-fields");

    const sortableGroup = await getSortableRenderGroup(page);
    const firstItemId = sortableGroup.itemIds[0];
    const secondItemId = sortableGroup.itemIds[1];

    // Use the field panel "下移" button on the first card
    const firstCard = fields.locator(".suggestion-card").first();
    await firstCard.locator("button", { hasText: "下移" }).click();
    await expect(page.locator(".notice")).toContainText("排序已保存");
    await expect.poll(() => getSectionItemIds(page, sortableGroup.sectionType)).toEqual([
      secondItemId,
      firstItemId,
      ...sortableGroup.itemIds.slice(2)
    ]);
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBefore);

    // Hide via the field panel "显示" checkbox
    const firstCardCheckbox = fields.locator(".suggestion-card").first().locator(".resume-current-toggle input[type='checkbox']");
    await firstCardCheckbox.uncheck();
    await expect(page.locator(".notice")).toContainText("内容已隐藏");
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBefore);

    // Restore via style mode layout tab hidden block list
    await openManualLayoutTab(page);
    await page.locator(".hidden-block-list").getByRole("button", { name: /显示：/ }).first().click();
    await expect(page.locator(".notice")).toContainText("内容已恢复显示");
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBefore);

    await openManualTemplateTab(page);
    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("modern-operations");
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await expect(preview).toHaveClass(/template-modern-operations/);
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBefore);

    await openManualHistoryTab(page);
    await page.getByRole("button", { name: "回退展示" }).click();
    await expect(page.locator(".notice")).toContainText("已撤销");
    await expect(preview).toHaveClass(/template-classic-technical/);
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBefore);

    await openManualTemplateTab(page);
    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("modern-operations");
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await expect(preview).toHaveClass(/template-modern-operations/);
    await page.reload();
    await expect(page.getByTestId("resume-a4-page")).toHaveClass(/template-modern-operations/);
    await expect.poll(() => getSectionItemIds(page, sortableGroup.sectionType)).toEqual([
      secondItemId,
      firstItemId,
      ...sortableGroup.itemIds.slice(2)
    ]);
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBefore);
  });

  test("快速连续排序操作不会丢失", async ({ page }) => {
    const branchName = `V2 G1a 快速排序 ${Date.now()}`;
    await createBranchFromDraft(page, branchName);

    const sortableGroup = await getSortableRenderGroup(page);
    if (sortableGroup.itemIds.length < 3) {
      test.skip();
      return;
    }

    const [itemId0, itemId1, itemId2, ...rest] = sortableGroup.itemIds;

    // Navigate to the experience section in the field panel
    await page.locator(".resume-mode-rail button").nth(0).click();
    await page.getByTestId("resume-section-nav").getByRole("button", { name: /工作经历/ }).click();
    const fields = page.getByTestId("resume-active-section-fields");

    // Click "下移" on the first card twice in rapid succession
    const moveDownButton = fields.locator(".suggestion-card").first().locator("button", { hasText: "下移" });
    await moveDownButton.click();
    await moveDownButton.click();

    await expect.poll(() => getSectionItemIds(page, sortableGroup.sectionType), { timeout: 10000 }).toEqual([
      itemId1,
      itemId2,
      itemId0,
      ...rest
    ]);
  });

  test("快速连续隐藏和恢复操作不会丢失", async ({ page }) => {
    const branchName = `V2 G1a 快速隐藏 ${Date.now()}`;
    await createBranchFromDraft(page, branchName);

    const sortableGroup = await getSortableRenderGroup(page);
    const firstItemId = sortableGroup.itemIds[0];

    // Navigate to the experience section in the field panel
    await page.locator(".resume-mode-rail button").nth(0).click();
    await page.getByTestId("resume-section-nav").getByRole("button", { name: /工作经历/ }).click();
    const fields = page.getByTestId("resume-active-section-fields");

    // Hide via the field panel "显示" checkbox
    const checkbox = fields.locator(".suggestion-card").first().locator(".resume-current-toggle input[type='checkbox']");
    await checkbox.uncheck();

    // Wait for hide to complete, then restore from hidden list
    await openManualLayoutTab(page);
    await expect(page.locator(".hidden-block-list")).toBeVisible();
    await page.locator(".hidden-block-list").getByRole("button", { name: /显示：/ }).first().click();

    // Item should be visible again in the preview
    const preview = page.locator(".resume-preview-pages").getByTestId("resume-a4-page");
    await expect(preview.locator(`[data-source-item-id="${firstItemId}"]`).first()).toBeVisible();
  });
});
