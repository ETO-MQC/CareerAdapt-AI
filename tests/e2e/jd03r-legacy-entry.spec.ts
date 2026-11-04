import { expect, test } from "@playwright/test";
import { prepareCoreSourceResume, installCoreWritingProvider, readStore } from "./support/p51CoreWorkflow";

test.use({ actionTimeout: 15000 });
test("JD03R blocked proposal keeps apply disabled and writes no formal revision", async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.goto("/jobs");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能", exact: true });
  if (await skip.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) await skip.click();
  await prepareCoreSourceResume(page);
  await page.goto("/jobs");
  await page.getByTestId("job-title-input").fill("数据分析实习生 CORE-BUSINESS");
  await page.getByTestId("job-company-input").fill("Core Test");
  await page.getByTestId("job-raw-textarea").fill("岗位职责\n1. 参与数据清洗与分析。\n任职要求\n1. 了解 Python 或 SQL。\n2. 具备团队协作能力。");
  await page.getByTestId("save-job-raw-input").click();
  await page.getByTestId("job-manual-mode-dialog").click();
  const dialog = page.getByRole("dialog");
  const checks = dialog.getByRole("checkbox");
  for (let index=0;index<await checks.count();index++) await checks.nth(index).check();
  await dialog.getByTestId("commit-job").click();
  await expect(page.getByTestId("conversion-result")).toBeVisible();
  const job=(await readStore(page,"jobDescriptions")).find(row=>String(row.title).includes("CORE-BUSINESS"))!;

  await installCoreWritingProvider(page);
  // Preserve the exact historical blocked output. Only the external writer is controlled.
  await page.route("**/api/ai/structured", async route => {
    const body = route.request().postDataJSON();
    if (body.task !== "resume-tailor-batch") return route.fallback();
    expect(body.input.jobId).toBe(job.id);
    const targets = body.input.targets.filter((target: { sectionType: string }) => target.sectionType === "project");
    const suggestions = targets.map((target: { itemId: string; sectionType: string; sectionId: string; fieldPath: string; before: string[]; relevantRequirements: Array<{ requirementId: string }>; allowedEvidenceRefs: unknown[] }) => ({
      id: `blocked-${target.itemId}`, intensity: body.input.intensity, operation: "rewrite", targetSectionType: target.sectionType, targetSectionId: target.sectionId, targetItemId: target.itemId, targetFieldPath: target.fieldPath,
      before: target.before, after: ["参与需求梳理、原型设计和功能验收等 AI 应用项目工作。"], changedFields: ["highlights"], requirementIds: target.relevantRequirements.map(row => row.requirementId), targetKeywords: [], coveredKeywordsBefore: [], coveredKeywordsAfter: [], claimSupportLevel: "verified", evidenceRefs: target.allowedEvidenceRefs,
      rationale: "重排已确认的项目职责，保留原有事实和证据", riskLevel: "low", metrics: { textChangeRatio: 0.1, keywordGain: 0 }, status: "ready"
    }));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, task: body.task, promptVersion: "jd03r-blocked-fixture", output: { suggestions }, meta: { provider: "isolated-test", model: "synthetic", inputLength: 1, outputLength: 1, latencyMs: 1 } }) });
  });
  await page.goto(`/jobs?jobId=${encodeURIComponent(String(job.id))}`);
  await page.getByRole("radio", { name: /优化已有简历/ }).click();
  await page.getByLabel("来源通用简历").selectOption({ index: 1 });
  await page.getByTestId("analyze-and-generate-job-resume").click();
  await expect(page).toHaveURL(/\/resume\?.*branchId=/);
  const branchId = new URL(page.url()).searchParams.get("branchId")!;
  const before = await readStore(page,"resumeBranches");
  const revisionsBefore = await readStore(page,"resumeRevisions");
  const profileBefore = await readStore(page,"profiles");
  const panel = page.getByTestId("job-optimization-panel");
  await panel.getByRole("button", { name: "生成改写建议", exact: true }).click();
  if (await panel.getByRole("button", { name: "没有", exact: true }).waitFor({ state: "visible", timeout: 5000 }).then(()=>true).catch(()=>false)) {
    await panel.getByRole("button", { name: "没有", exact: true }).click();
    await panel.getByRole("button", { name: "提交回答", exact: true }).click();
  }
  await expect(panel.getByLabel("采用建议")).toBeDisabled();
  await expect(panel).toContainText("不能添加硬事实");
  await panel.getByRole("button", {name:"采用全部可直接应用建议",exact:true}).click();
  await panel.getByRole("button", {name:"确认并应用",exact:true}).click();
  await expect(panel.getByRole("button", {name:"应用选择并保存新版本",exact:true})).toBeDisabled();
  await expect(panel).toContainText("尚未选中任何修改");
  expect(await readStore(page,"resumeRevisions")).toEqual(revisionsBefore);
  expect(await readStore(page,"resumeBranches")).toEqual(before);
  expect(await readStore(page,"profiles")).toEqual(profileBefore);
  await testInfo.attach("jd03r-blocked-apply",{body:await page.screenshot(),contentType:"image/png"});
  await testInfo.attach("jd03r-blocked-state",{body:JSON.stringify({branchId,jobId:job.id,revisionCount:revisionsBefore.length,applyDisabled:true,unchangedBranchAndProfile:true}),contentType:"application/json"});
});
