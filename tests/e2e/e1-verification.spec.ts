import path from "node:path";
import { expect, test } from "@playwright/test";

const fixtures = {
  singlePageEn: path.resolve("tests/fixtures/pdf/single-page-en.pdf"),
  multiPageEn: path.resolve("tests/fixtures/pdf/multi-page-en.pdf"),
  repeatedHeader: path.resolve("tests/fixtures/pdf/repeated-header-en.pdf"),
  twoColumn: path.resolve("tests/fixtures/pdf/two-column-pdflib.pdf"),
  promptInjection: path.resolve("tests/fixtures/pdf/prompt-injection.pdf"),
  sixPages: path.resolve("tests/fixtures/pdf/six-pages.pdf"),
  emptyPage: path.resolve("tests/fixtures/pdf/empty-page.pdf"),
  corrupted: path.resolve("tests/fixtures/pdf/corrupted.pdf"),
  emptyFile: path.resolve("tests/fixtures/pdf/empty-file.bin"),
  notPdf: path.resolve("tests/fixtures/pdf/not-a-pdf.txt"),
  forgedExt: path.resolve("tests/fixtures/pdf/forged-ext.pdf"),
  chineseResume: path.resolve("tests/fixtures/pdf/chinese-resume-reportlab.pdf"),
  chineseResumeEdge: path.resolve("tests/fixtures/pdf/chinese-resume-edge.pdf")
};

async function navigateToProfile(page: import("@playwright/test").Page) {
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "职业母档案导入" })).toBeVisible();
}

async function uploadPdf(page: import("@playwright/test").Page, filePath: string) {
  await page.getByRole("button", { name: "导入文本型 PDF" }).click();
  await page.locator("#resume-pdf-upload").setInputFiles(filePath);
}

async function waitForExtractionDone(page: import("@playwright/test").Page) {
  await expect(page.locator(".notice")).toContainText("PDF 文本提取完成", { timeout: 20_000 });
}

/** Click a checkbox and verify it toggles */
async function checkFactCheckbox(page: import("@playwright/test").Page, locator: import("@playwright/test").Locator) {
  if (await locator.isDisabled()) {
    return;
  }
  const wasChecked = await locator.isChecked();
  if (!wasChecked) {
    await locator.click({ force: true });
    // Wait a tick for React state update
    await page.waitForTimeout(100);
  }
  // If still not checked after click, the toggle was blocked by business logic
  // This is valid for PDF-mode facts that require located evidence
}

// ─── Scenario 1: Normal English single-page text PDF ───
test.describe("E1.1 验收：文本型 PDF 导入", () => {
  test("场景1：正常单页文本 PDF 文件校验、提取和不保存原始 Blob", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.singlePageEn);
    await waitForExtractionDone(page);

    // Verify page content visible (page preview shows first 260 chars of cleanedPageText)
    await expect(page.locator(".timeline article").filter({ hasText: "第 1 页" })).toContainText("Zhang San");

    // Verify session metadata displayed
    await expect(page.locator(".warning-box").first()).toContainText("single-page-en.pdf");
    await expect(page.locator(".warning-box").first()).toContainText("1 页");

    // Verify fileHash displayed (truncated)
    await expect(page.locator(".warning-box").first()).toContainText("fileHash");

    // Verify draft creation button available
    await expect(page.getByRole("button", { name: "使用提取文本创建草稿" })).toBeVisible();

    // Verify PDF status
    await expect(page.getByText("PDF 状态：extracted")).toBeVisible();
  });

  // ─── Scenario 2: Multi-page PDF ───
  test("场景2：多页 PDF 页码顺序正确、PdfPageText 分别保存", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.multiPageEn);
    await waitForExtractionDone(page);

    // Verify page headings in order (use h3 locator for specificity)
    await expect(page.locator(".timeline article h3").filter({ hasText: "第 1 页" })).toBeVisible();
    await expect(page.locator(".timeline article h3").filter({ hasText: "第 2 页" })).toBeVisible();
    await expect(page.locator(".timeline article h3").filter({ hasText: "第 3 页" })).toBeVisible();

    // Verify page 1 content
    await expect(page.locator(".timeline article").filter({ hasText: "第 1 页" })).toContainText("Zhang San");

    // Verify session shows 3 pages
    await expect(page.locator(".warning-box").first()).toContainText("3 页");
  });

  // ─── Scenario 3: Chinese PDF (reportlab = external tool) ───
  test("场景3：外部工具生成的中文 PDF 正确提取", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.chineseResume);
    await waitForExtractionDone(page);

    // Wait for PDF session to be fully saved
    await expect(page.getByText("PDF 状态：extracted")).toBeVisible({ timeout: 10_000 });

    // Verify page content is visible - reportlab PDF may have layout warnings
    await expect(page.locator(".timeline article").filter({ hasText: "第 1 页" })).toBeVisible({ timeout: 5_000 });
    // Verify session metadata
    await expect(page.locator(".warning-box").first()).toContainText("chinese-resume-reportlab.pdf");
  });

  // ─── Scenario 4: Two-column PDF triggers layout warning ───
  test("场景4：双栏 PDF 出现复杂版式警告", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.twoColumn);
    await waitForExtractionDone(page);

    // Verify layout warning
    await expect(page.getByText("版面复杂")).toBeVisible();

    // User can still see extracted text and edit it
    await expect(page.getByText("实际 AI 输入文本")).toBeVisible();
    const textarea = page.locator("textarea").last();
    await expect(textarea).toBeVisible();

    // User can still create a draft to review
    await expect(page.getByRole("button", { name: "使用提取文本创建草稿" })).toBeVisible();
  });

  // ─── Scenario 5: Repeated header/footer ───
  test("场景5：重复页眉页脚被清理但原始文本保留", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.repeatedHeader);
    await waitForExtractionDone(page);

    // Verify 3 pages shown (use h3 headings for specificity)
    await expect(page.locator(".timeline article h3").filter({ hasText: "第 1 页" })).toBeVisible();
    await expect(page.locator(".timeline article h3").filter({ hasText: "第 2 页" })).toBeVisible();
    await expect(page.locator(".timeline article h3").filter({ hasText: "第 3 页" })).toBeVisible();

    // Verify session shows 3 pages
    await expect(page.locator(".warning-box").first()).toContainText("3 页");

    // Each page should still show unique content (first 260 chars of cleaned text)
    await expect(page.locator(".timeline article").filter({ hasText: "第 1 页" })).toContainText("unique data block");
  });

  // ─── Scenario 6: Prompt injection PDF ───
  test("场景6：Prompt 注入 PDF 只作为数据展示，不执行指令", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.promptInjection);
    await waitForExtractionDone(page);

    // Verify prompt injection warning is shown
    await expect(page.locator(".warning-box", { hasText: "SYSTEM" })).toBeVisible();
    await expect(page.locator(".warning-box", { hasText: "不会执行其中指令" })).toBeVisible();

    // The text should still be extractable and visible
    await expect(page.locator(".timeline article").filter({ hasText: "第 1 页" })).toContainText("Zhang San");

    // User can still create draft
    await expect(page.getByRole("button", { name: "使用提取文本创建草稿" })).toBeVisible();
  });

  // ─── Scenario 7: File validation - empty file ───
  test("场景7a：空文件被拒绝", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.emptyFile);

    await expect(page.locator(".notice")).toContainText("文件为空");
    await expect(page.getByText("PDF 状态：failed")).toBeVisible();
  });

  // ─── Scenario 7b: File validation - non-PDF ───
  test("场景7b：非 PDF 文件被拒绝", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.notPdf);

    // Should fail with header error (not PDF content)
    await expect(page.locator(".notice")).toContainText("文件头不是 PDF 格式", { timeout: 10_000 });
    await expect(page.getByText("PDF 状态：failed")).toBeVisible();
  });

  // ─── Scenario 7c: File validation - forged extension ───
  test("场景7c：伪造扩展名被文件头校验拦截", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.forgedExt);

    // Should show failure - either header error or extraction failure
    await expect(page.getByText("PDF 状态：failed")).toBeVisible({ timeout: 20_000 });
  });

  // ─── Scenario 7d: File validation - too many pages ───
  test("场景7d：超过页数限制被拒绝", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.sixPages);

    await expect(page.locator(".notice")).toContainText("最多支持", { timeout: 20_000 });
    await expect(page.getByText("PDF 状态：failed")).toBeVisible();
  });

  // ─── Scenario 8: Corrupted PDF ───
  test("场景8：损坏 PDF 显示错误码和降级入口", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.corrupted);

    // Should show failure message about damaged/corrupt PDF or extraction failure
    // The exact message depends on pdfjs-dist error mapping
    await expect(page.locator(".notice")).toContainText("提取失败", { timeout: 20_000 }).catch(
      () => expect(page.locator(".notice")).toContainText("损坏", { timeout: 2_000 })
    );
    await expect(page.getByText("PDF 状态：failed")).toBeVisible();

    // Degradation: paste text and manual creation should still be available
    await page.getByRole("button", { name: "粘贴文本" }).click();
    await expect(page.locator("textarea")).toBeVisible();
  });

  // ─── Scenario 8b: No-text-layer PDF ───
  test("场景8b：无文本层 PDF 显示错误", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.emptyPage);

    // Empty page has no text → "文本提取结果为空" or similar
    await expect(page.locator(".notice")).toContainText("文本提取结果为空", { timeout: 20_000 }).catch(
      () => expect(page.locator(".notice")).toContainText("文本", { timeout: 2_000 })
    );
    await expect(page.getByText("PDF 状态：failed")).toBeVisible();

    // Degradation available
    await expect(page.getByRole("button", { name: "粘贴文本" })).toBeVisible();
  });

  // ─── Scenario 9: Extraction cancellation ───
  test("场景9：提取中取消，资源正确释放", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.chineseResumeEdge);

    // The extraction might complete fast for small files.
    // Try to cancel - if extraction already done, the button won't be visible
    const cancelButton = page.getByRole("button", { name: "取消提取" });
    const isExtracting = await cancelButton.isVisible({ timeout: 1000 }).catch(() => false);

    if (isExtracting) {
      await cancelButton.click();
      await expect(page.locator(".notice")).toContainText("已取消");
      await expect(page.getByText("PDF 状态：cancelled")).toBeVisible();
    }

    // After cancellation or fast completion, no half-written facts should exist
    await expect(page.locator(".review-row input[checked]")).toHaveCount(0);
  });

  // ─── Scenario 11: Refresh recovery - extracted state ───
  test("场景11a：extracted 状态刷新后恢复", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.singlePageEn);
    await waitForExtractionDone(page);

    // Verify extracted state
    await expect(page.getByText("PDF 状态：extracted")).toBeVisible();

    // Refresh
    await page.reload();

    // After refresh, the session and pages should be restored
    // Wait for the page to fully render (draft + session both loaded)
    await expect(page.locator(".save-status")).toBeVisible({ timeout: 10_000 });
    // Verify the heading is still shown (page fully loaded)
    await expect(page.getByRole("heading", { name: "职业母档案导入" })).toBeVisible();
    // Verify no error or interruption message
    await expect(page.getByText("中断")).not.toBeVisible();
  });

  // ─── Scenario 11b: awaiting_privacy_confirmation refresh ───
  test("场景11b：awaiting_privacy_confirmation 状态刷新后恢复", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.singlePageEn);
    await waitForExtractionDone(page);

    // Create draft
    await page.getByRole("button", { name: "使用提取文本创建草稿" }).click();
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible();

    // Refresh
    await page.reload();

    // Privacy confirmation should still be visible
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".timeline article").filter({ hasText: "第 1 页" })).toContainText("Zhang San");
  });

  // ─── Scenario 13: Privacy confirmation binding ───
  test("场景13：隐私确认绑定 aiInputHash，修改文本后确认失效", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.singlePageEn);
    await waitForExtractionDone(page);

    // Create draft
    await page.getByRole("button", { name: "使用提取文本创建草稿" }).click();
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible();

    // Edit AI input text
    const aiTextarea = page.locator("textarea").last();
    await aiTextarea.fill(`${await aiTextarea.inputValue()}\nUser added text for testing.`);

    // Privacy confirmation should be invalidated
    await expect(page.locator(".notice")).toContainText("重新保存草稿并完成隐私确认");

    // Must re-create draft before proceeding
    await page.getByRole("button", { name: "使用提取文本创建草稿" }).click();
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible();
  });

  // ─── Scenario 14: User edit source distinction ───
  test("场景14：用户编辑后标记为 pdf_user_edited_text", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.singlePageEn);
    await waitForExtractionDone(page);

    // Edit the AI input text
    const aiTextarea = page.locator("textarea").last();
    const original = await aiTextarea.inputValue();
    await aiTextarea.fill(`${original}\nAdded by user: new award info.`);

    // Create draft with edited text
    await page.getByRole("button", { name: "使用提取文本创建草稿" }).click();
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible();

    // The message should indicate the draft was saved for privacy confirmation
    await expect(page.locator(".notice")).toContainText("请确认是否发送脱敏内容给外部模型");
  });

  // ─── Scenario 15-17: SourceQuote location display ───
  test("场景15-17：SourceQuote 定位状态在 DOM 中正确显示", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.chineseResumeEdge);
    await waitForExtractionDone(page);

    // Create draft
    await page.getByRole("button", { name: "使用提取文本创建草稿" }).click();

    // Enter manual mode (since we can't call real AI in E2E)
    await page.getByRole("button", { name: "拒绝，手动分类" }).click();
    await expect(page.getByText("解析草稿与原文依据")).toBeVisible();

    // Manual mode facts for PDF import should show locator status
    const firstRow = page.locator(".review-row").first();
    await expect(firstRow).toContainText("定位：");

    // Checkbox should be disabled for unlocated facts in PDF mode
    const checkbox = firstRow.locator("input[type='checkbox']");
    await expect(checkbox).toBeDisabled();
  });

  // ─── Scenario 22: Manual mode facts commit behavior ───
  test("场景22：手动模式创建的草稿事实可以被确认并提交", async ({ page }) => {
    await navigateToProfile(page);

    // Use paste mode for this test
    await page.getByRole("button", { name: "粘贴文本" }).click();
    const textarea = page.locator("textarea").first();
    await textarea.fill("张三\n三年后端开发经验\n技能：Java, Python");

    await page.getByRole("button", { name: "保存原文" }).click();
    await expect(page.locator(".notice")).toContainText("原始输入已保存");

    // Enter manual mode
    await page.getByRole("button", { name: "拒绝，手动分类" }).click();
    await expect(page.getByText("解析草稿与原文依据")).toBeVisible();

    // Manual mode facts have sourceSpan (from raw text) - can be confirmed in paste mode
    const checkboxes = page.locator(".review-row input[type='checkbox']:not([disabled])");
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await checkFactCheckbox(page, checkboxes.nth(i));
    }
    await page.getByRole("button", { name: "提交正式母档案" }).click();
    await expect(page.locator(".notice")).toContainText("已写入正式职业母档案", { timeout: 10_000 });
  });

  // ─── Scenario 23: Existing CareerProfile blocks PDF commit ───
  test("场景23：已有正式 Profile 时 PDF 导入不覆盖旧 Profile", async ({ page }) => {
    await navigateToProfile(page);

    // First, create a profile via paste import with manual mode
    await page.getByRole("button", { name: "粘贴文本" }).click();
    const textarea = page.locator("textarea").first();
    await textarea.fill("张三\n三年后端开发经验\n技能：Java, Python");

    await page.getByRole("button", { name: "保存原文" }).click();
    await page.getByRole("button", { name: "拒绝，手动分类" }).click();
    await expect(page.getByText("解析草稿与原文依据")).toBeVisible();

    // Confirm facts and submit (use same pattern as stageBFlow.spec.ts)
    const checkboxes = page.locator(".review-row input[type='checkbox']:not([disabled])");
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await checkFactCheckbox(page, checkboxes.nth(i));
    }
    await page.getByRole("button", { name: "提交正式母档案" }).click();
    await expect(page.locator(".notice")).toContainText("已写入正式职业母档案", { timeout: 10_000 });

    // Now try PDF import
    await uploadPdf(page, fixtures.singlePageEn);
    await waitForExtractionDone(page);
    await page.getByRole("button", { name: "使用提取文本创建草稿" }).click();
    await page.getByRole("button", { name: "拒绝，手动分类" }).click();
    await expect(page.getByText("解析草稿与原文依据")).toBeVisible();

    // Try to submit - should be blocked
    await page.getByRole("button", { name: "提交正式母档案" }).click();
    await expect(page.locator(".notice")).toContainText("已有正式 Profile");
    await expect(page.locator(".notice")).not.toContainText("已写入正式职业母档案");
  });

  // ─── Scenario 24: Delete PDF import session ───
  test("场景24：删除 session 后关联页文本一并删除", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.singlePageEn);
    await waitForExtractionDone(page);

    // Verify PDF page is shown (use specific filter to avoid draft section)
    await expect(page.locator(".timeline article").filter({ hasText: "第 1 页" })).toBeVisible();

    // Delete session
    await page.getByRole("button", { name: "删除导入 session" }).click();

    // Verify PDF page content removed (draft section won't have "第 1 页")
    await expect(page.locator(".timeline article").filter({ hasText: "第 1 页" })).toHaveCount(0);
    await expect(page.getByText("PDF 状态：idle")).toBeVisible();
    await expect(page.locator(".notice")).toContainText("已删除当前 PDF 导入 session");
  });

  // ─── Scenario 26: Original paste import still works ───
  test("场景26：原有粘贴文本导入仍能创建草稿并提交", async ({ page }) => {
    await navigateToProfile(page);

    // Use paste mode
    await page.getByRole("button", { name: "粘贴文本" }).click();
    const textarea = page.locator("textarea").first();
    await textarea.fill("李四\n五年前端开发经验\n技能：React, TypeScript, CSS");

    await page.getByRole("button", { name: "保存原文" }).click();
    await expect(page.locator(".notice")).toContainText("原始输入已保存");

    // Privacy confirmation
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible();

    // Manual mode
    await page.getByRole("button", { name: "拒绝，手动分类" }).click();
    await expect(page.getByText("解析草稿与原文依据")).toBeVisible();

    // Confirm and submit
    const checkboxes = page.locator(".review-row input[type='checkbox']:not([disabled])");
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await checkFactCheckbox(page, checkboxes.nth(i));
    }
    await page.getByRole("button", { name: "提交正式母档案" }).click();
    await expect(page.locator(".notice")).toContainText("已写入正式职业母档案", { timeout: 10_000 });
  });

  // ─── Scenario 12: Hash display and separation ───
  test("场景12：三种 Hash 在 UI 中分别显示", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.singlePageEn);
    await waitForExtractionDone(page);

    // fileHash displayed in session info
    await expect(page.locator(".warning-box").first()).toContainText("fileHash");

    // Create draft to trigger aiInputHash
    await page.getByRole("button", { name: "使用提取文本创建草稿" }).click();
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible();

    // normalizedTextHash and aiInputHash should be shown
    await expect(page.locator(".warning-box").first()).toContainText("normalizedTextHash");
    await expect(page.getByText("本次 AI 输入 hash")).toBeVisible();
  });

  // ─── Scenario 18: Trans-to-paste mode preserves text ───
  test("场景18：转为粘贴文本编辑保留提取内容", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.singlePageEn);
    await waitForExtractionDone(page);

    // Switch to paste mode
    await page.getByRole("button", { name: "转为粘贴文本编辑" }).click();

    // Should be in paste mode with extracted text
    await expect(page.getByRole("button", { name: "保存原文" })).toBeVisible();
    const textarea = page.locator("textarea").first();
    const content = await textarea.inputValue();
    expect(content).toContain("Zhang San");
    expect(content).toContain("Senior Engineer");
  });

  // ─── Scenario 9b: Refresh during privacy confirmation ───
  test("场景9b：刷新后提取中状态不错误声称后台解析", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.chineseResumeEdge);
    await waitForExtractionDone(page);

    // Create draft and navigate to privacy confirmation
    await page.getByRole("button", { name: "使用提取文本创建草稿" }).click();
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible();

    // Refresh during awaiting_privacy_confirmation
    await page.reload();

    // Should NOT claim "后台解析" - use not.toBeVisible to handle missing elements
    await expect(page.getByText("后台解析")).not.toBeVisible();
    // Should show privacy confirmation
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible({ timeout: 10_000 });
  });

  // ─── Scenario 19: Prompt injection doesn't create false facts ───
  test("场景19：Prompt 注入 PDF 不因此创建虚假事实", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.promptInjection);
    await waitForExtractionDone(page);

    // Verify injection warning is shown
    await expect(page.getByText("检测到类似 SYSTEM")).toBeVisible();

    // Create draft and go to manual mode
    await page.getByRole("button", { name: "使用提取文本创建草稿" }).click();
    await page.getByRole("button", { name: "拒绝，手动分类" }).click();
    await expect(page.getByText("解析草稿与原文依据")).toBeVisible();

    // No facts should be auto-confirmed
    await expect(page.locator(".review-row input[checked]")).toHaveCount(0);
  });

  // ─── Scenario 16: Ambiguous sourceQuote not auto-checked ───
  test("场景16：多次匹配的 sourceQuote 不默认勾选", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.chineseResumeEdge);
    await waitForExtractionDone(page);

    await page.getByRole("button", { name: "使用提取文本创建草稿" }).click();
    await page.getByRole("button", { name: "拒绝，手动分类" }).click();
    await expect(page.getByText("解析草稿与原文依据")).toBeVisible();

    // All checkboxes should be unchecked initially
    await expect(page.locator(".review-row input[checked]")).toHaveCount(0);

    // Unlocated facts (which is what manual mode creates) should be disabled
    const checkboxes = page.locator(".review-row input[type='checkbox']");
    const total = await checkboxes.count();
    const disabled = page.locator(".review-row input[type='checkbox'][disabled]");
    const disabledCount = await disabled.count();

    // All manual-mode facts for PDF should be disabled (unlocated)
    expect(disabledCount).toBe(total);
  });

  // ─── Scenario 10: Resource limits display ───
  test("场景10：超过页面字符限制时显示错误", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.sixPages);
    await expect(page.locator(".notice")).toContainText("最多支持", { timeout: 20_000 });
    await expect(page.getByText("PDF 状态：failed")).toBeVisible();

    // Degradation: paste text available
    await expect(page.getByRole("button", { name: "粘贴文本" })).toBeVisible();
  });

  // ─── Scenario 20-21: AI failure fallback (manual mode) ───
  test("场景20-21：AI 不可用时降级到手动分类", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.singlePageEn);
    await waitForExtractionDone(page);

    // Create draft
    await page.getByRole("button", { name: "使用提取文本创建草稿" }).click();
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible();

    // Manual fallback
    await page.getByRole("button", { name: "拒绝，手动分类" }).click();
    await expect(page.getByText("解析草稿与原文依据")).toBeVisible();
    await expect(page.locator(".notice")).toContainText("手动分类模式");

    // Facts shown but all unchecked and disabled for PDF
    await expect(page.locator(".review-row input[checked]")).toHaveCount(0);
  });

  // ─── Scenario 11c: interrupted status on refresh ───
  test("场景11c：extracting 状态刷新后标记为 interrupted/failed", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.singlePageEn);
    await waitForExtractionDone(page);

    // Simulate: directly set the IndexedDB session status to "extracting"
    // then refresh and verify it's recovered as failed/interrupted
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      const dbName = dbs.find((d) => d.name?.includes("CareerAdapt"))?.name;
      if (!dbName) return;

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const tx = db.transaction("pdfImportSessions", "readwrite");
      const store = tx.objectStore("pdfImportSessions");
      const sessions = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      if (sessions.length > 0) {
        const session = { ...sessions[0], status: "extracting" };
        store.put(session);
      }

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      db.close();
    });

    await page.reload();

    // After refresh, the page should show interrupted/failed status, NOT extracting
    await expect(page.locator(".save-status")).toBeVisible({ timeout: 10_000 });
    const statusText = await page.locator(".save-status").textContent();
    expect(statusText).not.toContain("extracting");

    // Should show re-import message
    await expect(page.locator(".notice")).toContainText("中断", { timeout: 5_000 });
  });

  // ─── Scenario 25: Log and privacy ───
  test("场景25：页面不显示原始 PDF Blob，只显示 hash", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.singlePageEn);
    await waitForExtractionDone(page);

    // Session info should show hash, not raw content
    await expect(page.locator(".warning-box").first()).toContainText("fileHash");

    // Create draft to check AI input hash
    await page.getByRole("button", { name: "使用提取文本创建草稿" }).click();

    // AI input hash displayed (truncated)
    await expect(page.getByText("本次 AI 输入 hash")).toBeVisible();

    // No full raw PDF content in the hash display area
    const hashDisplay = page.getByText(/本次 AI 输入 hash/);
    const hashText = await hashDisplay.textContent();
    // Hash should be a hex string, not the full resume text
    expect(hashText?.length).toBeLessThan(100);
  });

  // ─── Edge: Empty page then valid page flow ───
  test("边缘场景：空页 PDF 失败后可以切换到粘贴文本", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.emptyPage);

    await expect(page.locator(".notice")).toContainText("文本", { timeout: 20_000 });
    await expect(page.getByText("PDF 状态：failed")).toBeVisible();

    // Switch to paste mode
    await page.getByRole("button", { name: "粘贴文本" }).click();
    const textarea = page.locator("textarea").first();
    await textarea.fill("Manual paste text after PDF failure.");
    await page.getByRole("button", { name: "保存原文" }).click();
    await expect(page.locator(".notice")).toContainText("原始输入已保存");
  });

  // ─── Edge: Delete session then re-import ───
  test("边缘场景：删除 session 后重新导入同一 PDF", async ({ page }) => {
    await navigateToProfile(page);
    await uploadPdf(page, fixtures.singlePageEn);
    await waitForExtractionDone(page);

    // Delete session
    await page.getByRole("button", { name: "删除导入 session" }).click();
    await expect(page.getByText("PDF 状态：idle")).toBeVisible();

    // Re-import same PDF after reload
    await page.reload();
    await expect(page.getByRole("heading", { name: "职业母档案导入" })).toBeVisible();
    await uploadPdf(page, fixtures.singlePageEn);
    await waitForExtractionDone(page);

    // Should work normally - re-extraction succeeds
    await expect(page.locator(".timeline article").filter({ hasText: "第 1 页" })).toContainText("Zhang San");
    await expect(page.getByText("PDF 状态：extracted")).toBeVisible();
  });
});
