import { afterEach, expect, it, vi } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { derivePendingInteraction } from "@/agent/runtime/agentTurnLifecycle";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { demoJobDescriptions } from "@/data/demoJobs";

let db: CareerAdaptDb;
afterEach(async () => { vi.restoreAllMocks(); db?.close(); if (db) await db.delete(); });

it("grounds a candidate, waits for review, and commits only on deterministic save", async () => {
  db = new CareerAdaptDb(`preference-host-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const created = await repository.createPerson("测试");
  const profile = await repository.saveProfile({ ...created.profile, version: created.profile.version + 1,
    preference: { targetRoles: ["供应链助理"], targetCities: ["郑州"], industries: [] } });
  const resume = await repository.createGeneralResumeBranch({ profileId: profile.id, operationId: "preference-existing-resume",
    name: "原有通用简历", includeProfileFacts: true, includeProfileBasics: true });
  const job = await repository.saveJobDescription(demoJobDescriptions[0]);
  const context = (await repository.getActiveCareerContext())!;
  const session = AgentRuntime.createConversationSession("偏好测试", context);
  const reducer = new AgentTaskStateReducer();
  session.taskState = { ...reducer.create(session, "conversation", { workflowId: "conversation", step: "chat" }),
    selectedEntities: { profileId: profile.id, profileVersion: profile.version, jobId: job.id, resumeId: resume.branch.id, revisionId: resume.revision!.id } };
  let persisted = session;
  const host = new AgentHostStore({ executor: {} as never, persistence: { save: async (value: AgentSession) => { persisted = value; return value; }, get: async () => persisted } as never, repository });
  host.adopt(session);
  const service = new BrowserAgentToolService(repository);
  const registry = createAgentToolRegistry(service);
  const gateway = new CareerToolGateway({ registry, executor: new AgentExecutor(registry),
    assertAvailableTargets: (name, input, binding) => service.assertAvailableToolTargets(name, input, binding),
    filterAvailableResult: (name, data, binding) => service.filterAvailableToolResult(name, data, binding),
    getUserMessageForTurn: turnId => host.getUserMessageForTurn(turnId),
    getAuthoritativeTaskState: () => host.getSnapshot().activeSession?.taskState });
  const source = "我最近也开始考虑跨境电商运营，地点还是优先郑州。";
  const shell = await host.beginRuntimeShell({ session, userMessage: source, runtimeId: "hermes" });
  const binding = { agentSessionId: session.id, personId: context.personId, profileId: profile.id,
    profileVersionNumber: context.profileVersionNumber, profileRevision: profile.version };
  const before = await repository.getProfile(profile.id);
  const result = await gateway.execute("career.workflow.profile_preferences", { intent: "candidate", sourceQuote: source,
    patch: { additions: { targetRoles: ["跨境电商运营"], targetCities: ["郑州"] } } },
  { operationId: "preference-propose", logicalTurnId: shell.turnId, sourceUserMessageId: shell.userMessageId, careerSessionBinding: binding, requireSessionBinding: true });
  expect(result.ok, JSON.stringify(result.error)).toBe(true);
  expect(gateway.getContract("career.workflow.profile_preferences")).toMatchObject({ readWrite: "read", safetyClass: "READ", confirmationPolicy: "none" });
  expect(result.data).toMatchObject({ status: "waiting_for_user", workflowCheckpoint: { kind: "profile_preferences", state: "candidate" } });
  expect(result.receipt.status).toBe("completed");
  expect(await repository.getProfile(profile.id)).toEqual(before);
  await host.applyRuntimeEvent({ type: "tool_call_completed", sessionId: session.id, turnId: shell.turnId,
    timestamp: new Date().toISOString(), toolName: "career.workflow.profile_preferences", operationId: "preference-propose", data: { result } }, shell.assistantMessageId);
  await host.applyRuntimeEvent({ type: "turn_completed", sessionId: session.id, turnId: shell.turnId,
    timestamp: new Date().toISOString(), message: "请确认。" }, shell.assistantMessageId);
  const waiting = host.getSnapshot().activeSession!;
  expect(derivePendingInteraction(waiting)?.kind).toBe("confirmation");
  expect(waiting.messages.findLast(message => message.role === "assistant")?.options?.map(option => option.label)).toEqual(["保存", "修改", "先不保存"]);
  expect(await repository.getProfile(profile.id)).toEqual(before);
  const edit = waiting.messages.findLast(message => message.role === "assistant")!.options!.find(option => option.id === "preference-edit")!;
  const editing = await host.prepareRuntimeUserEvent({ session: waiting, event: { type: "option_selected", optionId: edit.id, action: edit.action }, pageContext: { pathname: "/ai-workspace", query: {} } });
  expect(editing.session.taskState?.stage).toBe("preference_edit");
  expect(await repository.getProfile(profile.id)).toEqual(before);
  const editShell = await host.beginRuntimeShell({ session: editing.session, userMessage: "城市再加上海", runtimeId: "hermes" });
  const edited = await gateway.execute("career.workflow.profile_preferences", { intent: "candidate", sourceQuote: "城市再加上海",
    patch: { additions: { targetCities: ["上海"] } } }, { operationId: "preference-edit", logicalTurnId: editShell.turnId,
    sourceUserMessageId: editShell.userMessageId, careerSessionBinding: binding, requireSessionBinding: true });
  expect(edited.ok, JSON.stringify(edited.error)).toBe(true);
  await host.applyRuntimeEvent({ type: "tool_call_completed", sessionId: session.id, turnId: editShell.turnId,
    timestamp: new Date().toISOString(), toolName: "career.workflow.profile_preferences", operationId: "preference-edit", data: { result: edited } }, editShell.assistantMessageId);
  await host.applyRuntimeEvent({ type: "turn_completed", sessionId: session.id, turnId: editShell.turnId,
    timestamp: new Date().toISOString(), message: "请确认修改。" }, editShell.assistantMessageId);
  const updatedCandidate = host.getSnapshot().activeSession!;
  expect(derivePendingInteraction(updatedCandidate)?.kind).toBe("confirmation");
  expect(await repository.getProfile(profile.id)).toEqual(before);
  const saved = await host.prepareRuntimeUserEvent({ session: updatedCandidate, event: { type: "text_message", text: "保存" }, pageContext: { pathname: "/ai-workspace", query: {} } });
  expect(saved.deterministicTerminal).toBe(true);
  expect(await repository.getProfile(profile.id)).toMatchObject({ id: profile.id, version: profile.version + 1,
    preference: { targetRoles: ["供应链助理", "跨境电商运营"], targetCities: ["郑州", "上海"] } });
  expect(saved.session.profileRevision).toBe(profile.version + 1);
  expect(saved.session.taskState?.selectedEntities).toMatchObject({ jobId: job.id, resumeId: resume.branch.id, revisionId: resume.revision!.id });
  const accessAfterSave = await service.prepareAvailableRuntimeContext(saved.session);
  expect(accessAfterSave.resetContext).toBe(false);
  expect(accessAfterSave.session.taskState?.selectedEntities).toMatchObject({ jobId: job.id, resumeId: resume.branch.id, revisionId: resume.revision!.id });
  expect((await repository.listAvailableResumeBranches(profile.id)).map(branch => branch.id)).toContain(resume.branch.id);
  const committed = await repository.getProfile(profile.id);
  const afterBinding = { ...binding, profileRevision: profile.version + 1 };
  async function propose(text: string, city: string, intent: "candidate" | "ambiguous", operationId: string) {
    const current = host.getSnapshot().activeSession!;
    const turn = await host.beginRuntimeShell({ session: current, userMessage: text, runtimeId: "hermes" });
    const output = await gateway.execute("career.workflow.profile_preferences", { intent, sourceQuote: text,
      patch: { additions: { targetCities: [city] } } }, { operationId, logicalTurnId: turn.turnId,
      sourceUserMessageId: turn.userMessageId, careerSessionBinding: afterBinding, requireSessionBinding: true });
    expect(output.ok, JSON.stringify(output.error)).toBe(true);
    await host.applyRuntimeEvent({ type: "tool_call_completed", sessionId: session.id, turnId: turn.turnId,
      timestamp: new Date().toISOString(), toolName: "career.workflow.profile_preferences", operationId, data: { result: output } }, turn.assistantMessageId);
    await host.applyRuntimeEvent({ type: "turn_completed", sessionId: session.id, turnId: turn.turnId,
      timestamp: new Date().toISOString(), message: "请核对。" }, turn.assistantMessageId);
    return host.getSnapshot().activeSession!;
  }
  const toReject = await propose("以后优先广州", "广州", "candidate", "preference-reject-proposal");
  expect(derivePendingInteraction(toReject)?.kind).toBe("confirmation");
  const rejected = await host.prepareRuntimeUserEvent({ session: toReject, event: { type: "text_message", text: "先不用" }, pageContext: { pathname: "/ai-workspace", query: {} } });
  expect(rejected.deterministicTerminal).toBe(true);
  expect(await repository.getProfile(profile.id)).toEqual(committed);
  expect(rejected.session.taskState?.knownSlots.facadeCheckpoint).toBeUndefined();
  const ambiguous = await propose("北京的岗位也可以看看", "北京", "ambiguous", "preference-ambiguous");
  expect(derivePendingInteraction(ambiguous)?.kind).toBe("clarification");
  const clarified = await host.prepareRuntimeUserEvent({ session: ambiguous, event: { type: "text_message", text: "长期的" }, pageContext: { pathname: "/ai-workspace", query: {} } });
  expect(derivePendingInteraction(clarified.session)?.kind).toBe("confirmation");
  expect(await repository.getProfile(profile.id)).toEqual(committed);
  await host.prepareRuntimeUserEvent({ session: clarified.session, event: { type: "text_message", text: "先不保存" }, pageContext: { pathname: "/ai-workspace", query: {} } });
  const noChange = await propose("以后优先郑州", "郑州", "candidate", "preference-no-change");
  expect(noChange.messages.findLast(message => message.role === "assistant")?.content).toContain("无需重复保存");
  expect(await repository.getProfile(profile.id)).toEqual(committed);
  const fresh = AgentRuntime.createConversationSession("全新会话", await repository.getActiveCareerContext());
  const recall = await service.prepareAvailableRuntimeContext(fresh, false);
  expect(fresh.messages).toEqual([]);
  expect(recall.trustedCareerPreferences?.targetCities).toEqual(["郑州", "上海"]);
  expect(recall.trustedCareerPreferences?.targetRoles).toEqual(["供应链助理", "跨境电商运营"]);
});
