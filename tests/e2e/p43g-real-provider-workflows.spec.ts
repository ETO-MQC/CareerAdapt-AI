import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { resolve } from "node:path";
import narrativeFixture from "../fixtures/p43f-long-narrative.anonymized.json";
import { IMPORT_EXISTING_RESUME_RESPONSE } from "../../src/agent/workflows/QuickActionWorkflowSupervisor";

test.use({ trace: "on" });

const EDUCATION = "我现在是郑州大学本科学生，计算机科学与技术专业，2024年9月入学，预计毕业时间2028年6月";
const RETRY_NARRATIVE = "我在示例团队中独立负责一个内部协作项目，梳理需求、设计数据结构、实现自动化流程并完成上线验证。项目持续多个迭代周期，期间还整理了使用说明、回归检查和交付记录，最终让团队可以稳定复用这套流程并减少重复沟通。";

type Telemetry = {
  firstResponseLatencyMs?: number;
  structuredTasks: string[];
  structuredLatenciesMs: number[];
  structuredMeta: Array<{ provider?: string; model?: string; latencyMs?: number }>;
  agentStreamLatenciesMs: number[];
  agentStreamCalls: number;
  requestFailures: string[];
  stageTransitions: string[];
};

type StoredSession = {
  id: string;
  taskState?: Record<string, unknown>;
  messages?: Array<Record<string, unknown>>;
  conversationBranches?: Array<Record<string, unknown>>;
  activeTurn?: Record<string, unknown>;
};

test.describe("P4.3g headed real-provider workflow journeys", () => {
  test("A — education succeeds first turn, accepts, autosaves, and advances interview", async ({ page }, testInfo) => {
    const telemetry = observeProviderTraffic(page);
    await useServerProvider(page);
    await startIntake(page);

    const startedAt = Date.now();
    await send(page, EDUCATION);
    const card = page.locator(".profile-intake-candidate-card");
    await expect(card).toHaveCount(1, { timeout: 210_000 });
    telemetry.firstResponseLatencyMs = Date.now() - startedAt;
    await expect(card).toContainText("郑州大学");
    await expect(card).toContainText("本科");
    await expect(card).toContainText("计算机科学与技术");
    await expect(card).toContainText("2024-09");
    await expect(card).toContainText("2028-06");

    const before = await readActiveSession(page);
    const projection = objectValue(objectValue(before.taskState).knownSlots).profileIntakeReviewProjection as Record<string, unknown>;
    expect(["available", "failed", "invalid"]).toContain(projection.providerStatus);
    expect(["structured_ai", "structured_local", "partial"]).toContain(projection.extractionStatus);

    const candidateId = await card.getAttribute("data-candidate-id");
    await card.getByRole("button", { name: "采用", exact: true }).click();
    await expect(page.locator(`.profile-intake-candidate-card[data-candidate-id="${candidateId}"]`)).toHaveCount(0);
    await expect(page.locator(".profile-intake-compact-receipt")).toContainText("✓ 已记录教育经历：郑州大学 · 本科 · 计算机科学与技术");
    await expect(page.locator(".agent-message-row.is-assistant").filter({ hasText: "教育背景已经记录并自动保存。" }).last()).toBeVisible();
    await expect(page.getByRole("button", { name: "换一个方向", exact: true })).toBeVisible();
    await expect(page.getByText("已自动保存到本地", { exact: true })).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(`.profile-intake-candidate-card[data-candidate-id="${candidateId}"]`)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "重新打开", exact: true })).toBeVisible();
    await recordArtifacts(page, telemetry, testInfo, "A");
  });

  test("B — an unavailable provider still produces a usable local education card", async ({ page }, testInfo) => {
    const telemetry = observeProviderTraffic(page);
    await useServerProvider(page);
    await startIntake(page);
    await useUnavailableProvider(page);

    await send(page, EDUCATION);
    const card = page.locator(".profile-intake-candidate-card");
    await expect(card).toHaveCount(1, { timeout: 120_000 });
    await expect(card).toContainText("郑州大学");
    await expect(card).toContainText("计算机科学与技术");
    await expect(card).not.toContainText("没有完成结构化");
    await expect(card.getByRole("button", { name: "重新解析", exact: true })).toHaveCount(0);

    const session = await readActiveSession(page);
    const projection = objectValue(objectValue(session.taskState).knownSlots).profileIntakeReviewProjection as Record<string, unknown>;
    expect(projection.providerStatus).toBe("failed");
    expect(projection.extractionStatus).toBe("structured_local");
    expect(telemetry.structuredTasks).toContain("profile-intake-semantic");
    await recordArtifacts(page, telemetry, testInfo, "B");
  });

  test("C — real provider preserves a multi-candidate long narrative for conversation review", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const telemetry = observeProviderTraffic(page);
    await useServerProvider(page);
    await startIntake(page);
    await send(page, narrativeFixture.narrative);

    const cards = page.locator(".profile-intake-candidate-card");
    await expect.poll(() => cards.count(), { timeout: 210_000 }).toBeGreaterThan(1);
    const session = await readActiveSession(page);
    const projection = objectValue(objectValue(session.taskState).knownSlots).profileIntakeReviewProjection as Record<string, unknown>;
    const candidates = Array.isArray(projection.candidates) ? projection.candidates as Array<Record<string, unknown>> : [];
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.every((candidate) => typeof candidate.sourceQuote === "string" && String(candidate.sourceQuote).length > 0)).toBe(true);
    expect(candidates.some((candidate) => candidate.sectionType === "project")).toBe(true);

    for (let index = 0; index < 40; index += 1) {
      const active = cards.first();
      if (!await active.count()) break;
      await active.locator("details").first().evaluate((details) => {
        (details as HTMLDetailsElement).open = true;
      });
      const accept = active.getByRole("button", { name: "采用", exact: true });
      const ignore = active.getByRole("button", { name: "忽略", exact: true });
      if (await accept.count()) await accept.click({ timeout: 5_000 }).catch(() => undefined);
      else if (await ignore.count()) await ignore.click({ timeout: 5_000 }).catch(() => undefined);
      else break;
    }
    await expect.poll(() => readActiveSession(page), { timeout: 30_000 }).toMatchObject({
      taskState: { stage: "collect_experience" }
    });
    await expect(page.getByText(/接下来|补充/).last()).toBeVisible();
    await recordArtifacts(page, telemetry, testInfo, "C");
  });

  test("D — retry replaces a failed card with one structured call and no agent regeneration", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const telemetry = observeProviderTraffic(page);
    await useServerProvider(page);
    await startIntake(page);
    await useUnavailableProvider(page);
    await send(page, RETRY_NARRATIVE);

    const card = page.locator(".profile-intake-candidate-card");
    await expect(card.getByRole("button", { name: "重新解析", exact: true })).toBeVisible({ timeout: 120_000 });
    const before = await readActiveSession(page);
    const structuredBefore = telemetry.structuredTasks.length;
    const streamBefore = telemetry.agentStreamCalls;
    const branchesBefore = before.conversationBranches?.length ?? 0;
    await useServerProvider(page);
    await card.getByRole("button", { name: "重新解析", exact: true }).click();
    await expect(page.getByText(/已重新识别出 \d+ 项/)).toBeVisible({ timeout: 210_000 });
    await expect.poll(() => readActiveSession(page), { timeout: 210_000 }).toMatchObject({
      taskState: { stage: "review_facts" }
    });
    expect(telemetry.structuredTasks.length - structuredBefore).toBe(1);
    expect(telemetry.agentStreamCalls).toBe(streamBefore);
    const after = await readActiveSession(page);
    expect((after.conversationBranches?.length ?? 0) - branchesBefore).toBe(0);
    for (const message of after.messages ?? []) {
      const metadata = objectValue(message.metadata);
      expect(metadata.regeneratedFromMessageId).toBeUndefined();
      expect(metadata.regenerate).toBeUndefined();
    }
    expect((after.messages ?? []).some((message) => String(message.content ?? "").includes("正在规划下一步"))).toBe(false);
    await recordArtifacts(page, telemetry, testInfo, "D");
  });

  test("E — import quick action gives local guidance before upload and completes local DOCX extraction", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const telemetry = observeProviderTraffic(page);
    await useServerProvider(page);
    await page.goto("/ai-workspace");
    const quickAction = page.getByRole("button", { name: /^导入现有简历/ });
    await expect(quickAction).toBeVisible({ timeout: 30_000 });
    const startedAt = Date.now();
    await quickAction.click();
    await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("支持 PDF、DOCX、JSON、Markdown 和 TXT。");
    telemetry.firstResponseLatencyMs = Date.now() - startedAt;
    expect(telemetry.firstResponseLatencyMs).toBeLessThanOrEqual(300);
    expect(telemetry.agentStreamCalls).toBe(0);
    expect(telemetry.structuredTasks).toHaveLength(0);
    expect(await page.locator(".agent-composer input[type='file']").count()).toBe(1);
    expect(await page.locator(".agent-message-row.is-assistant").last().textContent()).toContain(IMPORT_EXISTING_RESUME_RESPONSE.split("\n")[1]);

    await page.locator(".agent-composer input[type='file']").setInputFiles(
      resolve(process.cwd(), "tests/fixtures/resume-import/ordinary.docx")
    );
    const consent = page.getByTestId("agent-import-ai-consent");
    if (await consent.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await consent.getByRole("button", { name: "仅本地解析", exact: true }).click();
    }
    await expect(page.getByRole("button", { name: "产物 1", exact: true })).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "产物 1", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "任务产物" })).toContainText("ordinary.docx", { timeout: 120_000 });
    await expect(page.getByRole("region", { name: "简历导入核对" })).toContainText("ordinary.docx", { timeout: 30_000 });
    await recordArtifacts(page, telemetry, testInfo, "E");
  });

  test("F — saved jobs with empty profile and resume assets get typed local recovery", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const telemetry = observeProviderTraffic(page);
    await useServerProvider(page);
    await leaveSavedJobsWithoutProfileOrResume(page);
    await page.goto("/ai-workspace");
    const quickAction = page.getByRole("button", { name: /^分析岗位匹配度/ });
    await expect(quickAction).toBeVisible({ timeout: 30_000 });
    await quickAction.click();

    const result = page.locator(".agent-message-row.is-assistant").filter({ hasText: "已找到并保留岗位" }).last();
    await expect(result).toContainText("已找到并保留岗位", { timeout: 30_000 });
    await expect(result).toContainText("导入简历");
    await expect(result).toContainText("从零整理经历");
    await expect(page.getByRole("button", { name: "导入简历", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "从零整理经历", exact: true })).toBeVisible();
    expect(telemetry.agentStreamCalls).toBe(0);
    expect(telemetry.structuredTasks).toHaveLength(0);

    const session = await readActiveSession(page);
    const metadata = objectValue(session.messages?.at(-1)?.metadata);
    expect(metadata).toMatchObject({
      quickActionSupervisor: true,
      modelCalls: 0,
      profileReads: 1,
      resumeReads: 1,
      jobReads: 1
    });
    await recordArtifacts(page, telemetry, testInfo, "F");
  });
});

function observeProviderTraffic(page: Page): Telemetry {
  const telemetry: Telemetry = {
    structuredTasks: [],
    structuredLatenciesMs: [],
    structuredMeta: [],
    agentStreamLatenciesMs: [],
    agentStreamCalls: 0,
    requestFailures: [],
    stageTransitions: []
  };
  const requestStarted = new WeakMap<object, number>();
  page.on("request", (request) => {
    if (request.url().includes("/api/agent/stream")) {
      telemetry.agentStreamCalls += 1;
      requestStarted.set(request, Date.now());
    }
    if (request.url().includes("/api/ai/structured")) {
      try {
        telemetry.structuredTasks.push(String((request.postDataJSON() as { task?: string }).task ?? "unknown"));
      } catch {
        telemetry.structuredTasks.push("unknown");
      }
      requestStarted.set(request, Date.now());
    }
  });
  page.on("requestfailed", (request) => {
    if (/\/api\/(agent\/stream|ai\/structured)/.test(request.url())) {
      telemetry.requestFailures.push(`${request.url()}: ${request.failure()?.errorText ?? "unknown"}`);
    }
  });
  page.on("response", (response) => {
    const started = requestStarted.get(response.request());
    if (started && response.url().includes("/api/agent/stream")) telemetry.agentStreamLatenciesMs.push(Date.now() - started);
    if (started && response.url().includes("/api/ai/structured")) {
      telemetry.structuredLatenciesMs.push(Date.now() - started);
      void response.json().then((body: { meta?: { provider?: string; model?: string; latencyMs?: number } }) => {
        if (body.meta) telemetry.structuredMeta.push(body.meta);
      }).catch(() => undefined);
    }
  });
  return telemetry;
}

async function useServerProvider(page: Page) {
  const clear = () => {
    // Keep only the known model override so SetupGuard allows the browser
    // journey while base URL and credentials still come from the server env.
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
      baseUrl: "",
      apiKey: "",
      model: "mimo-v2.5-pro",
      provider: "openai-compatible"
    }));
    localStorage.removeItem("careeradapt.resumeImportAiPreference");
  };
  await page.addInitScript(clear);
  await page.evaluate(clear).catch(() => undefined);
}

async function useUnavailableProvider(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
      baseUrl: "http://127.0.0.1:9/v1",
      apiKey: "p43g-provider-failure",
      model: "p43g-provider-failure",
      provider: "openai-compatible"
    }));
  });
}

async function startIntake(page: Page) {
  await page.goto("/profile");
  await expect(page.getByLabel("选择人物")).toBeVisible({ timeout: 30_000 });
  await page.goto("/ai-workspace");
  await page.getByRole("button", { name: /从零整理我的经历/ }).click();
  await expect(page.getByLabel("描述你的求职任务")).toBeVisible({ timeout: 30_000 });
}

async function leaveSavedJobsWithoutProfileOrResume(page: Page) {
  await page.goto("/profile");
  await expect(page.getByLabel("选择人物")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveDb, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolveDb(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolveTransaction, rejectTransaction) => {
      const transaction = database.transaction(["profiles", "resumeBranches"], "readwrite");
      transaction.objectStore("profiles").clear();
      transaction.objectStore("resumeBranches").clear();
      transaction.oncomplete = () => resolveTransaction();
      transaction.onerror = () => rejectTransaction(transaction.error);
      transaction.onabort = () => rejectTransaction(transaction.error);
    });
    database.close();
  });
}

async function send(page: Page, message: string) {
  await page.getByLabel("描述你的求职任务").fill(message);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
}

async function readActiveSession(page: Page): Promise<StoredSession> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveDb, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolveDb(request.result);
      request.onerror = () => reject(request.error);
    });
    const sessions = await new Promise<StoredSession[]>((resolveRows, reject) => {
      const request = database.transaction("agentSessions", "readonly").objectStore("agentSessions").getAll();
      request.onsuccess = () => resolveRows(request.result as StoredSession[]);
      request.onerror = () => reject(request.error);
    });
    database.close();
    const activeId = localStorage.getItem("careeradapt.agent.activeSessionId");
    const session = sessions.find((candidate) => candidate.id === activeId) ?? sessions.at(-1) ?? {} as StoredSession;
    const messageDatabase = await new Promise<IDBDatabase>((resolveDb, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolveDb(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise<Array<Record<string, unknown>>>((resolveRows, reject) => {
      const request = messageDatabase.transaction("agentMessages", "readonly").objectStore("agentMessages").getAll();
      request.onsuccess = () => resolveRows(request.result as Array<Record<string, unknown>>);
      request.onerror = () => reject(request.error);
    });
    messageDatabase.close();
    const messages = records
      .filter((message) => message.sessionId === session.id)
      .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0))
      .map(({ sessionId, sequence, ...message }) => {
        void sessionId;
        void sequence;
        return message;
      });
    return { ...session, messages };
  });
}

async function recordArtifacts(page: Page, telemetry: Telemetry, testInfo: TestInfo, journey: string) {
  const session = await readActiveSession(page);
  const stage = String(objectValue(session.taskState).stage ?? "unknown");
  if (!telemetry.stageTransitions.includes(stage)) telemetry.stageTransitions.push(stage);
  await page.screenshot({ path: testInfo.outputPath(`p43g-${journey.toLowerCase()}-real-provider.png`), fullPage: true });
  await testInfo.attach(`p43g-${journey}-telemetry.json`, {
    body: JSON.stringify({ ...telemetry, provider: telemetry.structuredMeta.at(-1)?.provider, model: telemetry.structuredMeta.at(-1)?.model }, null, 2),
    contentType: "application/json"
  });
  expect(telemetry.requestFailures).toEqual([]);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
