import { describe, expect, it, vi } from "vitest";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { createQuickActionIntent } from "@/agent/contracts/agentQuickAction";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { createAgentToolRegistry, type AgentToolServices } from "@/agent/tools/registry";
import { resolveProfileIntakeInterviewSupervisor } from "@/agent/workflows/ProfileIntakeInterviewSupervisor";
import {
  IMPORT_EXISTING_RESUME_RESPONSE,
  resolveQuickActionPrerequisites,
  resolveQuickActionWorkflow
} from "@/agent/workflows/QuickActionWorkflowSupervisor";
import { resolveWorkflowPrerequisites } from "@/agent/workflows/workflowPrerequisiteResolver";

describe("P4.3g workflow supervisors", () => {
  it("returns the import explanation and upload action without model or asset reads", () => {
    const result = resolveQuickActionWorkflow("import_existing_resume");

    expect(result).toMatchObject({
      handledLocally: true,
      assistantText: IMPORT_EXISTING_RESUME_RESPONSE,
      uiAction: { type: "open_resume_upload" },
      modelCalls: 0,
      profileReads: 0,
      jobReads: 0
    });
    expect(result?.assistantText).toBe(
      "支持 PDF、DOCX、JSON、Markdown 和 TXT。\n上传后会先在本地提取并脱敏，再进行结构识别。\n结果会按基本信息、教育、工作、项目、技能等栏目逐项核对，\n确认后才写入资料库。"
    );
  });

  it("resolves missing workflow assets to a concrete next action", () => {
    const result = resolveWorkflowPrerequisites({
      workflowId: "analyze_job_fit",
      profiles: [],
      resumes: [],
      jobs: [{ id: "job-1", title: "后端工程师", company: "示例公司" }]
    });

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(["profile", "resume"]);
    expect(result.availableAlternatives).toEqual([
      { id: "job-1", label: "后端工程师", kind: "job" }
    ]);
    expect(result.recommendedNextAction).toBe("已找到并保留岗位；导入简历或从零整理经历");
  });

  it("publishes typed recovery options when a quick action has saved jobs but no source assets", () => {
    const result = resolveQuickActionPrerequisites({
      actionId: "analyze_job_fit",
      workflowId: "analyze_job_fit",
      profiles: [],
      resumes: [],
      jobs: [{ id: "job-1", title: "后端工程师", company: "示例公司" }]
    });

    expect(result).toMatchObject({
      modelCalls: 0,
      profileReads: 1,
      resumeReads: 1,
      jobReads: 1,
      options: [
        { label: "导入简历", action: { type: "open_resume_upload" } },
        { label: "从零整理经历", action: { type: "start_workflow", workflowId: "guided_profile_intake" } }
      ]
    });
    expect(result?.assistantText).toContain("已找到并保留岗位");
  });

  it("disambiguates duplicate assets and asks only for the unresolved choice", () => {
    const result = resolveWorkflowPrerequisites({
      workflowId: "tailor_existing_resume",
      profiles: [{ id: "profile-1", name: "通用资料" }],
      resumes: [{ id: "resume-1", name: "校招简历" }],
      jobs: [
        { id: "job-1", title: "前端工程师" },
        { id: "job-2", title: "前端工程师" }
      ]
    });

    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.recommendedNextAction).toBe("选择目标岗位");
    expect(result.availableAlternatives.filter((asset) => asset.kind === "job").map((asset) => asset.label)).toEqual([
      "前端工程师 · job-1",
      "前端工程师 · job-2"
    ]);
  });

  it("waits for candidate review before asking the next interview question", () => {
    expect(resolveProfileIntakeInterviewSupervisor({ unresolvedCandidateIds: ["candidate-1"] })).toEqual({
      type: "wait_for_candidate_review",
      question: "先核对上面的经历卡片；确认或忽略后，我再继续整理下一段。"
    });
    expect(resolveProfileIntakeInterviewSupervisor({ suggestedNextSections: ["project"] })).toEqual({
      type: "ask_next_section",
      section: "project",
      question: "接下来介绍一段项目经历吧。先说名称、你的角色和主要工作即可。"
    });
    expect(resolveProfileIntakeInterviewSupervisor({ explicitFinish: true })).toEqual({ type: "commit" });
  });

  it("publishes the typed capture result in the tool manifest", () => {
    const registry = createAgentToolRegistry({} as AgentToolServices);
    const capture = registry.manifest().find((tool) => tool.name === "capture_profile_intake");
    const properties = capture?.outputSchema.properties as Record<string, unknown> | undefined;

    expect(properties).toEqual(expect.objectContaining({
      persistenceStatus: expect.anything(),
      providerStatus: expect.anything(),
      extractionStatus: expect.anything(),
      candidateCount: expect.anything(),
      usableCandidateCount: expect.anything(),
      quarantinedCandidateCount: expect.anything(),
      reviewProjection: expect.anything(),
      safeDiagnostics: expect.anything()
    }));
  });

  it("handles the import quick action in the host without executor or model calls", async () => {
    const intent = createQuickActionIntent("import_existing_resume");
    const execute = vi.fn();
    const host = new AgentHostStore({
      kernel: { runTurn: vi.fn() } as never,
      executor: { execute } as never,
      persistence: { save: async (session: AgentSession) => session } as never
    });
    const base = AgentRuntime.create("agent_quick_action", "collecting_intent");

    const result = await host.dispatch({
      type: "quick_action",
      actionId: intent.actionId,
      text: intent.intent,
      task: intent.task
    }, { session: base, pageContext: { pathname: "/ai-workspace", query: {} } });

    expect(execute).not.toHaveBeenCalled();
    expect(result?.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: IMPORT_EXISTING_RESUME_RESPONSE,
      options: [{ action: { type: "open_resume_upload" } }]
    });
    expect(host.getSnapshot().uiAction).toEqual({ type: "open_resume_upload" });
  });

  it("handles missing quick-action assets locally without entering the model stream", async () => {
    const intent = createQuickActionIntent("analyze_job_fit");
    const runTurn = vi.fn();
    const execute = vi.fn(async ({ toolName }: { toolName: string }) => ({
      ok: true,
      operationId: `operation-${toolName}`,
      toolName,
      data: toolName === "list_jobs"
        ? { jobs: [{ id: "job-1", title: "后端工程师", company: "示例公司" }] }
        : toolName === "list_profiles" ? { profiles: [] } : { resumes: [] },
      artifactIds: [],
      completedAt: new Date().toISOString()
    }));
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: { execute } as never,
      persistence: { save: async (session: AgentSession) => session } as never
    });
    const base = AgentRuntime.create("agent_quick_action", "collecting_intent");

    const result = await host.dispatch({
      type: "quick_action",
      actionId: intent.actionId,
      text: intent.intent,
      task: intent.task
    }, { session: base, pageContext: { pathname: "/ai-workspace", query: {} } });

    expect(runTurn).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(3);
    expect(result?.messages.at(-1)).toMatchObject({
      role: "assistant",
      options: [
        { action: { type: "open_resume_upload" } },
        { action: { type: "start_workflow", workflowId: "guided_profile_intake" } }
      ],
      metadata: { modelCalls: 0, profileReads: 1, resumeReads: 1, jobReads: 1 }
    });
  });
});
