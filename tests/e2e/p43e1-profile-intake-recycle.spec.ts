import { expect, test, type Page, type Route } from "@playwright/test";
import type { AgentTaskState } from "@/agent/contracts/agentSession";
import { bootstrapP43e1DisposableProfile } from "./support/p43e1ProfileIntakeBootstrap";

const META_QUESTION = "资料库的教育经历我不是已经放到回收站了吗，你怎么还知道";
const EDUCATION_NARRATIVE = "我现在是郑州大学本科学生，计算机科学与技术专业，2024年9月入学，预计2028年6月毕业。";

test.describe("P4.3e.1 profile intake recycle isolation", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
        baseUrl: "",
        apiKey: "mock-key",
        model: "",
        provider: "mock"
      }));
    });
    await mockTypedEducationSemantic(page);
  });

  test("recycle → fresh Agent Intake → meta question side turn → typed education → save only", async ({ page }) => {
    const seeded = await bootstrapP43e1DisposableProfile(page);
    await expect.poll(() => readProfileState(page, seeded.profileId)).toMatchObject({
      version: seeded.versionAfterRecycle,
      activeIds: [],
      recycledIds: [seeded.educationId]
    });

    await routeProfileIntake(page);
    await startProfileIntake(page);
    await expect(page.getByText("请先介绍你的教育背景。", { exact: true })).toBeVisible();

    await send(page, META_QUESTION);
    await expect(page.getByText(/没有这条教育经历/)).toBeVisible();
    const complaintTools = await readToolsForUserTurn(page, META_QUESTION);
    expect(complaintTools).toContain("get_profile");
    expect(complaintTools.filter((name) => [
      "capture_profile_intake",
      "review_profile_intake",
      "reconcile_profile_intake",
      "commit_profile_intake"
    ].includes(name))).toEqual([]);
    await expect.poll(() => readLatestAgentTask(page)).toMatchObject({
      rootGoal: "profile_intake",
      workflowId: "guided_profile_intake",
      stage: "collect_experience"
    });

    await send(page, EDUCATION_NARRATIVE);
    await expect.poll(() => page.getByRole("button", { name: /产物 \d+/ }).count()).toBeGreaterThan(0);
    await expect.poll(() => readLatestAgentTask(page)).toMatchObject({
      knownSlots: { latestIntakeSource: { sourceKind: "career_narrative" } }
    });
    await page.getByRole("button", { name: /产物 \d+/ }).first().click();
    const artifact = page.getByRole("region", { name: "经历核对" });
    const educationCandidate = artifact.locator(".agent-career-asset").first();
    await expect(educationCandidate.locator("header div strong")).toHaveText("郑州大学 / 本科 / 计算机科学与技术");
    await expect(educationCandidate.locator("header div strong")).not.toContainText("我现在是");
    await expect(artifact).toContainText("郑州大学");
    await expect(artifact).toContainText("本科");
    await expect(artifact).toContainText("计算机科学与技术");
    await expect(artifact).toContainText("2024-09");
    await expect(artifact).toContainText("2028-06");
    await artifact.getByRole("button", { name: "采用", exact: true }).first().click();

    await page.getByRole("button", { name: "关闭任务产物" }).click();
    await expect(page.getByRole("button", { name: "仅保存资料库", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "仅保存资料库", exact: true }).click();
    await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect.poll(() => readLatestAgentTask(page)).toMatchObject({
      rootGoal: "profile_intake",
      stage: "profile_complete",
      completionStatus: "completed"
    });
    const saved = await readProfileState(page, seeded.profileId);
    expect(saved.activeItems.find((item) => item.id === seeded.educationId)).toBeUndefined();
    expect(saved.activeItems.some((item) => item.school === "郑州大学")).toBe(true);
    expect(saved.activeItems.find((item) => item.school === "郑州大学")).toMatchObject({
      school: "郑州大学",
      degree: "本科",
      major: "计算机科学与技术",
      startDate: "2024-09",
      endDate: "2028-06"
    });
  });

  test("repeat intake and generate a General Resume after the typed candidate is accepted", async ({ page }) => {
    const seeded = await bootstrapP43e1DisposableProfile(page);
    await routeProfileIntake(page);
    await startProfileIntake(page);
    await expect(page.getByText("请先介绍你的教育背景。", { exact: true })).toBeVisible();
    await send(page, EDUCATION_NARRATIVE);
    await expect.poll(() => page.getByRole("button", { name: /产物 \d+/ }).count()).toBeGreaterThan(0);
    await page.getByRole("button", { name: /产物 \d+/ }).first().click();
    const artifact = page.getByRole("region", { name: "经历核对" });
    await expect(artifact).toContainText("计算机科学与技术");
    await artifact.getByRole("button", { name: "采用", exact: true }).first().click();
    await page.getByRole("button", { name: "关闭任务产物" }).click();
    await expect(page.getByRole("button", { name: "生成一份通用简历", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "生成一份通用简历", exact: true }).click();
    await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect.poll(() => readLatestAgentTask(page), { timeout: 30_000 }).toMatchObject({
      stage: "resume_ready",
      completionStatus: "completed"
    });
    const state = await readLatestAgentTask(page);
    expect(state.knownSlots.generalResumeResult).toBeDefined();
    const saved = await readProfileState(page, seeded.profileId);
    expect(saved.activeItems.some((item) => item.school === "郑州大学")).toBe(true);
  });
});

async function mockTypedEducationSemantic(page: Page) {
  await page.route("**/api/ai/structured", async (route) => {
    const body = route.request().postDataJSON() as { task?: string; input?: { rawNarrative?: string } };
    if (body.task !== "profile-intake-semantic") {
      await route.continue();
      return;
    }
    const raw = body.input?.rawNarrative?.trim() ?? "";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        task: "profile-intake-semantic",
        promptVersion: "profile-intake-semantic.p43e1-e2e",
        output: {
          candidates: [{
            candidateKey: "p43e1-education",
            sectionType: "education",
            structuredItem: {
              id: "p43e1-education",
              sectionType: "education",
              school: "郑州大学",
              degree: "本科",
              major: "计算机科学与技术",
              startDate: "2024-09",
              endDate: "2028-06",
              current: false,
              courses: [],
              honors: [],
              highlights: [],
              customFields: []
            },
            current: false,
            highlights: [],
            tools: [],
            methods: [],
            outcomes: [],
            sourceQuote: raw,
            confidence: 0.99,
            needsConfirmation: false,
            fieldEvidence: ["school", "degree", "major", "startDate", "endDate"].map((field) => ({
              field,
              sourceQuote: field === "school" ? "郑州大学" : field === "degree" ? "本科" : field === "major" ? "计算机科学与技术" : field === "startDate" ? "2024年9月" : "2028年6月",
              support: "explicit",
              confidence: 0.99,
              needsConfirmation: false
            }))
          }]
        },
        meta: { provider: "mock", model: "p43e1", inputLength: raw.length, outputLength: 900, latencyMs: 1 }
      })
    });
  });
}

async function routeProfileIntake(page: Page) {
  await page.route("**/api/agent/stream", async (route) => {
    const body = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>;
      tools?: Array<{ name: string }>;
    };
    const latestUser = [...(body.messages ?? [])].reverse().find((message) => message.role === "user")?.content ?? "";
    const observations = toolObservations(body);
    const tools = new Set((body.tools ?? []).map((tool) => tool.name));
    if (latestUser === META_QUESTION && tools.has("get_profile") && !observations.some((item) => item.name === "get_profile")) {
      await fulfillTool(route, "p43e1-profile-read", "get_profile", {});
      return;
    }
    if (tools.has("get_active_profile") && !observations.some((item) => item.name === "get_active_profile")) {
      await fulfillTool(route, "p43e1-active-profile", "get_active_profile", {});
      return;
    }
    if (tools.has("capture_profile_intake") && latestUser.includes("郑州大学") && !observations.some((item) => item.name === "capture_profile_intake")) {
      await fulfillTool(route, "p43e1-capture", "capture_profile_intake", {});
      return;
    }
    if (tools.has("reconcile_profile_intake") && !observations.some((item) => item.name === "reconcile_profile_intake")) {
      await fulfillTool(route, "p43e1-reconcile", "reconcile_profile_intake", {});
      return;
    }
    if (tools.has("commit_profile_intake") && !observations.some((item) => item.name === "commit_profile_intake")) {
      await fulfillTool(route, "p43e1-commit", "commit_profile_intake", {});
      return;
    }
    if (tools.has("ensure_general_resume_from_profile") && !observations.some((item) => item.name === "ensure_general_resume_from_profile")) {
      await fulfillTool(route, "p43e1-general-resume", "ensure_general_resume_from_profile", {});
      return;
    }
    if (observations.some((item) => item.name === "commit_profile_intake")) {
      await fulfillAsk(route, "经历已写入资料库。你可以仅保存资料库，或生成一份通用简历。");
      return;
    }
    await fulfillAsk(route, latestUser.includes("从零整理") ? "请先介绍你的教育背景。" : "请先介绍你的教育背景。");
  });
}

function toolObservations(body: { messages?: Array<{ role: string; name?: string; content: string }> }) {
  const messages = body.messages ?? [];
  const latestUserIndex = messages.findLastIndex((message) => message.role === "user");
  return messages.slice(latestUserIndex + 1)
    .filter((message) => message.role === "tool")
    .map((message) => ({ name: message.name ?? "", observation: message.content }));
}

async function fulfillTool(route: Route, id: string, name: string, args: Record<string, unknown>) {
  const call = { id, name, arguments: args };
  await route.fulfill({
    contentType: "text/event-stream",
    body: [
      `event: model_tool_call_start`,
      `data: ${JSON.stringify({ type: "model_tool_call_start", index: 0, id, name })}`,
      "",
      `event: model_tool_call_complete`,
      `data: ${JSON.stringify({ type: "model_tool_call_complete", index: 0, call })}`,
      "",
      `event: model_finish`,
      `data: ${JSON.stringify({ type: "model_finish", stopReason: "tool_calls" })}`,
      "",
      ""
    ].join("\n")
  });
}

async function fulfillAsk(route: Route, message: string) {
  await route.fulfill({
    contentType: "text/event-stream",
    body: [
      `event: model_text_delta`,
      `data: ${JSON.stringify({ type: "model_text_delta", delta: message })}`,
      "",
      `event: model_finish`,
      `data: ${JSON.stringify({ type: "model_finish", stopReason: "ask_user" })}`,
      "",
      ""
    ].join("\n")
  });
}

async function startProfileIntake(page: Page) {
  await page.goto("/ai-workspace");
  await page.getByRole("button", { name: "从零整理我的经历" }).click();
}

async function send(page: Page, text: string) {
  await page.getByLabel("描述你的求职任务").fill(text);
  await page.getByRole("button", { name: "发送消息" }).click();
}

async function readLatestAgentTask(page: Page): Promise<AgentTaskState> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const openRequest = indexedDB.open("CareerAdaptDb");
      openRequest.onsuccess = () => resolve(openRequest.result);
      openRequest.onerror = () => reject(openRequest.error);
    });
    const request = database.transaction("agentSessions", "readonly").objectStore("agentSessions").getAll();
    const sessions = await new Promise<Array<{ taskState?: AgentTaskState; updatedAt: string }>>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as Array<{ taskState?: AgentTaskState; updatedAt: string }>);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.taskState as AgentTaskState;
  });
}

async function readToolsForUserTurn(page: Page, text: string) {
  return page.evaluate(async (userText) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const openRequest = indexedDB.open("CareerAdaptDb");
      openRequest.onsuccess = () => resolve(openRequest.result);
      openRequest.onerror = () => reject(openRequest.error);
    });
    const request = database.transaction("agentSessions", "readonly").objectStore("agentSessions").getAll();
    const sessions = await new Promise<Array<{ id: string }>>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as Array<{ id: string }>);
      request.onerror = () => reject(request.error);
    });
    const activeSessionId = localStorage.getItem("careeradapt.agent.activeSessionId") ?? sessions.at(-1)?.id;
    const messageRequest = database.transaction("agentMessages", "readonly").objectStore("agentMessages").getAll();
    const messages = await new Promise<Array<{ sessionId: string; role: string; content: string; turnId?: string; toolName?: string }>>((resolve, reject) => {
      messageRequest.onsuccess = () => resolve(messageRequest.result as Array<{ sessionId: string; role: string; content: string; turnId?: string; toolName?: string }>);
      messageRequest.onerror = () => reject(messageRequest.error);
    });
    database.close();
    const sessionMessages = messages.filter((message) => message.sessionId === activeSessionId);
    const user = sessionMessages.findLast((message) => message.role === "user" && message.content === userText);
    return sessionMessages.filter((message) => message.turnId === user?.turnId && message.toolName).map((message) => message.toolName!);
  }, text);
}

async function readProfileState(page: Page, profileId: string) {
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const openRequest = indexedDB.open("CareerAdaptDb");
      openRequest.onsuccess = () => resolve(openRequest.result);
      openRequest.onerror = () => reject(openRequest.error);
    });
    const profileRequest = database.transaction("profiles", "readonly").objectStore("profiles").get(id);
    const profile = await new Promise<Record<string, unknown>>((resolve, reject) => {
      profileRequest.onsuccess = () => resolve(profileRequest.result as Record<string, unknown>);
      profileRequest.onerror = () => reject(profileRequest.error);
    });
    const metaRequest = database.transaction("appMeta", "readonly").objectStore("appMeta").get("workspaceRecycleBin:v1");
    const meta = await new Promise<{ value: { profileItems: Array<{ profileId: string; id: string; kind: string }> } }>((resolve, reject) => {
      metaRequest.onsuccess = () => resolve(metaRequest.result as { value: { profileItems: Array<{ profileId: string; id: string; kind: string }> } });
      metaRequest.onerror = () => reject(metaRequest.error);
    });
    database.close();
    const facts = Array.isArray(profile.structuredFacts) ? profile.structuredFacts.map((entry) => entry.data as Record<string, unknown>) : [];
    return {
      version: Number(profile.version ?? 0),
      activeIds: facts.map((item) => item.id),
      activeItems: facts,
      recycledIds: (meta.value.profileItems ?? []).filter((item) => item.profileId === id && item.kind === "canonical").map((item) => item.id)
    };
  }, profileId);
}
