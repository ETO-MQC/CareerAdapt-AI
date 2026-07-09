import { expect, test, type Page } from "@playwright/test";

test.describe("V2-G7b workspace UX", () => {
  test("product shell hides internal probes and exposes stable workspace routes", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".primary-sidebar a[href='/resume']")).toBeVisible();
    await expect(page.locator(".primary-sidebar a[href='/profile']")).toBeVisible();
    await expect(page.locator(".primary-sidebar a[href='/jobs']")).toBeVisible();
    await expect(page.locator(".primary-sidebar a[href='/applications']")).toBeVisible();
    await expect(page.locator(".primary-sidebar a[href='/settings']")).toBeVisible();

    await expect(page.getByText("A4 Probe")).toHaveCount(0);
    await expect(page.getByText("PDF Probe")).toHaveCount(0);
    await expect(page.getByText("Repository")).toHaveCount(0);
  });

  test("profile workspace uses category, list, detail management", async ({ page }) => {
    const skillName = `G7b Skill ${Date.now()}`;

    await page.goto("/profile");
    await expect(page.locator(".profile-manager-grid")).toBeVisible();
    await expect(page.locator(".profile-category-panel")).toBeVisible();
    await expect(page.locator(".profile-list-panel")).toBeVisible();
    await expect(page.locator(".profile-detail-panel")).toBeVisible();

    await page.locator(".profile-category-button").nth(7).click();
    await page.locator(".profile-list-panel button.primary-button").click();
    const detail = page.locator(".profile-detail-panel");
    await detail.locator("input").first().fill(skillName);
    await detail.locator("select").first().selectOption("proficient");
    await detail.locator("textarea").fill(`Confirmed skill ${skillName}`);
    await detail.locator("button.primary-button").last().click();

    await expect(page.locator(".profile-managed-list")).toContainText(skillName);
  });

  test("resume workspace supports A4 direct profile-field editing", async ({ page }) => {
    await createBranchFromDraft(page, `G7b Canvas ${Date.now()}`);

    // Double-click to start editing (single click only selects in new UI)
    await page.locator(".resume-preview-pages").getByTestId("resume-a4-page").first().locator("[data-source-item-id='profile:name']").dblclick();
    await expect(page.getByTestId("resume-studio-editor")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("resume-studio-editor").locator("textarea")).toBeVisible();
  });

  test("resume studio keeps A4 canvas in local scroll without page overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await createBranchFromDraft(page, `G7b Layout ${Date.now()}`);

    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const stage = document.querySelector<HTMLElement>(".resume-preview-stage");
      const resumePage = stage?.querySelector<HTMLElement>("[data-testid='resume-a4-page']");
      if (!stage || !resumePage) {
        throw new Error("resume_stage_or_page_missing");
      }
      const stageRect = stage.getBoundingClientRect();
      const pageRect = resumePage.getBoundingClientRect();
      const invisibleOversized = Array.from(document.querySelectorAll<HTMLElement>("[aria-hidden='true'], [data-resume-pagination-measurement='true']"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return style.position !== "absolute" && rect.height > 64;
        })
        .map((node) => ({ testId: node.dataset.testid, height: node.getBoundingClientRect().height }));

      return {
        horizontalOverflow: doc.scrollWidth - window.innerWidth,
        pageTopFromStage: pageRect.top - stageRect.top,
        stageScrollWidth: stage.scrollWidth,
        stageClientWidth: stage.clientWidth,
        invisibleOversized
      };
    });

    expect(metrics.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(metrics.pageTopFromStage).toBeGreaterThanOrEqual(16);
    expect(metrics.pageTopFromStage).toBeLessThanOrEqual(64);
    expect(metrics.stageScrollWidth).toBeGreaterThanOrEqual(metrics.stageClientWidth);
    expect(metrics.invisibleOversized).toEqual([]);
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
