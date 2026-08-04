import { expect, test, type Page, type Route } from "@playwright/test";
import type { AgentTaskState } from "@/agent/contracts/agentSession";

type ModelBody = {
  messages?: Array<{ role: string; name?: string; content: string }>;
  tools?: Array<{ name: string }>;
};

test.describe("P4.3e.2 guided profile intake closure", () => {
  test("stages candidates, continues, finishes once, and offers General Resume only after commit", async ({ page }) => {
    test.setTimeout(120_000);
    await installSemanticFixture(page);
    await installAgentRoute(page);
    await startIntake(page);

    const before = await activeProfile(page);
    const education = "我现在是示例大学本科学生，计算机相关专业，2024年9月入学，预计2028年6月毕业";
    await send(page, education);
    await expect.poll(() => latestTask(page)).toMatchObject({ stage: "review_facts", completionStatus: "waiting_for_user" });
    const artifact = await openIntakeArtifact(page);
    const educationCard = artifact.locator(".agent-career-asset").filter({ hasText: "示例大学" }).first();
    await educationCard.getByRole("button", { name: "编辑后采用", exact: true }).click();
    await educationCard.getByLabel("专业", { exact: true }).fill("计算机相关专业");
    await educationCard.getByRole("button", { name: "保存并采用", exact: true }).click();
    await expect(educationCard).toContainText("计算机相关专业");
    await expect(educationCard).toContainText("已采用");
    await expect(educationCard.getByRole("button", { name: "采用", exact: true })).toHaveCount(0);
    await expect(educationCard.getByRole("button", { name: "编辑后采用", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "仅保存资料库", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "生成一份通用简历", exact: true })).toHaveCount(0);

    await page.reload();
    await expect.poll(() => latestTask(page)).toMatchObject({ stage: "collect_experience" });
    await expect((await openIntakeArtifact(page)).getByText("计算机相关专业", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "继续补充", exact: true }).click();
    await page.reload();
    await expect.poll(() => latestTask(page)).toMatchObject({ stage: "collect_experience" });

    await send(page, "我完成了示例项目，负责需求分析、开发和上线交付，最终交付了可用版本。");
    await expect.poll(() => latestTask(page)).toMatchObject({ stage: "review_facts" });
    const projectArtifact = await openIntakeArtifact(page);
    const projectCard = projectArtifact.locator(".agent-career-asset").filter({ hasText: "示例项目" }).first();
    await projectCard.getByRole("button", { name: "采用", exact: true }).click();
    await expect(projectCard).toContainText("已采用");

    const finishButton = page.locator("form.agent-composer").getByRole("button", { name: "完成整理", exact: true });
    await expect(finishButton).toBeVisible();
    await finishButton.click();
    await expect.poll(() => latestTask(page)).toMatchObject({ stage: "final_review", completionStatus: "waiting_for_user" });
    const finalArtifact = await openIntakeArtifact(page);
    await expect(finalArtifact).toContainText("最终批量审核");
    await expect(finalArtifact).toContainText("目标资料库");
    await page.reload();
    await expect.poll(() => latestTask(page)).toMatchObject({ stage: "final_review" });
    const finalAfterReload = await openIntakeArtifact(page);
    await finalAfterReload.getByRole("button", { name: "完成整理并保存到资料库", exact: true }).click();
    await expect.poll(() => latestTask(page)).toMatchObject({ stage: "profile_complete", completionStatus: "waiting_for_user" });
    await expect(page.getByText("资料已保存到个人资料库")).toBeVisible();
    await expect(page.getByRole("button", { name: "确认", exact: true })).toHaveCount(0);
    const after = await activeProfile(page);
    expect(after.version).toBe(before.version + 1);
    const firstSession = await latestSession(page);
    expect(firstSession.messages.filter((message) => message.toolName === "capture_profile_intake")).toHaveLength(2);
    expect(firstSession.messages.filter((message) => message.toolName === "commit_profile_intake")).toHaveLength(1);

    await page.getByRole("button", { name: "暂时完成", exact: true }).click();
    await expect.poll(() => latestTask(page)).toMatchObject({ stage: "profile_complete", completionStatus: "completed" });
  });

  test("offers General Resume only after the Profile commit", async ({ page }) => {
    test.setTimeout(120_000);
    await installSemanticFixture(page);
    await installAgentRoute(page);
    await startIntake(page);

    await send(page, "我现在是示例大学本科学生，计算机相关专业，2024年9月入学，预计2028年6月毕业");
    await expect.poll(() => latestTask(page)).toMatchObject({ stage: "review_facts" });
    const artifact = await openIntakeArtifact(page);
    await artifact.locator(".agent-career-asset").filter({ hasText: "示例大学" }).getByRole("button", { name: "采用", exact: true }).click();
    await page.locator("form.agent-composer").getByRole("button", { name: "完成整理", exact: true }).click();
    await expect.poll(() => latestTask(page)).toMatchObject({ stage: "final_review" });
    await (await openIntakeArtifact(page)).getByRole("button", { name: "完成整理并保存到资料库", exact: true }).click();
    await expect.poll(() => latestTask(page)).toMatchObject({ stage: "profile_complete", completionStatus: "waiting_for_user" });
    await expect(page.getByRole("button", { name: "生成一份通用简历", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "生成一份通用简历", exact: true }).click();
    const confirm = page.getByRole("button", { name: "确认", exact: true });
    await expect(confirm).toBeVisible();
    await confirm.click();
    await expect.poll(() => latestTask(page)).toMatchObject({ stage: "resume_ready", completionStatus: "completed" });
  });
});

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

async function openIntakeArtifact(page: Page) {
  const artifact = page.getByRole("region", { name: "经历核对" });
  if (!(await artifact.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /产物/ }).click();
  }
  await expect(artifact).toBeVisible();
  return artifact;
}

async function latestTask(page: Page): Promise<AgentTaskState> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<Array<{ taskState?: AgentTaskState; updatedAt: string }>>((resolve, reject) => {
      const request = db.transaction("agentSessions", "readonly").objectStore("agentSessions").getAll();
      request.onsuccess = () => resolve(request.result as Array<{ taskState?: AgentTaskState; updatedAt: string }>);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.taskState as AgentTaskState;
  });
}

async function latestSession(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<Array<{ id: string; updatedAt: string }>>((resolve, reject) => {
      const request = db.transaction("agentSessions", "readonly").objectStore("agentSessions").getAll();
      request.onsuccess = () => resolve(request.result as Array<{ id: string; updatedAt: string }>);
      request.onerror = () => reject(request.error);
    });
    const latest = rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const messages = latest
      ? await new Promise<Array<{ toolName?: string }>>((resolve, reject) => {
          const request = db.transaction("agentMessages", "readonly").objectStore("agentMessages").getAll();
          request.onsuccess = () => resolve((request.result as Array<{ sessionId: string; sequence: number; toolName?: string }>)
            .filter((message) => message.sessionId === latest.id)
            .sort((left, right) => left.sequence - right.sequence)
            .map((message) => ({ toolName: message.toolName })));
          request.onerror = () => reject(request.error);
        })
      : [];
    db.close();
    return { ...latest, messages };
  });
}

async function activeProfile(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const get = <T>(storeName: string, key: IDBValidKey) => new Promise<T>((resolve, reject) => {
      const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
    const context = await get<{ value: { profileId: string } }>("appMeta", "activeProfileContext:v1");
    const profile = await get<{ id: string; version: number }>("profiles", context.value.profileId);
    db.close();
    return profile;
  });
}

async function installSemanticFixture(page: Page) {
  await page.route("**/api/ai/structured**", async (route) => {
    const body = route.request().postDataJSON() as { task?: string; input?: { rawNarrative?: string } };
    if (body.task !== "profile-intake-semantic") return route.continue();
    const raw = body.input?.rawNarrative?.trim() ?? "";
    const education = /大学|本科|入学|毕业/u.test(raw);
    const title = raw.includes("第二示例项目") ? "第二示例项目" : "示例项目";
    const output = education ? {
      id: "fixture-education",
      sectionType: "education",
      school: "示例大学",
      degree: "本科",
      major: "计算机相关专业",
      startDate: "2024-09",
      endDate: "2028-06",
      current: false,
      courses: [],
      honors: [],
      highlights: [],
      customFields: []
    } : {
      id: `fixture-${title}`,
      sectionType: "project",
      title,
      current: false,
      description: raw.includes("第二示例项目")
        ? "负责用户调研、接口设计和测试发布，最终上线了独立版本。"
        : "负责需求分析、开发和上线交付，最终交付了可用版本。",
      highlights: [raw.includes("第二示例项目") ? "用户调研、接口设计和测试发布" : "需求分析、开发和上线交付"],
      tools: [],
      outcomes: [raw.includes("第二示例项目") ? "最终上线了独立版本" : "最终交付了可用版本"],
      customFields: []
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, task: body.task, promptVersion: "p43e2-fixture", output: {
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
      }, meta: { provider: "fixture", model: "p43e2" } })
    });
  });
}

async function installAgentRoute(page: Page) {
  await page.route("**/api/agent/stream", async (route) => {
    const body = route.request().postDataJSON() as ModelBody;
    const observations = toolObservations(body);
    const tools = new Set((body.tools ?? []).map((tool) => tool.name));
    if (latestUserMessage(body) === "项目经历") {
      return fulfillAsk(route, "好的，我们继续补充项目经历。请告诉我一个项目的名称、你负责的工作和最终结果。");
    }
    if (tools.has("get_active_profile") && !observations.some((item) => item.name === "get_active_profile")) {
      return fulfillTool(route, "p43e2-profile", "get_active_profile", {});
    }
    for (const tool of ["capture_profile_intake", "reconcile_profile_intake", "commit_profile_intake", "ensure_general_resume_from_profile"]) {
      if (tools.has(tool) && !observations.some((item) => item.name === tool)) {
        return fulfillTool(route, `p43e2-${tool}`, tool, {});
      }
    }
    return fulfillAsk(route, "我会按当前步骤继续核对真实经历。");
  });
}

function latestUserMessage(body: ModelBody) {
  return [...(body.messages ?? [])].reverse().find((message) => message.role === "user")?.content?.trim();
}

function toolObservations(body: ModelBody) {
  const latestUserIndex = (body.messages ?? []).findLastIndex((message) => message.role === "user");
  return (body.messages ?? []).slice(latestUserIndex + 1).filter((message) => message.role === "tool");
}

function nativeAsk(message: string) {
  return [
    `event: model_text_delta`, `data: ${JSON.stringify({ type: "model_text_delta", delta: message })}`, "",
    `event: model_finish`, `data: ${JSON.stringify({ type: "model_finish", stopReason: "ask_user" })}`, "", ""
  ].join("\n");
}

function nativeTool(id: string, name: string, args: Record<string, unknown>) {
  const call = { id, name, arguments: args };
  return [
    `event: model_tool_call_start`, `data: ${JSON.stringify({ type: "model_tool_call_start", index: 0, id, name })}`, "",
    `event: model_tool_call_complete`, `data: ${JSON.stringify({ type: "model_tool_call_complete", index: 0, call })}`, "",
    `event: model_finish`, `data: ${JSON.stringify({ type: "model_finish", stopReason: "tool_calls" })}`, "", ""
  ].join("\n");
}

async function fulfillAsk(route: Route, message: string) {
  await route.fulfill({ contentType: "text/event-stream", body: nativeAsk(message) });
}

async function fulfillTool(route: Route, id: string, name: string, args: Record<string, unknown>) {
  await route.fulfill({ contentType: "text/event-stream", body: nativeTool(id, name, args) });
}
