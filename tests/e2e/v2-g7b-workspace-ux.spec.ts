import { expect, test, type Page } from "@playwright/test";

test.describe("V2-G7b workspace UX", () => {
  test("product shell hides internal probes and exposes stable workspace routes", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".primary-sidebar a[href='/resume']")).toBeVisible();
    await expect(page.locator(".primary-sidebar a[href='/profile']")).toBeVisible();
    await expect(page.locator(".primary-sidebar a[href='/jobs']")).toBeVisible();
    await expect(page.locator(".primary-sidebar a[href='/applications']")).toBeVisible();
    await expect(page.locator(".primary-sidebar a[href='/recycle']")).toBeVisible();
    await expect(page.locator(".primary-sidebar a[href='/settings']")).toBeVisible();

    await expect(page.getByText("A4 Probe")).toHaveCount(0);
    await expect(page.getByText("PDF Probe")).toHaveCount(0);
    await expect(page.getByText("Repository")).toHaveCount(0);
  });

  test("moves a job to the unified recycle bin and restores it", async ({ page }) => {
    await page.goto("/resume");
    await page.getByRole("button").filter({ hasText: "从个人资料库创建" }).click();
    await page.goto("/jobs");
    await page.getByLabel("来源通用简历").selectOption({ index: 1 });
    const jobTitle = await page.locator(".jobs-detail-panel strong").first().innerText();
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(".jobs-detail-panel").getByRole("button", { name: "删除", exact: true }).click();
    await expect(page.locator(".notice")).toContainText("岗位已移入回收站");

    await page.goto("/recycle");
    const recycled = page.locator(".recycle-row").filter({ hasText: jobTitle });
    await expect(recycled).toBeVisible();
    await recycled.getByRole("button", { name: "恢复", exact: true }).click();
    await expect(page.locator(".app-notification")).toContainText("岗位已恢复");
    await expect(recycled).toHaveCount(0);
  });

  test("profile workspace uses category, list, detail management", async ({ page }) => {
    const skillName = `G7b Skill ${Date.now()}`;

    await page.goto("/profile");
    await expect(page.locator(".profile-manager-grid")).toBeVisible();
    await expect(page.locator(".profile-category-panel")).toBeVisible();
    await expect(page.locator(".profile-list-panel")).toBeVisible();
    await expect(page.locator(".profile-detail-panel")).toBeVisible();

    await page.locator(".profile-category-button").filter({ hasText: "个人技能" }).click();
    const rows = page.locator(".profile-managed-row");
    const initialCount = await rows.count();
    const originalFirstItem = await rows.first().innerText();
    await page.locator(".profile-list-panel button.primary-button").click();
    const detail = page.locator(".profile-detail-panel");
    await detail.locator("input").first().fill(skillName);
    await detail.locator("select").first().selectOption("proficient");
    await detail.locator("textarea").fill(`Confirmed skill ${skillName}`);
    await detail.locator("button.primary-button").last().click();

    await expect(page.locator(".profile-managed-list")).toContainText(skillName);
    await expect(rows).toHaveCount(initialCount + 1);
    await expect(page.locator(".profile-managed-list")).toContainText(originalFirstItem.split("\n")[0]);

    const scrollStructure = await page.locator(".profile-list-panel").evaluate((panel) => {
      const list = panel.querySelector<HTMLElement>(".profile-managed-list");
      return {
        rows: getComputedStyle(panel).gridTemplateRows,
        overflowY: list ? getComputedStyle(list).overflowY : "",
        scrollbarGutter: list ? getComputedStyle(list).scrollbarGutter : ""
      };
    });
    expect(scrollStructure.rows.trim().split(/\s+/)).toHaveLength(3);
    expect(scrollStructure.overflowY).toBe("auto");
    expect(scrollStructure.scrollbarGutter).toContain("stable");

    const createdRow = page.locator(".profile-managed-row").filter({ hasText: skillName });
    await createdRow.getByRole("button", { name: `归档 ${skillName}` }).click();
    await expect(page.locator(".profile-list-panel select")).toHaveValue("all");
    await expect(page.locator(".notice")).toContainText("资料条目已归档");
    await page.locator(".profile-list-panel select").selectOption("archived");
    const archivedRow = page.locator(".profile-managed-row").filter({ hasText: skillName });
    await archivedRow.getByRole("button", { name: `删除 ${skillName}` }).click();
    await expect(page.locator(".notice")).toContainText("资料条目已移入回收站");
    await page.goto("/recycle");
    await expect(page.locator(".recycle-row").filter({ hasText: skillName })).toBeVisible();
  });

  test("current profile offers edit and guarded delete actions", async ({ page }) => {
    await page.goto("/profile");
    const currentProfile = page.locator(".current-profile-panel");
    await expect(currentProfile.getByRole("button", { name: "修改" })).toBeVisible();
    await expect(currentProfile.getByRole("button", { name: "删除" })).toBeVisible();

    await currentProfile.getByRole("button", { name: "修改" }).click();
    await expect(page.locator(".profile-category-button-active")).toContainText("个人信息");
    await currentProfile.getByRole("button", { name: "删除" }).click();
    await expect(page.getByRole("dialog", { name: "删除当前个人资料？" })).toBeVisible();
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("dialog", { name: "删除当前个人资料？" })).toHaveCount(0);
  });

  test("profile education fields persist with the resume field model", async ({ page }) => {
    const schoolName = `职适测试大学 ${Date.now()}`;
    await page.goto("/profile");
    await page.locator(".profile-category-button").filter({ hasText: "教育经历" }).click();
    await page.locator(".profile-list-panel button.primary-button").click();
    const detail = page.locator(".profile-detail-panel");
    await detail.getByLabel("学校名称").fill(schoolName);
    await detail.getByLabel("学历").fill("本科");
    await detail.getByLabel("专业").fill("计算机相关专业");
    await detail.getByLabel("学校所在地").fill("上海");
    await detail.getByLabel("就读开始时间").fill("2021-09-01");
    await detail.getByLabel("就读结束时间").fill("2025-06-30");
    await detail.getByLabel("主修课程").fill("数据结构、操作系统");
    await detail.locator("[contenteditable='true']").fill("主修方向与目标岗位相关。");
    await detail.getByRole("button", { name: "保存", exact: true }).click();

    await expect(page.getByTestId("profile-managed-list")).toContainText(schoolName);
    await page.reload();
    await page.locator(".profile-category-button").filter({ hasText: "教育经历" }).click();
    await page.locator(".profile-managed-row").filter({ hasText: schoolName }).click();
    await expect(detail.locator(".profile-detail-data-list")).toContainText("计算机相关专业");
    await expect(detail.locator(".profile-detail-data-list")).toContainText("数据结构、操作系统");
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
  await page.goto("/resume");
  await page.getByRole("button").filter({ hasText: "从个人资料库创建" }).click();
  await page.getByTestId("resume-studio-workbar").getByRole("button", { name: "返回", exact: true }).click();
  await page.goto("/jobs");
  await page.getByLabel("来源通用简历").selectOption({ index: 1 });
  await page.getByTestId("run-experience-match").click();
  await expect(page.locator(".match-row").first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("create-suggestion-draft").click();
  await expect(page.locator(".notice")).toBeVisible({ timeout: 15_000 });

  await page.goto("/resume");
  await page.getByTestId("resume-import-strip").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button").filter({ hasText: "根据岗位创建" }).click();
  await page.getByTestId("job-suggestion-draft-select").first().selectOption({ index: 0 });
  await page.getByTestId("new-resume-branch-name").first().fill(branchName);
  await page.getByTestId("create-job-resume").first().click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("resume-a4-page").first()).toBeVisible();
}
