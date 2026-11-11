import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentToolRegistry } from "@/agent/tools/registry";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { CareerAdaptMcpAdapter } from "@/agent/mcp/CareerAdaptMcpAdapter";
import { CAREER_WORKFLOW_FACADE_DEFINITIONS } from "@/agent/workflows/CareerWorkflowFacade";

const examples: Array<[string, Record<string, unknown>]> = [
  ["profile_intake_turn", { userTurn: "我在项目中负责数据清洗与测试。" }],
  ["profile_intake_finalize", { importId: "bound-draft", expectedDraftRevision: 1 }],
  ["material_intake", { attachmentId: "bound-attachment" }],
  ["resume_import", { attachmentId: "bound-attachment" }],
  ["compose_resume", { mode: "general" }],
  ["compose_resume", { mode: "general", sourceResumeId: "bound-resume", reviewOnly: true }],
  ["job_intake", { rawText: "岗位：数据工程师。职责：维护数据查询和产品测试。要求：掌握 SQL。", company: null, persistence: "analyze_only" }],
  ["job_fit", { profileId: "bound-profile", resumeId: "bound-resume", jobId: "bound-job" }],
  ["tailor_resume", { profileId: "bound-profile", sourceResumeId: "bound-resume", jobId: "bound-job" }],
  ["precise_edit", { proposedValue: "负责数据清洗与产品测试" }],
  ["resume_export", { resumeId: "bound-resume" }]
];
describe("H2 workflow schema sweep", () => {
  const published = new CareerAdaptMcpAdapter(new CareerToolGateway(new AgentToolRegistry([]))).listTools();
  it.each(examples)("T21 %s accepts the same example at published and canonical boundaries", (suffix, input) => {
    const name = `career.workflow.${suffix}`;
    const facade = CAREER_WORKFLOW_FACADE_DEFINITIONS.find(tool => tool.name === name)!;
    expect(facade.inputSchema.safeParse(input).success).toBe(true);
    const schema = z.fromJSONSchema(published.find(tool => tool.name === name)!.inputSchema);
    expect(schema.safeParse(input).success).toBe(true);
  });
});
