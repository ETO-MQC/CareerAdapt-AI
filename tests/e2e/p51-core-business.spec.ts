import { expect, test } from "@playwright/test";
import { completeCoreResumeWorkflow, prepareCoreSourceResume, readStore } from "./support/p51CoreWorkflow";

test.use({ actionTimeout: 15_000 });

test("pasted JD through confirmed Jobs intake, targeted revision, preview and real PDF", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/jobs");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能", exact: true });
  if (await skip.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await skip.click();
    await page.goto("/jobs");
  }
  await prepareCoreSourceResume(page);
  await page.goto("/jobs");
  await page.getByTestId("job-title-input").fill("数据分析实习生 CORE-BUSINESS");
  await page.getByTestId("job-company-input").fill("Core Test");
  await page.getByTestId("job-raw-textarea").fill("岗位职责\n1. 参与数据清洗与分析。\n任职要求\n1. 了解 Python 或 SQL。\n2. 具备团队协作能力。");
  await page.getByTestId("save-job-raw-input").click();
  await page.getByTestId("job-manual-mode-dialog").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const checks = dialog.getByRole("checkbox");
  for (let index = 0; index < await checks.count(); index++) await checks.nth(index).check();
  await dialog.getByTestId("commit-job").click();
  await expect(page.getByTestId("conversion-result")).toBeVisible();
  const job = (await readStore(page, "jobDescriptions")).find(job => String(job.title).includes("CORE-BUSINESS"))!;
  expect(job.id).toBeTruthy();
  await completeCoreResumeWorkflow(page, String(job.id));
});
