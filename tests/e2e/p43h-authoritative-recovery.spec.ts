import narrativeFixture from "../fixtures/p43f-long-narrative.anonymized.json";
import { expect, test, type Page } from "@playwright/test";

test.use({ trace: "on" });

const EDUCATION = "我现在是郑州大学本科学生，计算机科学与技术专业，2024年9月入学，预计毕业时间2028年6月";
const DATE_CORRECTION = "我更正时间为 2026 年 6 月，之前写成 2025 年是笔误；截至 2026 年仍在推进。";

type StoredSession = {
  id: string;
  activeBranchId?: string;
  taskState?: Record<string, unknown>;
  messages?: Array<Record<string, unknown>>;
  conversationBranches?: Array<Record<string, unknown>>;
};

test.describe("P4.3h authoritative Profile Intake recovery", () => {
  test("real provider multi-turn intake journals, reviews, commits, and survives reload", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const providerTraffic = observeProviderTraffic(page);
    await useServerProvider(page);
    await startIntake(page);

    expect(providerTraffic.agentStreamCalls).toBe(0);
    let journal = await readSourceJournal(page);
    expect(journal).toHaveLength(0);

    await send(page, EDUCATION);
    await expect(page.locator(".profile-intake-candidate-card")).toHaveCount(1, { timeout: 210_000 });
    await expect.poll(() => readSourceJournal(page), { timeout: 30_000 }).toMatchObject([
      { processingStatus: expect.stringMatching(/structured|partial/) }
    ]);
    await reviewAllVisibleCandidates(page);
    await expect.poll(() => readActiveTask(page), { timeout: 30_000 }).toMatchObject({ stage: "collect_experience" });
    expect((await readSourceJournal(page)).length).toBe(1);

    await send(page, narrativeFixture.narrative);
    await expect.poll(() => page.locator(".profile-intake-candidate-card").count(), { timeout: 210_000 }).toBeGreaterThan(0);
    await expect.poll(() => readSourceJournal(page), { timeout: 30_000 }).toHaveLength(2);
    const narrativeTask = await readActiveTask(page);
    const narrativeProjection = objectValue(objectValue(narrativeTask.knownSlots).profileIntakeReviewProjection);
    const narrativeCandidates = Array.isArray(narrativeProjection.candidates)
      ? narrativeProjection.candidates as Array<Record<string, unknown>>
      : [];
    expect(narrativeCandidates.length).toBeGreaterThan(0);
    for (const candidate of narrativeCandidates) {
      if (/竞赛|比赛|大赛/u.test(String(candidate.sourceQuote ?? ""))) {
        expect(candidate.sectionType).not.toBe("project");
      }
    }
    await reviewAllVisibleCandidates(page);
    await expect.poll(() => readActiveTask(page), { timeout: 30_000 }).toMatchObject({ stage: "collect_experience" });

    await send(page, DATE_CORRECTION);
    await expect.poll(() => readSourceJournal(page), { timeout: 30_000 }).toHaveLength(3);
    await expect.poll(() => page.locator(".profile-intake-candidate-card").count(), { timeout: 210_000 }).toBeGreaterThan(0);
    await reviewAllVisibleCandidates(page);
    await expect.poll(() => readActiveTask(page), { timeout: 30_000 }).toMatchObject({ stage: "collect_experience" });

    await send(page, "完成整理");
    await expect.poll(() => readActiveTask(page), { timeout: 60_000 }).toMatchObject({ stage: "final_review" });
    expect((await readActiveTask(page)).completionStatus).toBe("waiting_for_user");

    await send(page, "确认");
    await expect.poll(() => readActiveTask(page), { timeout: 120_000 }).toMatchObject({
      stage: "profile_complete",
      completionStatus: "waiting_for_user"
    });
    await expect(page.getByText(/已保存到个人资料库。资料库版本：\d+；本次新增 \d+ 项经历、\d+ 条事实，读取核验通过。/u)).toBeVisible();
    await expect(page.getByText(/provider_textual_tool_protocol/)).toHaveCount(0);
    await expect(page.getByText(/重试刚才/)).toHaveCount(0);

    const finalSession = await readActiveSession(page);
    const toolNames = (finalSession.messages ?? []).map((message) => String(message.toolName ?? ""));
    const commitResult = objectValue(objectValue(finalSession.taskState).knownSlots).profileCommitResult;
    const commitValue = objectValue(commitResult);
    expect(toolNames.filter((name) => name === "capture_profile_intake").length).toBe(3);
    expect(toolNames).toContain("reconcile_profile_intake");
    expect(toolNames).toContain("commit_profile_intake");
    expect(toolNames).toContain("get_profile");
    expect((finalSession.conversationBranches ?? []).filter((branch) => branch.status === "active")).toHaveLength(1);

    journal = await readSourceJournal(page);
    expect(journal.every((turn) => turn.processingStatus === "structured" || turn.processingStatus === "partial")).toBe(true);
    const beforeReload = await readActiveTask(page);
    const committedProfile = await readCommittedProfile(page);
    expect(committedProfile.items.length).toBeGreaterThan(0);
    await page.reload({ waitUntil: "networkidle" });
    await expect.poll(() => readActiveTask(page), { timeout: 30_000 }).toMatchObject({
      stage: "profile_complete",
      completionStatus: "waiting_for_user"
    });
    await expect(page.getByText(/读取核验通过/u)).toBeVisible();
    const afterReloadProfile = await readCommittedProfile(page);
    expect(afterReloadProfile.version).toBe(committedProfile.version);
    expect(afterReloadProfile.items.length).toBeGreaterThanOrEqual(committedProfile.items.length);
    expect(objectValue(beforeReload.knownSlots).profilePersistenceReceipt).toMatchObject({
      type: "profile_persistence_receipt",
      newProfileVersion: committedProfile.version
    });

    const safeTelemetry = {
      ...providerTraffic,
      sourceTurnCount: journal.length,
      captureCount: toolNames.filter((name) => name === "capture_profile_intake").length,
      reviewCount: toolNames.filter((name) => name === "review_profile_intake").length,
      reconcileCount: toolNames.filter((name) => name === "reconcile_profile_intake").length,
      commitCount: toolNames.filter((name) => name === "commit_profile_intake").length,
      getProfileCount: toolNames.filter((name) => name === "get_profile").length,
      activeBranchCount: (finalSession.conversationBranches ?? []).filter((branch) => branch.status === "active").length,
      profileVersion: committedProfile.version,
      profileItemCount: committedProfile.items.length,
      committedItemCount: commitValue.committedItemCount,
      committedFactCount: commitValue.committedFactCount
    };
    console.log("[p43h-safe-telemetry]", JSON.stringify(safeTelemetry));
    await testInfo.attach("p43h-real-provider-safe-telemetry.json", {
      body: JSON.stringify(safeTelemetry, null, 2),
      contentType: "application/json"
    });
  });

  test("real provider edit replays from the pre-message snapshot and excludes abandoned branch context", async ({ page }) => {
    test.setTimeout(300_000);
    await useServerProvider(page);
    await startIntake(page);

    await send(page, EDUCATION);
    await expect(page.locator(".profile-intake-candidate-card")).toHaveCount(1, { timeout: 210_000 });
    await reviewAllVisibleCandidates(page);

    const laterNarrative = "我参与过校内算法竞赛，和队友完成数据分析与展示，获得了校级二等奖。";
    await send(page, laterNarrative);
    await expect.poll(() => page.locator(".profile-intake-candidate-card").count(), { timeout: 210_000 }).toBeGreaterThan(0);
    await reviewAllVisibleCandidates(page);

    const beforeEdit = await readActiveSession(page);
    const oldBranchId = String(beforeEdit.activeBranchId ?? "");
    const captureCount = (beforeEdit.messages ?? []).filter((message) => message.toolName === "capture_profile_intake").length;
    const originalRow = page.locator(".agent-message-row.is-user").filter({ hasText: EDUCATION }).first();
    await expect(originalRow).toBeVisible();
    await originalRow.getByRole("button", { name: "编辑并重发", exact: true }).click();
    const editedEducation = "我在示例理工大学读软件工程本科，2025年9月入学，预计2029年6月毕业。";
    await originalRow.getByRole("textbox", { name: "编辑消息", exact: true }).fill(editedEducation);
    await page.getByRole("button", { name: "确认并重发", exact: true }).click();

    await expect.poll(async () => (await readActiveSession(page)).activeBranchId, { timeout: 60_000 }).not.toBe(oldBranchId);
    await expect(page.locator(".profile-intake-candidate-card").filter({ hasText: "示例理工大学" })).toBeVisible({ timeout: 210_000 });
    const afterEdit = await readActiveSession(page);
    expect(afterEdit.conversationBranches?.filter((branch) => branch.status === "active")).toHaveLength(1);
    expect((afterEdit.messages ?? []).filter((message) => message.toolName === "capture_profile_intake")).toHaveLength(captureCount + 1);
    expect((afterEdit.messages ?? []).some((message) => message.branchId === afterEdit.activeBranchId && String(message.content ?? "").includes(laterNarrative))).toBe(false);
    const journal = await readSourceJournal(page);
    expect(journal.filter((turn) => turn.processingStatus !== "superseded")).toHaveLength(1);
  });
});

function observeProviderTraffic(page: Page) {
  const traffic = { agentStreamCalls: 0, structuredCalls: 0, requestFailures: [] as string[] };
  page.on("request", (request) => {
    if (request.url().includes("/api/agent/stream")) traffic.agentStreamCalls += 1;
    if (request.url().includes("/api/ai/structured")) traffic.structuredCalls += 1;
  });
  page.on("requestfailed", (request) => {
    if (/\/api\/(agent\/stream|ai\/structured)/.test(request.url())) {
      traffic.requestFailures.push(`${request.url()}: ${request.failure()?.errorText ?? "unknown"}`);
    }
  });
  return traffic;
}

async function useServerProvider(page: Page) {
  const clear = () => {
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

async function startIntake(page: Page) {
  await page.goto("/profile");
  await expect(page.getByLabel("选择人物")).toBeVisible({ timeout: 30_000 });
  await page.goto("/ai-workspace");
  await page.getByRole("button", { name: /从零整理我的经历/ }).click();
  await expect(page.locator('[data-agent-workflow-id="guided_profile_intake"][data-agent-task-stage="collect_experience"]'))
    .toBeVisible({ timeout: 30_000 });
}

async function send(page: Page, text: string) {
  await page.getByLabel("描述你的求职任务").fill(text);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
}

async function reviewAllVisibleCandidates(page: Page) {
  for (let index = 0; index < 50; index += 1) {
    const card = page.locator(".profile-intake-candidate-card").first();
    if (!await card.count()) return;
    const details = card.locator("details").first();
    if (!await details.count()) return;
    await details.evaluate((element) => { (element as HTMLDetailsElement).open = true; }, undefined, { timeout: 5_000 }).catch(() => undefined);
    const accept = card.getByRole("button", { name: "采用", exact: true });
    const ignore = card.getByRole("button", { name: "忽略", exact: true });
    const preserve = card.getByRole("button", { name: "保留为来源", exact: true });
    if (await accept.isVisible().catch(() => false)) {
      await accept.click();
    } else if (await ignore.isVisible().catch(() => false)) {
      await ignore.click();
    } else if (await preserve.isVisible().catch(() => false)) {
      await preserve.click();
    } else {
      throw new Error(`candidate has no safe review action: ${await card.textContent()}`);
    }
    await page.waitForTimeout(80);
  }
  throw new Error("candidate review did not settle within 50 actions");
}

async function readActiveTask(page: Page) {
  const session = await readActiveSession(page);
  return objectValue(session.taskState);
}

async function readActiveSession(page: Page): Promise<StoredSession> {
  return page.evaluate(async () => {
    const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const getAll = <T>(database: IDBDatabase, storeName: string) => new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
    const database = await openDatabase();
    const sessions = await getAll<StoredSession>(database, "agentSessions");
    const activeId = localStorage.getItem("careeradapt.agent.activeSessionId");
    const session = sessions.find((candidate) => candidate.id === activeId) ?? sessions.at(-1) ?? {} as StoredSession;
    const records = await getAll<Record<string, unknown>>(database, "agentMessages");
    database.close();
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

async function readSourceJournal(page: Page) {
  return page.evaluate(async () => {
    const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const getAll = <T>(database: IDBDatabase, storeName: string) => new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
    const objectValue = (value: unknown): Record<string, unknown> =>
      value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const database = await openDatabase();
    const rows = await getAll<Record<string, unknown>>(database, "appMeta");
    database.close();
    return rows
      .filter((row) => String(row.key).startsWith("profileIntakeSourceTurn:v1:"))
      .map((row) => {
        const value = objectValue(row.value);
        return {
          processingStatus: value.processingStatus,
          candidateIds: Array.isArray(value.candidateIds) ? value.candidateIds : [],
          lastErrorCode: value.lastErrorCode
        };
      });
  });
}

async function readCommittedProfile(page: Page) {
  return page.evaluate(async () => {
    const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const getOne = <T>(database: IDBDatabase, storeName: string, key: IDBValidKey) => new Promise<T | undefined>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
    const database = await openDatabase();
    const context = await getOne<{ value?: { profileId?: string } }>(database, "appMeta", "activeProfileContext:v1");
    const profileId = context?.value?.profileId;
    if (!profileId) throw new Error("active profile missing");
    const profile = await getOne<{
      version: number;
      structuredFacts?: unknown[];
      experiences?: unknown[];
      skills?: unknown[];
      certificates?: unknown[];
      evidences?: unknown[];
    }>(database, "profiles", profileId);
    database.close();
    const structuredItems = Array.isArray(profile?.structuredFacts)
      ? profile.structuredFacts.flatMap((entry) => {
          const value = entry && typeof entry === "object" && !Array.isArray(entry)
            ? (entry as { data?: unknown }).data
            : undefined;
          return value && typeof value === "object" && !Array.isArray(value) ? [value] : [];
        })
      : [];
    const legacyItems = [
      ...(Array.isArray(profile?.experiences) ? profile.experiences : []),
      ...(Array.isArray(profile?.skills) ? profile.skills : []),
      ...(Array.isArray(profile?.certificates) ? profile.certificates : []),
      ...(Array.isArray(profile?.evidences) ? profile.evidences : [])
    ];
    return { version: profile?.version ?? -1, items: structuredItems.length ? structuredItems : legacyItems };
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
