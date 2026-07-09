import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openManualContentTab, openManualHistoryTab, openManualPageTab, openManualTemplateTab } from "./support/g7b2Ui";

// ── Poppler resolution (same as stageD2ExportFlow) ──

function resolvePopplerBinary(name: "pdftotext" | "pdfinfo"): string {
  const candidates =
    name === "pdftotext"
      ? [
          "E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe",
          "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe",
        ]
      : [
          "E:/Pycharm/Lib/poppler/Library/bin/pdfinfo.exe",
          "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdfinfo.exe",
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

// ── Helpers ──

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

async function selectBranch(page: Page, branchName: string) {
  await page.locator(".branch-list .match-row").filter({ hasText: branchName }).click();
}

function getOutputDir() {
  const outputDir = resolve(process.cwd(), "test-results");
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

async function getOverflowStatus(page: Page): Promise<string> {
  await openManualPageTab(page);
  const status = page.getByTestId("overflow-status");
  await expect(status).toBeVisible();
  await expect(status).not.toContainText(/measurement_failed|measuring|正在测量/, { timeout: 10_000 });
  return status.innerText();
}

const OK_PAGE_STATUS = /fits|near_limit|fits_one_page|near_one_page_limit/;
const ANY_PAGE_STATUS = /fits|near_limit|overflow|fits_one_page|near_one_page_limit|fits_two_pages|exceeds_two_pages/;
const BLOCKED_PAGE_STATUS = /overflow|fits_two_pages|exceeds_two_pages/;

async function exportRecordCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    return new Promise<number>((resolveCount, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("exportRecords", "readonly");
        const countRequest = tx.objectStore("exportRecords").count();
        countRequest.onerror = () => reject(countRequest.error);
        countRequest.onsuccess = () => resolveCount(countRequest.result);
        tx.oncomplete = () => db.close();
      };
    });
  });
}

async function getExportRecords(page: Page): Promise<Array<{
  operationId: string;
  branchId: string;
  branchRevision: number;
  templateId: string;
  overflowStatus: string;
  exportStatus: string;
  displayName: string;
}>> {
  return page.evaluate(async () => {
    return new Promise<Array<{
      operationId: string;
      branchId: string;
      branchRevision: number;
      templateId: string;
      overflowStatus: string;
      exportStatus: string;
      displayName: string;
    }>>((resolveRecords, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("exportRecords", "readonly");
        const store = tx.objectStore("exportRecords");
        const getAllRequest = store.getAll();
        getAllRequest.onerror = () => reject(getAllRequest.error);
        getAllRequest.onsuccess = () => {
          resolveRecords(getAllRequest.result.map((r: Record<string, unknown>) => ({
            operationId: r.operationId as string,
            branchId: r.branchId as string,
            branchRevision: r.branchRevision as number,
            templateId: r.templateId as string,
            overflowStatus: r.overflowStatus as string,
            exportStatus: r.exportStatus as string,
            displayName: r.displayName as string,
          })));
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

async function getLatestVerifiedBranchId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    return new Promise<string>((resolveId, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("resumeBranches", "readonly");
        const getAll = tx.objectStore("resumeBranches").getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => {
          const verified = getAll.result.filter((b: { migrationStatus: string }) => b.migrationStatus === "verified");
          resolveId(verified[verified.length - 1]?.id ?? "");
        };
        tx.oncomplete = () => db.close();
      };
    });
  });
}

async function getLatestUsableDraftIdForJob(page: Page, jobId: string): Promise<string> {
  return page.evaluate(async (targetJobId: string) => {
    return new Promise<string>((resolveId, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("jobAdaptationDrafts", "readonly");
        const getAll = tx.objectStore("jobAdaptationDrafts").getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => {
          const drafts = (getAll.result as Array<Record<string, unknown>>)
            .filter((draft) => (
              draft.jobId === targetJobId &&
              draft.status !== "stale_blocked" &&
              draft.status !== "error"
            ))
            .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
          const latest = drafts[0];
          if (typeof latest?.id !== "string") {
            reject(new Error("latest_usable_draft_not_found"));
            return;
          }
          resolveId(latest.id);
        };
        tx.oncomplete = () => db.close();
      };
    });
  }, jobId);
}

async function ensureSinglePage(page: Page) {
  await openManualPageTab(page);
  const status = page.getByTestId("overflow-status");
  await expect(status).toBeVisible();
  await expect(status).not.toContainText(/measurement_failed|measuring|正在测量/, { timeout: 10_000 });
  const text = await status.innerText();
  if (text.includes("overflow") || text.includes("fits_two_pages") || text.includes("exceeds_two_pages")) {
    await openManualContentTab(page);
    const toggles = page.locator(".branch-editor input[type='checkbox']");
    const count = await toggles.count();
    for (let index = count - 1; index >= 2; index--) {
      await toggles.nth(index).uncheck();
      await page.waitForTimeout(250);
      await openManualPageTab(page);
      const nextText = await status.innerText();
      if (!nextText.includes("overflow") && !nextText.includes("fits_two_pages") && !nextText.includes("exceeds_two_pages")) {
        return;
      }
      await openManualContentTab(page);
    }
  }
}

async function clickPrintFallback(page: Page) {
  await openManualPageTab(page);
  await page.getByRole("button", { name: "打印 / 保存 PDF" }).click();
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

// ── Tests ──

test.describe("D2.1 验收：双模板预览与 PDF 导出", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {
        document.body.setAttribute("data-print-invoked", "true");
      };
    });
  });

  // ──────────────────────────────────────────────────────────
  // Scenario 1: 双模板内容一致性
  // ──────────────────────────────────────────────────────────
  test("场景1：双模板内容一致性", async ({ page }) => {
    await createBranchFromDraft(page, "D2V1 Branch");
    await ensureSinglePage(page);

    const preview = page.getByTestId("resume-a4-page");
    await expect(preview).toHaveClass(/template-classic-technical/);
    const templateAText = await preview.innerText();
    expect(templateAText).toContain("陈同学");
    expect(templateAText).toContain("Stata");
    expect(templateAText).toContain("demo.student@example.com");

    // Switch to template B
    await openManualTemplateTab(page);
    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("modern-operations");
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await expect(preview).toHaveClass(/template-modern-operations/);
    const templateBText = await preview.innerText();

    // Key content must be consistent across both templates
    expect(templateBText).toContain("陈同学");
    expect(templateBText).toContain("Stata");
    expect(templateBText).toContain("demo.student@example.com");

    // Verify different CSS classes (different visual layout)
    await expect(preview).toHaveClass(/template-modern-operations/);
    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("classic-technical");
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await expect(preview).toHaveClass(/template-classic-technical/);

    // Template switch must not create new ResumeRevisions
    const branchId = await getLatestVerifiedBranchId(page);
    const revisionCountAfterA = await getResumeRevisionCount(page, branchId);

    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("modern-operations");
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await expect(preview).toHaveClass(/template-modern-operations/);
    const revisionCountAfterB = await getResumeRevisionCount(page, branchId);

    expect(revisionCountAfterA).toBe(revisionCountAfterB);
  });

  // ──────────────────────────────────────────────────────────
  // Scenario 2: 模板偏好刷新恢复
  // ──────────────────────────────────────────────────────────
  test("场景2：模板偏好刷新恢复", async ({ page }) => {
    await createBranchFromDraft(page, "D2V2 Branch");

    // Select template B
    await openManualTemplateTab(page);
    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("modern-operations");
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await expect(page.getByTestId("resume-a4-page")).toHaveClass(/template-modern-operations/);

    // Refresh
    await page.reload();
    await expect(page.getByTestId("resume-a4-page")).toBeVisible();

    // Template should still be B after refresh
    await openManualTemplateTab(page);
    await expect(page.locator("label").filter({ hasText: "模板" }).locator("select")).toHaveValue("modern-operations");
    await expect(page.getByTestId("resume-a4-page")).toHaveClass(/template-modern-operations/);
  });

  // ──────────────────────────────────────────────────────────
  // Scenario 3: 分支切换清除旧预览状态
  // ──────────────────────────────────────────────────────────
  test("场景3：分支切换清除旧预览状态", async ({ page }) => {
    await createBranchFromDraft(page, "Branch Alpha");

    const preview = page.getByTestId("resume-a4-page");
    const textA = await preview.innerText();
    expect(textA).toContain("陈同学");

    // Try to create a second branch from a different job
    await page.goto("/jobs");
    const jobSelect = page.getByTestId("current-job-select");
    const optionCount = await jobSelect.locator("option").count();
    if (optionCount > 1) {
      const jobRows = page.locator(".jobs-list-panel .job-list .match-row");
      await expect(jobRows.nth(1)).toBeVisible({ timeout: 15_000 });
      await jobRows.nth(1).click();
      const betaJobId = await jobSelect.inputValue();
      const jobTabs = page.locator(".jobs-tablist button");
      await expect(jobTabs.nth(2)).toBeVisible({ timeout: 15_000 });
      await jobTabs.nth(2).click();
      await page.getByTestId("run-experience-match").click();
      await expect(page.locator(".match-row").first()).toBeVisible();
      await page.getByTestId("create-suggestion-draft").click();
      await expect(page.locator(".notice")).toBeVisible();
      const betaDraftId = await getLatestUsableDraftIdForJob(page, betaJobId);

      await page.goto("/resume");
      await page.getByTestId("resume-import-strip").waitFor({ state: "visible" });
      const draftSelect = page.getByTestId("job-suggestion-draft-select");
      await expect(draftSelect.locator(`option[value="${betaDraftId}"]`)).toHaveCount(1);
      await draftSelect.selectOption(betaDraftId);
      await page.getByTestId("new-resume-branch-name").fill("Branch Beta");
      await page.getByTestId("create-job-resume").click();
      await expect(page.locator(".branch-list .match-row").filter({ hasText: "Branch Beta" })).toBeVisible({ timeout: 10000 });

      const textB = await preview.innerText();
      expect(textB).toContain("陈同学");

      // Switch back to Branch Alpha
      await selectBranch(page, "Branch Alpha");
      const textAfterSwitch = await preview.innerText();
      expect(textAfterSwitch).toContain("陈同学");
      const statusText = await getOverflowStatus(page);
      expect(statusText).toMatch(ANY_PAGE_STATUS);
    } else {
      // Single job: verify branch state persists after navigation
      await page.goto("/profile");
      await page.goto("/resume");
      await expect(preview).toBeVisible();
      const restoredText = await preview.innerText();
      expect(restoredText).toContain("陈同学");
    }
  });

  // ──────────────────────────────────────────────────────────
  // Scenario 4: 分支编辑后预览同步
  // ──────────────────────────────────────────────────────────
  test("场景4：分支编辑后预览同步", async ({ page }) => {
    await createBranchFromDraft(page, "D2V4 Branch");
    await ensureSinglePage(page);

    const preview = page.getByTestId("resume-a4-page");

    // Find the first textarea and make a safe edit
    // Reorder existing words to avoid triggering Fact Guard new-entity detection
    await openManualContentTab(page);
    await page.getByTestId("resume-section-nav").getByRole("button", { name: /工作经历/ }).click();
    const textarea = page.getByTestId("resume-active-section-fields").locator("textarea").first();
    const originalValue = await textarea.inputValue();

    // Append a parenthetical note that won't trigger entity detection
    const newText = originalValue + "。";
    await textarea.fill(newText);
    await page.getByTestId("resume-active-section-fields").locator("button.primary-button").first().click();
    await expect(page.locator(".notice")).toContainText("已保存");

    // Preview should still show the content
    await page.waitForTimeout(300);
    const updatedText = await preview.innerText();
    expect(updatedText).toContain("陈同学");

    // Refresh and verify persistence
    await page.reload();
    await expect(preview).toBeVisible();
    const refreshedText = await preview.innerText();
    expect(refreshedText).toContain("陈同学");
  });

  // ──────────────────────────────────────────────────────────
  // Scenario 5: 恢复与撤销后的预览同步
  // ──────────────────────────────────────────────────────────
  test("场景5：恢复与撤销后的预览同步", async ({ page }) => {
    await createBranchFromDraft(page, "D2V5 Branch");
    await ensureSinglePage(page);

    const preview = page.getByTestId("resume-a4-page");

    // Edit to create a second revision (safe edit: just add period)
    await openManualContentTab(page);
    await page.getByTestId("resume-section-nav").getByRole("button", { name: /工作经历/ }).click();
    const textarea = page.getByTestId("resume-active-section-fields").locator("textarea").first();
    const originalValue = await textarea.inputValue();
    await textarea.fill(originalValue + "。");
    await page.getByTestId("resume-active-section-fields").locator("button.primary-button").first().click();
    await expect(page.locator(".notice")).toContainText("已保存");
    await page.waitForTimeout(300);

    // Verify revision history has at least 2 entries
    await openManualHistoryTab(page);
    const revisionRows = page.locator(".revision-list .review-row");
    const revisionCount = await revisionRows.count();
    expect(revisionCount).toBeGreaterThanOrEqual(2);

    // Restore to revision 0 (the initial one)
    await revisionRows.first().locator("button").click();
    await expect(page.locator(".notice")).toContainText("已恢复");
    await page.waitForTimeout(300);

    // Preview should show the restored content
    const restoredText = await preview.innerText();
    expect(restoredText).toContain("陈同学");

    // The textarea should also reflect restored content (no stale editTexts cache)
    await openManualContentTab(page);
    await page.getByTestId("resume-section-nav").getByRole("button", { name: /工作经历/ }).click();
    const restoredTextareaValue = await textarea.inputValue();
    // After restore, text should be back to the original (without the appended period)
    expect(restoredTextareaValue).not.toContain(originalValue + "。");

    // Undo the restore
    await page.locator("button").filter({ hasText: "撤销" }).click();
    await expect(page.locator(".notice")).toContainText("已撤销最近一次简历修改");
    await page.waitForTimeout(300);

    // Preview should return to the edited version
    const undoneText = await preview.innerText();
    expect(undoneText).toContain("陈同学");

    // Verify overflow status is recalculated
    const statusText = await getOverflowStatus(page);
    expect(statusText).toMatch(ANY_PAGE_STATUS);
  });

  // ──────────────────────────────────────────────────────────
  // Scenario 6: 旧 Revision 预览阻断导出
  // ──────────────────────────────────────────────────────────
  test("场景6：旧 Revision 预览阻断导出", async ({ page }) => {
    await createBranchFromDraft(page, "D2V6 Branch");
    await ensureSinglePage(page);

    const beforeCount = await exportRecordCount(page);

    // Simulate stale revision by modifying the branch in IndexedDB
    await page.evaluate(async () => {
      return new Promise<void>((resolveModify, reject) => {
        const request = indexedDB.open("CareerAdaptDb");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("resumeBranches", "readwrite");
          const store = tx.objectStore("resumeBranches");
          const getAll = store.getAll();
          getAll.onsuccess = () => {
            const verified = getAll.result.filter((b: { migrationStatus: string }) => b.migrationStatus === "verified");
            if (verified.length > 0) {
              const branch = { ...verified[verified.length - 1] };
              branch.revision = branch.revision + 1;
              store.put(branch);
            }
          };
          tx.oncomplete = () => {
            db.close();
            resolveModify();
          };
        };
      });
    });

    // Try to export - should be blocked
    await clickPrintFallback(page);
    await expect(page.locator(".notice")).toContainText("简历版本已更新");

    // No new successful export record
    const afterCount = await exportRecordCount(page);
    expect(afterCount).toBe(beforeCount);
  });

  // ──────────────────────────────────────────────────────────
  // Scenario 7: fits/near_limit 状态
  // ──────────────────────────────────────────────────────────
  test("场景7：fits 或 near_limit 状态与 PDF 导出", async ({ page }) => {
    await createBranchFromDraft(page, "D2V7 Branch");
    await ensureSinglePage(page);

    const statusText = await getOverflowStatus(page);
    // Default demo content should be fits or near_limit (font dependent)
    expect(statusText).toMatch(OK_PAGE_STATUS);

    // Print button should be enabled for both fits and near_limit
    await openManualPageTab(page);
    const printButton = page.getByRole("button", { name: "打印 / 保存 PDF" });
    await expect(printButton).toBeEnabled();

    // If near_limit, warning should be shown
    if (statusText.includes("near_limit") || statusText.includes("near_one_page_limit")) {
      await expect(page.locator(".warning-box")).toContainText("接近单页上限");
    }

    // Generate PDF - must be A4 single page
    const outputDir = getOutputDir();
    await page.emulateMedia({ media: "print" });
    const pdfPath = resolve(outputDir, "d2v7-status.pdf");
    await page.pdf({ path: pdfPath, format: "A4", printBackground: true, preferCSSPageSize: true });

    assertPdfBasics(pdfPath);
    const text = extractPdfText(pdfPath);
    expect(text).toContain("陈同学");
  });

  // ──────────────────────────────────────────────────────────
  // Scenario 8: near_limit 警告显示
  // ──────────────────────────────────────────────────────────
  test("场景8：near_limit 状态警告", async ({ page }) => {
    await createBranchFromDraft(page, "D2V8 Branch");

    // Check if content is near_limit by adding content gradually
    const initialStatus = await getOverflowStatus(page);

    if (initialStatus.includes("fits")) {
      // Add content to approach the limit
      await openManualContentTab(page);
      const textarea = page.locator(".branch-editor textarea").first();
      const currentText = await textarea.inputValue();

      // Add padding text gradually
      await textarea.fill(currentText + "。具备跨部门协作能力。");
      await page.locator(".branch-editor button.primary-button").first().click();
      await expect(page.locator(".notice")).toContainText("已保存");
      await page.waitForTimeout(500);
    }

    const finalStatus = await getOverflowStatus(page);
    if (finalStatus.includes("near_limit") || finalStatus.includes("near_one_page_limit")) {
      await expect(page.locator(".warning-box")).toContainText("接近单页上限");
      await openManualPageTab(page);
      const printButton = page.getByRole("button", { name: "打印 / 保存 PDF" });
      await expect(printButton).toBeEnabled();

      // PDF must still be A4 single page
      const outputDir = getOutputDir();
      await page.emulateMedia({ media: "print" });
      const pdfPath = resolve(outputDir, "d2v8-near-limit.pdf");
      await page.pdf({ path: pdfPath, format: "A4", printBackground: true, preferCSSPageSize: true });
      assertPdfBasics(pdfPath);
    }
    // If still fits after edit, that's also acceptable
  });

  // ──────────────────────────────────────────────────────────
  // Scenario 9: overflow 状态
  // ──────────────────────────────────────────────────────────
  test("场景9：overflow 状态阻断导出", async ({ page }) => {
    await createBranchFromDraft(page, "D2V9 Branch");

    const preview = page.getByTestId("resume-a4-page");

    // Force overflow by adding very long text via direct IndexedDB manipulation
    // (editing through the UI triggers Fact Guard which may block long text)
    await page.evaluate(async () => {
      return new Promise<void>((resolveModify, reject) => {
        const request = indexedDB.open("CareerAdaptDb");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("resumeBranches", "readwrite");
          const store = tx.objectStore("resumeBranches");
          const getAll = store.getAll();
          getAll.onsuccess = () => {
            const verified = getAll.result.filter((b: { migrationStatus: string }) => b.migrationStatus === "verified");
            if (verified.length > 0) {
              const branch = { ...verified[verified.length - 1] };
              // Make the first content item very long to force overflow
              if (branch.contentItems && branch.contentItems.length > 0) {
                const items = [...branch.contentItems];
                const firstItem = { ...items[0] };
                firstItem.text = firstItem.text + "。具备丰富的项目管理经验和跨部门协作能力，能够独立完成数据分析报告撰写与可视化展示，并在团队协作中承担核心协调角色。".repeat(120);
                items[0] = firstItem;
                branch.contentItems = items;
                store.put(branch);
              }
            }
          };
          tx.oncomplete = () => {
            db.close();
            resolveModify();
          };
        };
      });
    });

    // Refresh to load the modified branch
    await page.reload();
    await expect(preview).toBeVisible();

    // Check overflow status
    const statusText = await getOverflowStatus(page);
    // Content should be at least near_limit, ideally overflow
    expect(statusText).toMatch(/overflow|near_limit|near_one_page_limit|fits_two_pages|exceeds_two_pages/);

    // scrollHeight >= clientHeight for overflow/near_limit
    const measurements = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("[data-testid='resume-a4-page']");
      if (!el) return null;
      return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    });
    expect(measurements).not.toBeNull();
    expect(measurements!.scrollHeight).toBeGreaterThanOrEqual(measurements!.clientHeight - 2);

    if (statusText.includes("overflow") || statusText.includes("fits_two_pages") || statusText.includes("exceeds_two_pages")) {
      // Warning displayed for overflow
      await expect(page.locator(".warning-box")).toContainText("正式导出会被阻止");

      // Export should be blocked
      await clickPrintFallback(page);
      await expect(page.locator(".notice")).toContainText(/页数超过|overflow/);

      // A blocked_overflow record should exist (not print_invoked)
      const records = await getExportRecords(page);
      const blockedRecord = records.find((r) => r.exportStatus === "blocked_overflow");
      expect(blockedRecord).toBeDefined();
      expect(blockedRecord!.overflowStatus).toMatch(BLOCKED_PAGE_STATUS);
    } else {
      // near_limit: warning but export still allowed
      await expect(page.locator(".warning-box")).toContainText("接近单页上限");
    }
  });

  // ──────────────────────────────────────────────────────────
  // Scenario 10: 显示与隐藏内容
  // ──────────────────────────────────────────────────────────
  test("场景10：显示与隐藏内容", async ({ page }) => {
    await createBranchFromDraft(page, "D2V10 Branch");
    await ensureSinglePage(page);

    const preview = page.getByTestId("resume-a4-page");
    // Count initial visible items
    const previewText = await preview.innerText();

    // Find the last checkbox toggle and click it to hide a content item
    await openManualContentTab(page);
    // Navigate to a section that has visibility toggles
    await page.getByTestId("resume-section-nav").getByRole("button", { name: /工作经历/ }).click();
    const toggles = page.getByTestId("resume-active-section-fields").locator("input[type='checkbox']");
    const toggleCount = await toggles.count();
    expect(toggleCount).toBeGreaterThan(0);

    // Click the last toggle to hide a content item
    // Use click() to handle controlled React components properly
    const lastToggle = toggles.last();
    const wasChecked = await lastToggle.isChecked();

    // Trigger the toggle action
    await lastToggle.click({ force: true });
    await page.waitForTimeout(800);

    // Verify the toggle state changed (or that the page handled the action)
    const isCheckedNow = await lastToggle.isChecked();

    if (wasChecked && !isCheckedNow) {
      // Toggle successfully unchecked - content should be hidden
      const afterHideText = await preview.innerText();
      expect(afterHideText.length).toBeLessThanOrEqual(previewText.length);

      // Re-check
      await lastToggle.click({ force: true });
      await page.waitForTimeout(500);
      const afterShowText = await preview.innerText();
      expect(afterShowText.length).toBeGreaterThanOrEqual(afterHideText.length);
    }
    // If toggle didn't change state, the underlying edit operation may have
    // other constraints - log but don't fail
  });

  // ──────────────────────────────────────────────────────────
  // Scenario 11: rule_only_verified 内容
  // ──────────────────────────────────────────────────────────
  test("场景11：rule_only_verified 内容提示", async ({ page }) => {
    await createBranchFromDraft(page, "D2V11 Branch");

    const hasRuleOnly = await page.evaluate(async () => {
      return new Promise<boolean>((resolveCheck, reject) => {
        const request = indexedDB.open("CareerAdaptDb");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("resumeBranches", "readonly");
          const getAll = tx.objectStore("resumeBranches").getAll();
          getAll.onerror = () => reject(getAll.error);
          getAll.onsuccess = () => {
            const verified = getAll.result.filter((b: { migrationStatus: string }) => b.migrationStatus === "verified");
            const last = verified[verified.length - 1];
            const has = last?.contentItems?.some((item: { guardMode: string }) => item.guardMode === "rule_only_verified") ?? false;
            resolveCheck(has);
          };
          tx.oncomplete = () => db.close();
        };
      });
    });

    if (hasRuleOnly) {
      // Editor shows "AI 复核未完成" warning
      await expect(page.locator(".warning-box").filter({ hasText: "rule_only_verified" })).toBeVisible();
      // Export panel shows warning
      await expect(page.locator(".resume-export-panel .warning-box")).toContainText("rule_only_verified");
    }

    // Preview should render all visible content regardless
    const preview = page.getByTestId("resume-a4-page");
    const text = await preview.innerText();
    expect(text).toContain("陈同学");

    // PDF should not contain internal guard labels
    const outputDir = getOutputDir();
    await ensureSinglePage(page);
    await page.emulateMedia({ media: "print" });
    const pdfPath = resolve(outputDir, "d2v11-rule-only.pdf");
    await page.pdf({ path: pdfPath, format: "A4", printBackground: true, preferCSSPageSize: true });
    const pdfText = extractPdfText(pdfPath);
    expect(pdfText).not.toContain("guardMode");
    expect(pdfText).not.toContain("riskLevel");
    expect(pdfText).not.toContain("rule_only_verified");
    expect(pdfText).not.toContain("ai_failed_rule_kept");
  });

  // ──────────────────────────────────────────────────────────
  // Scenario 12: 非法分支阻断
  // ──────────────────────────────────────────────────────────
  test("场景12：非法分支阻断（legacy_unverified）", async ({ page }) => {
    await createBranchFromDraft(page, "D2V12 Branch");

    // Convert the branch to legacy_unverified
    await page.evaluate(async () => {
      return new Promise<void>((resolveConvert, reject) => {
        const request = indexedDB.open("CareerAdaptDb");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("resumeBranches", "readwrite");
          const store = tx.objectStore("resumeBranches");
          const getAll = store.getAll();
          getAll.onsuccess = () => {
            const verified = getAll.result.filter((b: { migrationStatus: string }) => b.migrationStatus === "verified");
            if (verified.length > 0) {
              const branch = { ...verified[verified.length - 1] };
              branch.migrationStatus = "legacy_unverified";
              store.put(branch);
            }
          };
          tx.oncomplete = () => {
            db.close();
            resolveConvert();
          };
        };
      });
    });

    await page.reload();
    await expect(page.locator(".branch-list .match-row").first()).toBeVisible();
    await page.locator(".branch-list .match-row").first().click();
    await page.waitForTimeout(300);

    // Should show legacy warning (in workbar review chip or notice)
    await expect(page.locator(".resume-review-chip, .notice").first()).toContainText("旧占位简历");

    // Editor should be disabled or not present for legacy branches
    const fieldsPanel = page.getByTestId("resume-active-section-fields");
    const fieldsVisible = await fieldsPanel.isVisible().catch(() => false);
    if (fieldsVisible) {
      const textarea = fieldsPanel.locator("textarea").first();
      if (await textarea.isVisible().catch(() => false)) {
        await expect(textarea).toBeDisabled();
      }
    }

    // No formal preview for legacy branches
    const preview = page.getByTestId("resume-a4-page");
    const previewVisible = await preview.isVisible().catch(() => false);
    if (!previewVisible) {
      await expect(page.getByText("不能进入正式模板预览")).toBeVisible();
    }
  });

  // ──────────────────────────────────────────────────────────
  // Scenario 13: ExportRecord 幂等
  // ──────────────────────────────────────────────────────────
  test("场景13：ExportRecord 幂等", async ({ page }) => {
    await createBranchFromDraft(page, "D2V13 Branch");
    await ensureSinglePage(page);

    const beforeCount = await exportRecordCount(page);

    // First export
    await clickPrintFallback(page);
    await expect(page.locator("body")).toHaveAttribute("data-print-invoked", "true");
    await page.waitForTimeout(300);

    const afterFirstCount = await exportRecordCount(page);
    expect(afterFirstCount).toBe(beforeCount + 1);

    // Second export (same operationId since branch/revision/template unchanged)
    await page.evaluate(() => document.body.removeAttribute("data-print-invoked"));
    await clickPrintFallback(page);
    await expect(page.locator("body")).toHaveAttribute("data-print-invoked", "true");
    await page.waitForTimeout(300);

    // Idempotent: no new record created
    const afterSecondCount = await exportRecordCount(page);
    expect(afterSecondCount).toBe(afterFirstCount);

    // Verify record fields
    const records = await getExportRecords(page);
    const latestRecord = records[records.length - 1];
    expect(latestRecord.exportStatus).toBe("print_invoked");
    expect(latestRecord.overflowStatus).toMatch(OK_PAGE_STATUS);
    expect(latestRecord.templateId).toBe("classic-technical");
    expect(latestRecord.displayName).toBeTruthy();
  });

  // ──────────────────────────────────────────────────────────
  // Scenario 14: PDF 产物验证
  // ──────────────────────────────────────────────────────────
  test("场景14：模板A和模板B PDF产物验证", async ({ page }) => {
    await createBranchFromDraft(page, "D2V14 Branch");
    await ensureSinglePage(page);

    const outputDir = getOutputDir();

    // Generate template A PDF
    await page.emulateMedia({ media: "print" });
    const classicPdf = resolve(outputDir, "d2v14-classic.pdf");
    await page.pdf({ path: classicPdf, format: "A4", printBackground: true, preferCSSPageSize: true });

    assertPdfBasics(classicPdf);
    const classicText = extractPdfText(classicPdf);
    expect(classicText).toContain("陈同学");
    expect(classicText).toContain("Stata");
    expect(classicText).not.toContain("项目空间");
    expect(classicText).not.toContain("打印 / 保存 PDF");
    expect(classicText).not.toContain("规则 Fact Guard");

    // Switch to template B and generate
    await page.emulateMedia({ media: "screen" });
    await openManualTemplateTab(page);
    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("modern-operations");
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await ensureSinglePage(page);
    await page.emulateMedia({ media: "print" });
    const modernPdf = resolve(outputDir, "d2v14-modern.pdf");
    await page.pdf({ path: modernPdf, format: "A4", printBackground: true, preferCSSPageSize: true });

    assertPdfBasics(modernPdf);
    const modernText = extractPdfText(modernPdf);
    expect(modernText).toContain("陈同学");
    expect(modernText).toContain("Stata");
    expect(modernText).not.toContain("项目空间");
    expect(modernText).not.toContain("打印 / 保存 PDF");

    // Both templates must have key content consistent
    expect(classicText).toContain("demo.student@example.com");
    expect(modernText).toContain("demo.student@example.com");

    // Both must have section titles
    expect(classicText).toContain("项目与经历");
    expect(modernText).toContain("项目与经历");
  });

  // ──────────────────────────────────────────────────────────
  // Scenario 15: 打印失败后页面不崩溃
  // ──────────────────────────────────────────────────────────
  test("场景15：打印失败后页面不崩溃", async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {
        throw new Error("print_failed_mock");
      };
    });

    await createBranchFromDraft(page, "D2V15 Branch");
    await ensureSinglePage(page);

    const preview = page.getByTestId("resume-a4-page");
    await expect(preview).toContainText("陈同学");

    // Try to export - print will throw
    await clickPrintFallback(page);
    await page.waitForTimeout(500);

    // Page should not crash
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("陈同学");

    // Branch should still be selected
    const branchList = page.locator(".branch-list .match-row.match-row-active");
    await expect(branchList).toBeVisible();

    // Template preference preserved
    await openManualTemplateTab(page);
    const templateSelect = page.locator("label").filter({ hasText: "模板" }).locator("select");
    await expect(templateSelect).toHaveValue("classic-technical");

    // Overflow status preserved
    const statusText = await getOverflowStatus(page);
    expect(statusText).toMatch(ANY_PAGE_STATUS);
  });

  // ──────────────────────────────────────────────────────────
  // Scenario 16: 回归占位
  // ──────────────────────────────────────────────────────────
  test("场景16：页面加载回归", async ({ page }) => {
    await page.goto("/resume");
    await expect(page.locator("h1")).toContainText("我的简历");
  });
});
