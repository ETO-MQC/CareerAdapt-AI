import { expect, test } from "@playwright/test";
import { readStore } from "./support/p51CoreWorkflow";

const narrative = "我最近在某科技公司做了产品运营实习，时间是2026年7月至9月，主要负责用户反馈整理、竞品分析和产品功能优化。";

test("diagnoses the real Hermes intake tool boundary for one internship", async ({ page }, testInfo) => {
  const baseUrl = process.env.HERMES_INTEGRATION_PROVIDER_URL;
  const providerKey = process.env.HERMES_INTEGRATION_PROVIDER_KEY;
  if (!baseUrl || !providerKey) throw new Error("synthetic_provider_not_configured");
  await page.addInitScript(({ provider }) => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
    baseUrl: provider, model: "careeradapt-test", provider: "openai-compatible", apiKeyConfigured: true
  })), { provider: baseUrl });
  await page.route("**/api/ai/structured**", async (route) => {
    const body = route.request().postDataJSON() as { task?: string; input?: { rawNarrative?: string } };
    if (body.task !== "profile-intake-semantic") return route.continue();
    const raw = body.input?.rawNarrative ?? "";
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, task: body.task,
      promptVersion: "isolated-internship", output: { candidates: [{ candidateKey: "internship-one", sectionType: "internship",
        sourceSpan: { start: 0, end: raw.length }, structuredItem: { id: "internship-one", sectionType: "internship",
          organization: "某科技公司", role: "产品运营", startDate: "2026-07", endDate: "2026-09", current: false,
          description: "负责用户反馈整理、竞品分析和产品功能优化。", highlights: [], customFields: [] },
        professionalText: raw, uncertainFields: [] }], followUpQuestions: [] },
      meta: { provider: "synthetic", model: "isolated-internship", latencyMs: 1 } }) });
  });
  await page.goto("/ai-workspace");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.isVisible()) await skip.click();
  await expect.poll(async () => {
    const response = await page.request.get("/api/agent/runtime/hermes/control");
    if (!response.ok()) return false;
    const body = await response.json();
    return Boolean(body.snapshot?.processReady && body.snapshot?.providerReady && body.snapshot?.careerMcpReady
      && body.snapshot?.toolSurfaceReady && body.snapshot?.runReady);
  }, { timeout: 60_000 }).toBe(true);
  await page.locator(".career-context-trigger").click();
  const manager = page.getByRole("dialog", { name: "人物与版本" });
  await manager.getByRole("tab", { name: "新增人物" }).click();
  await manager.getByLabel("人物名称").fill("隔离诊断人物");
  await manager.getByRole("button", { name: "创建人物" }).click();
  await manager.getByRole("button", { name: /隔离诊断人物/ }).first().click();
  await manager.getByRole("button", { name: "使用此版本" }).click();
  const start = page.getByRole("button", { name: /从零整理我的经历/ });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.locator('[data-agent-workflow-id="guided_profile_intake"][data-agent-task-stage="collect_experience"]')).toBeVisible();
  await page.getByLabel("描述你的求职任务").fill(narrative);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  try {
    await expect.poll(async () => {
      const sessions = await readStore(page, "agentSessions");
      const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
      const session = sessions.find((entry) => entry.id === id);
      const task = session?.taskState as { knownSlots?: { profileIntakeReviewProjection?: { candidates?: unknown[] } } } | undefined;
      return JSON.stringify(task?.knownSlots?.profileIntakeReviewProjection?.candidates ?? []);
    }, { timeout: 30_000 }).toContain("某科技公司");
  } finally {
    const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    const session = (await readStore(page, "agentSessions")).find((entry) => entry.id === id);
    const evidenceResponse = await page.request.get(`${baseUrl}/integration-evidence`, { headers: { Authorization: `Bearer ${providerKey}` } });
    const evidence = evidenceResponse.ok() ? await evidenceResponse.json() : { requests: [] };
    const requests = Array.isArray(evidence.requests) ? evidence.requests as Array<{ selectedTool?: string; messages?: unknown[]; safeMetrics?: { toolCount?: number } }> : [];
    const summary = { sessionId: id, stage: (session?.taskState as { stage?: string } | undefined)?.stage,
      requests: requests.map((request) => ({ selectedTool: request.selectedTool, toolCount: request.safeMetrics?.toolCount,
        containsUserNarrative: JSON.stringify(request.messages ?? []).includes(narrative) })) };
    await testInfo.attach("intake-boundary-summary.json", { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
    console.log("intake-boundary-summary", JSON.stringify(summary));
    await page.screenshot({ path: testInfo.outputPath("intake-boundary.png"), fullPage: true });
  }
});
