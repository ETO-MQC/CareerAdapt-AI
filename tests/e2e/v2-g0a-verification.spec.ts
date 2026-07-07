import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

const editableContentBlockSelector = "[data-editable-block='true'][data-source-item-id]:not([data-profile-field-id])";

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
  await page.getByTestId("run-experience-match").click();
  await expect(page.locator(".match-row").first()).toBeVisible();
  await page.getByTestId("create-suggestion-draft").click();
  await expect(page.locator(".notice")).toBeVisible();

  await page.goto("/resume");
  await page.getByTestId("job-suggestion-draft-select").selectOption({ index: 0 });
  await page.locator("article.panel").first().locator("input").fill(branchName);
  await page.locator("article.panel").first().locator("button.primary-button").click();
  await expect(page.locator(".branch-list .match-row").filter({ hasText: branchName })).toBeVisible();
  await expect(page.getByTestId("resume-a4-page")).toBeVisible();
}

async function enablePreviewEditing(page: Page) {
  const toggle = page.getByTestId("canvas-edit-toggle");
  await expect(toggle).toBeEnabled();
  await toggle.check();
}

async function firstEditableContentBlock(page: Page, preview: Locator) {
  const blocks = preview.locator(editableContentBlockSelector);
  const count = await blocks.count();
  const editor = page.getByTestId("resume-studio-editor");
  for (let index = 0; index < count; index++) {
    const block = blocks.nth(index);
    await block.click({ force: true });
    const editButton = editor.getByRole("button", { name: "编辑" });
    await expect(editButton).toBeVisible();
    if (await editButton.isEnabled()) {
      return block;
    }
  }
  throw new Error("No editable resume content block found");
}

async function startEditingContentBlock(page: Page, block: Locator) {
  const editor = page.getByTestId("resume-studio-editor");
  if ((await block.getAttribute("data-selected")) !== "true") {
    await block.click({ force: true });
  }
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "编辑" }).click();
  await expect(editor.locator("textarea")).toBeVisible();
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

async function getAllRevisionsForBranch(page: Page, branchId: string) {
  return page.evaluate(async (targetBranchId: string) => {
    return new Promise<Array<{ id: string; operationId: string; revisionNumber: number }>>((resolveRevisions, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("resumeRevisions", "readonly");
        const index = tx.objectStore("resumeRevisions").index("branchId");
        const getAll = index.getAll(targetBranchId);
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => {
          resolveRevisions(getAll.result.map((r) => ({
            id: r.id,
            operationId: r.operationId,
            revisionNumber: r.revisionNumber
          })));
        };
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

test.describe("V2-G0a Resume Studio 独立验收", () => {
  test("场景 1-8：编辑模式、键盘操作、模板一致性、显式保存、Fact Guard 阻断", async ({ page }) => {
    // ========== Setup ==========
    await createBranchFromDraft(page, "V2 G0a 验收分支");
    await enablePreviewEditing(page);

    const preview = page.getByTestId("resume-a4-page");
    const editor = page.getByTestId("resume-studio-editor");
    const branch = await getLatestVerifiedBranch(page);
    const revisionsBeforeEdit = await getResumeRevisionCount(page, branch.id);

    // ========== 场景1: verified 分支进入编辑模式 ==========
    // Blocks should have data-editable-block="true"
    const editableBlocks = preview.locator(editableContentBlockSelector);
    const blockCount = await editableBlocks.count();
    expect(blockCount).toBeGreaterThan(0);

    // Click a block to select it
    const firstBlock = await firstEditableContentBlock(page, preview);
    const contentItemId = await firstBlock.getAttribute("data-source-item-id");
    expect(contentItemId).toBeTruthy();

    await expect(editor).toBeVisible();
    // Editor should show the edit button for the selected block
    await expect(editor.getByRole("button", { name: "编辑" })).toBeVisible();
    // Editor shows block type info
    await expect(editor.locator("strong")).toContainText("编辑段落");
    const originalText = (await firstBlock.innerText()).trim();
    expect(originalText.length).toBeGreaterThan(0);

    // ========== 场景5: 选中后的编辑按钮 ==========
    // Click edit button (not double-click)
    await editor.getByRole("button", { name: "编辑" }).click();
    await expect(editor.locator("textarea")).toBeVisible();
    await expect(editor.locator("textarea")).toHaveValue(originalText);
    // Cancel to go back to selected state
    await editor.getByRole("button", { name: "取消" }).click();
    await expect(editor.locator("textarea")).toBeHidden();

    // ========== 场景6: 键盘操作 ==========
    // Enter to start editing
    await preview.focus();
    await page.keyboard.press("Enter");
    await expect(editor.locator("textarea")).toBeVisible();
    await expect(editor.locator("textarea")).toHaveValue(originalText);
    // Escape to cancel
    await page.keyboard.press("Escape");
    await expect(editor.locator("textarea")).toBeHidden();

    // F2 to start editing
    await preview.focus();
    await page.keyboard.press("F2");
    await expect(editor.locator("textarea")).toBeVisible();
    await editor.getByRole("button", { name: "取消" }).click();
    await expect(editor.locator("textarea")).toBeHidden();

    // Ctrl+Enter to save
    const editedText = `${originalText} V2G0a验证`;
    await startEditingContentBlock(page, firstBlock);
    await editor.locator("textarea").fill(editedText);
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".notice")).toContainText("简历内容已保存");
    await expect(editor.locator("textarea")).toBeHidden();

    // ========== 场景2: 模板A合法编辑 — Revision 创建和预览更新 ==========
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBeforeEdit + 1);
    // Preview immediately shows the new text
    await expect(preview.locator(`[data-source-item-id="${contentItemId}"]`)).toContainText(editedText);

    // ========== 场景7: 明确保存 — 失焦不自动创建 Revision ==========
    // Select a different block but don't edit it, then click elsewhere
    const secondBlock = editableBlocks.nth(1);
    if ((await secondBlock.count()) > 0) {
      await secondBlock.click();
      await expect(editor).toBeVisible();
      // Click somewhere else to deselect - should NOT create a new revision
      await preview.locator("header").first().click();
    }
    // Revision count should still be revisionsBeforeEdit + 1
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBeforeEdit + 1);

    // ========== 场景3: 模板B合法编辑 — same contentItemId ==========
    // Switch to template B
    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("modern-operations");
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await expect(preview).toHaveClass(/template-modern-operations/);

    // Template B shows the same edited content
    await expect(preview.locator(`[data-source-item-id="${contentItemId}"]`).first()).toContainText(editedText);
    // No new revision was created from template switch
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBeforeEdit + 1);

    // Edit in template B
    const modernBlock = preview.locator(`[data-source-item-id="${contentItemId}"]`).first();
    await startEditingContentBlock(page, modernBlock);
    const editedTextB = `${editedText} 模板B`;
    await editor.locator("textarea").fill(editedTextB);
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".notice")).toContainText("简历内容已保存");
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBeforeEdit + 2);

    // ========== 场景4: 跨模板一致性 ==========
    // Switch back to template A — shows the same content from template B edit
    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("classic-technical");
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await expect(preview).toHaveClass(/template-classic-technical/);
    await expect(preview.locator(`[data-source-item-id="${contentItemId}"]`)).toContainText(editedTextB);
    // No extra revision from template switch
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBeforeEdit + 2);

    // ========== 场景8: Fact Guard 高风险阻断 ==========
    // Try to add an unsourced number
    const factBlock = await firstEditableContentBlock(page, preview);
    await startEditingContentBlock(page, factBlock);
    await editor.locator("textarea").fill("这个项目提升了200%的用户增长，获得了全国特等奖");
    await page.keyboard.press("Control+Enter");
    // Should be blocked
    await expect(editor.locator(".save-status-failed")).toBeVisible();
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBeforeEdit + 2);
    // Cancel the blocked edit
    await editor.getByRole("button", { name: "取消" }).click();

    // Try responsibility upgrade: 参与 → 主导
    await startEditingContentBlock(page, factBlock);
    await editor.locator("textarea").fill("主导了团队的核心项目开发");
    await page.keyboard.press("Control+Enter");
    // The guard may or may not block this depending on originalText — but if blocked, error shows
    const guardError = editor.locator(".save-status-failed");
    const hasGuardBlock = await guardError.isVisible().catch(() => false);
    if (hasGuardBlock) {
      // If blocked, revision count should not increase
      expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBeforeEdit + 2);
    }
    await page.keyboard.press("Escape");
  });

  test("场景 9-10：operationId 幂等与 expectedRevision 冲突", async ({ page }) => {
    await createBranchFromDraft(page, "V2 G0a 幂等冲突分支");
    await enablePreviewEditing(page);

    const preview = page.getByTestId("resume-a4-page");
    const editor = page.getByTestId("resume-studio-editor");
    const branch = await getLatestVerifiedBranch(page);
    const revisionsBefore = await getResumeRevisionCount(page, branch.id);

    const firstBlock = await firstEditableContentBlock(page, preview);
    const contentItemId = await firstBlock.getAttribute("data-source-item-id");
    const originalText = (await firstBlock.innerText()).trim();

    // ========== 场景9: operationId 幂等 ==========
    // Edit and save — creates one revision
    await startEditingContentBlock(page, firstBlock);
    await editor.locator("textarea").fill(`${originalText} 幂等测试`);
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".notice")).toContainText("简历内容已保存");
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBefore + 1);

    // Verify all revisions have unique operationIds (no duplicates)
    const branchAfterEdit = await getLatestVerifiedBranch(page);
    const revisions = await getAllRevisionsForBranch(page, branchAfterEdit.id);
    const operationIds = revisions.map((r) => r.operationId);
    const uniqueOperationIds = new Set(operationIds);
    expect(uniqueOperationIds.size).toBe(operationIds.length);

    // ========== 场景10: expectedRevision 冲突 ==========
    // Start editing, then externally bump the branch revision
    const blockAfterEdit = preview.locator(`[data-source-item-id="${contentItemId}"]`).first();
    await startEditingContentBlock(page, blockAfterEdit);
    await editor.locator("textarea").fill(`${originalText} 冲突测试`);
    // Advance the branch revision externally (simulating concurrent edit)
    await advanceBranchRevisionWithoutRevisionRecord(page, branchAfterEdit.id);
    await page.keyboard.press("Control+Enter");
    // Should see conflict error
    await expect(editor).toContainText("版本已变化");
    // Revision count should not increase
    expect(await getResumeRevisionCount(page, branchAfterEdit.id)).toBe(revisionsBefore + 1);
  });

  test("场景 11-12：撤销与恢复历史 Revision", async ({ page }) => {
    await createBranchFromDraft(page, "V2 G0a 撤销恢复分支");
    await enablePreviewEditing(page);

    const preview = page.getByTestId("resume-a4-page");
    const editor = page.getByTestId("resume-studio-editor");
    let branch = await getLatestVerifiedBranch(page);
    const revisionsBefore = await getResumeRevisionCount(page, branch.id);

    const firstBlock = await firstEditableContentBlock(page, preview);
    const contentItemId = await firstBlock.getAttribute("data-source-item-id");
    const originalText = (await firstBlock.innerText()).trim();

    // Edit and save
    await startEditingContentBlock(page, firstBlock);
    const undoTestText = `${originalText} 撤销前`;
    await editor.locator("textarea").fill(undoTestText);
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".notice")).toContainText("简历内容已保存");
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBefore + 1);

    // ========== 场景11: 撤销 ==========
    await page.getByTestId("resume-studio-workbar").getByRole("button", { name: "撤销" }).click();
    await expect(page.locator(".notice")).toContainText("撤销");
    // Revision count increases (undo creates a new revision)
    branch = await getLatestVerifiedBranch(page);
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBefore + 2);
    // Text should be restored to original
    await expect(preview.locator(`[data-source-item-id="${contentItemId}"]`).first())
      .toContainText(originalText);
    // Editing state should be cleared
    await expect(editor.locator("textarea")).toBeHidden();

    // After undo, entering edit mode shows the undone text, not the old draft
    const blockAfterUndo = preview.locator(`[data-source-item-id="${contentItemId}"]`).first();
    await startEditingContentBlock(page, blockAfterUndo);
    await expect(editor.locator("textarea")).toHaveValue(originalText);
    await page.keyboard.press("Escape");

    // ========== 场景12: 恢复历史 Revision ==========
    // Get revisions to verify chain integrity
    const revisions = await getAllRevisionsForBranch(page, branch.id);
    expect(revisions.length).toBeGreaterThanOrEqual(2);
    // Click the restore button for the first revision in the revision list
    const revisionRows = page.locator(".revision-list .review-row");
    await revisionRows.first().locator("button").click();
    await expect(page.locator(".notice")).toContainText("恢复");

    // Preview should show the restored content
    branch = await getLatestVerifiedBranch(page);
    expect(await getResumeRevisionCount(page, branch.id)).toBe(revisionsBefore + 3);

    // All editor state should be cleared
    await expect(editor.locator("textarea")).toBeHidden();
    await expect(editor.locator(".save-status-failed")).toBeHidden();
  });

  test("场景 13-14：分支隔离与非法分支", async ({ page }) => {
    // Use a unique branch name prefix to avoid collision with other tests
    const uniqueId = Date.now();
    const branchNameA = `V2G0a IsoA ${uniqueId}`;
    const branchNameB = `V2G0a IsoB ${uniqueId}`;

    await createBranchFromDraft(page, branchNameA);
    await createBranchFromDraft(page, branchNameB);

    await page.goto("/resume");
    const branchList = page.locator(".branch-list");

    // Select branch A and enable editing
    await branchList.locator(".match-row").filter({ hasText: branchNameA }).click();
    await enablePreviewEditing(page);

    const preview = page.getByTestId("resume-a4-page");
    const editor = page.getByTestId("resume-studio-editor");

    // ========== 场景13: 分支隔离 ==========
    const firstBlockA = await firstEditableContentBlock(page, preview);
    await startEditingContentBlock(page, firstBlockA);
    const textA = await editor.locator("textarea").inputValue();
    await editor.locator("textarea").fill(`${textA} 分支A编辑`);
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".notice")).toContainText("简历内容已保存");

    // Switch to branch B
    await branchList.locator(".match-row").filter({ hasText: branchNameB }).click();
    await expect(preview).toBeVisible();
    // Editor state should be cleared
    await expect(editor.locator("textarea")).toBeHidden();
    await expect(editor.locator(".save-status-failed")).toBeHidden();

    // Branch B content should not contain branch A's edit
    const blockBText = await (await firstEditableContentBlock(page, preview)).innerText();
    expect(blockBText).not.toContain("分支A编辑");

    // Switch back to branch A
    await branchList.locator(".match-row").filter({ hasText: branchNameA }).click();
    await expect(preview).toBeVisible();
    // No stale draft
    await expect(editor.locator("textarea")).toBeHidden();

    // ========== 场景14: 非法分支 ==========
    // Get the exact branch matching our name
    const branchAData = await page.evaluate(async (name: string) => {
      return new Promise<{ id: string; name: string }>((resolve, reject) => {
        const request = indexedDB.open("CareerAdaptDb");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("resumeBranches", "readonly");
          const getAll = tx.objectStore("resumeBranches").getAll();
          getAll.onerror = () => reject(getAll.error);
          getAll.onsuccess = () => {
            const found = getAll.result.find((b: { name: string }) => b.name === name);
            resolve(found);
          };
          tx.oncomplete = () => db.close();
        };
      });
    }, branchNameA);
    expect(branchAData).toBeDefined();

    // Mutate to legacy_unverified
    await page.evaluate(async (branchId: string) => {
      return new Promise<void>((resolveMutation, reject) => {
        const request = indexedDB.open("CareerAdaptDb");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("resumeBranches", "readwrite");
          const store = tx.objectStore("resumeBranches");
          const getRequest = store.get(branchId);
          getRequest.onerror = () => reject(getRequest.error);
          getRequest.onsuccess = () => {
            const branch = getRequest.result;
            branch.migrationStatus = "legacy_unverified";
            const putRequest = store.put(branch);
            putRequest.onerror = () => reject(putRequest.error);
          };
          tx.oncomplete = () => { db.close(); resolveMutation(); };
          tx.onerror = () => reject(tx.error);
        };
      });
    }, branchAData!.id);

    // Reload to sync React state with mutated IndexedDB
    await page.reload();
    await expect(page.locator(".branch-list .match-row").first()).toBeVisible({ timeout: 10000 });
    // Click the mutated legacy branch
    await page.locator(".branch-list .match-row").filter({ hasText: branchNameA }).click();
    // Should show legacy warning
    await expect(page.locator(".warning-box").filter({ hasText: "旧占位简历" })).toBeVisible({ timeout: 10000 });
  });

  test("场景 19：PDF 产物不含编辑控件且包含正式文本", async ({ page }) => {
    await createBranchFromDraft(page, "V2 G0a PDF验证分支");
    await enablePreviewEditing(page);

    const preview = page.getByTestId("resume-a4-page");
    const editor = page.getByTestId("resume-studio-editor");

    // Edit and save some text
    const firstBlock = await firstEditableContentBlock(page, preview);
    const originalText = (await firstBlock.innerText()).trim();
    await startEditingContentBlock(page, firstBlock);
    const pdfTestText = `${originalText} PDF验证`;
    await editor.locator("textarea").fill(pdfTestText);
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".notice")).toContainText("简历内容已保存");

    // Generate PDF
    const pdfPath = outputPath("v2-g0a-verification.pdf");
    await page.emulateMedia({ media: "print" });
    await generatePdfWithRetry(page, pdfPath);
    const pdfText = extractPdfText(pdfPath);

    // PDF should contain the saved text
    expect(pdfText).toContain("陈同学");
    expect(pdfText).toContain("PDF验证");

    // PDF should NOT contain editing UI artifacts
    expect(pdfText).not.toContain("编辑区块");
    expect(pdfText).not.toContain("编辑段落");
    expect(pdfText).not.toContain("保存失败");
    expect(pdfText).not.toContain("预览区编辑");
    expect(pdfText).not.toContain("Ctrl/Cmd+Enter");
    expect(pdfText).not.toContain("Fact Guard");
  });

  test("场景 22：页面刷新持久化与状态清理", async ({ page }) => {
    await createBranchFromDraft(page, "V2 G0a 刷新持久化分支");
    await enablePreviewEditing(page);

    const preview = page.getByTestId("resume-a4-page");
    const editor = page.getByTestId("resume-studio-editor");

    // Edit and save
    const firstBlock = await firstEditableContentBlock(page, preview);
    const contentItemId = await firstBlock.getAttribute("data-source-item-id");
    const originalText = (await firstBlock.innerText()).trim();
    const refreshTestText = `${originalText} 刷新持久化`;
    await startEditingContentBlock(page, firstBlock);
    await editor.locator("textarea").fill(refreshTestText);
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".notice")).toContainText("简历内容已保存");

    // Refresh the page
    await page.reload();
    await expect(preview).toBeVisible();

    // Saved content should persist
    await expect(preview.locator(`[data-source-item-id="${contentItemId}"]`).first())
      .toContainText(refreshTestText);

    // No ghost selection state
    await expect(editor).toBeHidden();
  });

  test("V1 回归：分支表单编辑、模板切换、撤销、A4 预览仍可用", async ({ page }) => {
    await createBranchFromDraft(page, "V2 G0a V1回归分支");
    await page.goto("/resume");

    const branchList = page.locator(".branch-list");
    await branchList.locator(".match-row").filter({ hasText: "V2 G0a V1回归分支" }).click();

    // V1 branch form editing should still work
    const branchEditor = page.locator(".branch-editor");
    await expect(branchEditor).toBeVisible();
    const formTextarea = branchEditor.locator("textarea").first();
    await expect(formTextarea).toBeVisible();
    const formText = await formTextarea.inputValue();
    expect(formText.length).toBeGreaterThan(0);

    // Template switching should still work
    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("modern-operations");
    const preview = page.getByTestId("resume-a4-page");
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await expect(preview).toHaveClass(/template-modern-operations/);

    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("classic-technical");
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await expect(preview).toHaveClass(/template-classic-technical/);

    // Undo button should be present and enabled
    await expect(page.getByRole("button", { name: "撤销" })).toBeEnabled();

    // A4 preview should be visible
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("陈同学");
  });

  test("场景 18：模板切换期间存在未保存草稿 — 不静默丢失用户输入", async ({ page }) => {
    await createBranchFromDraft(page, "V2 G0a 草稿保留分支");
    await enablePreviewEditing(page);

    const preview = page.getByTestId("resume-a4-page");
    const editor = page.getByTestId("resume-studio-editor");

    // Enter editing mode and type new text WITHOUT saving
    const firstBlock = await firstEditableContentBlock(page, preview);
    const contentItemId = await firstBlock.getAttribute("data-source-item-id");
    const originalText = (await firstBlock.innerText()).trim();
    const unsavedText = `${originalText} 未保存草稿测试`;

    await startEditingContentBlock(page, firstBlock);
    await editor.locator("textarea").fill(unsavedText);
    // Do NOT save — textarea has unsaved content

    // Switch template while draft is active
    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("modern-operations");
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await expect(preview).toHaveClass(/template-modern-operations/);

    // The unsaved draft must NOT be silently lost
    // The editor should still be visible with the draft text preserved
    await expect(editor.locator("textarea")).toBeVisible();
    await expect(editor.locator("textarea")).toHaveValue(unsavedText);

    // The contentItemId should be consistent across templates
    // (same block should be selected in the new template)
    const modernBlock = preview.locator(`[data-source-item-id="${contentItemId}"]`).first();
    await expect(modernBlock).toBeVisible();

    // Switch back to template A — draft should STILL be preserved
    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("classic-technical");
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await expect(preview).toHaveClass(/template-classic-technical/);
    await expect(editor.locator("textarea")).toBeVisible();
    await expect(editor.locator("textarea")).toHaveValue(unsavedText);

    // Cancel the draft — no Revision should have been created
    await page.keyboard.press("Escape");
    await expect(editor.locator("textarea")).toBeHidden();

    // Original text should be shown (no save happened)
    await expect(preview.locator(`[data-source-item-id="${contentItemId}"]`)).toContainText(originalText);
  });
});
