import { expect, test, type Page, type Route } from "@playwright/test";
import fixture from "../fixtures/p43e3-conversation-branch-regression.json";

type ModelMessage = {
  role: string;
  content?: string;
  name?: string;
  toolCallId?: string;
};

type ModelBody = {
  messages?: ModelMessage[];
  tools?: Array<{ name: string }>;
};

type ProviderProbe = {
  requests: ModelBody[];
};

type StoredAgentMessage = {
  id: string;
  sequence?: number;
  branchId?: string;
  role: string;
  content: string;
  status?: string;
  kind?: string;
  toolName?: string;
  operationId?: string;
  parentMessageId?: string;
  metadata?: Record<string, unknown>;
};

type StoredSession = {
  id: string;
  activeBranchId: string;
  activeHeadMessageId?: string;
  conversationBranches: Array<{
    id: string;
    parentBranchId?: string;
    forkedFromMessageId?: string;
    headMessageId?: string;
    status: string;
  }>;
  taskState?: {
    stage?: string;
    knownSlots?: Record<string, unknown>;
  };
  messages: StoredAgentMessage[];
};

test.describe("P4.3e.3 conversation branch isolation", () => {
  test("A: consumes Profile Intake section options without a User turn or provider/tool call", async ({ page }) => {
    test.setTimeout(120_000);
    expect(fixture.profileIntakeSectionOptions).toContain("project");
    const probe = await installFixture(page);
    await startIntake(page);
    await captureAndAcceptEducation(page);

    const beforeClickRequests = probe.requests.length;
    const beforeClick = await latestSession(page);
    const beforeCaptureCount = toolCount(beforeClick, "capture_profile_intake");

    await expect(page.getByRole("button", { name: "继续补充", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "继续补充", exact: true }).click();

    await expect(page.getByText(/^已选择：.+$/u)).toBeVisible();
    await expect(page.getByRole("button", { name: "继续补充", exact: true })).toHaveCount(0);
    await expect(page.locator(".agent-message-row.is-user").filter({ hasText: "项目经历" })).toHaveCount(0);
    await expect(page.getByText(/请告诉我.*名称、你承担的角色、主要工作和结果。/u)).toBeVisible();
    await expect(page.locator(".agent-message-row.is-assistant").last().locator(".agent-message-options")).toHaveCount(0);

    expect(probe.requests).toHaveLength(beforeClickRequests);
    const afterClick = await latestSession(page);
    expect(toolCount(afterClick, "capture_profile_intake")).toBe(beforeCaptureCount);
    expect(fixture.profileIntakeSectionOptions).toContain(afterClick.taskState?.knownSlots?.intakeRequestedSection);
    expect(afterClick.taskState?.knownSlots?.latestIntakeSource).not.toMatchObject({ exactSourceQuote: "项目经历" });
  });

  test("B: regenerates an earlier Assistant narration on an isolated branch with no later context or tools", async ({ page }) => {
    test.setTimeout(120_000);
    const probe = await installFixture(page);
    await startIntake(page);
    await send(page, educationNarrative());
    await expect.poll(() => latestTask(page)).toMatchObject({ stage: "review_facts" });

    const beforeReview = await latestSession(page);
    const sourceAssistant = [...beforeReview.messages]
      .reverse()
      .find((message) => message.role === "assistant" && message.status === "complete" && message.kind === "text");
    expect(sourceAssistant?.id).toBeTruthy();
    await acceptEducationCandidate(page);
    await expect(page.getByRole("button", { name: "继续补充", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "继续补充", exact: true }).click();
    await expect(page.getByText(/请告诉我.*名称、你承担的角色、主要工作和结果。/u)).toBeVisible();

    const beforeRegenerate = await latestSession(page);
    const captureCount = toolCount(beforeRegenerate, "capture_profile_intake");
    const draftImportId = String(beforeRegenerate.taskState?.knownSlots?.intakeImportId ?? "");
    const draftRevision = await importedDraftRevision(page, draftImportId);
    const profileVersion = await activeProfileVersion(page);
    const requestCount = probe.requests.length;
    const sourceRow = page.locator(`[data-message-id="${sourceAssistant!.id}"]`);
    await expect(sourceRow).toBeVisible();
    await sourceRow.getByRole("button", { name: "重新生成", exact: true }).click();

    await expect.poll(() => probe.requests.length, { timeout: 30_000 }).toBe(requestCount + 1);
    await expect(page.getByText("重新整理后的教育经历核对回复。", { exact: true })).toBeVisible();
    const regenerationRequest = probe.requests.at(-1);
    expect(regenerationRequest?.tools ?? []).toEqual([]);
    expect(JSON.stringify(regenerationRequest?.messages ?? [])).not.toContain("项目经历");

    const afterRegenerate = await latestSession(page);
    expect(afterRegenerate.activeBranchId).not.toBe(beforeRegenerate.conversationBranches.find((branch) => branch.status === "active")?.id ?? "");
    expect(toolCount(afterRegenerate, "capture_profile_intake")).toBe(captureCount);
    expect(await importedDraftRevision(page, draftImportId)).toBe(draftRevision);
    expect(await activeProfileVersion(page)).toBe(profileVersion);
    expect(afterRegenerate.messages.filter((message) => message.branchId === afterRegenerate.activeBranchId && message.role === "tool")).toHaveLength(0);
    await expect(page.getByText(/请告诉我.*名称、你承担的角色、主要工作和结果。/u)).toHaveCount(0);
    await expect(page.getByText("任务暂时中断", { exact: true })).toHaveCount(0);
  });

  test("C: edits the education User message by creating a new branch and capturing the edited source once", async ({ page }) => {
    test.setTimeout(120_000);
    await installFixture(page);
    await startIntake(page);
    const originalEducation = educationNarrative();
    await send(page, originalEducation);
    await expect.poll(() => latestTask(page)).toMatchObject({ stage: "review_facts" });
    await acceptEducationCandidate(page);
    await page.getByRole("button", { name: "继续补充", exact: true }).click();
    await expect(page.getByText(/请告诉我.*名称、你承担的角色、主要工作和结果。/u)).toBeVisible();

    const beforeEdit = await latestSession(page);
    const originalCaptureCount = toolCount(beforeEdit, "capture_profile_intake");
    const oldBranchId = beforeEdit.activeBranchId;
    const oldBranchAssistants = beforeEdit.messages
      .filter((message) => message.branchId === oldBranchId && message.role === "assistant")
      .map((message) => ({ id: message.id, content: message.content, status: message.status, kind: message.kind }));
    const originalRow = page.locator(".agent-message-row.is-user").filter({ hasText: originalEducation }).first();
    const originalMessageId = await originalRow.getAttribute("data-message-id");
    expect(originalMessageId).toBeTruthy();
    await originalRow.getByRole("button", { name: "编辑并重发", exact: true }).click();
    const editor = originalRow.getByRole("textbox", { name: "编辑消息", exact: true });
    const editedEducation = "我在示例理工大学读软件工程本科，2025年9月入学，预计2029年6月毕业。";
    await editor.fill(editedEducation);
    const confirmEdit = page.getByRole("button", { name: "确认并重发", exact: true });
    await expect(confirmEdit).toHaveCount(1);
    await expect(confirmEdit).toBeEnabled();
    await confirmEdit.click();

    await expect.poll(async () => (await latestSession(page)).activeBranchId, { timeout: 30_000 }).not.toBe(oldBranchId);
    await expect.poll(() => latestTask(page), { timeout: 30_000 }).toMatchObject({ stage: "review_facts" });
    const afterEdit = await latestSession(page);
    expect(afterEdit.taskState).toMatchObject({ stage: "review_facts" });
    expect(afterEdit.activeBranchId).not.toBe(oldBranchId);
    expect(afterEdit.conversationBranches).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: oldBranchId, status: "superseded" }),
      expect.objectContaining({ id: afterEdit.activeBranchId, parentBranchId: oldBranchId, status: "active" })
    ]));
    expect(toolCount(afterEdit, "capture_profile_intake")).toBe(originalCaptureCount + 1);
    expect(afterEdit.messages
      .filter((message) => message.branchId === oldBranchId && message.role === "assistant")
      .map((message) => ({ id: message.id, content: message.content, status: message.status, kind: message.kind })))
      .toEqual(oldBranchAssistants);
    expect(afterEdit.messages.filter((message) => message.role === "user" && message.content === editedEducation)).toHaveLength(1);
    expect(afterEdit.taskState?.knownSlots?.latestIntakeSource).toMatchObject({ exactSourceQuote: editedEducation });
    expect(afterEdit.taskState?.knownSlots?.latestIntakeSource).not.toMatchObject({ exactSourceQuote: "项目经历" });
    expect(afterEdit.messages.some((message) => /请告诉我.*名称、你承担的角色、主要工作和结果。/u.test(message.content) && message.branchId === afterEdit.activeBranchId)).toBe(false);
    expect(afterEdit.messages.some((message) => /名称、你承担的角色/u.test(message.content) && message.branchId === oldBranchId)).toBe(true);
  });

  test("D: reload keeps the active branch head and resolved options without replaying tools", async ({ page }) => {
    test.setTimeout(120_000);
    const probe = await installFixture(page);
    await startIntake(page);
    await captureAndAcceptEducation(page);
    await page.getByRole("button", { name: "继续补充", exact: true }).click();
    const beforeReload = await latestSession(page);
    const captureCount = toolCount(beforeReload, "capture_profile_intake");
    const providerRequestCount = probe.requests.length;
    const activeBranchId = beforeReload.activeBranchId;
    const activeHeadMessageId = beforeReload.activeHeadMessageId;
    await page.reload();

    await expect(page.getByText(/^已选择：.+$/u)).toBeVisible();
    await expect(page.getByRole("button", { name: "继续补充", exact: true })).toHaveCount(0);
    await expect(page.getByText(/请告诉我.*名称、你承担的角色、主要工作和结果。/u)).toBeVisible();
    const afterReload = await latestSession(page);
    expect(afterReload.activeBranchId).toBe(activeBranchId);
    expect(afterReload.activeHeadMessageId).toBe(activeHeadMessageId);
    expect(toolCount(afterReload, "capture_profile_intake")).toBe(captureCount);
    expect(probe.requests).toHaveLength(providerRequestCount);
  });
});

function educationNarrative() {
  return "我现在是示例大学本科学生，计算机相关专业，2024年9月入学，预计2028年6月毕业";
}

async function installFixture(page: Page): Promise<ProviderProbe> {
  const probe: ProviderProbe = { requests: [] };
  await page.route("**/api/ai/structured**", async (route) => {
    const body = route.request().postDataJSON() as { task?: string; input?: { rawNarrative?: string } };
    if (body.task !== "profile-intake-semantic") return route.continue();
    const raw = body.input?.rawNarrative?.trim() ?? "";
    const education = /大学|本科|入学|毕业/u.test(raw);
    const output = education ? {
      id: raw.includes("理工") ? "fixture-edited-education" : "fixture-education",
      sectionType: "education",
      school: raw.includes("理工") ? "示例理工大学" : "示例大学",
      degree: "本科",
      major: raw.includes("软件工程") ? "软件工程" : "计算机相关专业",
      startDate: raw.includes("2025") ? "2025-09" : "2024-09",
      endDate: raw.includes("2029") ? "2029-06" : "2028-06",
      current: false,
      courses: [],
      honors: [],
      highlights: [],
      customFields: []
    } : {
      id: "fixture-project",
      sectionType: "project",
      title: "示例项目",
      current: false,
      description: "负责需求分析、开发和上线交付，最终交付了可用版本。",
      highlights: ["需求分析、开发和上线交付"],
      tools: [],
      outcomes: ["最终交付了可用版本"],
      customFields: []
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        task: body.task,
        promptVersion: "p43e3-fixture",
        output: {
          candidates: [{
            candidateKey: output.id,
            sectionType: output.sectionType,
            sourceSpan: { start: 0, end: raw.length },
            structuredItem: output,
            professionalText: education
              ? "示例大学本科计算机相关专业，2024年9月入学，预计2028年6月毕业。"
              : output.description,
            uncertainFields: []
          }],
          followUpQuestions: []
        },
        meta: { provider: "fixture", model: "p43e3" }
      })
    });
  });
  await page.route("**/api/agent/stream", async (route) => {
    const body = route.request().postDataJSON() as ModelBody;
    probe.requests.push(body);
    const observations = toolObservations(body);
    const tools = new Set((body.tools ?? []).map((tool) => tool.name));
    if (tools.size === 0) return fulfillAsk(route, "重新整理后的教育经历核对回复。" );
    if (tools.has("get_active_profile") && !observations.some((item) => item.name === "get_active_profile")) {
      return fulfillTool(route, `p43e3-get-profile-${probe.requests.length}`, "get_active_profile", {});
    }
    for (const tool of ["capture_profile_intake", "review_profile_intake", "reconcile_profile_intake", "commit_profile_intake", "ensure_general_resume_from_profile"]) {
      if (tools.has(tool) && !observations.some((item) => item.name === tool)) {
        return fulfillTool(route, `p43e3-${tool}-${probe.requests.length}`, tool, {});
      }
    }
    return fulfillAsk(route, "我会按当前步骤继续核对真实经历。" );
  });
  return probe;
}

async function startIntake(page: Page) {
  await page.goto("/profile");
  await page.waitForTimeout(750);
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能", exact: true });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await page.goto("/profile");
  }
  await expect(page.locator(".ai-asset-content")).toBeVisible();
  await page.goto("/ai-workspace");
  await page.getByRole("button", { name: /从零整理我的经历/ }).click();
}

async function send(page: Page, message: string) {
  await page.getByLabel("描述你的求职任务").fill(message);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
}

async function captureAndAcceptEducation(page: Page) {
  await send(page, educationNarrative());
  await expect.poll(() => latestTask(page)).toMatchObject({ stage: "review_facts" });
  await acceptEducationCandidate(page);
}

async function acceptEducationCandidate(page: Page) {
  const artifact = page.getByRole("region", { name: "经历核对" });
  if (!(await artifact.isVisible().catch(() => false))) await page.getByRole("button", { name: /产物/ }).click();
  await expect(artifact).toBeVisible();
  await artifact.locator(".agent-career-asset").filter({ hasText: "示例大学" }).first().getByRole("button", { name: "采用", exact: true }).click();
  await expect(page.getByRole("button", { name: "继续补充", exact: true })).toBeVisible();
}

async function latestTask(page: Page) {
  const session = await latestSession(page);
  return session.taskState;
}

async function latestSession(page: Page): Promise<StoredSession> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sessions = await new Promise<Array<StoredSession & { updatedAt: string }>>((resolve, reject) => {
      const request = db.transaction("agentSessions", "readonly").objectStore("agentSessions").getAll();
      request.onsuccess = () => resolve(request.result as Array<StoredSession & { updatedAt: string }>);
      request.onerror = () => reject(request.error);
    });
    const session = sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (!session) throw new Error("agent_session_not_found");
    const messages = await new Promise<StoredAgentMessage[]>((resolve, reject) => {
      const request = db.transaction("agentMessages", "readonly").objectStore("agentMessages").getAll();
      request.onsuccess = () => resolve((request.result as Array<StoredAgentMessage & { sessionId: string }>).filter((message) => message.sessionId === session.id).sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0)));
      request.onerror = () => reject(request.error);
    });
    db.close();
    return { ...session, messages };
  });
}

async function activeProfileVersion(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const meta = await new Promise<{ value: { profileId: string } }>((resolve, reject) => {
      const request = db.transaction("appMeta", "readonly").objectStore("appMeta").get("activeProfileContext:v1");
      request.onsuccess = () => resolve(request.result as { value: { profileId: string } });
      request.onerror = () => reject(request.error);
    });
    const profile = await new Promise<{ version: number }>((resolve, reject) => {
      const request = db.transaction("profiles", "readonly").objectStore("profiles").get(meta.value.profileId);
      request.onsuccess = () => resolve(request.result as { version: number });
      request.onerror = () => reject(request.error);
    });
    db.close();
    return profile.version;
  });
}

async function importedDraftRevision(page: Page, importId: string) {
  return page.evaluate(async (draftId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const row = await new Promise<{ value?: { revision?: number } }>((resolve, reject) => {
      const request = db.transaction("appMeta", "readonly").objectStore("appMeta").get(`importedResumeDraft:${draftId}`);
      request.onsuccess = () => resolve(request.result as { value?: { revision?: number } });
      request.onerror = () => reject(request.error);
    });
    db.close();
    return row.value?.revision;
  }, importId);
}

function toolCount(session: StoredSession, toolName: string) {
  return session.messages.filter((message) => message.role === "tool" && message.toolName === toolName).length;
}

function toolObservations(body: ModelBody) {
  const latestUserIndex = (body.messages ?? []).findLastIndex((message) => message.role === "user");
  return (body.messages ?? []).slice(latestUserIndex + 1).filter((message) => message.role === "tool");
}

async function fulfillAsk(route: Route, message: string) {
  await route.fulfill({
    contentType: "text/event-stream",
    body: [
      "event: model_text_delta", `data: ${JSON.stringify({ type: "model_text_delta", delta: message })}`, "",
      "event: model_finish", "data: {\"type\":\"model_finish\",\"stopReason\":\"ask_user\"}", "", ""
    ].join("\n")
  });
}

async function fulfillTool(route: Route, id: string, name: string, args: Record<string, unknown>) {
  const call = { id, name, arguments: args };
  await route.fulfill({
    contentType: "text/event-stream",
    body: [
      "event: model_tool_call_start", `data: ${JSON.stringify({ type: "model_tool_call_start", index: 0, id, name })}`, "",
      "event: model_tool_call_complete", `data: ${JSON.stringify({ type: "model_tool_call_complete", index: 0, call })}`, "",
      "event: model_finish", "data: {\"type\":\"model_finish\",\"stopReason\":\"tool_calls\"}", "", ""
    ].join("\n")
  });
}
