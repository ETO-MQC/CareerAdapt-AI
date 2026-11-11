import { z } from "zod";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";
import { CareerAdaptMcpAdapter } from "@/agent/mcp/CareerAdaptMcpAdapter";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { classifyTurnIntent } from "@/agent/runtime/AgentTurnIntent";
import { prepareCareerWorkflowInvocation, CAREER_WORKFLOW_FACADE_DEFINITIONS } from "@/agent/workflows/CareerWorkflowFacade";
import { buildResumeEvidenceGraph, compileResumeComposition } from "@/domain/resumeComposition";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import { demoCareerProfile } from "@/data/demoProfile";
import { readFileSync } from "node:fs";

function state() {
  const reducer = new AgentTaskStateReducer();
  const task = reducer.create(AgentRuntime.create("agent_quick_action", "collecting_intent"));
  task.selectedEntities = { profileId: "profile-h1", jobId: "job-h1", resumeId: "resume-h1", revisionId: "revision-h1" };
  task.workflowId = "job_ingestion";
  task.stage = "completed";
  task.completionStatus = "completed";
  task.knownSlots = { facadeCheckpoint: { kind: "job_intake", input: { rawText: "A complete synthetic job description for the workflow fixture.", persistence: "analyze_only" } } };
  return { reducer, task };
}

describe("H1 workflow circuit", () => {
  it("keeps published MCP, official Skill and Gateway validation in parity for fit/intake/tailor", async () => {
    const gateway = new CareerToolGateway(new AgentToolRegistry([]));
    const published = new CareerAdaptMcpAdapter(gateway).listTools();
    for (const skillName of ["job-fit-analysis", "resume-tailoring"]) {
      const skill = readFileSync(`skills/career/${skillName}/SKILL.md`, "utf8");
      const examples = [...skill.matchAll(/### (career\.workflow\.\w+)\s+```json\s*([\s\S]*?)```/g)];
      expect(examples.length).toBeGreaterThan(0);
      for (const [, name, json] of examples) {
        const input = JSON.parse(json);
        expect(z.fromJSONSchema(published.find(tool => tool.name === name)!.inputSchema).safeParse(input).success).toBe(true);
        const context = { authoritativeTaskState: state().task, careerSessionBinding: { agentSessionId: "h1-session", personId: "h1-person", profileId: "profile-h1", profileRevision: 1, profileVersionNumber: 1 } };
        const prepared = prepareCareerWorkflowInvocation(name, input, context, "h1-parity");
        expect(CAREER_WORKFLOW_FACADE_DEFINITIONS.find(tool => tool.name === name)!.inputSchema.safeParse(prepared.input).success).toBe(true);
        const result = await gateway.execute(name, input, { ...context, operationId: `h1-${name}` });
        expect(result.diagnostics?.schemaIssues).toBeUndefined();
        expect(result.diagnostics?.enteredFacadeAt).toBeDefined();
      }
    }
  });
  it.each(["创建通用简历", "基于已确认的 Profile 创建一份通用简历，然后再做岗位匹配"])("routes %s to composition before fit", text => {
    expect(classifyTurnIntent({ text, taskState: state().task })).toMatchObject({ taskMutation: "replace", newTask: { workflowId: "compose_resume" } });
  });
  it("retains bound entities while clearing workflow-specific checkpoints", () => {
    const { reducer, task } = state();
    const next = reducer.reduce(task, { type: "new_root_task", goal: "compose_resume", workflowId: "compose_resume", stage: "select_profile_scope" });
    expect(next.selectedEntities).toEqual(task.selectedEntities);
    expect(next.knownSlots.facadeCheckpoint).toBeUndefined();
    expect(next.completionStatus).toBe("active");
  });
  it("does not carry an old Job binding into a new intake goal", () => {
    const { reducer, task } = state();
    expect(reducer.reduce(task, { type: "new_root_task", goal: "ingest_job", workflowId: "job_ingestion", stage: "collect_job_description" }).selectedEntities.jobId).toBeUndefined();
  });
  it("restores analyze-only source for save without repasting", () => {
    const input = prepareCareerWorkflowInvocation("career.workflow.job_intake", { persistence: "save" }, { authoritativeTaskState: { ...state().task, selectedEntities: { profileId: "profile-h1" } } }, "save-h1").input;
    expect(input.rawText).toBe("A complete synthetic job description for the workflow fixture.");
    expect(input.persistence).toBe("save");
  });
  it("omits null Job only for general mode and rejects an explicit Job", () => {
    expect(prepareCareerWorkflowInvocation("career.workflow.compose_resume", { mode: "general", jobId: null }, {}, "general-h1").input).toEqual({ mode: "general" });
    expect(() => prepareCareerWorkflowInvocation("career.workflow.compose_resume", { mode: "general", jobId: "job-other" }, {}, "general-conflict")).toThrow();
  });
  it("binds omitted job-specific target but rejects explicit conflict", () => {
    const context = { authoritativeTaskState: state().task };
    expect(prepareCareerWorkflowInvocation("career.workflow.compose_resume", { mode: "job_specific" }, context, "specific-h1").input).toMatchObject({ jobId: "job-h1" });
    expect(() => prepareCareerWorkflowInvocation("career.workflow.compose_resume", { mode: "job_specific", jobId: "job-other" }, context, "specific-conflict")).toThrow("career_workflow_target_conflict");
    expect(() => prepareCareerWorkflowInvocation("career.workflow.compose_resume", { mode: "invented" }, context, "mode-invalid")).toThrow();
  });
  it("persists continuation through serialization and cancels it on rejection", () => {
    const { reducer, task } = state();
    let next = reducer.reduce(task, { type: "new_root_task", goal: "compose_resume", workflowId: "compose_resume", stage: "select_profile_scope" });
    next = reducer.reduce(next, { type: "user_message", sessionId: "session-h2", turnId: "turn-h2", message: "基于已确认的 Profile 创建一份通用简历，然后再做岗位匹配" });
    const restored = JSON.parse(JSON.stringify(next));
    expect(restored.knownSlots.nextAction).toEqual({ kind: "job_fit", workflow: "analyze_job_fit", originSessionId: "session-h2", originTurnId: "turn-h2", jobId: "job-h1", profileId: "profile-h1", requiredEntities: { profileId: "profile-h1", jobId: "job-h1" } });
    expect(reducer.reduce(restored, { type: "confirmation_rejected", toolName: "compose_resume" }).knownSlots.nextAction).toBeUndefined();
  });
  it("preserves confirmed Profile content through the production graph and compiler", () => {
    const profile = migrateCareerProfileToV2(demoCareerProfile);
    const before = JSON.stringify(profile);
    const graph = buildResumeEvidenceGraph({ profile });
    const result = compileResumeComposition({ profile, mode: "general" });
    expect(graph.sourceAssetIds.length).toBeGreaterThan(0);
    expect(result.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(profile)).toBe(before);
  });
  it("validates actual Skill JSON examples against the canonical facade schema", () => {
    const skill = readFileSync("skills/career/resume-composition/SKILL.md", "utf8");
    const examples = [...skill.matchAll(/```json\s*([\s\S]*?)```/g)].map(match => JSON.parse(match[1]));
    expect(examples).toHaveLength(2);
    const definition = CAREER_WORKFLOW_FACADE_DEFINITIONS.find(tool => tool.name === "career.workflow.compose_resume")!;
    const gateway = new CareerToolGateway(new AgentToolRegistry([]));
    const published = new CareerAdaptMcpAdapter(gateway).listTools().find(tool => tool.name === definition.name)!;
    const schema = z.fromJSONSchema(published.inputSchema);
    for (const example of examples) {
      expect(schema.safeParse(example).success).toBe(true);
      expect(definition.inputSchema.safeParse(example).success).toBe(true);
      expect(prepareCareerWorkflowInvocation(definition.name, example, {}, "parity-h1").input).toMatchObject(example);
    }
  });
});
