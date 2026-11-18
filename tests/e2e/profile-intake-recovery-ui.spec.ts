import { expect, test } from "@playwright/test";
import type { ProfileIntakeOperationRequest } from "@/services/storage/repositories";
import { readStore } from "./support/p51CoreWorkflow";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

type BrowserHarness = {
  prepareUi(name: string, committed: boolean): Promise<{ request: ProfileIntakeOperationRequest; personId: string;
    sessionId: string; sessionRevision: number; before: { branches: unknown; revisions: unknown } }>;
  prepareImpactUi(name: string): Promise<{ jobId: string; existing: { branch: { id: string; revision: number }; revision: { id: string } } }>;
  read(name: string): Promise<{ version: number; itemCount: number }>;
  inspectUi(name: string, request: ProfileIntakeOperationRequest, personId: string): Promise<{
    version: number; itemCount: number; branches: unknown; revisions: unknown; receiptOperationId?: string; receiptFingerprint?: string }>;
  advanceProfile(name: string): Promise<unknown>;
  seedLegacy(name: string): Promise<void>;
  simulateLateOutcome(name: string, sessionId: string, revision: number): Promise<string>;
};
declare global { interface Window { intakeRecoveryUiHarness: BrowserHarness } }

test("multiple generated suggestions remain staged until one confirmation", async ({ page, context }, testInfo) => {
  const baseUrl = process.env.HERMES_INTEGRATION_PROVIDER_URL;
  if (!baseUrl) throw new Error("synthetic_hermes_provider_required");
  await page.addInitScript(({ url }) => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl: url,
    model: "careeradapt-test", provider: "openai-compatible", apiKeyConfigured: true })), { url: baseUrl });
  const requests: unknown[] = [];
  await page.route("**/api/ai/structured", async route => {
    const body = route.request().postDataJSON() as { task?: string; input?: { target?: { sectionId: string; itemId: string; fieldPath: string };
      currentContent?: { fieldValue?: string | string[] }; relevantRequirements?: Array<{ requirementId: string; keywords: string[] }>; allowedEvidenceRefs?: unknown[] } };
    if (body.task !== "resume-tailor-diff" || !body.input?.target) return route.continue();
    requests.push(body.input);
    const original = body.input.currentContent?.fieldValue ?? "";
    const change = (text: string) => text.replace("参与", "参与了");
    const value = Array.isArray(original) ? original.map(change) : change(original);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, task: body.task, promptVersion: "impact-test",
      output: { diffs: [{ target: { sectionId: body.input.target.sectionId, itemId: body.input.target.itemId,
        fieldPath: body.input.target.fieldPath }, operation: "replace", original, value, reason: "根据已有来源明确项目经历。",
        requirementIds: (body.input.relevantRequirements ?? []).map(item => item.requirementId), targetKeywords: [],
        evidenceRefs: body.input.allowedEvidenceRefs ?? [], supportLevel: "verified" }], clarifications: [] },
      meta: { provider: "fixture", model: "impact-test", inputLength: 1, outputLength: 1, latencyMs: 1 } }) });
  });
  await page.goto("/ai-workspace");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.isVisible()) await skip.click();
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  const prepared = await page.evaluate(() => (window as unknown as { intakeConcurrency: BrowserHarness }).intakeConcurrency.prepareImpactUi("CareerAdaptDb"));
  await page.reload();
  await expect.poll(async () => (await skip.isVisible()) || (await page.getByRole("button", { name: "重新查询保存状态" }).isVisible())).toBe(true);
  if (await skip.isVisible()) await skip.click();
  await page.getByRole("button", { name: "重新查询保存状态" }).click();
  const selector = page.getByRole("region", { name: "选择要分析的岗位" });
  await selector.getByLabel(/数据分析岗位 · 验收公司/).check();
  await selector.getByRole("button", { name: "分析所选岗位" }).click();
  const report = page.getByRole("region", { name: "经历与岗位影响报告" });
  await report.getByLabel("岗位简历").selectOption(prepared.existing.branch.id);
  await report.getByLabel("资料变化").selectOption({ index: 1 });
  await report.getByRole("button", { name: "核对加入建议" }).click();
  const branches = await readStore(page, "resumeBranches");
  const revisions = await readStore(page, "resumeRevisions");
  const profiles = await readStore(page, "profiles");
  const jobs = await readStore(page, "jobDescriptions");
  await report.getByRole("button", { name: "生成岗位修改建议" }).click();
  await expect.poll(async () => (await report.getByRole("button", { name: "编辑后采用", exact: true }).count()) > 0
    || (await report.getByText("现有简历没有生成可安全采用的字段修改", { exact: false }).count()) > 0
    || (await page.getByText("采用操作未完成", { exact: true }).count()) > 0, { timeout: 30_000 }).toBe(true);
  if (await page.getByText("采用操作未完成", { exact: true }).isVisible()) {
    throw new Error(`generation_failed: ${await page.getByRole("region", { name: "操作通知" }).innerText()}`);
  }
  if (await report.getByText("现有简历没有生成可安全采用的字段修改", { exact: false }).count()) {
    const sessions = await readStore(page, "agentSessions");
    throw new Error(`empty_generation: ${JSON.stringify({ requests, session: sessions.find(row => row.id === "browser-session")?.taskState })}`);
  }
  await expect(report.getByRole("button", { name: "编辑后采用", exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const diffs = report.getByRole("region", { name: "核对经历加入建议" }).locator(":scope > article");
  await expect(diffs).toHaveCount(2);
  const original = (await diffs.first().locator("del").innerText()).trim();
  const editedText = original.replace("参与", "参与了").replace(/。$/u, "");
  const ignoredText = (await diffs.nth(1).locator("ins").innerText()).trim();
  await expect.poll(async () => { const response = await page.request.get("/api/agent/runtime/hermes/control");
    return response.ok() && Boolean((await response.json()).snapshot?.runReady); }, { timeout: 60_000 }).toBe(true);
  await page.getByLabel("描述你的求职任务").fill("第一条采用，第三条忽略。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(report.getByRole("button", { name: "采用经历", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
  await expect(diffs.nth(1).getByRole("button", { name: "已忽略", exact: true })).toBeVisible();
  await diffs.first().getByRole("button", { name: "编辑后采用", exact: true }).click();
  await diffs.first().getByLabel("编辑建议内容").fill(editedText);
  await diffs.first().getByRole("button", { name: "采用编辑" }).click();
  expect(await readStore(page, "resumeBranches")).toEqual(branches);
  expect(await readStore(page, "resumeRevisions")).toEqual(revisions);
  await report.getByRole("button", { name: "应用已选修改" }).click();
  await expect(report).toContainText("已保存新版本");
  const after = await readStore(page, "resumeBranches");
  const current = after.find(row => row.id === prepared.existing.branch.id)!;
  expect(current.revision).toBe(prepared.existing.branch.revision + 1);
  expect(JSON.stringify(current)).toContain(editedText);
  expect(JSON.stringify(current)).not.toContain(ignoredText);
  expect(after.filter(row => row.id !== prepared.existing.branch.id)).toEqual(branches.filter(row => row.id !== prepared.existing.branch.id));
  expect((await readStore(page, "profiles")).find(row => row.id === "browser-profile")).toEqual(profiles.find(row => row.id === "browser-profile"));
  expect(await readStore(page, "jobDescriptions")).toEqual(jobs);
  expect((await readStore(page, "resumeRevisions")).find(row => row.id === prepared.existing.revision.id))
    .toEqual(revisions.find(row => row.id === prepared.existing.revision.id));
  await page.screenshot({ path: testInfo.outputPath("multi-review.png"), fullPage: true });
  const resumePage = await context.newPage();
  await resumePage.goto(`/resume?branchId=${encodeURIComponent(prepared.existing.branch.id)}`);
  const preview = resumePage.locator(".resume-preview-stage").getByTestId("resume-a4-page").first();
  await expect(preview).toContainText("示例数据分析");
  await expect(preview).toContainText(editedText);
  await expect(preview).not.toContainText(ignoredText);
  await preview.screenshot({ path: testInfo.outputPath("multi-review-preview.png") });
  const download = resumePage.waitForEvent("download");
  const exportRequest = resumePage.waitForRequest(request => request.url().includes("/api/resume-export/pdf") && request.method() === "POST");
  await resumePage.getByRole("button", { name: "下载 PDF", exact: true }).click();
  expect((await exportRequest).postDataJSON()).toMatchObject({ snapshot: { branchId: prepared.existing.branch.id,
    branchRevision: current.revision, currentRevisionId: current.currentRevisionId } });
  const pdf = testInfo.outputPath("multi-review.pdf");
  await (await download).saveAs(pdf);
  const binary = ["E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe", "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"].find(existsSync) ?? "pdftotext";
  const pdfText = execFileSync(binary, [pdf, "-"], { encoding: "utf8" }).replace(/\s/gu, "");
  expect(pdfText).toContain("示例数据分析");
  expect(pdfText).toContain(editedText.replace(/\s/gu, ""));
  expect(pdfText).not.toContain(ignoredText.replace(/\s/gu, ""));
  expect(pdfText).toContain("匿名");
});

test("Hermes clarifies same-name jobs and continues with a numbered answer", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const baseUrl = process.env.HERMES_INTEGRATION_PROVIDER_URL;
  if (!baseUrl) throw new Error("synthetic_hermes_provider_required");
  await page.addInitScript(({ url }) => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl: url,
    model: "careeradapt-test", provider: "openai-compatible", apiKeyConfigured: true })), { url: baseUrl });
  await page.goto("/ai-workspace");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.isVisible()) await skip.click();
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  await page.evaluate(() => (window as unknown as { intakeConcurrency: BrowserHarness }).intakeConcurrency.prepareImpactUi("CareerAdaptDb"));
  await page.reload();
  await expect.poll(async () => (await skip.isVisible()) || (await page.getByRole("button", { name: "重新查询保存状态" }).isVisible())).toBe(true);
  if (await skip.isVisible()) await skip.click();
  await page.getByRole("button", { name: "重新查询保存状态" }).click();
  const selector = page.getByRole("region", { name: "选择要分析的岗位" });
  await expect(selector).toBeVisible();
  await expect.poll(async () => {
    const response = await page.request.get("/api/agent/runtime/hermes/control");
    if (!response.ok()) return false;
    const body = await response.json();
    return Boolean(body.snapshot?.processReady && body.snapshot?.providerReady && body.snapshot?.careerMcpReady
      && body.snapshot?.toolSurfaceReady && body.snapshot?.runReady);
  }, { timeout: 60_000 }).toBe(true);
  await page.getByLabel("描述你的求职任务").fill("分析数据分析岗位。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(selector).toContainText("你想分析哪一个岗位？", { timeout: 60_000 });
  await expect(selector.locator("input:checked")).toHaveCount(0);
  const secondCompany = (await selector.locator("ol li").nth(1).innerText()).split(" · ")[0];
  await expect.poll(async () => {
    const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    const session = (await readStore(page, "agentSessions")).find(row => row.id === id);
    return (session?.hermesRun as { status?: string } | undefined)?.status;
  }, { timeout: 60_000 }).toBe("completed");
  await page.reload();
  await expect(selector).toContainText("你想分析哪一个岗位？");
  const previousRunId = ((await readStore(page, "agentSessions")).find(row => row.id === "browser-session")?.hermesRun as { runId?: string } | undefined)?.runId;
  await page.getByLabel("描述你的求职任务").fill("就看第二个。");
  await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(selector).toContainText("已根据你的描述预选岗位", { timeout: 60_000 });
  await expect(selector.locator("input:checked")).toHaveCount(1);
  await expect(selector.getByLabel(new RegExp(secondCompany))).toBeChecked();
  await expect.poll(async () => {
    const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    const session = (await readStore(page, "agentSessions")).find(row => row.id === id);
    const run = session?.hermesRun as { status?: string; runId?: string } | undefined;
    return run?.runId !== previousRunId ? run?.status : undefined;
  }, { timeout: 60_000 }).toBe("completed");
  await page.screenshot({ path: testInfo.outputPath("natural-language-clarification.png"), fullPage: true });
  await selector.getByRole("button", { name: "分析所选岗位" }).click();
  await expect(page.getByRole("region", { name: "经历与岗位影响报告" })).toBeVisible();
  await page.getByLabel("描述你的求职任务").fill("这段经历对岗位有什么帮助？");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("岗位要求：", { timeout: 60_000 });
  await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("证据：");
  await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("来源：");
});

test("confirmed impact adds an item to an existing job branch as a new revision", async ({ page, context }, testInfo) => {
  const baseUrl = process.env.HERMES_INTEGRATION_PROVIDER_URL;
  if (!baseUrl) throw new Error("synthetic_hermes_provider_required");
  await page.addInitScript(({ url }) => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl: url,
    model: "careeradapt-test", provider: "openai-compatible", apiKeyConfigured: true })), { url: baseUrl });
  await page.goto("/ai-workspace");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.isVisible()) await skip.click();
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  const prepared = await page.evaluate(() => (window as unknown as { intakeConcurrency: BrowserHarness }).intakeConcurrency.prepareImpactUi("CareerAdaptDb"));
  const profiles = await readStore(page, "profiles");
  const before = await readStore(page, "resumeBranches");
  const revisions = await readStore(page, "resumeRevisions");
  await page.reload();
  await expect.poll(async () => (await skip.isVisible()) || (await page.getByRole("button", { name: "重新查询保存状态" }).isVisible())).toBe(true);
  if (await skip.isVisible()) await skip.click();
  await page.getByRole("button", { name: "重新查询保存状态" }).click();
  const selector = page.getByRole("region", { name: "选择要分析的岗位" });
  await selector.getByLabel(/数据分析岗位 · 验收公司/).check();
  await selector.getByRole("button", { name: "分析所选岗位" }).click();
  const report = page.getByRole("region", { name: "经历与岗位影响报告" });
  await expect(report).toBeVisible();
  await report.getByLabel("岗位简历").selectOption(prepared.existing.branch.id);
  await report.getByLabel("资料变化").selectOption({ index: 1 });
  await report.getByRole("button", { name: "核对加入建议" }).click();
  await expect(report.getByRole("region", { name: "核对经历加入建议" })).toBeVisible();
  await page.reload();
  await expect.poll(async () => (await skip.isVisible()) || (await report.isVisible())).toBe(true);
  if (await skip.isVisible()) await skip.click();
  await expect(report.getByRole("region", { name: "核对经历加入建议" })).toBeVisible();
  await report.getByRole("button", { name: "忽略", exact: true }).click();
  expect(await readStore(page, "resumeBranches")).toEqual(before);
  await report.getByLabel("岗位简历").selectOption(prepared.existing.branch.id);
  await report.getByLabel("资料变化").selectOption({ index: 1 });
  await report.getByRole("button", { name: "核对加入建议" }).click();
  await report.getByRole("button", { name: "采用经历", exact: true }).click();
  await report.getByRole("button", { name: "应用已选修改" }).click();
  await expect(report).toContainText("已保存新版本");
  const after = await readStore(page, "resumeBranches");
  expect(after.find(row => row.id === prepared.existing.branch.id)?.revision).toBe(prepared.existing.branch.revision + 1);
  expect(after.filter(row => row.id !== prepared.existing.branch.id)).toEqual(before.filter(row => row.id !== prepared.existing.branch.id));
  expect((await readStore(page, "profiles")).find(row => row.id === "browser-profile"))
    .toEqual(profiles.find(row => row.id === "browser-profile"));
  expect((await readStore(page, "resumeRevisions")).find(row => row.id === prepared.existing.revision.id))
    .toEqual(revisions.find(row => row.id === prepared.existing.revision.id));
  await page.screenshot({ path: testInfo.outputPath("existing-branch-revision.png"), fullPage: true });
  const resumePage = await context.newPage();
  await resumePage.goto(`/resume?branchId=${encodeURIComponent(prepared.existing.branch.id)}`);
  const preview = resumePage.locator(".resume-preview-stage").getByTestId("resume-a4-page").first();
  await expect(preview).toContainText("示例数据分析");
  await preview.screenshot({ path: testInfo.outputPath("existing-branch-preview.png") });
  const downloadPromise = resumePage.waitForEvent("download");
  await resumePage.getByRole("button", { name: "下载 PDF", exact: true }).click();
  const pdf = testInfo.outputPath("existing-branch.pdf");
  await (await downloadPromise).saveAs(pdf);
  const binary = ["E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe", "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"].find(existsSync) ?? "pdftotext";
  expect(execFileSync(binary, [pdf, "-"], { encoding: "utf8" }).replace(/\s/gu, "")).toContain("示例数据分析");
  await resumePage.close();
  const oldSessionId = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
  await page.getByRole("button", { name: "新任务", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"))).not.toBe(oldSessionId);
  await expect(page.locator(".agent-conversation").getByText("确认保存", { exact: true })).toHaveCount(0);
  await page.getByLabel("描述你的求职任务").fill("继续看看刚才那个数据分析岗位。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("请选择公司", { timeout: 60_000 });
  await page.getByLabel("描述你的求职任务").fill("选择验收公司数据分析岗位。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText(`当前岗位简历版本 ${prepared.existing.branch.revision + 1}`, { timeout: 60_000 });
  await page.screenshot({ path: testInfo.outputPath("new-session-recall.png"), fullPage: true });
});

for (const committed of [true, false]) {
  test(`original operation is queried from the agent workspace (${committed ? "committed" : "not sent"})`, async ({ page }) => {
    await page.goto("/ai-workspace");
    const skipSetup = page.getByRole("button", { name: "跳过，先体验其他功能" });
    if (await skipSetup.isVisible()) await skipSetup.click();
    await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
    await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
    const prepared = await page.evaluate(async (wasCommitted) => {
      const harness = (window as unknown as { intakeConcurrency: BrowserHarness }).intakeConcurrency;
      return harness.prepareUi("CareerAdaptDb", wasCommitted);
    }, committed);
    await page.reload();
    await expect.poll(async () => (await skipSetup.isVisible()) || (await page.getByRole("button", { name: "重新查询保存状态" }).isVisible())).toBe(true);
    if (await skipSetup.isVisible()) await skipSetup.click();
    const status = committed ? "资料已保存，并已读取核实。" : "保存结果尚未核实，原始操作已保留。请查询保存状态。";
    await expect(page.getByText("保存结果尚未核实，原始操作已保留。请查询保存状态。")).toBeVisible();
    await page.getByRole("button", { name: "重新查询保存状态" }).click();
    await expect(page.getByText(status)).toBeVisible();
    await page.reload();
    await expect.poll(async () => (await skipSetup.isVisible()) || (await page.getByText(status).isVisible())).toBe(true);
    if (await skipSetup.isVisible()) await skipSetup.click();
    await expect(page.getByText(status)).toBeVisible();
    await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
    await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
    const result = await page.evaluate(async (input) => (window as unknown as { intakeConcurrency: BrowserHarness })
      .intakeConcurrency.inspectUi("CareerAdaptDb", input.request, input.personId), prepared);
    expect(result).toMatchObject({ version: committed ? 2 : 1, itemCount: committed ? 1 : 0,
      receiptOperationId: committed ? "browser-ui-original-operation" : undefined,
      receiptFingerprint: committed ? prepared.request.frozen?.fingerprint : undefined,
      branches: prepared.before.branches, revisions: prepared.before.revisions });
  });
}

test("receipt lookup failure keeps the original operation unknown without writing", async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      if (localStorage.getItem("test-receipt-unavailable") === "1" && typeof key === "string" && key.startsWith("profileIntakeOperation:v1:")) {
        throw new Error("test_receipt_unavailable");
      }
      return original.call(this, key);
    };
  });
  await page.goto("/ai-workspace");
  const skipSetup = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skipSetup.isVisible()) await skipSetup.click();
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  await page.evaluate(async () => { await (window as unknown as { intakeConcurrency: BrowserHarness }).intakeConcurrency.prepareUi("CareerAdaptDb", false);
    localStorage.setItem("test-receipt-unavailable", "1"); });
  await page.reload();
  if (await skipSetup.isVisible()) await skipSetup.click();
  await page.getByRole("button", { name: "重新查询保存状态" }).click();
  await expect(page.getByRole("button", { name: "重新查询保存状态" })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("test-receipt-unavailable"));
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  expect(await page.evaluate(async () => (window as unknown as { intakeConcurrency: BrowserHarness }).intakeConcurrency.read("CareerAdaptDb")))
    .toEqual({ version: 1, itemCount: 0 });
  await page.getByRole("button", { name: "重新查询保存状态" }).click();
  await expect(page.getByRole("button", { name: "重新查询保存状态" })).toBeVisible();
});

test("a changed Profile is not overwritten by the original recovery", async ({ page }) => {
  await page.goto("/ai-workspace");
  const skipSetup = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skipSetup.isVisible()) await skipSetup.click();
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  await page.evaluate(async () => { const harness = (window as unknown as { intakeConcurrency: BrowserHarness }).intakeConcurrency;
    await harness.prepareUi("CareerAdaptDb", false); await harness.advanceProfile("CareerAdaptDb"); });
  await page.reload();
  if (await skipSetup.isVisible()) await skipSetup.click();
  await page.getByRole("button", { name: "重新查询保存状态" }).click();
  await expect(page.getByText("保存结果尚未核实，原始操作已保留。请查询保存状态。")).toBeVisible();
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  expect(await page.evaluate(async () => (window as unknown as { intakeConcurrency: BrowserHarness }).intakeConcurrency.read("CareerAdaptDb")))
    .toEqual({ version: 2, itemCount: 0 });
});

test("two workspace pages query the same unknown operation without writing", async ({ page, context }) => {
  await page.goto("/ai-workspace");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.isVisible()) await skip.click();
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  const prepared = await page.evaluate(async () => (window as unknown as { intakeConcurrency: BrowserHarness })
    .intakeConcurrency.prepareUi("CareerAdaptDb", false));
  await page.reload();
  if (await skip.isVisible()) await skip.click();
  await expect(page.getByRole("button", { name: "重新查询保存状态" })).toBeVisible();
  const second = await context.newPage();
  await second.goto("/ai-workspace");
  const secondSkip = second.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await secondSkip.isVisible()) await secondSkip.click();
  await expect(second.getByRole("button", { name: "重新查询保存状态" })).toBeVisible();
  await Promise.all([page.getByRole("button", { name: "重新查询保存状态" }).click(),
    second.getByRole("button", { name: "重新查询保存状态" }).click()]);
  await expect(page.getByText("保存结果尚未核实，原始操作已保留。请查询保存状态。")).toBeVisible();
  await second.reload();
  if (await secondSkip.isVisible()) await secondSkip.click();
  await expect(second.getByText("保存结果尚未核实，原始操作已保留。请查询保存状态。")).toBeVisible();
  await second.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await second.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  const result = await second.evaluate(async (input) => (window as unknown as { intakeConcurrency: BrowserHarness })
    .intakeConcurrency.inspectUi("CareerAdaptDb", input.request, input.personId), prepared);
  expect(result).toMatchObject({ version: 1, itemCount: 0, receiptOperationId: undefined,
    branches: prepared.before.branches, revisions: prepared.before.revisions });
  const late = await second.evaluate(async (input) => (window as unknown as { intakeConcurrency: BrowserHarness })
    .intakeConcurrency.simulateLateOutcome("CareerAdaptDb", input.sessionId, input.sessionRevision), prepared);
  expect(late).toBe("revision_conflict");
  await second.reload();
  if (await secondSkip.isVisible()) await secondSkip.click();
  await expect(second.getByText("保存结果尚未核实，原始操作已保留。请查询保存状态。")).toBeVisible();
});

test("a legacy receipt requires a manual Profile check", async ({ page }) => {
  await page.goto("/ai-workspace");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.isVisible()) await skip.click();
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  await page.evaluate(async () => { const harness = (window as unknown as { intakeConcurrency: BrowserHarness }).intakeConcurrency;
    await harness.prepareUi("CareerAdaptDb", false); await harness.seedLegacy("CareerAdaptDb"); });
  await page.reload();
  if (await skip.isVisible()) await skip.click();
  await page.getByRole("button", { name: "重新查询保存状态" }).click();
  await expect(page.getByText("这条历史记录缺少完整核验信息，无法自动判断是否已经保存。")).toBeVisible();
  await expect(page.getByRole("button", { name: "恢复原保存操作" })).toHaveCount(0);
  await page.getByRole("button", { name: "查看资料库" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});


test("selector layout supports one two and four jobs with keyboard selection", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/ai-workspace");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.isVisible()) await skip.click();
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  await page.evaluate(async () => { const h = (window as unknown as { intakeConcurrency: { prepareImpactUi(name: string): Promise<unknown>; setVisibleSelectorJobs(name: string, count: number): Promise<void> } }).intakeConcurrency;
    await h.prepareImpactUi("CareerAdaptDb"); await h.setVisibleSelectorJobs("CareerAdaptDb", 1); });
  await page.reload();
  await expect.poll(async () => (await skip.isVisible()) || (await page.getByRole("button", { name: "重新查询保存状态" }).isVisible())).toBe(true);
  if (await skip.isVisible()) await skip.click();
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.evaluate(async () => (window as unknown as { intakeConcurrency: { setVisibleSelectorJobs(name: string, count: number): Promise<void> } }).intakeConcurrency.setVisibleSelectorJobs("CareerAdaptDb", 1));
  await page.getByRole("button", { name: "重新查询保存状态" }).click();
  const selector = page.getByRole("region", { name: "选择要分析的岗位" });
  await expect(selector.locator("input[type=checkbox]")).toHaveCount(1);
  const checkbox = selector.locator("input[type=checkbox]").first();
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await expect(selector.locator("label").first()).toHaveAttribute("data-selected", "true");
  const style = await selector.evaluate(element => { const css = getComputedStyle(element); return { padding: parseFloat(css.paddingTop), margin: parseFloat(css.marginBottom) }; });
  expect(style.padding).toBeGreaterThanOrEqual(16);
  expect(style.margin).toBeGreaterThanOrEqual(12);
  for (const count of [2, 4]) {
    await page.evaluate(async count => (window as unknown as { intakeConcurrency: { setVisibleSelectorJobs(name: string, count: number): Promise<void> } }).intakeConcurrency.setVisibleSelectorJobs("CareerAdaptDb", count), count);
    await expect(selector.locator("input[type=checkbox]")).toHaveCount(count);
    await page.screenshot({ path: testInfo.outputPath(`selector-${count}.png`), fullPage: true });
  }
  const longJob = selector.getByText("高级跨部门数据分析和复杂业务运营支持岗位长期名称测试");
  await longJob.scrollIntoViewIfNeeded();
  await expect(longJob).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("selector-long-title.png"), fullPage: true });
  const boxes = await Promise.all([selector.boundingBox(), page.locator(".agent-composer").boundingBox()]);
  expect(boxes[0]).not.toBeNull(); expect(boxes[1]).not.toBeNull();
  expect(boxes[1]!.y - (boxes[0]!.y + boxes[0]!.height)).toBeGreaterThanOrEqual(12);
  await selector.getByRole("button", { name: "分析所选岗位" }).click();
  const drawer = page.getByRole("complementary", { name: "任务产物" });
  await expect(drawer).toBeVisible();
  await expect(page.getByRole("region", { name: "经历与岗位影响报告" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("selector-drawer.png"), fullPage: true });
});
