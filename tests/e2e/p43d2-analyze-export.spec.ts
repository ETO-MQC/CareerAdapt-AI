import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";
import { openManualPageTab } from "./support/g7b2Ui";

type ModelBody = {
  messages?: Array<{ role: string; name?: string; content: string }>;
  tools?: Array<{ name: string }>;
};

type StoredSession = {
  id: string;
  taskState?: Record<string, unknown>;
  artifactRefs?: Array<Record<string, unknown>>;
  pendingConfirmation?: unknown;
  pendingToolCall?: unknown;
  activeTurn?: { status?: string };
  messages: Array<Record<string, unknown>>;
};

test.describe("P4.3d.2 standalone analysis and export journeys", () => {
  test("analyze_job_fit completes as an analysis Artifact without mutating resume data", async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
        baseUrl: "https://example.test/v1",
        apiKey: "e2e-key",
        model: "e2e-model",
        provider: "openai-compatible"
      }));
      localStorage.removeItem("careeradapt.agent.activeSessionId");
    });

    const entities = await prepareBrowserEntities(page);
    const before = await readEntityStores(page);
    const calls: string[] = [];
    let awaitingJobSelection = false;

    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as ModelBody;
      const observation = toolObservations(body).at(-1);
      if (!observation) {
        if (awaitingJobSelection) {
          awaitingJobSelection = false;
          calls.push("analyze_job_fit");
          await fulfillTool(route, "p43d2-analyze-fit", "analyze_job_fit", {
            profileId: entities.profileId,
            resumeId: entities.resumeId,
            jobId: entities.jobId
          });
          return;
        }
        calls.push("get_active_profile");
        await fulfillTool(route, "p43d2-analyze-profile", "get_active_profile", {});
        return;
      }
      if (observation.name === "get_active_profile") {
        calls.push("list_resumes");
        await fulfillTool(route, "p43d2-analyze-resumes", "list_resumes", {});
        return;
      }
      if (observation.name === "list_resumes") {
        calls.push("get_resume");
        await fulfillTool(route, "p43d2-analyze-resume", "get_resume", { resumeId: entities.resumeId });
        return;
      }
      if (observation.name === "get_resume") {
        calls.push("list_jobs");
        await fulfillTool(route, "p43d2-analyze-jobs", "list_jobs", {});
        return;
      }
      if (observation.name === "list_jobs") {
        awaitingJobSelection = true;
        await fulfillAsk(route, "请选择要分析的目标岗位。");
        return;
      }
      if (observation.name === "get_job") {
        calls.push("analyze_job_fit");
        await fulfillTool(route, "p43d2-analyze-fit", "analyze_job_fit", {
          profileId: entities.profileId,
          resumeId: entities.resumeId,
          jobId: entities.jobId
        });
        return;
      }
      if (observation.name === "analyze_job_fit") {
        await fulfillFinal(route, "岗位匹配分析已完成，请在任务产物中查看匹配概览。");
        return;
      }
      await fulfillFinal(route, "分析流程已安全停止。");
    });

    await openAgentQuickAction(page, "分析岗位匹配度");
    await expect(page.getByText("请选择要分析的目标岗位。", { exact: true })).toBeVisible({ timeout: 30_000 });
    await sendMessage(page, entities.jobTitle);
    await expect.poll(() => readActiveSession(page), { timeout: 45_000 }).toMatchObject({
      taskState: {
        rootGoal: "analyze_job_fit",
        workflowId: "analyze_job_fit",
        stage: "completed",
        completionStatus: "completed"
      },
      pendingConfirmation: undefined,
      pendingToolCall: undefined,
      activeTurn: { status: "completed" }
    });

    const after = await readEntityStores(page);
    expect(after.profiles).toEqual(before.profiles);
    expect(after.resumeBranches).toEqual(before.resumeBranches);
    expect(after.jobDescriptions).toEqual(before.jobDescriptions);

    const session = await readActiveSession(page);
    const toolNames = session.messages
      .map((message) => typeof message.toolName === "string" ? message.toolName : undefined)
      .filter((name): name is string => Boolean(name));
    expect(calls.filter((name) => name === "analyze_job_fit")).toHaveLength(1);
    expect(toolNames.filter((name) => name === "analyze_job_fit")).toHaveLength(1);
    expect(toolNames).not.toContain("create_tailoring_session");
    expect(toolNames).not.toContain("apply_tailoring_changes");
    expect(session.taskState?.selectedEntities).toMatchObject({
      profileId: entities.profileId,
      resumeId: entities.resumeId,
      jobId: entities.jobId
    });
    expect(session.taskState?.knownSlots).toMatchObject({
      fitAnalysis: expect.any(Object)
    });
    expect(session.artifactRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "job_fit_overview", entityId: entities.jobId })
    ]));

    await page.getByRole("button", { name: /产物 \d+/ }).click();
    await expect(page.getByRole("tab", { name: "岗位匹配分析", exact: true })).toBeVisible();
    await expect(page.getByText("匹配概览", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "打开原功能页", exact: true })).toBeVisible();
  });

  test("repair_and_export_resume checks and exports the selected Resume as a downloadable PDF", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
        baseUrl: "https://example.test/v1",
        apiKey: "e2e-key",
        model: "e2e-model",
        provider: "openai-compatible"
      }));
      localStorage.removeItem("careeradapt.agent.activeSessionId");
    });

    const entities = await prepareBrowserEntities(page);
    const before = await readEntityStores(page);
    const calls: string[] = [];

    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as ModelBody;
      const observation = toolObservations(body).at(-1);
      if (!observation) {
        calls.push("get_resume");
        await fulfillTool(route, "p43d2-export-resume", "get_resume", { resumeId: entities.resumeId });
        return;
      }
      if (observation.name === "get_resume") {
        calls.push("get_resume_revision");
        await fulfillTool(route, "p43d2-export-revision", "get_resume_revision", { resumeId: entities.resumeId });
        return;
      }
      if (observation.name === "get_resume_revision") {
        calls.push("export_resume");
        await fulfillTool(route, "p43d2-export-pdf", "export_resume", { resumeId: entities.resumeId });
        return;
      }
      if (observation.name === "export_resume") {
        await fulfillFinal(route, "PDF 导出预览已准备好，请打开简历页下载。");
        return;
      }
      await fulfillFinal(route, "导出流程已安全停止。");
    });

    await openAgentQuickAction(page, "检查并导出简历");
    await expect.poll(() => readActiveSession(page), { timeout: 45_000 }).toMatchObject({
      taskState: {
        rootGoal: "export_resume",
        workflowId: "repair_and_export_resume",
        stage: "export_ready",
        completionStatus: "completed"
      },
      pendingConfirmation: undefined,
      pendingToolCall: undefined,
      activeTurn: { status: "completed" }
    });

    const after = await readEntityStores(page);
    expect(after.profiles).toEqual(before.profiles);
    expect(after.resumeBranches).toEqual(before.resumeBranches);
    expect(after.jobDescriptions).toEqual(before.jobDescriptions);

    const session = await readActiveSession(page);
    const toolNames = session.messages
      .map((message) => typeof message.toolName === "string" ? message.toolName : undefined)
      .filter((name): name is string => Boolean(name));
    expect(calls.filter((name) => name === "export_resume")).toHaveLength(1);
    expect(toolNames.filter((name) => name === "export_resume")).toHaveLength(1);
    expect(toolNames).not.toContain("apply_tailoring_changes");
    expect(session.artifactRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "pdf_preview",
        entityId: entities.resumeId,
        route: `/resume?branchId=${encodeURIComponent(entities.resumeId)}&export=pdf`
      })
    ]));

    await page.getByRole("button", { name: /产物 \d+/ }).click();
    await expect(page.getByRole("tab", { name: "PDF 导出预览", exact: true })).toBeVisible();
    const editorLink = page.getByRole("link", { name: "打开原功能页", exact: true });
    await expect(editorLink).toHaveAttribute("href", `/resume?branchId=${encodeURIComponent(entities.resumeId)}&export=pdf`);
    await editorLink.click();
    await expect(page).toHaveURL(new RegExp(`/resume\\?branchId=${entities.resumeId}`));
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 30_000 });
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
    const pdfPath = testInfo.outputPath("export-only.pdf");
    await download.saveAs(pdfPath);
    expect(existsSync(pdfPath)).toBe(true);
    expect((await import("node:fs")).statSync(pdfPath).size).toBeGreaterThan(0);
    const pdfText = execFileSync(resolvePopplerBinary(), [pdfPath, "-"], { encoding: "utf8" });
    expect(pdfText).toMatch(/[\u4e00-\u9fff]/u);
    expect(pdfText).not.toContain("{{");
  });
});

async function openAgentQuickAction(page: Page, title: string) {
  await page.goto("/ai-workspace");
  await bypassSetupIfNeeded(page);
  const card = page.getByRole("button", { name: new RegExp(title) });
  if (!(await card.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "新任务", exact: true }).click();
  }
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();
}

async function sendMessage(page: Page, message: string) {
  await page.getByLabel("描述你的求职任务").fill(message);
  await page.getByRole("button", { name: "发送消息" }).click();
}

async function bypassSetupIfNeeded(page: Page) {
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await skip.click();
    await page.goto("/ai-workspace");
  }
}

async function prepareBrowserEntities(page: Page) {
  await page.goto("/resume");
  await bypassSetupIfNeeded(page);
  await expect.poll(() => readEntityCounts(page), { timeout: 30_000 }).toMatchObject({
    profiles: 1,
    jobDescriptions: expect.any(Number)
  });
  const createGeneralResume = page.getByRole("button", { name: /从个人资料库创建/ });
  if (await createGeneralResume.isVisible().catch(() => false)) {
    await createGeneralResume.click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 30_000 });
    await page.goto("/resume");
  }
  const stores = await readEntityStores(page);
  const profile = stores.profiles[0];
  const resume = stores.resumeBranches.find((candidate) =>
    candidate.profileId === profile?.id
    && (candidate.branchPurpose === "general" || candidate.purpose === "general")
  );
  const job = stores.jobDescriptions[0];
  if (!profile?.id || !resume?.id || !job?.id) {
    throw new Error("p43d2_analyze_export_demo_entities_missing");
  }
  return {
    profileId: String(profile.id),
    resumeId: String(resume.id),
    jobId: String(job.id),
    jobTitle: String(job.title ?? job.id)
  };
}

async function readEntityCounts(page: Page) {
  const stores = await readEntityStores(page);
  return {
    profiles: stores.profiles.length,
    resumeBranches: stores.resumeBranches.length,
    jobDescriptions: stores.jobDescriptions.length
  };
}

async function readEntityStores(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = (storeName: string) => new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>);
      request.onerror = () => reject(request.error);
    });
    const [profiles, resumeBranches, jobDescriptions] = await Promise.all([
      read("profiles"),
      read("resumeBranches"),
      read("jobDescriptions")
    ]);
    database.close();
    return { profiles, resumeBranches, jobDescriptions };
  });
}

async function readActiveSession(page: Page): Promise<StoredSession> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <T,>(storeName: string) => new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
    const [sessions, messages] = await Promise.all([
      read<StoredSession>("agentSessions"),
      read<Record<string, unknown>>("agentMessages")
    ]);
    database.close();
    const activeId = localStorage.getItem("careeradapt.agent.activeSessionId");
    const session = sessions.find((candidate) => candidate.id === activeId) ?? sessions.at(-1);
    if (!session) throw new Error("p43d2_active_agent_session_missing");
    return {
      ...session,
      messages: messages.filter((message) => message.sessionId === session.id)
    };
  });
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

async function fulfillTool(route: Route, id: string, name: string, args: Record<string, unknown>) {
  await route.fulfill({ contentType: "text/event-stream", body: nativeTool(id, name, args) });
}

async function fulfillFinal(route: Route, message: string) {
  await route.fulfill({ contentType: "text/event-stream", body: nativeFinal(message) });
}

async function fulfillAsk(route: Route, message: string) {
  await route.fulfill({ contentType: "text/event-stream", body: nativeAsk(message) });
}

function resolvePopplerBinary() {
  return [
    "E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe",
    "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"
  ].find((candidate) => existsSync(candidate)) ?? "pdftotext";
}
