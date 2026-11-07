import { it, expect, vi } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { createTailoringSessionCommand, answerTailoringQuestionCommand, generateTailoringDiffsCommand } from "@/services/jobs/tailoringCommands";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";

it("advances the last answer to generation and produces grounded structured changes", async () => {
 const profile = demoCareerProfile;
 const db = new CareerAdaptDb(`b011-generation-${crypto.randomUUID()}`);
 const repository = new WorkspaceRepository(db);
 await repository.saveProfile(profile);
 const branch = (await repository.ensureGeneralResumeFromProfile({ profileId: profile.id, operationId: "b011-source-test", mode: "create_new" })).branch;
 const job = { ...demoJobDescriptions[0], requirements: [...demoJobDescriptions[0].requirements, { ...demoJobDescriptions[0].requirements[0], id: "kubernetes-req", description: "使用 Kubernetes 完成部署", keywords: ["Kubernetes"] }] };
 const session = createTailoringSessionCommand({ operationId: "b011-session-test", profile, branch, job, mode: "competitive" }).session;
 const answered = answerTailoringQuestionCommand({ operationId: "b011-answer-test", session, questionId: session.plan.questionPlan!.activeQuestionId!, answer: "没有" });
 const reducer = new AgentTaskStateReducer();
 let state = reducer.create(AgentRuntime.create("tailor_existing_resume", "clarify_unsupported_facts"), "create_tailored_resume");
 state = reducer.reduce(state, { type: "tool_observation", toolName: "answer_tailoring_question", observation: answered });
 expect(state.stage).toBe("generate_changes");
 const generated = await generateTailoringDiffsCommand({ operationId: "b011-generate-test", session: answered.session, generate: async request => {
  let value = request.target.sectionId === "summary" ? "基于数据分析项目完成结构化交付，并突出与目标岗位相关的分析经验。"
    : Array.isArray(request.currentContent.fieldValue) ? request.currentContent.fieldValue.map(line => line.includes("需求梳理") ? "参与需求梳理、原型设计和功能验收等 AI 应用项目工作。" : line) : request.currentContent.fieldValue;
  if (request.target.sectionId === "internship" && Array.isArray(request.currentContent.fieldValue)) value = request.currentContent.fieldValue.map(line => line.includes("公文") ? "协助整理公文流转与热线记录，保持信息记录准确和资料有序。" : line);
  return { diffs: [{ target: { sectionId: request.target.sectionId, itemId: request.target.itemId!, fieldPath: request.target.fieldPath }, operation: "replace", original: request.currentContent.fieldValue, value, reason: "重组已确认事实", requirementIds: [], targetKeywords: [], evidenceRefs: request.allowedEvidenceRefs, supportLevel: "verified" }], clarifications: [] };
 }});
 expect(generated.session.plan.diffs!.length).toBeGreaterThanOrEqual(2);
 const generateFailure = vi.fn(async () => { throw Object.assign(new Error("isolated deadline"), { code: "provider_timeout" }); });
 await expect(generateTailoringDiffsCommand({ operationId: "b011-timeout-test", session: answered.session, generate: generateFailure })).rejects.toMatchObject({ code: "provider_timeout" });
 expect(generateFailure).toHaveBeenCalledTimes(1);
 expect(answered.session.plan.clarificationAnswers).toHaveLength(1);
 db.close();
});
