import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { readStore, installCoreWritingProvider } from "./support/p51CoreWorkflow";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { CareerProfileSchema } from "@/domain/schemas";
import { ResumeCompositionResultSchema } from "@/domain/resumeComposition/contracts";

const JD = "岗位：数据开发工程师\n岗位职责：维护数据查询，参与数据清洗与产品测试。\n任职要求：\n本科及以上学历。\n必须掌握 SQL。\n至少熟悉 Java 或 Go 中的一项。\nPython 优先。";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

test("H1 bundled Hermes analyze/save/compose/confirm/fit/refresh", async ({ page }, info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const timeline: Array<Record<string, unknown>> = [];
  const bridgeResults: Array<Record<string, unknown>> = [];
  const requests: Array<Record<string, unknown>> = [];
  page.on("request", request => {
    if (request.method() !== "POST" || !request.url().includes("/api/agent/mcp?bridge=1")) return;
    const body = record(request.postDataJSON());
    if (body.action === "result") bridgeResults.push({ requestId: body.requestId, result: body.result });
  });
  page.on("response", async response => {
    if (!response.url().includes("/api/agent/mcp?bridge=1") || response.request().method() !== "GET") return;
    const body = record(await response.json().catch(() => undefined));
    if (body.request) requests.push(record(body.request));
    if (Array.isArray(body.requests)) requests.push(...body.requests.map(record));
  });
  let sessionId = "";
  const sessions = async () => await readStore(page, "agentSessions") as unknown as AgentSession[];
  const current = async () => (await sessions()).find(session => session.id === sessionId)!;
  const snapshot = async (step: string) => {
    const value = { step, at: new Date().toISOString(), session: sessionId ? await current() : undefined,
      profiles: await readStore(page, "profiles"), jobs: await readStore(page, "jobDescriptions"),
      branches: await readStore(page, "resumeBranches"), revisions: await readStore(page, "resumeRevisions") };
    timeline.push(value);
    return value;
  };
  try {
    // Only non-secret Provider settings. No business data or TaskState in localStorage.
    await page.addInitScript(({ baseUrl }) => {
      if (!localStorage.getItem("careeradapt-ai-settings")) localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl, model: "careeradapt-test",
        provider: "openai-compatible", apiKeyConfigured: true }));
    }, { baseUrl: process.env.HERMES_INTEGRATION_PROVIDER_URL! });
    await page.addInitScript(() => {
      const observations: Array<{ state: string; sendEnabled: boolean }> = [];
      Object.assign(window, { h2qRecoveryObservations: observations });
      new MutationObserver(() => {
        const state = document.querySelector('[data-testid="agent-recovery-state"]')?.getAttribute("data-state");
        if (!state) return;
        const send = document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]');
        observations.push({ state, sendEnabled: Boolean(send && !send.disabled) });
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state", "disabled"] });
    });
    await page.goto("/h1q-fixture");
    await page.getByRole("button", { name: "Seed confirmed Profile", exact: true }).click();
    await expect(page.getByTestId("seed-result")).toHaveText(/^profile-/u);
    const profileId = (await page.getByTestId("seed-result").textContent())!;
    const before = await snapshot("repository-seed");
    const profile = CareerProfileSchema.parse(before.profiles.find(row => row.id === profileId));
    expect(profile.experiences.filter(row => row.type === "education")).toHaveLength(1);
    expect(profile.experiences.find(row => row.type === "project")!.facts.length).toBeGreaterThanOrEqual(2);
    expect(profile.experiences.find(row => row.type === "internship")!.facts.length).toBeGreaterThanOrEqual(1);
    expect(profile.experiences.every(row => row.facts.every(fact => fact.confirmedByUser))).toBe(true);
    expect(profile.skills.map(skill => skill.name)).toEqual(["SQL", "Python"]);
    expect(profile.structuredFacts?.some(entry => entry.data.sectionType === "project")).toBe(true);
    expect(profile.structuredFacts?.some(entry => entry.data.sectionType === "internship")).toBe(true);
    expect(before.branches).toHaveLength(0);
    expect(before.revisions).toHaveLength(0);
    const baselineJobs = before.jobs.length;
    await installCoreWritingProvider(page);
    await page.goto("/ai-workspace");
    // One explicit READY preflight. Real Supervisor/API/MCP/Facade projections.
    await expect.poll(async () => {
      const body = await (await page.request.get("/api/agent/runtime/hermes/control")).json();
      const state = body.snapshot;
      return state?.processReady && state?.apiReady && state?.providerReady && state?.careerMcpReady
        && state?.toolSurfaceReady && state?.requiredCareerFacadesReady === state?.requiredCareerFacadesTotal;
    }, { timeout: 90_000 }).toBe(true);
    await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u);
    const sessionIds = new Set((await sessions()).map(session => session.id));
    await page.getByRole("button", { name: "新任务", exact: true }).click();
    await expect.poll(async () => (await sessions()).filter(session => !sessionIds.has(session.id)).length).toBe(1);
    sessionId = (await sessions()).find(session => !sessionIds.has(session.id))!.id;
    const send = async (text: string) => {
      await page.getByLabel("描述你的求职任务").fill(text);
      await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled({ timeout: 30_000 });
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
    };
    await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-state", /^(ready|new_session_ready)$/u);
    await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
    await expect(page.getByLabel("描述你的求职任务")).toBeEnabled();
    await snapshot("new-session-persisted");
    await send(`请先分析这个岗位。\n${JD}`);
    await expect.poll(async () => (await current())?.taskState?.completionStatus, { timeout: 60_000 }).toBe("completed");
    const analyzed = await snapshot("analyze-only");
    expect(analyzed.jobs).toHaveLength(baselineJobs);
    expect(analyzed.session?.taskState?.workflowId).toBe("job_ingestion");
    expect(analyzed.session?.taskState?.knownSlots.rawText).toBe(JD);
    expect(record(analyzed.session?.taskState?.knownSlots.facadeCheckpoint).targetSnapshot).toBeTruthy();
    const graph = record(analyzed.session?.taskState?.knownSlots.graph);
    const requirements = (graph.requirements as Array<Record<string, unknown>>);
    expect(requirements.some(row => String(row.statement).includes("SQL") && row.hardConstraint === true)).toBe(true);
    expect(requirements.some(row => record(row.keywordLogic).relation === "any_of")).toBe(true);
    // Force recovery from durable state; the next user message contains no JD.
    await page.reload();
    // A visible Composer alone does not prove asynchronous Session hydration.
    // Wait for the previous user message to be restored before interacting.
    await expect(page.getByText(`请先分析这个岗位。\n${JD}`, { exact: true })).toBeVisible();
    await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
    expect((await current()).taskState).toEqual(analyzed.session?.taskState);
    expect((await current()).activeBranchId).toBe(analyzed.session?.activeBranchId);
    const recoveryObservations = await page.evaluate(() => (window as unknown as {
      h2qRecoveryObservations: Array<{ state: string; sendEnabled: boolean }>
    }).h2qRecoveryObservations);
    expect(recoveryObservations.some(row => row.state === "restoring")).toBe(true);
    expect(recoveryObservations.filter(row => row.state === "restoring").every(row => !row.sendEnabled)).toBe(true);
    timeline.push({ step: "recovery-send-gate", recoveryObservations });
    await send("保存刚才这个岗位。");
    // A save request may require its persisted Host confirmation. Exercise the
    // real authorization boundary rather than waiting for an unapproved write.
    await expect(page.getByRole("region", { name: "确认保存岗位信息" })).toBeVisible({ timeout: 30_000 });
    expect(await readStore(page, "jobDescriptions")).toHaveLength(baselineJobs);
    await snapshot("job-awaiting-confirmation");
    await page.getByRole("region", { name: "确认保存岗位信息" }).getByRole("button", { name: "确认", exact: true }).click();
    await expect.poll(async () => (await readStore(page, "jobDescriptions")).length, { timeout: 60_000 }).toBe(baselineJobs + 1);
    await expect.poll(async () => (await current())?.taskState?.knownSlots.jobPersistenceVerified, { timeout: 30_000 }).toBe(true);
    const saved = await snapshot("job-saved");
    const job = saved.jobs.find(row => !before.jobs.some(old => old.id === row.id))!;
    expect(job).toMatchObject({ rawText: JD, company: null });
    const jobId = job.id;
    expect(saved.session?.taskState).toMatchObject({ workflowId: "job_ingestion", completionStatus: "completed", selectedEntities: { profileId, jobId } });
    await send("基于已确认的 Profile 创建一份通用简历，然后再做岗位匹配。");
    await expect(page.getByRole("button", { name: "直接生成", exact: true }).last()).toBeVisible({ timeout: 60_000 });
    const proposed = await snapshot("composition-proposed");
    expect(proposed.session?.taskState).toMatchObject({ workflowId: "compose_resume", selectedEntities: { profileId, jobId } });
    expect(proposed.session?.taskState?.knownSlots.nextAction).toMatchObject({ kind: "job_fit", profileId, jobId });
    expect(proposed.branches).toHaveLength(0);
    const checkpoint = record(proposed.session?.taskState?.knownSlots.resumeCompositionCheckpoint);
    const composition = ResumeCompositionResultSchema.parse(checkpoint.compositionResult);
    expect(composition.items.some(item => item.data.sectionType === "project")).toBe(true);
    expect(composition.items.some(item => item.data.sectionType === "internship")).toBe(true);
    expect(composition.proposal.bulletCount).toBeGreaterThan(0);
    expect(composition.evidenceGraph.sourceAssetIds.length).toBeGreaterThan(0);
    expect(composition.jobId).toBeUndefined();
    const compose = bridgeResults.map(row => record(row.result)).find(result => record(record(result.diagnostics).mcpCallTrace).toolName === "career.workflow.compose_resume");
    expect(compose, JSON.stringify(bridgeResults)).toBeTruthy();
    expect(compose!.ok).toBe(true);
    expect(record(record(compose!.diagnostics).mcpCallTrace).gatewayReached).toBe(true);
    expect(record(compose!.diagnostics).schemaIssues ?? []).toEqual([]);
    expect(requests.find(request => request.name === "career.workflow.compose_resume")?.input).toEqual({ mode: "general" });
    await page.reload();
    await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
    expect((await current()).taskState?.knownSlots.nextAction).toEqual(proposed.session?.taskState?.knownSlots.nextAction);
    expect((await current()).taskState?.knownSlots.resumeCompositionCheckpoint).toEqual(checkpoint);
    expect((await current()).pendingConfirmation).toEqual(proposed.session?.pendingConfirmation);
    expect((await current()).activeBranchId).toBe(proposed.session?.activeBranchId);
    await snapshot("composition-confirmation-restored");
    if (proposed.session?.pendingConfirmation?.toolName === "career.workflow.compose_resume") {
      await page.getByRole("region", { name: proposed.session.pendingConfirmation.title, exact: true })
        .getByRole("button", { name: "确认", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "直接生成", exact: true }).last().click();
    }
    await expect.poll(async () => ({ workflowId: (await current())?.taskState?.workflowId,
      completionStatus: (await current())?.taskState?.completionStatus }), { timeout: 60_000 }).toEqual({ workflowId: "analyze_job_fit", completionStatus: "completed" });
    const completed = await snapshot("fit-completed");
    expect(completed.branches).toHaveLength(1);
    expect(completed.revisions).toHaveLength(1);
    const branch = completed.branches[0];
    expect(branch.branchPurpose).toBe("general");
    expect(branch.profileId).toBe(profileId);
    expect(branch.jobId).toBeUndefined();
    const revisionId = branch.currentRevisionId;
    expect(completed.revisions[0]).toMatchObject({ id: revisionId, branchId: branch.id });
    expect(completed.session?.taskState?.selectedEntities).toMatchObject({ profileId, jobId, resumeId: branch.id, revisionId });
    expect(completed.session?.taskState?.knownSlots.nextAction).toBeUndefined();
    const fitCheckpoint = record(completed.session?.taskState?.knownSlots.facadeCheckpoint);
    expect(fitCheckpoint).toMatchObject({ kind: "job_fit", profileId, jobId, resumeId: branch.id });
    const fit = record(completed.session?.taskState?.knownSlots.fitAnalysis);
    expect(fit.analysis).toBeTruthy();
    expect(fit.dependencies).toMatchObject({ profileId, jobId, resumeId: branch.id, resumeRevisionId: revisionId });
    expect(JSON.stringify(fit.analysis)).toMatch(/status/u);
    expect(JSON.stringify(fit.analysis)).toMatch(/evidence|unknown/iu);
    const fitArtifact = completed.session?.artifactRefs.find(artifact => artifact.kind === "job_fit_overview");
    expect(fitArtifact?.binding).toMatchObject({ sessionId, branchId: completed.session?.activeBranchId,
      workflowId: "analyze_job_fit", jobId, resumeBranchId: branch.id, revisionId });
    expect(completed.session?.pendingConfirmation).toBeUndefined();
    await page.reload();
    await expect(page.getByText("通用简历已创建，岗位匹配已完成，可以打开匹配结果。", { exact: true })).toBeVisible();
    const restored = await snapshot("refreshed");
    await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
    expect(restored.session?.activeBranchId).toBe(completed.session?.activeBranchId);
    expect(restored.session?.taskState).toEqual(completed.session?.taskState);
    expect(restored.session?.artifactRefs).toContainEqual(fitArtifact);
    expect(restored.session?.pendingConfirmation).toBeUndefined();
    expect(restored.session?.taskState).toMatchObject({ workflowId: "analyze_job_fit", completionStatus: "completed",
      selectedEntities: { profileId, jobId, resumeId: branch.id, revisionId } });
    expect(restored.session?.taskState?.knownSlots.fitAnalysis).toEqual(fit);
    expect(restored.profiles).toEqual(before.profiles);
    expect(restored.jobs).toHaveLength(baselineJobs + 1);
    expect(restored.jobs.find(row => row.id === jobId)).toEqual(job);
    expect(restored.branches).toEqual(completed.branches);
    expect(restored.revisions).toEqual(completed.revisions);
    expect(JSON.stringify({ sessions: await sessions(), bridgeResults })).not.toMatch(/career_agent_duplicate_invalid_call|gateway_validation_failed|jobId invalid_type|mode invalid_value/u);
  } finally {
    await snapshot("final-observed-state");
    const evidence = { sessionId, timeline, bridgeResults, requests: requests.map(({ name, input, agentSessionId, operationId }) => ({ name, input, agentSessionId, operationId })) };
    await info.attach("h1q-business-evidence", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
    if (process.env.H1Q_EVIDENCE_DIR) writeFileSync(path.join(process.env.H1Q_EVIDENCE_DIR, "business-evidence.json"), JSON.stringify(evidence, null, 2));
  }
});
