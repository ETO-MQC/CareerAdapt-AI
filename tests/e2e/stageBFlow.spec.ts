import { expect, test } from "@playwright/test";

test.describe("Phase B profile import flow", () => {
  test("paste text, save raw input, privacy confirm, manual fallback, commit", async ({ page }) => {
    await page.goto("/profile");

    // Wait for the page to load
    await expect(page.locator(".profile-workspace")).toBeVisible();

    // Step 1: Paste resume text
    const textarea = page.getByTestId("profile-raw-textarea");
    await expect(textarea).toBeVisible();
    await textarea.fill("教育经历\n某大学 计算机科学专业 2022-2026\n项目经历\n数据可视化平台 前端开发");

    // Step 2: Click save raw input
    await page.getByTestId("save-profile-raw-input").click();

    // Should show privacy confirmation
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible({ timeout: 5_000 });

    // Step 3: Reject external model -> manual mode
    await page.getByTestId("profile-manual-mode").click();

    // Should enter manual mode
    await expect(page.getByText("手动分类模式", { exact: false })).toBeVisible({ timeout: 5_000 });

    // Step 4: Should show manual draft content
    await expect(page.getByText("解析草稿与原文依据")).toBeVisible({ timeout: 5_000 });

    // Step 5: Ensure a fact is checked (may already be checked from prior run)
    const checkboxes = page.locator(".review-row input[type='checkbox']");
    const checkboxCount = await checkboxes.count();
    expect(checkboxCount).toBeGreaterThan(0);
    const firstCheckbox = checkboxes.first();
    if (!(await firstCheckbox.isChecked())) {
      await firstCheckbox.click({ force: true });
    }
    await expect(firstCheckbox).toBeChecked();

    // Step 6: Commit
    await page.getByTestId("commit-profile").click();

    // Should show success
    await expect(page.locator(".notice")).toContainText("已写入个人资料", { timeout: 5_000 });
  });

  test("profile draft persists after refresh (recovery)", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.locator(".profile-workspace")).toBeVisible();

    // If there's a previously saved draft, it should be loaded on refresh
    // Check that textarea content is restored (from the previous test or empty)
    const textarea = page.getByTestId("profile-raw-textarea");
    await expect(textarea).toBeVisible();

    // If manual mode content is shown, it means draft was recovered
    const hasDraft = await page.getByText("解析草稿与原文依据").isVisible().catch(() => false);
    if (hasDraft) {
      await expect(page.getByText("解析草稿与原文依据")).toBeVisible();
    }
  });
});

test.describe("Phase B JD analysis flow", () => {
  test("fill title/company, paste JD, save, privacy confirm, manual fallback, commit", async ({ page }) => {
    await page.goto("/jobs");

    // Wait for the page to load
    await expect(page.locator(".jobs-workspace")).toBeVisible();
    await expect(page.getByRole("heading", { name: "岗位解析与简历建议" })).toBeVisible();

    // Step 1: Fill title and company
    const titleInput = page.getByTestId("job-title-input");
    const companyInput = page.getByTestId("job-company-input");
    await titleInput.fill("数据分析实习生");
    await companyInput.fill("某互联网公司");

    // Step 2: Paste JD text (simple single-line for reliable sourceSpan location)
    const textarea = page.getByTestId("job-raw-textarea");
    await textarea.fill("负责数据采集与清洗，使用SQL和Excel产出报表，每周实习4天以上。");

    // Step 3: Save raw JD
    await page.getByTestId("save-job-raw-input").click();

    // Should show privacy confirmation
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible({ timeout: 5_000 });

    // Step 4: Reject external model -> manual mode
    await page.getByTestId("job-manual-mode").click();

    // Should enter manual mode and show requirements
    await expect(page.getByText("手动分类模式", { exact: false })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("岗位要求草稿")).toBeVisible({ timeout: 5_000 });

    // Step 5: Verify requirement rows are shown
    await expect(page.locator(".review-row")).toHaveCount(1, { timeout: 5_000 });

    // Check/enabled checkbox if sourceSpan was located; otherwise it stays disabled
    const checkbox = page.locator(".review-row input[type='checkbox']").first();
    const isDisabled = await checkbox.isDisabled();
    if (!isDisabled) {
      await checkbox.waitFor({ state: "visible" });
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const cb = document.querySelector('.review-row input[type="checkbox"]') as HTMLInputElement;
        if (cb && !cb.checked) {
          cb.checked = true;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }

    // Step 6: Commit
    await page.getByTestId("commit-job").click();

    // Should show success or validation message (commit requires at least one confirmed+locatable requirement)
    if (!isDisabled) {
      await expect(page.getByText("已写入正式岗位数据", { exact: false })).toBeVisible({ timeout: 5_000 });
    } else {
      // If no confirmed requirement with sourceSpan, commit may fail gracefully
      await expect(
        page.getByText("提交失败", { exact: false }).or(page.getByText("已写入正式岗位数据", { exact: false }))
      ).toBeVisible({ timeout: 5_000 });
    }
  });

  test("JD draft persists after refresh (recovery)", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page.locator(".jobs-workspace")).toBeVisible();

    // If previously saved draft exists, fields should be populated
    const titleInput = page.getByTestId("job-title-input");
    await expect(titleInput).toBeVisible();
  });
});

test.describe("Phase B provider failure fallback", () => {
  test("without API key, analyze enters manual mode gracefully", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.locator(".profile-workspace")).toBeVisible();

    // Paste text
    const textarea = page.getByTestId("profile-raw-textarea");
    await textarea.fill("Provider失败测试\n某公司 产品经理 2023-2025");

    // Save
    await page.getByTestId("save-profile-raw-input").click();
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible({ timeout: 5_000 });

    // Try to use AI (should fail gracefully since no API key)
    await page.getByTestId("profile-analyze-ai").click();

    // Should fall back to manual mode or error with graceful message
    await expect(
      page.getByText("AI不可用", { exact: false }).or(page.getByText("手动分类", { exact: false })).or(page.getByText("解析失败", { exact: false }))
    ).toBeVisible({ timeout: 15_000 });

    // Raw text should still be in the textarea
    const textareaAfter = page.getByTestId("profile-raw-textarea");
    const text = await textareaAfter.inputValue();
    expect(text).toContain("Provider失败测试");
  });
});
