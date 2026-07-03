import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

type DbResumeBranch = {
  id: string;
  revision: number;
  currentRevisionId?: string;
  migrationStatus: string;
  contentItems: Array<{ id: string; text: string }>;
};

function resolvePopplerBinary(name: "pdftotext"): string {
  const candidates = [
    "E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe",
    "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return name;
}

const PDFTOTEXT = resolvePopplerBinary("pdftotext");

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

async function getLatestVerifiedBranch(page: Page): Promise<DbResumeBranch> {
  return page.evaluate(async () => {
    return new Promise<DbResumeBranch>((resolveBranch, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("resumeBranches", "readonly");
        const getAll = tx.objectStore("resumeBranches").getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => {
          const verified = (getAll.result as DbResumeBranch[])
            .filter((branch) => branch.migrationStatus === "verified");
          resolveBranch(verified[verified.length - 1]);
        };
        tx.oncomplete = () => db.close();
      };
    });
  });
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

async function advanceBranchRevisionWithoutRevisionRecord(page: Page, branchId: string) {
  await page.evaluate(async (targetBranchId: string) => {
    return new Promise<void>((resolveMutation, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("resumeBranches", "readwrite");
        const store = tx.objectStore("resumeBranches");
        const getRequest = store.get(targetBranchId);
        getRequest.onerror = () => reject(getRequest.error);
        getRequest.onsuccess = () => {
          const branch = getRequest.result as DbResumeBranch & { updatedAt?: string };
          branch.revision += 1;
          branch.updatedAt = new Date().toISOString();
          const putRequest = store.put(branch);
          putRequest.onerror = () => reject(putRequest.error);
        };
        tx.oncomplete = () => {
          db.close();
          resolveMutation();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, branchId);
}

async function generatePdfWithRetry(page: Page, path: string) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.waitForTimeout(500);
      await page.pdf({ path, format: "A4", printBackground: true, preferCSSPageSize: true });
      return;
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
      await page.waitForTimeout(1000 * attempt);
    }
  }
}

function outputPath(fileName: string) {
  const outputDir = resolve(process.cwd(), "test-results");
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  return resolve(outputDir, fileName);
}

function extractPdfText(path: string): string {
  return execFileSync(PDFTOTEXT, [path, "-"], { encoding: "utf8" });
}

test.describe("V2 G0a resume studio editing", () => {
  test.skip(true, "V2-G0a code not implemented yet; test is a placeholder for future development");
  test("edits through one stable content id across templates and clears draft after undo", async ({ page }) => {
    await createBranchFromDraft(page, "V2 G0a Studio Branch");
    await enablePreviewEditing(page);

    const preview = page.getByTestId("resume-a4-page");
    const branch = await getLatestVerifiedBranch(page);
    const revisionsBeforeEdit = await getResumeRevisionCount(page, branch.id);
    const firstBlock = preview.locator("[data-editable-block='true'][data-source-item-id]").first();
    const contentItemId = await firstBlock.getAttribute("data-source-item-id");
    const originalText = (await firstBlock.innerText()).trim();
    expect(contentItemId).toBeTruthy();

    await firstBlock.click();
    const editor = page.getByTestId("resume-studio-editor");
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "编辑" }).click();
    await expect(editor.locator("textarea")).toHaveValue(originalText);
    await page.keyboard.press("Escape");
    await expect(editor.locator("textarea")).toBeHidden();

    await preview.focus();
    await page.keyboard.press("F2");
    await expect(editor.locator("textarea")).toHaveValue(originalText);
    await editor.getByRole("button", { name: "取消" }).click();

    await preview.focus();
    await page.keyboard.press("Enter");
    await expect(editor.locator("textarea")).toHaveValue(originalText);
    await editor.getByRole("button", { name: "取消" }).click();

    await firstBlock.dblclick();
    const editedText = `${originalText} V2G0a`;
    await editor.locator("textarea").fill(editedText);
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".notice")).toContainText("预览区编辑已保存");
    await expect(editor).toBeHidden();
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBeforeEdit + 1);
    await expect(preview.locator(`[data-source-item-id="${contentItemId}"]`)).toContainText(editedText);

    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("modern-operations");
    await expect(preview).toHaveClass(/template-modern-operations/);
    await expect(preview.locator(`[data-source-item-id="${contentItemId}"]`)).toContainText(editedText);
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBeforeEdit + 1);

    const modernBlock = preview.locator(`[data-source-item-id="${contentItemId}"]`).first();
    await modernBlock.click();
    await editor.getByRole("button", { name: "编辑" }).click();
    await editor.locator("textarea").fill(`${editedText} unsaved`);
    await page.getByRole("button", { name: "撤销" }).click();
    await expect(page.locator(".notice")).toContainText("撤销");
    await expect(editor).toBeHidden();
    await expect(preview).not.toContainText(`${editedText} unsaved`);
  });

  test("blocks stale expectedRevision saves and keeps editing controls out of PDF", async ({ page }) => {
    await createBranchFromDraft(page, "V2 G0a Conflict Branch");
    await enablePreviewEditing(page);

    const preview = page.getByTestId("resume-a4-page");
    const branch = await getLatestVerifiedBranch(page);
    const revisionsBeforeConflict = await getResumeRevisionCount(page, branch.id);
    const firstBlock = preview.locator("[data-editable-block='true'][data-source-item-id]").first();
    const originalText = (await firstBlock.innerText()).trim();

    await firstBlock.dblclick();
    const editor = page.getByTestId("resume-studio-editor");
    await expect(editor.locator("textarea")).toBeVisible();
    await editor.locator("textarea").fill(`${originalText} stale`);
    await advanceBranchRevisionWithoutRevisionRecord(page, branch.id);
    await page.keyboard.press("Control+Enter");
    await expect(editor).toContainText("revision 已变化");
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBeforeConflict);

    const pdfPath = outputPath("v2-g0a-editor-controls-hidden.pdf");
    await page.emulateMedia({ media: "print" });
    await generatePdfWithRetry(page, pdfPath);
    const pdfText = extractPdfText(pdfPath);
    expect(pdfText).toContain("陈同学");
    expect(pdfText).not.toContain("编辑区块");
    expect(pdfText).not.toContain("保存失败");
    expect(pdfText).not.toContain("预览区编辑");
    expect(pdfText).not.toContain("Ctrl/Cmd+Enter");
  });
});
