import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { AgentTaskState } from "@/agent/contracts/agentSession";
import { openManualPageTab } from "./support/g7b2Ui";

const profileFact = {
  id: "p43d2-project-a",
  sectionType: "project",
  title: "离线笔记工具",
  role: "开发者",
  startDate: "2025-01",
  endDate: "2025-06",
  current: false,
  tools: ["Rust", "Tauri"],
  highlights: ["实现本地索引与桌面界面"],
  outcomes: [],
  customFields: []
};

test("build_resume_from_profile creates an independent ResumeBranch and exports its PDF", async ({ page }, testInfo) => {
  await page.goto("/profile");
  const setupHeading = page.getByRole("heading", { name: "欢迎使用职适AI" });
  const profileSelector = page.getByLabel("选择人物");
  await expect(profileSelector.or(setupHeading)).toBeVisible({ timeout: 15_000 });
  if (new URL(page.url()).pathname === "/setup" || await setupHeading.isVisible()) {
    await page.getByRole("button", { name: "跳过，先体验其他功能" }).click();
    await page.waitForURL(/\/$/);
    await page.goto("/profile");
  }
  await expect(profileSelector).toBeVisible();
  const seeded = await seedProfile(page);
  const modelCalls: string[] = [];

  await page.route("**/api/agent/stream", async (route) => {
    const body = route.request().postDataJSON() as ModelBody;
    const tools = new Set((body.tools ?? []).map((tool) => tool.name));
    const observations = toolObservations(body);
    const latestUser = latestUserMessage(body);

    if (tools.has("get_active_profile") && !observations.some((item) => item.name === "get_active_profile")) {
      modelCalls.push("get_active_profile");
      await fulfillTool(route, "p43d2-build-active-profile", "get_active_profile", {});
      return;
    }
    if (tools.has("get_profile") && !observations.some((item) => item.name === "get_profile")) {
      modelCalls.push("get_profile");
      await fulfillTool(route, "p43d2-build-profile", "get_profile", { profileId: seeded.profileId });
      return;
    }
    if (tools.has("create_resume_from_profile") && latestUser.includes("全部已确认经历")) {
      modelCalls.push("create_resume_from_profile");
      await fulfillTool(route, "p43d2-build-create", "create_resume_from_profile", {
        targetProfileId: seeded.profileId,
        expectedProfileVersion: seeded.version,
        selectedFactIds: [profileFact.id],
        name: "后端工程通用简历"
      });
      return;
    }
    if (observations.some((item) => item.name === "create_resume_from_profile")) {
      await fulfillFinal(route, "已创建独立通用简历，请打开编辑器继续检查。");
      return;
    }
    await fulfillAsk(route, "请选择要使用的已确认经历；你可以回复“全部已确认经历”。");
  });

  await page.goto("/ai-workspace");
  await page.getByRole("button", { name: "从资料库组装简历" }).click();
  await expect.poll(() => readLatestAgentTask(page)).toMatchObject({
    rootGoal: "create_resume_from_profile",
    workflowId: "build_resume_from_profile",
    stage: "select_facts"
  });

  await page.getByLabel("描述你的求职任务").fill("目标方向是后端工程，全部已确认经历都可以使用。");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
  await expect.poll(() => readLatestAgentTask(page)).toMatchObject({
    rootGoal: "create_resume_from_profile",
    workflowId: "build_resume_from_profile",
    stage: "confirm_create",
    completionStatus: "waiting_for_confirmation"
  });

  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => readLatestAgentTask(page), { timeout: 20_000 }).toMatchObject({
    rootGoal: "create_resume_from_profile",
    stage: "completed",
    completionStatus: "completed"
  });

  const result = await readBuildResult(page, seeded.profileId);
  expect(result.profile).toEqual(seeded.profileSnapshot);
  expect(result.branches).toHaveLength(1);
  expect(result.branches[0]).toMatchObject({
    profileId: seeded.profileId,
    branchPurpose: "general",
    name: "后端工程通用简历",
    revision: 0,
    migrationStatus: "verified"
  });
  expect(result.branches[0]?.structuredContentItems?.map((item) => item.data.id)).toEqual([profileFact.id]);
  expect(result.revisions).toHaveLength(1);
  expect(result.revisions[0]).toMatchObject({ branchId: result.branches[0]?.id, revisionNumber: 0 });
  expect(result.operations).toHaveLength(1);
  expect(modelCalls.filter((name) => name === "create_resume_from_profile")).toHaveLength(1);

  const session = result.session;
  expect(session.pendingConfirmation).toBeUndefined();
  expect(session.activeTurn?.status).toBe("completed");
  expect(session.messages.filter((message) => message.toolName === "create_resume_from_profile")).toHaveLength(1);
  expect(session.messages.some((message) => message.role === "user" && message.metadata?.executionState === "running")).toBe(false);

  await page.getByRole("button", { name: /产物 \d+/ }).click();
  await expect(page.getByText("独立通用简历已创建")).toBeVisible();
  await page.getByRole("link", { name: "打开简历编辑器" }).click();
  await expect(page).toHaveURL(new RegExp(`/resume\\?branchId=${result.branches[0]?.id}`));
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  await openManualPageTab(page);
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST",
    { timeout: 30_000 }
  );
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "下载 PDF" }).click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  expect(response.status()).toBe(200);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const pdfPath = testInfo.outputPath("profile-built.pdf");
  await download.saveAs(pdfPath);
  expect(existsSync(pdfPath)).toBe(true);
  expect(statSync(pdfPath).size).toBeGreaterThan(0);
  const pdfText = execFileSync(resolvePopplerBinary(), [pdfPath, "-"], { encoding: "utf8" });
  expect(pdfText).toMatch(/[\u4e00-\u9fff]/u);
  expect(pdfText).not.toContain("{{");
});

type ModelBody = {
  messages?: Array<{ role: string; name?: string; content: string }>;
  tools?: Array<{ name: string }>;
};

async function seedProfile(page: Page) {
  return page.evaluate(async (fact) => {
    const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const requestValue = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    const database = await openDatabase();
    const transaction = database.transaction("profiles", "readwrite");
    const store = transaction.objectStore("profiles");
    const profiles = await requestValue<Record<string, unknown>[]>(store.getAll() as IDBRequest<Record<string, unknown>[]>);
    const profile = profiles[0];
    if (!profile) throw new Error("profile_seed_missing");
    const version = Number(profile.version);
    const oldExperiences = Array.isArray(profile.experiences)
      ? profile.experiences as Array<Record<string, unknown>>
      : [];
    const experienceTemplate = oldExperiences[0] ?? {};
    const factTemplate = Array.isArray(experienceTemplate.facts)
      ? experienceTemplate.facts[0] as Record<string, unknown>
      : {};
    const sourceTime = new Date().toISOString();
    const newFactId = `fact-${fact.id}`;
    const newExperience = {
      ...experienceTemplate,
      id: "p43d2-experience-a",
      organization: "匿名产品实验室",
      role: "开发者",
      startDate: fact.startDate,
      endDate: fact.endDate,
      current: false,
      evidenceIds: [],
      tags: fact.tools,
      facts: [{
        ...factTemplate,
        id: newFactId,
        category: "experience",
        statement: "实现本地索引与桌面界面。",
        confirmedByUser: true,
        riskLevel: "low",
        provenance: Array.isArray(factTemplate.provenance) && factTemplate.provenance.length
          ? factTemplate.provenance.map((source: Record<string, unknown>) => ({
              ...source,
              sourceText: "实现本地索引与桌面界面。",
              confirmedByUser: true,
              capturedAt: sourceTime,
              createdAt: sourceTime,
              updatedAt: sourceTime
            }))
          : [{
              sourceId: "p43d2-anonymized-fixture",
              sourceType: "manual",
              sourceText: "实现本地索引与桌面界面。",
              confidence: 1,
              confirmedByUser: true,
              riskLevel: "low",
              createdAt: sourceTime,
              updatedAt: sourceTime
            }],
        createdAt: sourceTime,
        updatedAt: sourceTime
      }],
      resumeDrafts: [],
      createdAt: sourceTime,
      updatedAt: sourceTime
    };
    const profileSnapshot = {
      ...profile,
      experiences: [...oldExperiences, newExperience],
      structuredFacts: [{
        data: fact,
        factIds: [`fact-${fact.id}`],
        sourceBlockIds: [`block-${fact.id}`],
        sourceRanges: [],
        mappingTrace: []
      }],
      version,
      updatedAt: sourceTime
    };
    store.put(profileSnapshot);
    await transactionDone(transaction);
    database.close();
    return { profileId: String(profile.id), version, profileSnapshot };
  }, profileFact);
}

async function readLatestAgentTask(page: Page): Promise<AgentTaskState> {
  return page.evaluate(async () => {
    const request = indexedDB.open("CareerAdaptDb");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sessions = await new Promise<Array<{ taskState?: unknown; updatedAt: string }>>((resolve, reject) => {
      const get = database.transaction("agentSessions", "readonly").objectStore("agentSessions").getAll();
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    database.close();
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.taskState as AgentTaskState;
  });
}

async function readBuildResult(page: Page, profileId: string) {
  return page.evaluate(async (id) => {
    const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const requestValue = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const database = await openDatabase();
    const [profiles, branches, revisions, operations, sessions, messageRecords] = await Promise.all([
      requestValue<Array<Record<string, unknown>>>(database.transaction("profiles", "readonly").objectStore("profiles").getAll()),
      requestValue<Array<Record<string, unknown>>>(database.transaction("resumeBranches", "readonly").objectStore("resumeBranches").getAll()),
      requestValue<Array<Record<string, unknown>>>(database.transaction("resumeRevisions", "readonly").objectStore("resumeRevisions").getAll()),
      requestValue<Array<Record<string, unknown>>>(database.transaction("resumeBranchOperations", "readonly").objectStore("resumeBranchOperations").getAll()),
      requestValue<Array<Record<string, unknown>>>(database.transaction("agentSessions", "readonly").objectStore("agentSessions").getAll()),
      requestValue<Array<Record<string, unknown>>>(database.transaction("agentMessages", "readonly").objectStore("agentMessages").getAll())
    ]);
    database.close();
    const session = sessions.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0];
    return {
      profile: profiles.find((profile) => profile.id === id),
      branches: branches.filter((branch) => branch.profileId === id),
      revisions: revisions.filter((revision) => branches.some((branch) => branch.id === revision.branchId)),
      operations: operations.filter((operation) => branches.some((branch) => branch.id === operation.branchId)),
      session: {
        ...session,
        messages: messageRecords.filter((message) => message.sessionId === session?.id)
      }
    } as {
      profile: Record<string, unknown>;
      branches: Array<Record<string, unknown> & {
        structuredContentItems?: Array<{ data: { id: string } }>;
      }>;
      revisions: Array<Record<string, unknown>>;
      operations: Array<Record<string, unknown>>;
      session: {
        taskState?: unknown;
        pendingConfirmation?: unknown;
        activeTurn?: { status?: string };
        messages: Array<{ role: string; toolName?: string; content?: string; status?: string; metadata?: Record<string, unknown> }>;
      };
    };
  }, profileId);
}

function latestUserMessage(body: ModelBody) {
  return [...(body.messages ?? [])].reverse().find((message) => message.role === "user")?.content ?? "";
}

function toolObservations(body: ModelBody) {
  const latestUserIndex = body.messages?.findLastIndex((message) => message.role === "user") ?? -1;
  return (body.messages ?? []).slice(latestUserIndex + 1).filter((message) => message.role === "tool");
}

function nativeTool(id: string, name: string, args: Record<string, unknown>) {
  const call = { id, name, arguments: args };
  return [
    "event: model_tool_call_start",
    `data: ${JSON.stringify({ type: "model_tool_call_start", index: 0, id, name })}`,
    "",
    "event: model_tool_call_complete",
    `data: ${JSON.stringify({ type: "model_tool_call_complete", index: 0, call })}`,
    "",
    "event: model_finish",
    `data: ${JSON.stringify({ type: "model_finish", stopReason: "tool_calls" })}`,
    "",
    ""
  ].join("\n");
}

function nativeAsk(message: string) {
  return [
    "event: model_text_delta",
    `data: ${JSON.stringify({ type: "model_text_delta", delta: message })}`,
    "",
    "event: model_finish",
    `data: ${JSON.stringify({ type: "model_finish", stopReason: "ask_user" })}`,
    "",
    ""
  ].join("\n");
}

function nativeFinal(message: string) {
  return [
    "event: model_text_delta",
    `data: ${JSON.stringify({ type: "model_text_delta", delta: message })}`,
    "",
    "event: model_finish",
    `data: ${JSON.stringify({ type: "model_finish", stopReason: "final" })}`,
    "",
    ""
  ].join("\n");
}

async function fulfillTool(route: Route, id: string, name: string, args: Record<string, unknown>) {
  await route.fulfill({ contentType: "text/event-stream", body: nativeTool(id, name, args) });
}

async function fulfillAsk(route: Route, message: string) {
  await route.fulfill({ contentType: "text/event-stream", body: nativeAsk(message) });
}

async function fulfillFinal(route: Route, message: string) {
  await route.fulfill({ contentType: "text/event-stream", body: nativeFinal(message) });
}

function resolvePopplerBinary() {
  return [
    "E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe",
    "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"
  ].find((candidate) => existsSync(candidate)) ?? "pdftotext";
}
