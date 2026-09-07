import { Blob as NodeBlob } from "node:buffer";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { HttpHermesBridgeTransport } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { CareerToolGateway, CareerToolGatewayExecutor } from "@/agent/tools/CareerToolGateway";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { CareerAdaptDb } from "@/services/storage/db";
import { writeResumeImportSemanticPreference } from "@/services/preferences/resumeImportAi";
import { agentAttachmentStore } from "@/services/agent/AgentAttachmentStore";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2, projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import type { AgentSession } from "@/agent/contracts/agentSession";

let database: CareerAdaptDb;
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
  if (database) { database.close(); await database.delete(); }
});

async function fixture(existing = false) {
  vi.stubGlobal("Blob", NodeBlob);
  database = new CareerAdaptDb(`p47c1-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(database);
  if (existing) {
    const profile = await repository.saveProfile(migrateCareerProfileToV2(demoCareerProfile));
    await repository.setActiveProfileId(profile.id);
  }
  const service = new BrowserAgentToolService(repository);
  const prepare = vi.spyOn(service, "prepareResumeImport");
  const registry = createAgentToolRegistry(service);
  const gateway = new CareerToolGateway({ registry, executor: new AgentExecutor(registry) });
  const gatewayExecute = vi.spyOn(gateway, "execute");
  const executor = new CareerToolGatewayExecutor(registry, gateway);
  const execute = vi.spyOn(executor, "execute");
  const host = new AgentHostStore({ executor, repository, persistence: {
    save: async (session: AgentSession) => session,
    getWorkspaceRepository: () => repository
  } as never });
  const startTurn = vi.spyOn(host, "startTurn");
  const context = { session: AgentRuntime.create(`p47c1-${crypto.randomUUID()}`, "collecting_intent"), pageContext: { pathname: "/ai-workspace", query: {} } };
  return { repository, service, prepare, gatewayExecute, execute, host, startTurn, context };
}

function assertReview(session: AgentSession | undefined, f: Awaited<ReturnType<typeof fixture>>) {
  expect(session?.taskState).toMatchObject({ workflowId: "resume_import", stage: "import_review", completionStatus: "waiting_for_user" });
  expect(f.execute).toHaveBeenCalledTimes(1);
  expect(f.gatewayExecute.mock.calls.map(([name]) => name)).toEqual(["career.workflow.resume_import", "career.resume.import.prepare"]);
  expect(f.prepare).toHaveBeenCalledTimes(1);
  expect(f.startTurn).not.toHaveBeenCalled();
  expect(session?.activeTurn).toMatchObject({ executionOwner: "deterministic_transition" });
  for (const field of ["preferredRuntime", "attemptedRuntime", "finalRuntime"] as const) expect(session?.activeTurn?.[field]).toBeUndefined();
  expect(JSON.stringify(session)).not.toMatch(/agent_runtime_failed|agent_kernel_disabled_for_production/);
  expect(session?.messages.filter(message => message.role === "user")).toHaveLength(1);
  expect(session?.messages.find(message => message.role === "user")?.metadata?.executionState).toBe("complete");
  expect(f.host.getSnapshot().uiAction?.type).toBe("open_import_review");
  expect(session?.messages.some(message => message.role === "tool" && message.toolName === "career.workflow.resume_import")).toBe(true);
}

describe("P4.7c.1 production import execution boundary", () => {
  it("leaves normal text and non-import evidence on the Hermes execution path", async () => {
    const f = await fixture();
    const prepared = await f.host.prepareRuntimeUserEvent({ ...f.context, event: { type: "text_message", text: "帮我理解这份项目证据" } });
    expect(prepared.deterministicTerminal).not.toBe(true);
    expect(prepared.session.taskState).toBeUndefined();
    const shell = await f.host.beginRuntimeShell({ session: prepared.session, userMessage: prepared.userMessage, runtimeId: "hermes" });
    expect(shell.session.activeTurn?.executionOwner).toBe("hermes");
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true, data: { runId: "p47c1-evidence", status: "started" } }), { headers: { "Content-Type": "application/json" } });
    }));
    await new HttpHermesBridgeTransport("/hermes").startRun!({ sessionId: shell.session.id, turnId: shell.turnId, userMessage: prepared.userMessage, pageContext: f.context.pageContext, toolContracts: [], attachments: [{ id: "evidence-1", fileName: "project.txt", mimeType: "text/plain", size: 20, purpose: "career_evidence" }] });
    expect(bodies).toEqual([expect.objectContaining({ action: "run_start", attachments: [expect.objectContaining({ purpose: "career_evidence" })] })]);
    expect(f.execute).not.toHaveBeenCalled(); expect(f.startTurn).not.toHaveBeenCalled();
  });
  // Real PDF.js file selection runs in the browser smoke, where Worker and DOMMatrix exist.
  for (const existing of [false, true]) {
    it(`parses a real DOCX before target selection; existing Profile=${existing}`, async () => {
      const f = await fixture(existing);
      writeResumeImportSemanticPreference("local");
      const file = new File([await readFile("tests/fixtures/resume-import/ordinary.docx")], "ordinary.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const session = await f.host.dispatch({ type: "composer_submit", files: [file] }, f.context);
      assertReview(session, f);
      expect(await f.repository.getImportedResumeDraft(String(session?.taskState?.knownSlots.importId))).toBeDefined();
      expect(session?.taskState?.knownSlots.quickActionImportTargetRequired).toBe(!existing);
    });
  }
  for (const consent of [false, true]) for (const mode of ["local", "ai"] as const) {
    it(`${consent ? "consent" : "saved preference"} ${mode} uses the same facade`, async () => {
      const f = await fixture();
      const provider = vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const blocks = JSON.parse(body.input.rawText) as Array<{ id: string; text: string }>;
        return new Response(JSON.stringify({ ok: true, task: "resume-document-mapper", promptVersion: "resume-document-mapper.v6-canonical-v2", output: {
          resume: { schemaVersion: "careeradapt-resume-v2", basics: {}, sections: [], unclassifiedBlocks: [] },
          sourceRefs: [], unclassifiedRefs: blocks.map(block => ({ blockIds: [block.id], reason: "manual review" }))
        }, meta: { provider: "test", model: "fixture", inputLength: body.input.rawText.length, outputLength: 100, latencyMs: 1 } }), { headers: { "Content-Type": "application/json" } });
      });
      vi.stubGlobal("fetch", provider);
      if (!consent) writeResumeImportSemanticPreference(mode);
      let session = await f.host.dispatch({ type: "composer_submit", files: [new File(["张三\n邮箱：test@example.com\n工作经历\n示例公司 工程师\n开发数据系统并完成测试。"], "resume.txt", { type: "text/plain" })] }, f.context);
      if (consent) {
        expect(f.execute).not.toHaveBeenCalled();
        expect(f.host.getSnapshot().uiAction?.type).toBe("request_resume_import_consent");
        session = await f.host.dispatch({ type: "resume_import_consent", attachmentId: session!.taskState!.attachment!.id, mode }, { ...f.context, session: session! });
      }
      assertReview(session, f);
      expect(provider.mock.calls.length).toBe(mode === "ai" ? 1 : 0);
    });
  }
  it("retains parser failures and retries without a Native turn", async () => {
    const f = await fixture(true); writeResumeImportSemanticPreference("local");
    let session = await f.host.dispatch({ type: "composer_submit", files: [new File(["invalid"], "resume.pdf", { type: "application/pdf" })] }, f.context);
    expect(session?.activeTurn?.lastSafeErrorCode).toBe("invalid_pdf_header");
    expect(session?.taskState?.knownSlots.importTarget).toMatchObject({ mode: "existing", profileId: demoCareerProfile.id });
    expect(session?.activeTurn?.lastSafeErrorCode).not.toBe("agent_runtime_failed");
    expect(agentAttachmentStore.has(session!.taskState!.attachment!.id)).toBe(true);
    session = await f.host.dispatch({ type: "option", action: { type: "retry_current_step" } }, { ...f.context, session: session! });
    expect(f.prepare).toHaveBeenCalledTimes(2);
    expect(f.startTurn).not.toHaveBeenCalled();
    agentAttachmentStore.release(session!.taskState!.attachment!.id);
  });
  it("preserves the unsupported-file error and attachment", async () => {
    const f = await fixture(); writeResumeImportSemanticPreference("local");
    const session = await f.host.dispatch({ type: "composer_submit", files: [new File(["unsupported"], "resume.bin", { type: "application/octet-stream" })] }, f.context);
    expect(session?.activeTurn?.lastSafeErrorCode).toBe("resume_import_unsupported_file");
    expect(agentAttachmentStore.has(session!.taskState!.attachment!.id)).toBe(true);
    agentAttachmentStore.release(session!.taskState!.attachment!.id);
  });
  for (const lost of [false, true]) it(`rejects ${lost ? "lost" : "wrong-session"} attachment`, async () => {
    const f = await fixture();
    const ref = await agentAttachmentStore.register(new File(["test"], "resume.txt"), { agentSessionId: "another-session" });
    if (lost) agentAttachmentStore.release(ref.id);
    await expect(f.host.dispatch({ type: "resume_import_consent", attachmentId: ref.id, mode: "local" }, f.context)).rejects.toMatchObject({ code: lost ? "agent_attachment_lost" : "agent_attachment_session_mismatch" });
    expect(f.execute).not.toHaveBeenCalled(); agentAttachmentStore.release(ref.id);
  });
  it("imports canonical JSON through review, confirmation and rich Profile editor readback", async () => {
    const f = await fixture();
    const json = JSON.parse(await readFile("tests/fixtures/resume-import/reconciliation-v2.json", "utf8"));
    const project = json.sections[0].items[0];
    project.background = "保留项目背景。"; project.description = "保留完整职责段落。";
    project.highlights = ["完成需求拆解", "设计数据结构", "实现核心流程", "补充回归测试"]; project.outcomes = ["结果一"];
    const work = { id: "p47c1-work", sectionType: "work", organization: "示例数据团队", role: "数据运营实习生", description: "参与数据运营流程和跨团队交付。", highlights: ["整理业务数据", "核对运营口径", "协同产品与业务", "交付周报分析"], customFields: [] };
    json.sections.push({ id: "p47c1-work-section", sectionType: "work", title: "工作经历", order: 2, visible: true, items: [work] });
    const session = await f.host.dispatch({ type: "composer_submit", files: [new File([JSON.stringify(json)], "resume.json", { type: "application/json" })] }, f.context);
    assertReview(session, f);
    const importId = String(session!.taskState!.knownSlots.importId);
    const reviewed = await f.service.reviewResumeImport({ importId, expectedDraftRevision: session!.taskState!.knownSlots.expectedDraftRevision, decision: "accept_all" });
    const result = await f.repository.confirmImportedResume({ importId, expectedDraftRevision: reviewed.expectedDraftRevision, operationId: "p47c1-confirm", target: { mode: "new", profileName: "测试资料", createGeneralResume: true } });
    const stored = await f.repository.getProfile(result.profileId);
    const item = stored?.structuredFacts?.find(item => item.data.id === project.id);
    expect(item?.data).toMatchObject({ background: project.background, description: project.description, highlights: project.highlights, outcomes: project.outcomes });
    expect(stored?.experiences.find(entry => entry.facts.some(fact => item!.factIds.includes(fact.id)))?.resumeDrafts[0]?.text).toBe(projectResumeItemV2(item!.data));
    const workItem = stored?.structuredFacts?.find(item => item.data.id === work.id);
    expect(workItem?.data).toMatchObject(work);
    expect(stored?.experiences.find(entry => entry.facts.some(fact => workItem!.factIds.includes(fact.id)))?.resumeDrafts[0]?.text).toBe(projectResumeItemV2(workItem!.data));
    const second = await f.host.dispatch({ type: "composer_submit", files: [new File([JSON.stringify(json) + "\n"], "resume-again.json", { type: "application/json" })] }, { ...f.context, session: session! });
    const secondId = String(second!.taskState!.knownSlots.importId);
    const secondReview = await f.service.reviewResumeImport({ importId: secondId, expectedDraftRevision: second!.taskState!.knownSlots.expectedDraftRevision, decision: "accept_all" });
    let reconciliation = await f.service.reconcileResumeImport({ importId: secondId, expectedDraftRevision: secondReview.expectedDraftRevision, profileId: result.profileId });
    for (const decision of reconciliation.unresolved) {
      reconciliation = await f.service.resolveResumeReconciliation({ importId: secondId, expectedPlanRevision: reconciliation.expectedPlanRevision, incomingItemId: decision.incomingItemId, resolution: "keep_existing" });
    }
    const merged = await f.repository.confirmImportedResume({ importId: secondId, expectedDraftRevision: secondReview.expectedDraftRevision, expectedReconciliationRevision: reconciliation.expectedPlanRevision, operationId: "p47c1-reconciled-confirm", target: { mode: "existing", profileId: result.profileId } });
    expect(merged.profileId).toBe(result.profileId);
    const reloaded = await f.repository.getProfile(merged.profileId);
    expect(reloaded?.structuredFacts?.find(entry => entry.data.id === project.id)?.data).toEqual(item!.data);
    expect(reloaded?.structuredFacts?.find(entry => entry.data.id === work.id)?.data).toEqual(workItem!.data);
  });
});
