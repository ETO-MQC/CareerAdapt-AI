import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openManualContentTab, openManualHistoryTab, openManualPageTab, openManualTemplateTab, openManualTypographyTab } from "./support/g7b2Ui";

type DbResumeBranch = {
  id: string;
  name: string;
  revision: number;
  currentRevisionId?: string;
  migrationStatus: string;
};

type DbPresentationConfig = {
  templateId: string;
  presentationRevision: number;
  hiddenItemIds: string[];
  typography?: { lineHeight?: string };
};

function visibleA4Page(page: Page) {
  return page.locator(".resume-preview-stage").getByTestId("resume-a4-page").first();
}

function resolvePopplerBinary(name: "pdftotext" | "pdfinfo"): string {
  const candidates =
    name === "pdftotext"
      ? [
          "E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe",
          "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"
        ]
      : [
          "E:/Pycharm/Lib/poppler/Library/bin/pdfinfo.exe",
          "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdfinfo.exe"
        ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return name;
}

const PDFTOTEXT = resolvePopplerBinary("pdftotext");
const PDFINFO = resolvePopplerBinary("pdfinfo");

function getOutputDir() {
  const outputDir = resolve(process.cwd(), "test-results");
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

async function createBranchFromDraft(page: Page, branchName: string) {
  await page.goto("/jobs");
  await page.getByTestId("run-experience-match").click();
  await expect(page.locator(".match-row").first()).toBeVisible();
  await page.getByTestId("create-suggestion-draft").click();
  await expect(page.locator(".notice")).toBeVisible();

  await page.goto("/resume");
  await page.getByTestId("job-suggestion-draft-select").selectOption({ index: 0 });
  await page.locator("article.panel").first().locator("input").fill(branchName);
  await page.locator("article.panel").first().locator("button.primary-button").click();
  await expect(page.locator(".branch-list .match-row").filter({ hasText: branchName })).toBeVisible();
  await expect(visibleA4Page(page)).toBeVisible();
}

async function enablePreviewEditing(page: Page) {
  const toggle = page.getByTestId("canvas-edit-toggle");
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

async function getPresentationConfig(page: Page, branchId: string): Promise<DbPresentationConfig> {
  return page.evaluate(async (targetBranchId: string) => {
    return new Promise<DbPresentationConfig>((resolveConfig, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("appMeta", "readonly");
        const getRequest = tx.objectStore("appMeta").get(`resumePresentationConfig:${targetBranchId}`);
        getRequest.onerror = () => reject(getRequest.error);
        getRequest.onsuccess = () => resolveConfig(getRequest.result.value as DbPresentationConfig);
        tx.oncomplete = () => db.close();
      };
    });
  }, branchId);
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

async function getRenderedItemIds(page: Page): Promise<string[]> {
  return visibleA4Page(page).evaluate((pageElement) => {
    const items = Array.from(pageElement.querySelectorAll<HTMLElement>('.resume-template-item[data-source-item-id]:not([data-source-item-id^="profile:"])'));
    const ids = items.map((item) => item.dataset.sourceItemId).filter(Boolean) as string[];
    if (!ids.length) {
      throw new Error("rendered_item_not_found");
    }
    return ids;
  });
}

async function getCssVariable(page: Page, name: string) {
  return visibleA4Page(page).evaluate((element, variableName) => {
    return getComputedStyle(element).getPropertyValue(variableName).trim();
  }, name);
}

async function ensureSinglePage(page: Page) {
  await openManualPageTab(page);
  const status = page.getByTestId("overflow-status");
  await expect(status).toBeVisible();
  const text = await status.innerText();
  if (!text.includes("overflow")) {
    return;
  }
  await openManualContentTab(page);
  const toggles = page.locator(".branch-editor input[type='checkbox']");
  const count = await toggles.count();
  for (let index = count - 1; index >= 2; index--) {
    await toggles.nth(index).uncheck();
    await page.waitForTimeout(250);
    await openManualPageTab(page);
    if (!(await status.innerText()).includes("overflow")) {
      return;
    }
    await openManualContentTab(page);
  }
}

function assertPdfBasics(path: string) {
  const info = execFileSync(PDFINFO, [path], { encoding: "utf8" });
  expect(info).toContain("Pages:           1");
  const pageSize = info.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/);
  expect(pageSize).not.toBeNull();
  expect(Number(pageSize![1])).toBeGreaterThan(594);
  expect(Number(pageSize![1])).toBeLessThan(596);
  expect(Number(pageSize![2])).toBeGreaterThan(841);
  expect(Number(pageSize![2])).toBeLessThan(843);
  expect(info).toContain("A4");
}

function extractPdfText(path: string): string {
  return execFileSync(PDFTOTEXT, [path, "-"], { encoding: "utf8" });
}

async function openTemplateCenter(page: Page) {
  await page.getByRole("button", { name: "模板中心", exact: true }).click();
  await expect(page.getByTestId("template-center")).toBeVisible();
}

async function closeTemplateCenter(page: Page) {
  await page.getByRole("button", { name: "关闭模板中心" }).click();
  await expect(page.getByTestId("template-center")).toHaveCount(0);
}

async function expectCardCount(page: Page, count: number) {
  await expect(page.locator("[data-testid^='template-card-']")).toHaveCount(count);
}

test.describe("V2-G2 template center", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {
        document.body.setAttribute("data-print-invoked", "true");
      };
    });
  });

  test("打开关闭模板中心，展示四套模板并按第一阶段分类筛选", async ({ page }) => {
    const branchName = `V2 G2 模板中心 ${Date.now()}`;
    await createBranchFromDraft(page, branchName);

    await openTemplateCenter(page);
    await expectCardCount(page, 4);
    await expect(page.getByTestId("template-card-classic-technical")).toContainText("稳重技术");
    await expect(page.getByTestId("template-card-modern-operations")).toContainText("简洁现代");
    await expect(page.getByTestId("template-card-ats-minimal")).toContainText("ATS极简单栏");
    await expect(page.getByTestId("template-card-business-consulting")).toContainText("商务咨询正式");
    await expect(page.getByTestId("template-card-ats-minimal")).toContainText("单栏");
    await expect(page.getByTestId("template-card-business-consulting")).toContainText("ATS友好：中");

    await page.getByRole("button", { name: "ATS优先", exact: true }).click();
    await expectCardCount(page, 2);
    await page.getByRole("button", { name: "单栏", exact: true }).click();
    await expectCardCount(page, 2);
    await page.getByRole("button", { name: "双栏", exact: true }).click();
    await expectCardCount(page, 2);
    await page.getByRole("button", { name: "技术简洁", exact: true }).click();
    await expectCardCount(page, 2);
    await page.getByRole("button", { name: "商务正式", exact: true }).click();
    await expectCardCount(page, 1);
    await expect(page.getByTestId("template-card-business-consulting")).toBeVisible();

    await page.getByRole("button", { name: "关闭模板中心" }).click();
    await expect(page.getByTestId("template-center")).toHaveCount(0);
  });

  test("应用新模板走展示配置队列，支持 Undo/Redo、刷新保持和 ExportRecord 快照", async ({ page }) => {
    const branchName = `V2 G2 应用模板 ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    const branch = await getBranchByName(page, branchName);
    const revisionsBefore = await getResumeRevisionCount(page, branch.id);
    const preview = visibleA4Page(page);

    await openTemplateCenter(page);
    await page.getByRole("button", { name: "应用模板：ATS极简单栏" }).click();
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await expect(preview).toHaveClass(/template-ats-minimal/);
    await expect(page.getByTestId("template-card-ats-minimal")).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("button", { name: "应用模板：ATS极简单栏" })).toBeDisabled();
    const atsConfig = await getPresentationConfig(page, branch.id);
    expect(atsConfig.templateId).toBe("ats-minimal");

    await page.getByRole("button", { name: "应用模板：商务咨询正式" }).click();
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await expect(preview).toHaveClass(/template-business-consulting/);
    const businessConfig = await getPresentationConfig(page, branch.id);
    expect(businessConfig.templateId).toBe("business-consulting");
    expect(businessConfig.presentationRevision).toBeGreaterThan(atsConfig.presentationRevision);
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBefore);

    await closeTemplateCenter(page);
    await openManualHistoryTab(page);
    await page.getByRole("button", { name: "回退展示" }).click();
    await expect(page.locator(".notice")).toContainText("已撤销");
    await expect(preview).toHaveClass(/template-ats-minimal/);
    await openTemplateCenter(page);
    await expect(page.getByTestId("template-card-ats-minimal")).toHaveAttribute("aria-current", "true");

    await closeTemplateCenter(page);
    await openManualHistoryTab(page);
    await page.getByRole("button", { name: "重做展示" }).click();
    await expect(page.locator(".notice")).toContainText("已重做");
    await expect(preview).toHaveClass(/template-business-consulting/);
    await openTemplateCenter(page);
    await expect(page.getByTestId("template-card-business-consulting")).toHaveAttribute("aria-current", "true");

    await page.reload();
    await expect(visibleA4Page(page)).toHaveClass(/template-business-consulting/);
    await openTemplateCenter(page);
    await expect(page.getByTestId("template-card-business-consulting")).toHaveAttribute("aria-current", "true");

    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("template-center")).toBeHidden();
    await page.emulateMedia({ media: "screen" });

    await closeTemplateCenter(page);
    await openManualPageTab(page);
    await page.getByRole("button", { name: "打印 / 保存 PDF" }).click();
    const exportRecord = await getLatestExportRecord(page);
    const snapshot = exportRecord.presentationSnapshot as { templateId?: string } | undefined;
    expect(exportRecord.templateId).toBe("business-consulting");
    expect(snapshot?.templateId).toBe("business-consulting");
  });

  test("模板中心不丢未保存正文草稿，模板切换保留已有样式和隐藏配置", async ({ page }) => {
    const branchName = `V2 G2 草稿保留 ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    const branch = await getBranchByName(page, branchName);

    await openManualTypographyTab(page);
    await page.getByLabel("行距").selectOption("relaxed");
    await expect(page.locator(".notice")).toContainText("行距已保存");
    await expect.poll(() => getCssVariable(page, "--resume-line-height")).toBe("1.62");

    await enablePreviewEditing(page);
    const itemIds = await getRenderedItemIds(page);
    const editItemId = itemIds[0];
    const hiddenItemId = itemIds[1] ?? itemIds[0];
    await visibleA4Page(page).locator(`[data-source-item-id="${editItemId}"]`).first().click({ force: true });
    await expect(page.getByLabel("编辑简历区块正文")).toBeVisible();
    await page.getByLabel("编辑简历区块正文").fill("G2 未保存正文草稿");

    await openManualContentTab(page);
    await page.locator(".branch-editor input[type='checkbox']").nth(itemIds[1] ? 1 : 0).click();
    await expect(page.locator(".notice")).toContainText("内容已隐藏");
    const hiddenConfig = await getPresentationConfig(page, branch.id);
    expect(hiddenConfig.hiddenItemIds).toContain(hiddenItemId);

    await openTemplateCenter(page);
    await page.getByRole("button", { name: "全部", exact: true }).click();
    await page.getByRole("button", { name: "应用模板：ATS极简单栏" }).click();
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await expect(visibleA4Page(page)).toContainText("G2 未保存正文草稿");
    await expect.poll(() => getCssVariable(page, "--resume-line-height")).toBe("1.62");
    const switchedConfig = await getPresentationConfig(page, branch.id);
    expect(switchedConfig.templateId).toBe("ats-minimal");
    expect(switchedConfig.hiddenItemIds).toContain(hiddenItemId);
    expect(switchedConfig.typography?.lineHeight).toBe("relaxed");
  });

  test("四套模板均可生成A4 PDF且不包含模板中心或编辑控件", async ({ page }) => {
    const branchName = `V2 G2 PDF ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    await ensureSinglePage(page);
    const outputDir = getOutputDir();
    const templateIds = [
      "classic-technical",
      "modern-operations",
      "ats-minimal",
      "business-consulting"
    ];

    for (const templateId of templateIds) {
      await page.emulateMedia({ media: "screen" });
      await openManualTemplateTab(page);
      await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption(templateId);
      if (templateId !== "classic-technical") {
        await expect(page.locator(".notice")).toContainText("模板偏好已保存");
      }
      await expect(visibleA4Page(page)).toHaveClass(new RegExp(`template-${templateId}`));
      await ensureSinglePage(page);
      await page.emulateMedia({ media: "print" });
      const pdfPath = resolve(outputDir, `g2-${templateId}.pdf`);
      await page.pdf({ path: pdfPath, format: "A4", printBackground: true, preferCSSPageSize: true });

      assertPdfBasics(pdfPath);
      const text = extractPdfText(pdfPath);
      expect(text).toContain("陈同学");
      expect(text).toContain("demo.student@example.com");
      expect(text).not.toContain("模板中心");
      expect(text).not.toContain("应用模板");
      expect(text).not.toContain("打印 / 保存 PDF");
      expect(text).not.toContain("编辑区块");
    }
  });
});
