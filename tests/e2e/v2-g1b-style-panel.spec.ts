import { expect, test, type Page } from "@playwright/test";

type DbResumeBranch = {
  id: string;
  name: string;
  migrationStatus: string;
};

type RenderSectionTarget = {
  sectionType: string;
  title: string;
  itemId: string;
};

async function createBranchFromDraft(page: Page, branchName: string) {
  await page.goto("/jobs");
  await page.locator("button").filter({ hasText: "C1" }).first().click();
  await expect(page.locator(".match-row").first()).toBeVisible();
  await page.locator("button").filter({ hasText: "C2" }).first().click();
  await expect(page.locator(".notice")).toContainText("C2");

  await page.goto("/resume");
  await page.locator("label").filter({ hasText: "C2" }).locator("select").selectOption({ index: 0 });
  await page.locator("article.panel").first().locator("input").fill(branchName);
  await page.locator("article.panel").first().locator("button.primary-button").click();
  await expect(page.locator(".branch-list .match-row").filter({ hasText: branchName })).toBeVisible();
  await expect(page.getByTestId("resume-a4-page")).toBeVisible();
}

async function enablePreviewEditing(page: Page) {
  const toggle = page.locator("label").filter({ hasText: "预览区编辑" }).locator("input");
  await expect(toggle).toBeEnabled();
  await toggle.check();
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

async function getCssVariable(page: Page, name: string) {
  return page.getByTestId("resume-a4-page").evaluate((element, variableName) => {
    return getComputedStyle(element).getPropertyValue(variableName).trim();
  }, name);
}

async function getSectionTarget(page: Page): Promise<RenderSectionTarget> {
  return page.getByTestId("resume-a4-page").evaluate((pageElement) => {
    const sections = Array.from(pageElement.querySelectorAll<HTMLElement>("[data-render-section]"));
    for (const section of sections) {
      const item = section.querySelector<HTMLElement>("[data-source-item-id]");
      const title = section.querySelector<HTMLElement>("h2");
      if (item?.dataset.sourceItemId && title?.textContent?.trim()) {
        return {
          sectionType: section.dataset.renderSection ?? "",
          title: title.textContent.trim(),
          itemId: item.dataset.sourceItemId
        };
      }
    }
    throw new Error("section_target_not_found");
  });
}

async function isSectionTitleVisible(page: Page, sectionType: string, title: string) {
  return page.getByTestId("resume-a4-page").evaluate((pageElement, target) => {
    const section = pageElement.querySelector<HTMLElement>(`[data-render-section="${target.sectionType}"]`);
    return section?.querySelector("h2")?.textContent?.trim() === target.title;
  }, { sectionType, title });
}

async function getLatestExportRecord(page: Page) {
  return page.evaluate(async () => {
    return new Promise<Record<string, unknown>>((resolveRecord, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("exportRecords", "readonly");
        const getAll = tx.objectStore("exportRecords").getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => {
          const records = (getAll.result as Array<Record<string, unknown>>)
            .sort((left, right) => String(right.exportedAt ?? "").localeCompare(String(left.exportedAt ?? "")));
          resolveRecord(records[0] ?? {});
        };
        tx.oncomplete = () => db.close();
      };
    });
  });
}

test.describe("V2-G1b style property panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {
        document.body.setAttribute("data-print-invoked", "true");
      };
    });
  });

  test("右侧属性面板保存受控样式、Section 标题显隐和导出快照且不创建内容 Revision", async ({ page }) => {
    const branchName = `V2 G1b 样式面板 ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    const branch = await getBranchByName(page, branchName);
    const revisionsBefore = await getResumeRevisionCount(page, branch.id);

    await expect(page.getByTestId("resume-property-panel")).toBeVisible();
    await page.getByLabel("页面密度").selectOption("compact");
    await expect(page.locator(".notice")).toContainText("页面密度已保存");
    await expect.poll(() => getCssVariable(page, "--resume-page-padding-block")).toBe("10mm");

    await page.getByLabel("正文字号").selectOption("small");
    await expect(page.locator(".notice")).toContainText("正文字号已保存");
    await expect.poll(() => getCssVariable(page, "--resume-body-font-size")).toBe("8.8pt");

    await page.getByLabel("行距").selectOption("tight");
    await expect(page.locator(".notice")).toContainText("行距已保存");
    await expect.poll(() => getCssVariable(page, "--resume-line-height")).toBe("1.34");

    await page.getByLabel("主题强调色：蓝色").click();
    await expect(page.locator(".notice")).toContainText("主题强调色已保存");
    await expect.poll(() => getCssVariable(page, "--resume-accent-color")).toBe("#1d4f91");

    await enablePreviewEditing(page);
    const target = await getSectionTarget(page);
    await page.getByTestId("resume-a4-page").locator(`[data-source-item-id="${target.itemId}"]`).first().click();
    await expect(page.getByTestId("block-style-panel")).toBeVisible();

    await page.getByRole("button", { name: "Section" }).click();
    await expect(page.getByTestId("section-style-panel")).toBeVisible();
    await page.getByLabel("显示 Section 标题").click();
    await expect(page.locator(".notice")).toContainText("Section 标题已隐藏");
    await expect.poll(() => isSectionTitleVisible(page, target.sectionType, target.title)).toBe(false);

    await page.getByRole("button", { name: "Document" }).click();
    await page.locator(".resume-export-panel button.primary-button").click();
    await expect(page.locator("body")).toHaveAttribute("data-print-invoked", "true");
    const exportRecord = await getLatestExportRecord(page);
    const snapshot = exportRecord.presentationSnapshot as {
      typography?: { bodyTextScale?: string; lineHeight?: string };
      theme?: { accentColor?: string; density?: string };
      sectionStyleOverrides?: Record<string, { showTitle?: boolean }>;
    } | undefined;
    expect(snapshot?.typography?.bodyTextScale).toBe("small");
    expect(snapshot?.typography?.lineHeight).toBe("tight");
    expect(snapshot?.theme?.accentColor).toBe("blue");
    expect(snapshot?.theme?.density).toBe("compact");
    expect(snapshot?.sectionStyleOverrides?.[target.sectionType]?.showTitle).toBe(false);

    await page.getByRole("button", { name: "回退展示" }).click();
    await expect(page.locator(".notice")).toContainText("已撤销");
    await expect.poll(() => isSectionTitleVisible(page, target.sectionType, target.title)).toBe(true);

    await page.reload();
    await expect(page.getByTestId("resume-a4-page")).toBeVisible();
    await expect.poll(() => getCssVariable(page, "--resume-body-font-size")).toBe("8.8pt");
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBefore);
  });
});
