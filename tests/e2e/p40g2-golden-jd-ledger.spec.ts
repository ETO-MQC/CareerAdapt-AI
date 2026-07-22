import { expect, test } from "@playwright/test";
import { AI_CODING_TASK_DESIGNER_JD } from "../fixtures/aiCodingTaskDesignerJd";

test("P4.0g.2 完整 JD 按层级核对并完整提交", async ({ page }) => {
  await page.goto("/jobs");
  await page.getByTestId("job-title-input").fill("AI Coding 任务设计专家");
  await page.getByTestId("job-company-input").fill("Golden Fixture 公司");
  await page.getByTestId("job-raw-textarea").fill(AI_CODING_TASK_DESIGNER_JD);
  await page.getByTestId("save-job-raw-input").click();
  await page.getByTestId("job-manual-mode").click();

  const review = page.locator(".job-draft-review");
  await expect(review.getByRole("heading", { name: "岗位核心使命" })).toBeVisible();
  await expect(review.getByRole("heading", { name: "工作职责" })).toBeVisible();
  await expect(review.getByText("以下 4 条满足任意 1 条即可")).toBeVisible();
  await expect(review.getByText("以下 6 条具备任意一条均为加分")).toBeVisible();
  await expect(review.locator(".job-draft-section").filter({ has: page.getByRole("heading", { name: "工作职责" }) }).locator(".review-row")).toHaveCount(7);
  await expect(review.locator(".verification-materials article")).toHaveCount(6);
  await expect(review.locator(".hiring-signals article")).toHaveCount(3);
  await expect(review.getByText("18 条子详情")).toHaveCount(0);
  await expect(review.getByText("6 条子详情")).toHaveCount(3);

  const cardTexts = await review.locator(".review-row > label strong").allTextContents();
  for (const metadata of ["Vibe Coding", "关联项目", "【Code】General coding", "职责内容", "参与要求", "岗位要求", "优先考虑"]) expect(cardTexts).not.toContain(metadata);
  await page.getByTestId("commit-job").click();
  await expect(page.locator(".jobs-list-panel .job-card").filter({ hasText: "AI Coding 任务设计专家" })).toBeVisible();
  await page.getByRole("tab", { name: "岗位要求" }).click();
  await expect(page.getByText("申请材料清单")).toBeVisible();
  await expect(page.getByText("招聘方关注特征", { exact: false })).toBeVisible();
});
