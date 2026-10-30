import { afterEach, describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import { addSessionConfirmedSkills } from "@/domain/resumeComposition/sessionConfirmedSkills";
import { buildResumeEvidenceGraph, writeResumeComposition, createResumeCompositionCheckpoint } from "@/domain/resumeComposition";
import { planResumeBlueprint } from "@/domain/resumeComposition/ResumeBlueprint";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { prepareCareerWorkflowInvocation } from "@/agent/workflows/CareerWorkflowFacade";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import type { CareerResumeWritingService, ResumeCompositionResult } from "@/domain/resumeComposition";

let db: CareerAdaptDb | undefined;
afterEach(async () => { db?.close(); if (db) await db.delete(); db = undefined; });
const profile = migrateCareerProfileToV2(structuredClone(demoCareerProfile));
const source = (text: string) => ({ sessionId: "session-sq1", messageId: "message-sq1", turnId: "turn-sq1", exactSourceText: text });
function composition(text: string, sourceResumeId?: string) {
  const graph = addSessionConfirmedSkills(buildResumeEvidenceGraph({ profile }), source(text));
  const blueprint = planResumeBlueprint({ profile, graph, mode: "general" });
  const result = writeResumeComposition({ profile, graph, blueprint, mode: "general", sourceResumeId });
  return { ...result, writingExecution: { ...result.writingExecution!, mode: "ai" as const } };
}
async function fixture() {
  db = new CareerAdaptDb(`SQ1-session-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  await repository.saveProfile(profile);
  await repository.setActiveProfileId(profile.id);
  return { repository, service: new BrowserAgentToolService(repository) };
}

describe("SQ1 session-confirmed composition consumption", () => {
  it("projects user-confirmed SQL into general resume evidence without changing Profile", () => {
    const before = structuredClone(profile);
    const result = composition("SQL 基础查询我能独立完成，只用于这份简历，不加入资料库。");
    expect(result.claims.find(claim => claim.id === "claim:skill:SQL")).toMatchObject({ classification: "SUPPORTED", guardStatus: "pass", sourceTurnIds: ["turn-sq1"], factIds: [] });
    expect(result.items.some(item => item.data.sectionType === "skills" && item.data.name.includes("SQL"))).toBe(true);
    expect(profile).toEqual(before);
  });

  it.each([
    ["我只学过 Pandas，没有正式项目。", "Pandas（基础接触）", "familiar"],
    ["我正在学习 NumPy，只用于当前简历。", "NumPy（正在学习）", "learning"]
  ])("preserves maturity for %s", (text, label, maturity) => {
    const result = composition(text);
    expect(result.evidenceGraph.nodes.find(node => node.id.startsWith("session-claim:"))).toMatchObject({ maturity, sourceTurnIds: ["turn-sq1"] });
    expect(result.items.some(item => item.data.sectionType === "skills" && item.data.name.includes(label))).toBe(true);
    expect(result.items.some(item => item.data.sectionType === "project" && JSON.stringify(item).includes("Pandas"))).toBe(false);
  });

  it.each([
    "我选你给的例子：Python 课程练习。还没确认做过。", "我会 SQL 吗？",
    "如果我会 SQL，就写进去。", "岗位要求掌握 SQL，请生成。",
    "我不会 SQL。", "我可能会 Python，但不确定。",
    "替我编一个 Python 项目，主导团队提升 45%。"
  ])("does not promote exploratory/denied/high-risk content: %s", text => {
    expect(composition(text).evidenceGraph.nodes.filter(node => node.id.startsWith("session-claim:"))).toEqual([]);
  });

  it("never copies hard facts or ownership from a capability narration", () => {
    const result = composition("我会 SQL，主导 50 人团队，在虚构公司提升销售 45%。");
    const nodes = result.evidenceGraph.nodes.filter(node => node.id.startsWith("session-claim:"));
    expect(nodes.map(node => node.value)).toEqual(["SQL"]);
    const claims = result.claims.filter(claim => claim.sourceTurnIds.includes("turn-sq1"));
    expect(claims.map(claim => claim.text)).toEqual(["SQL"]);
  });

  it("does not turn another person's skill or an unresolved alternative into the user's capability", () => {
    const result = composition("我会 SQL，同事 Python 在课程和比赛里用过。");
    expect(result.evidenceGraph.nodes.filter(node => node.id.startsWith("session-claim:")).map(node => node.value)).toEqual(["SQL"]);
    expect(composition("我会 SQL 或 Python 中的一项。").evidenceGraph.nodes.filter(node => node.id.startsWith("session-claim:"))).toEqual([]);
  });

  it("retains scoped evidence through continuation and applies a maturity correction or retraction", () => {
    const initial = composition("我会 SQL 基础查询，只用于这份简历。");
    const restored = JSON.parse(JSON.stringify(initial.evidenceGraph));
    const continued = addSessionConfirmedSkills(restored, { ...source("先别问了，直接生成。"), turnId: "next-turn" });
    expect(continued.nodes.filter(node => node.id.startsWith("session-claim:"))).toEqual(initial.evidenceGraph.nodes.filter(node => node.id.startsWith("session-claim:")));
    const corrected = addSessionConfirmedSkills(continued, { ...source("我只学过 SQL。"), turnId: "correction-turn" });
    expect(corrected.skillMatrix.find(skill => skill.name === "SQL")?.maturity).toBe("familiar");
    expect(corrected.nodes.find(node => node.id.startsWith("session-claim:"))?.sourceTurnIds).toEqual(["correction-turn"]);
    const retracted = addSessionConfirmedSkills(corrected, source("我不会 SQL，前面说错了。"));
    expect(retracted.skillMatrix.some(skill => skill.name === "SQL")).toBe(false);
  });

  it("uses only Host source text and fixed session identity at the public facade", () => {
    const context = { logicalTurnId: "turn-sq1", sourceUserMessageId: "message-sq1", sourceUserMessage: "我会 SQL。",
      careerSessionBinding: { agentSessionId: "session-sq1", profileId: profile.id, profileRevision: profile.version, personId: profile.personId!, profileVersionNumber: 1 } };
    const prepared = prepareCareerWorkflowInvocation("career.workflow.compose_resume", { mode: "general" }, context, "operation-sq1");
    expect(prepared.context.compositionSourceTurn).toEqual(source("我会 SQL。"));
    expect(prepared.context.sourceUserMessage).toBeUndefined();
    expect(() => prepareCareerWorkflowInvocation("career.workflow.compose_resume", { mode: "general", sessionSource: source("我会 Python。") }, context, "operation-sq1")).toThrow();
  });

  it("commits via Repository, preserves Profile and other branches, and retains source after refresh", async () => {
    const { repository, service } = await fixture();
    const other = await repository.ensureGeneralResumeFromProfile({ profileId: profile.id, operationId: "other-general" });
    const job = demoJobDescriptions[0];
    await repository.saveJobDescription(job);
    const jobBranch = await repository.createJobSpecificBranchFromProfile({ profileId: profile.id, jobId: job.id,
      operationId: "other-job", name: "Other job resume", selectedCanonicalItemIds: profile.structuredFacts.map(entry => entry.data.id), requirementMatchIds: [] });
    const profileBefore = await repository.getProfile(profile.id);
    const branchesBefore = await repository.listResumeBranches();
    const result = composition("我会 SQL 基础查询，只用于这份简历，不加入资料库。");
    const checkpoint = await repository.saveResumeCompositionCheckpoint(createResumeCompositionCheckpoint({ composition: result }));
    const restored = await repository.getResumeCompositionCheckpoint(checkpoint.checkpointId);
    expect(restored!.compositionResult.claims.find(claim => claim.id === "claim:skill:SQL")?.sourceTurnIds).toEqual(["turn-sq1"]);
    const input = { profileId: profile.id, expectedProfileRevision: profile.version, mode: "general", checkpointId: checkpoint.checkpointId, sessionScopeId: "session-sq1" };
    const saved = await service.composeResume(input, "session-general-save");
    const branch = await repository.getResumeBranch(saved.resumeId);
    expect(branch!.contentItems.some(item => item.text.includes("SQL") && item.userConfirmation?.scope === "resume_only")).toBe(true);
    expect(await repository.getProfile(profile.id)).toEqual(profileBefore);
    expect(await repository.getResumeBranch(other.branch.id)).toEqual(branchesBefore.find(branch => branch.id === other.branch.id));
    expect(await repository.getResumeBranch(jobBranch.branch.id)).toEqual(branchesBefore.find(branch => branch.id === jobBranch.branch.id));
    expect(branch!.currentRevisionId).toBe(saved.revisionId);
    await expect(service.composeResume({ ...input, sessionScopeId: "different-session" }, "bad-session-save")).rejects.toMatchObject({ code: "resume_composition_session_mismatch" });
    await expect(service.composeResume({ ...input, sourceResumeId: other.branch.id }, "bad-target-save")).rejects.toMatchObject({ code: "resume_composition_checkpoint_source_mismatch" });
  });

  it("carries the actual persisted UserMessage through facade, service, proposal, confirmation and Revision", async () => {
    const { repository } = await fixture();
    const baseline = composition("生成通用简历");
    const writer = { writeWithExecution: async () => ({ output: baseline.writingOutput, execution: baseline.writingExecution }) } as unknown as CareerResumeWritingService;
    const registry = createAgentToolRegistry(new BrowserAgentToolService(repository, undefined, writer));
    const gateway = new CareerToolGateway({ registry,
      getUserMessageForTurn: () => ({ id: "message-sq1", turnId: "turn-sq1", content: "SQL 基础查询我能独立完成，只用于这份简历，不加入资料库。" }),
      verifySessionBinding: async () => ({ valid: true }) });
    const binding = { agentSessionId: "session-sq1", profileId: profile.id, profileRevision: profile.version, personId: profile.personId!, profileVersionNumber: 1 };
    const context = { sourceUserMessageId: "message-sq1", logicalTurnId: "turn-sq1", careerSessionBinding: binding, requireSessionBinding: true };
    const profileBefore = await repository.getProfile(profile.id);
    const planned = await gateway.execute<{ workflowCheckpoint: { checkpointId: string; compositionResult: ResumeCompositionResult } }>("career.workflow.compose_resume", { mode: "general", generalResumeMode: "create_new" }, { ...context, operationId: "sq1-plan-operation" });
    expect(planned.ok, JSON.stringify(planned.error)).toBe(true);
    const checkpoint = planned.data!.workflowCheckpoint;
    expect(checkpoint.compositionResult.claims.find(claim => claim.id === "claim:skill:SQL")).toMatchObject({ classification: "SUPPORTED", sourceTurnIds: ["turn-sq1"] });
    expect(await repository.listResumeBranches()).toHaveLength(0);
    const committed = await gateway.execute("career.workflow.compose_resume", { mode: "general", generalResumeMode: "create_new", checkpointId: checkpoint.checkpointId }, { ...context, operationId: "sq1-confirm-operation", confirmed: true });
    expect(committed.ok, JSON.stringify(committed.error)).toBe(true);
    const branch = (await repository.listResumeBranches())[0];
    expect(branch.contentItems.some(item => item.text.includes("SQL") && item.userConfirmation?.scope === "resume_only")).toBe(true);
    expect(await repository.getProfile(profile.id)).toEqual(profileBefore);
  });

  it("updates only the selected existing resume and requires a separate Profile confirmation", async () => {
    const { repository, service } = await fixture();
    const original = await repository.ensureGeneralResumeFromProfile({ profileId: profile.id, operationId: "existing-general" });
    const profileBefore = await repository.getProfile(profile.id);
    const fingerprint = (await repository.getResumeSourceFingerprint(original.branch.id))!;
    const result = composition("我会 SQL 基础查询，同时加入资料库。", original.branch.id);
    const checkpoint = await repository.saveResumeCompositionCheckpoint(createResumeCompositionCheckpoint({ composition: result, source: fingerprint }));
    const saved = await service.composeResume({ profileId: profile.id, expectedProfileRevision: profile.version, mode: "general", checkpointId: checkpoint.checkpointId,
      sessionScopeId: "session-sq1", sourceResumeId: original.branch.id, generalResumeMode: "update_existing" }, "existing-update");
    expect(saved.resumeId).toBe(original.branch.id);
    expect(saved.revisionId).not.toBe(original.branch.currentRevisionId);
    expect(await repository.getProfile(profile.id)).toEqual(profileBefore);
    expect(await repository.listResumeBranches()).toHaveLength(1);
  });
});
