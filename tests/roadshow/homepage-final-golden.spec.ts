import { expect, test } from "@playwright/test";
import { installCoreWritingProvider, readStore } from "../e2e/support/p51CoreWorkflow";
import { openManualPageTab } from "../e2e/support/g7b2Ui";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

test("final homepage golden journey with deterministic provider", async ({ page }, info) => {
  test.setTimeout(360_000);
  const receipts: string[] = [];
  page.on("request", request => {
    if (request.method() !== "POST" || !request.url().includes("/api/agent/mcp?bridge=1")) return;
    const body = request.postDataJSON() as { action?: string; result?: { ok?: boolean; receipt?: { toolName?: string } } };
    if (body.action === "result" && body.result?.ok && body.result.receipt?.toolName) receipts.push(body.result.receipt.toolName);
  });
  page.setDefaultTimeout(15_000);
  const providerUrl = process.env.HERMES_INTEGRATION_PROVIDER_URL || process.env.HERMES_INTEGRATION_REAL_PROVIDER_URL;
  if (!providerUrl) throw new Error("hermes_provider_required");
  const model = process.env.HERMES_INTEGRATION_REAL_PROVIDER_MODEL || "careeradapt-test";
  await page.addInitScript(({ baseUrl, model }) => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
    baseUrl, model, provider: "openai-compatible", apiKeyConfigured: true
  })), { baseUrl: providerUrl, model });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  await expect(skip.or(page.locator(".career-context-trigger"))).toBeVisible({ timeout: 15_000 });
  if (await skip.isVisible()) await skip.click();
  await expect.poll(async () => {
    const response = await page.request.get("/api/agent/runtime/hermes/control");
    return response.ok() && Boolean((await response.json()).snapshot?.runReady);
  }, { timeout: 60_000 }).toBe(true);
  await page.locator(".career-context-trigger").click();
  const dialog = page.getByRole("dialog", { name: "人物与版本" });
  await dialog.getByRole("tab", { name: "新增人物" }).click();
  await dialog.getByLabel("人物名称").fill("路演验收人物");
  await dialog.getByRole("button", { name: "创建人物" }).click();
  await dialog.getByRole("button", { name: /路演验收人物/ }).first().click();
  await dialog.getByRole("button", { name: "使用此版本" }).click();
  const start = page.getByRole("button", { name: /从零整理我的经历/ });
  await expect(start).toBeEnabled();
  await start.click();
  await page.getByLabel("描述你的求职任务").fill("我最近在示例科技做了产品运营实习，时间是2026年7月至9月，主要负责用户反馈整理、竞品分析和产品功能优化。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const intake = page.getByRole("region", { name: "经历候选核对" });
  await expect(intake.getByRole("button", { name: "编辑后采用" })).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => {
    const sessionId = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    const session = (await readStore(page, "agentSessions")).find(row => row.id === sessionId);
    return (session?.hermesRun as { status?: string } | undefined)?.status;
  }, { timeout: 60_000 }).toBe("completed");
  await intake.getByRole("button", { name: "忽略", exact: true }).click();
  await expect(intake.getByRole("button", { name: /已核对 1\/1/ })).toBeVisible();
  await intake.getByRole("button", { name: /已核对 1\/1/ }).click();
  await intake.getByRole("button", { name: "重新打开", exact: true }).click();
  await intake.getByRole("button", { name: "编辑后采用" }).click();
  await intake.getByLabel("角色", { exact: true }).fill("产品运营实习生");
  await intake.getByRole("button", { name: "保存并采用", exact: true }).click();
  await page.getByLabel("描述你的求职任务").fill("完成整理");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const review = page.getByRole("region", { name: "最终资料草稿审核" });
  await expect(review).toBeVisible({ timeout: 30_000 });
  await review.getByRole("button", { name: "全部采用" }).click();
  await review.getByRole("button", { name: "确认并写入个人资料库" }).click();
  await expect.poll(async () => {
    const sessionId = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    const session = (await readStore(page, "agentSessions")).find(row => row.id === sessionId);
    return (session?.taskState as { knownSlots?: { profileIntakeCommitOutcome?: { status?: string } } })?.knownSlots?.profileIntakeCommitOutcome?.status;
  }, { timeout: 30_000 }).toBe("COMMITTED_VERIFIED");
  const profiles = await readStore(page, "profiles");
  const profile = profiles.find(row => row.name === "路演验收人物");
  expect(profile).toBeTruthy();
  await page.getByRole("link", { name: "个人资料库", exact: true }).click();
  await expect(page.getByText("示例科技").first()).toBeVisible();
  await page.getByRole("link", { name: "我的简历", exact: true }).click();
  await page.getByRole("button", { name: /从个人资料库创建/ }).click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  const preview = page.getByTestId("resume-a4-page").first();
  await expect(preview).toContainText("示例科技");
  await expect(preview).not.toContainText(/operationId|workflow|diagnostic/iu);
  const branches = await readStore(page, "resumeBranches");
  expect(branches.some(row => row.profileId === profile?.id && row.branchPurpose === "general" && row.currentRevisionId)).toBe(true);
  expect(await readStore(page, "profiles")).toEqual(profiles);
  const branch = branches.find(row => row.profileId === profile?.id && row.branchPurpose === "general" && row.currentRevisionId)!;
  await page.getByRole("link", { name: "AI 助手", exact: true }).click();
  const send = async (text: string) => {
    await page.getByLabel("描述你的求职任务").fill(text);
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
  };
  await send("保存这个岗位 CORE-JD：公司 Core Test，数据分析实习生，负责数据清洗，要求了解 Python 或 SQL。");
  const confirmation = page.locator(".agent-confirmation");
  await expect.poll(async () => await confirmation.isVisible()
    || (await readStore(page, "jobDescriptions")).some(job => String(job.title).includes("CORE-JD")), { timeout: 45_000 }).toBe(true);
  if (await confirmation.isVisible()) await confirmation.getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(async () => (await readStore(page, "jobDescriptions")).some(job => String(job.title).includes("CORE-JD")), { timeout: 30_000 }).toBe(true);
  const job = (await readStore(page, "jobDescriptions")).find(row => String(row.title).includes("CORE-JD"))!;
  expect(String(job.rawText)).toContain("Python");
  const choice = page.getByRole("region", { name: "选择要分析的岗位" });
  await expect(choice).toBeVisible({ timeout: 30_000 });
  await choice.getByRole("checkbox", { name: /数据分析实习生 CORE-JD · Core Test/ }).check();
  await choice.getByRole("button", { name: "分析所选岗位" }).click();
  const impact = page.getByRole("region", { name: "经历与岗位影响报告" });
  await expect(impact).toContainText("数据分析实习生 CORE-JD", { timeout: 30_000 });
  await page.getByLabel("描述你的求职任务").fill("P51-C02-FIT 这个岗位适合我吗？");
  await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect.poll(async () => {
    const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    const session = (await readStore(page, "agentSessions")).find(row => row.id === id);
    const task = session?.taskState as { workflowId?: string; completionStatus?: string; selectedEntities?: { jobId?: string; resumeId?: string; revisionId?: string } } | undefined;
    return task?.workflowId === "analyze_job_fit" && task.completionStatus === "completed" && task.selectedEntities?.jobId === job.id
      && task.selectedEntities?.resumeId === branch.id && task.selectedEntities?.revisionId === branch.currentRevisionId;
  }, { timeout: 60_000 }).toBe(true);
  await page.getByRole("button", { name: "查看匹配分析" }).click();
  await expect(page.getByRole("complementary", { name: "任务产物" }).getByRole("list", { name: "岗位要求与证据" })).toBeVisible();
  expect(await readStore(page, "profiles")).toEqual(profiles);
  const drawer = page.getByRole("complementary", { name: "任务产物" });
  await drawer.getByRole("tab", { name: "经历与岗位影响" }).click();
  await impact.getByRole("link", { name: "前往此岗位的简历工作区" }).click();
  await expect(page).toHaveURL(/\/jobs\?jobId=/);
  await page.getByRole("radio", { name: /优化已有简历/ }).click();
  await page.getByLabel("来源通用简历").selectOption(String(branch.id));
  await installCoreWritingProvider(page);
  await page.route("**/api/ai/structured", async route => {
    const request = route.request().postDataJSON() as { task: string; input: { intensity: string; targets?: Array<{
      itemId: string; sectionType: string; sectionId: string; fieldPath: string; before: string | string[];
      relevantRequirements: Array<{ requirementId: string }>; allowedEvidenceRefs: unknown[] }> } };
    if (request.task !== "resume-tailor-batch") return route.fallback();
    const targets = (request.input.targets ?? []).filter(target => /用户反馈整理/u.test(JSON.stringify(target.before)));
    const rephrase = (text: string) => text.replace("负责用户反馈整理、竞品分析和产品功能优化", "实习期间，负责用户反馈整理、竞品分析和产品功能优化");
    const suggestions = targets.map(target => ({ id: `golden-${target.itemId}-${target.fieldPath}`,
      intensity: request.input.intensity, operation: "rewrite", targetSectionType: target.sectionType,
      targetSectionId: target.sectionId, targetItemId: target.itemId, targetFieldPath: target.fieldPath,
      before: target.before, after: Array.isArray(target.before) ? target.before.map(rephrase) : rephrase(target.before),
      changedFields: [target.fieldPath.split(".").at(-1)], requirementIds: target.relevantRequirements.map(item => item.requirementId),
      targetKeywords: [], coveredKeywordsBefore: [], coveredKeywordsAfter: [], claimSupportLevel: "verified",
      evidenceRefs: target.allowedEvidenceRefs, rationale: "依据已确认实习经历补充语境", riskLevel: "low", metrics: { textChangeRatio: 0.1, keywordGain: 0 }, status: "ready" }));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, task: request.task,
      promptVersion: "golden-test", output: { suggestions }, meta: { provider: "deterministic", model: "golden-test", inputLength: 1, outputLength: 1, latencyMs: 1 } }) });
  });
  await page.getByTestId("analyze-and-generate-job-resume").click();
  await expect(page).toHaveURL(/\/resume\?.*branchId=/, { timeout: 25_000 });
  const branchId = new URL(page.url()).searchParams.get("branchId")!;
  const before = (await readStore(page, "resumeBranches")).find(row => row.id === branchId)!;
  const revisions = await readStore(page, "resumeRevisions");
  const panel = page.getByTestId("job-optimization-panel");
  await panel.getByRole("button", { name: "生成改写建议", exact: true }).click();
  await expect.poll(async () => await panel.getByLabel("采用建议").first().isVisible()
    || await panel.getByRole("button", { name: "没有", exact: true }).isVisible(), { timeout: 30_000 }).toBe(true);
  const no = panel.getByRole("button", { name: "没有", exact: true });
  if (await no.isVisible()) {
    await no.click();
    await panel.getByRole("button", { name: "提交回答", exact: true }).click();
    await panel.getByRole("button", { name: "继续生成改写建议", exact: true }).click();
  }
  await expect(panel.getByLabel("采用建议").first()).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0, { timeout: 30_000 });
  const available = panel.getByLabel("采用建议");
  const enabled = [];
  for (let index = 0; index < await available.count(); index++) {
    if (await available.nth(index).isEnabled()) enabled.push(available.nth(index));
  }
  expect(enabled.length).toBeGreaterThan(0);
  for (const checkbox of enabled) await checkbox.uncheck();
  await enabled[0].check();
  await panel.getByRole("button", { name: "确认并应用", exact: true }).click();
  expect(await readStore(page, "resumeRevisions")).toEqual(revisions);
  const confirmationCard = panel.locator(".tailoring-confirmation-card");
  if (await confirmationCard.count()) {
    const editor = confirmationCard.getByLabel("编辑最终句");
    await expect(editor).toBeVisible();
    await editor.fill("实习期间，负责用户反馈整理、竞品分析和产品功能优化。");
    await confirmationCard.getByRole("button", { name: "编辑后采用", exact: true }).click();
  }
  await panel.getByRole("button", { name: "应用选择并保存新版本", exact: true }).click();
  await expect.poll(async () => (await readStore(page, "resumeBranches")).find(row => row.id === branchId)?.revision, { timeout: 30_000 }).toBe(Number(before.revision) + 1);
  const after = (await readStore(page, "resumeBranches")).find(row => row.id === branchId)!;
  expect(await readStore(page, "resumeRevisions")).toHaveLength(revisions.length + 1);
  expect((await readStore(page, "resumeBranches")).find(row => row.id === branch.id)).toEqual(branch);
  expect(await readStore(page, "profiles")).toEqual(profiles);
  await openManualPageTab(page);
  const request = page.waitForRequest(item => item.url().includes("/api/resume-export/pdf") && item.method() === "POST");
  const download = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ snapshot: { branchId, currentRevisionId: after.currentRevisionId } });
  const pdf = info.outputPath("golden-homepage.pdf");
  await (await download).saveAs(pdf);
  expect(readFileSync(pdf).subarray(0, 5).toString()).toBe("%PDF-");
  const binary = ["E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe", "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"].find(existsSync) ?? "pdftotext";
  const pdfText = execFileSync(binary, [pdf, "-"], { encoding: "utf8" });
  expect(pdfText).toContain("示例科技");
  expect(pdfText).toContain("用户反馈");
  expect(pdfText.replace(/\s/gu, "")).toContain("用户反馈整理、竞品分析");
  await page.getByRole("link", { name: "AI 助手", exact: true }).click();
  const oldSession = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
  await page.getByRole("button", { name: "新任务", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"))).not.toBe(oldSession);
  receipts.length = 0;
  await send("请读取当前人物、刚保存的 CORE-JD 岗位和对应岗位简历的最新版本。");
  await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText(`岗位简历版本 ${after.revision}`, { timeout: 60_000 });
  await expect.poll(() => ["career.profile.get", "career.job.get", "career.resume.get"].every(name => receipts.includes(name)), { timeout: 15_000 }).toBe(true);
  expect((await readStore(page, "resumeBranches")).find(row => row.id === branchId)?.currentRevisionId).toBe(after.currentRevisionId);
});
