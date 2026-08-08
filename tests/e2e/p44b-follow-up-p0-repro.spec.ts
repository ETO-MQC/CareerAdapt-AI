import narrativeFixture from "../fixtures/p43f-long-narrative.anonymized.json";
import { expect, test, type Page, type Route } from "@playwright/test";

test.describe("P4.4b exact follow-up P0 reproduction", () => {
  test("records the safe failure shape for the result answer", async ({ page }) => {
    test.setTimeout(90_000);
    await useServerProvider(page);
    await installSemanticFixture(page);
    console.log("[p44b-p0] start intake");
    await startIntake(page);
    console.log("[p44b-p0] intake ready");

    await send(page, narrativeFixture.narrative);
    console.log("[p44b-p0] narrative sent");
    await expect.poll(() => readActiveTask(page), { timeout: 30_000 }).toMatchObject({
      knownSlots: { intakeActiveQuestion: expect.any(Object) }
    });
    console.log("[p44b-p0] follow-up ready");

    const before = await readSafeState(page);
    const answer = "最后集成了一个可以检测心跳和判断跌倒的板子，并且通过蓝牙连接，他们还做了一个软件，可以实时观测数据";
    await send(page, answer);
    console.log("[p44b-p0] answer sent");
    await expect.poll(() => readActiveSession(page), { timeout: 30_000 }).toMatchObject({
      activeTurn: { status: expect.not.stringMatching(/^running$/u) }
    });

    const after = await readSafeState(page);
    console.log("[p44b-p0-repro-safe-diagnostic]", JSON.stringify({
      before: {
        turnClassification: before.turnClassification,
        activeQuestionId: before.activeQuestionId,
        candidateId: before.candidateId,
        dimension: before.dimension,
        sourceTurnCount: before.sourceTurnCount
      },
      after: {
        turnClassification: after.turnClassification,
        activeQuestionId: after.activeQuestionId,
        candidateId: after.candidateId,
        dimension: after.dimension,
        semanticRequest: after.semanticRequest,
        semanticResponse: after.semanticResponse,
        patchStage: after.patchStage,
        schemaStage: after.schemaStage,
        groundingStage: after.groundingStage,
        repositoryStage: after.repositoryStage,
        safeErrorCode: after.safeErrorCode,
        lastAssistantMessage: after.lastAssistantMessage,
        sourceTurnCount: after.sourceTurnCount
      }
    }));
    expect(after.semanticRequest.task).toBe("profile-intake-follow-up-patch");
    expect(after.patchStage).toBe("completed");
    expect(after.repositoryStage).toBe("passed");
    expect(after.lastAssistantMessage).not.toContain("重新执行当前步骤");
    expect(after.sourceTurnCount).toBe(before.sourceTurnCount + 1);
  });
});

async function installSemanticFixture(page: Page) {
  await page.route("**/api/ai/structured", async (route) => {
    const body = route.request().postDataJSON() as { task?: string; input?: { rawNarrative?: string } };
    if (body.task !== "profile-intake-semantic") {
      await route.continue();
      return;
    }
    const raw = body.input?.rawNarrative ?? "";
    const quote = "课程项目使用 ESP32 做可检测心跳与摔倒的穿戴设备，我协助心跳模块、走线修复和蓝牙连接。";
    const start = raw.indexOf(quote);
    await fulfillJson(route, {
      ok: true,
      task: "profile-intake-semantic",
      promptVersion: "p44b-p0-fixture",
      output: {
        candidates: [{
          candidateKey: "wearable-project",
          sectionType: "project",
          sourceSpan: { start: Math.max(0, start), end: Math.max(0, start) + quote.length },
          structuredItem: {
            sectionType: "project",
            title: "可穿戴设备课程项目",
            role: "项目协助",
            tools: ["ESP32", "蓝牙"],
            description: "协助心跳模块、走线修复和蓝牙连接。",
            highlights: [],
            outcomes: []
          },
          professionalText: "在可穿戴设备课程项目中协助心跳模块、走线修复和蓝牙连接。",
          uncertainFields: []
        }],
        followUpQuestions: ["这个项目最终完成了哪些结果？"]
      },
      meta: { provider: "mock", model: "p44b-p0-fixture", inputLength: raw.length, outputLength: 700, latencyMs: 1 }
    });
  });
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
}

async function useServerProvider(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
      baseUrl: "",
      apiKey: "mock-key",
      model: "mock-p44b",
      provider: "mock"
    }));
  });
}

async function startIntake(page: Page) {
  await page.goto("/profile");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能", exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await resetIntakeBrowserState(page);
  await page.reload();
  if (await page.getByRole("button", { name: "跳过，先体验其他功能", exact: true }).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "跳过，先体验其他功能", exact: true }).click();
  }
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "个人资料库", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.goto("/ai-workspace");
  await page.getByRole("button", { name: /从零整理我的经历/ }).click();
  await expect(page.locator('[data-agent-workflow-id="guided_profile_intake"][data-agent-task-stage="collect_experience"]'))
    .toBeVisible({ timeout: 30_000 });
}

async function resetIntakeBrowserState(page: Page) {
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const storeNames = ["agentSessions", "agentMessages", "appMeta"].filter((name) => database.objectStoreNames.contains(name));
    if (!storeNames.length) {
      database.close();
      localStorage.removeItem("careerad.agent.activeSessionId");
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeNames, "readwrite");
      if (storeNames.includes("agentSessions")) transaction.objectStore("agentSessions").clear();
      if (storeNames.includes("agentMessages")) transaction.objectStore("agentMessages").clear();
      if (storeNames.includes("appMeta")) {
        const appMeta = transaction.objectStore("appMeta");
        const request = appMeta.getAll();
        request.onsuccess = () => {
          for (const row of request.result as Array<{ key?: string }>) {
            if (String(row.key ?? "").startsWith("profileIntakeSourceTurn:v1:")) appMeta.delete(row.key as IDBValidKey);
          }
        };
        request.onerror = () => reject(request.error);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    localStorage.removeItem("careerad.agent.activeSessionId");
  });
}

async function send(page: Page, text: string) {
  await page.getByLabel("描述你的求职任务").fill(text);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
}

async function readActiveSession(page: Page) {
  return page.evaluate(async () => {
    const open = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = <T>(database: IDBDatabase, storeName: string) => new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
    const database = await open();
    const sessions = await all<Record<string, unknown>>(database, "agentSessions");
    const activeId = localStorage.getItem("careeradapt.agent.activeSessionId");
    const session = (sessions.find((candidate) => candidate.id === activeId)
      ?? sessions.sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0]
      ?? {}) as Record<string, unknown>;
    const messages = await all<Record<string, unknown>>(database, "agentMessages");
    database.close();
    return {
      ...session,
      messages: messages
        .filter((message) => message.sessionId === session.id)
        .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0))
    };
  });
}

async function readActiveTask(page: Page) {
  const session = await readActiveSession(page);
  return (session as unknown as Record<string, unknown>).taskState;
}

async function readSafeState(page: Page) {
  return page.evaluate(async () => {
    const asRecord = (value: unknown): Record<string, unknown> =>
      value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const open = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = <T>(database: IDBDatabase, storeName: string) => new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
    const database = await open();
    const sessions = await all<Record<string, unknown>>(database, "agentSessions");
    const activeId = localStorage.getItem("careeradapt.agent.activeSessionId");
    const session = sessions.find((candidate) => candidate.id === activeId) ?? sessions[0] ?? {};
    const taskState = asRecord(session.taskState);
    const knownSlots = asRecord(taskState.knownSlots);
    const question = asRecord(knownSlots.intakeActiveQuestion);
    const messages = (await all<Record<string, unknown>>(database, "agentMessages"))
      .filter((message) => message.sessionId === session.id)
      .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0));
    const sourceTurns = (await all<Record<string, unknown>>(database, "appMeta"))
      .filter((row) => String(row.key ?? "").startsWith("profileIntakeSourceTurn:v1:"))
      .map((row) => asRecord(row.value));
    const latestSource = [...sourceTurns]
      .sort((left, right) => String(left.capturedAt ?? "").localeCompare(String(right.capturedAt ?? "")))
      .at(-1) ?? {};
    const latestSemantic = asRecord(knownSlots.profileIntakeReviewProjection);
    const latestAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant");
    database.close();
    return {
      turnClassification: latestSource.turnClassification ?? knownSlots.profileIntakeTurnKind ?? taskState.profileIntakeTurnKind ?? "unknown",
      activeQuestionId: question.questionId ?? knownSlots.activeQuestionId,
      candidateId: question.candidateId ?? knownSlots.intakeCandidateId,
      dimension: question.dimension ?? knownSlots.intakeDimension,
      semanticRequest: {
        task: latestSource.semanticTask,
        rawNarrativeLength: typeof latestSource.exactSourceText === "string" ? latestSource.exactSourceText.length : undefined,
        followUpCandidateId: latestSource.activeCandidateId,
        expectedDimension: latestSource.expectedAnswerDimension
      },
      semanticResponse: {
        providerStatus: latestSemantic.providerStatus,
        extractionStatus: latestSemantic.extractionStatus,
        candidateCount: Array.isArray(latestSemantic.candidates) ? latestSemantic.candidates.length : undefined,
        safeDiagnostics: latestSemantic.safeDiagnostics
      },
      patchStage: latestSource.patchStage,
      schemaStage: latestSource.schemaStage,
      groundingStage: latestSource.groundingStage,
      repositoryStage: latestSource.repositoryStage,
      safeErrorCode: latestSource.safeErrorCode ?? latestSource.lastErrorCode ?? asRecord(latestAssistantMessage?.metadata).errorCode,
      lastAssistantMessage: latestAssistantMessage?.content,
      sourceTurnCount: sourceTurns.length
    };
  });
}
