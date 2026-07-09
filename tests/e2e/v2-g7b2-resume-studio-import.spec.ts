import { expect, test, type Page } from "@playwright/test";

test.describe("V2-G7b.2 Resume Studio and import IA", () => {
  test("separates manual editing tools from AI optimization tools", async ({ page }) => {
    await createBranchFromDraft(page, `G7b2 mode split ${Date.now()}`);

    await expect(page.locator(".resume-inspector")).toBeVisible();
    await expect(page.getByTestId("resume-section-nav")).toBeVisible();
    await expect(page.locator(".branch-editor")).toBeVisible();
    await expect(page.locator(".presentation-history-actions")).toHaveCount(0);

    await page.locator(".resume-mode-rail button").nth(2).click();
    await expect(page.locator(".resume-inspector .inspector-tablist button")).toHaveText(["模板", "颜色", "字体", "页面"]);
    await page.locator(".resume-inspector .inspector-tablist button").nth(3).click();
    await expect(page.getByTestId("resume-property-panel")).toBeVisible();
    await expect(page.locator(".branch-editor")).toHaveCount(0);

    await page.locator(".resume-mode-rail button").nth(1).click();
    await expect(page.locator(".branch-editor")).toHaveCount(0);
    await expect(page.locator(".presentation-history-actions")).toHaveCount(0);
    await expect(page.locator(".property-panel-body")).toHaveCount(0);
    await expect(page.getByTestId("resume-ai-summary")).toBeVisible();
  });

  test("imports structured JSON into the same review flow before confirmation", async ({ page }) => {
    await page.goto("/resume");
    await page.locator(".import-json-details summary").click();
    await page.locator(".import-json-details textarea").fill(JSON.stringify({
      schemaVersion: "structured-resume-draft-v1",
      basics: {
        name: "JSON Candidate",
        email: "demo.student@example.com",
        summary: "Data analysis student."
      },
      sections: [{
        title: "Projects",
        sectionType: "experience",
        items: ["Cleaned provincial panel data with Stata."]
      }]
    }));
    await page.locator(".import-json-details button.primary-button").click();

    await expect(page.getByTestId("import-quality-report")).toBeVisible();
    await expect(page.locator(".import-source-text")).toContainText("JSON Candidate");
    await expect(page.locator(".import-structure-panel button.primary-button")).toBeVisible();
  });

  test("exports the active resume as structured JSON", async ({ page }) => {
    await createBranchFromDraft(page, `G7b2 JSON export ${Date.now()}`);

    // Open the "更多" dropdown to access JSON export
    const workbar = page.getByTestId("resume-studio-workbar");
    await workbar.locator(".toolbar-more summary").click();
    const downloadPromise = page.waitForEvent("download");
    await workbar.locator(".toolbar-more-popover").getByRole("button", { name: /JSON/ }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain("structured-resume.json");
    await expect(page.locator(".notice")).toBeVisible();
  });
});

async function createBranchFromDraft(page: Page, branchName: string) {
  await page.goto("/jobs");
  await page.getByTestId("run-experience-match").click();
  await expect(page.locator(".match-row").first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("create-suggestion-draft").click();
  await expect(page.locator(".notice")).toBeVisible({ timeout: 15_000 });

  await page.goto("/resume");
  await page.getByTestId("resume-import-strip").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("job-suggestion-draft-select").first().selectOption({ index: 0 });
  await page.getByTestId("new-resume-branch-name").first().fill(branchName);
  await page.getByTestId("create-job-resume").first().click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("resume-a4-page").first()).toBeVisible();
}
