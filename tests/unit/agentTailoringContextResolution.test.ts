import { describe, expect, it } from "vitest";
import { AgentTaskStateSchema } from "@/agent/contracts/agentSession";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";

const NOW = "2026-07-31T00:00:00.000Z";

function state() {
  return AgentTaskStateSchema.parse({
    goal: "create_tailored_resume",
    rootGoal: "create_tailored_resume",
    activeGoal: "create_tailored_resume",
    workflowId: "tailor_existing_resume",
    stage: "choose_resume_source",
    requiredSlots: ["profileId", "resumeId", "jobId"],
    knownSlots: {},
    missingSlots: ["profileId", "resumeId", "jobId"],
    selectedEntities: {},
    dependencySnapshots: {},
    artifacts: [],
    completionStatus: "active",
    computeTier: "T3",
    updatedAt: NOW
  });
}

function context() {
  const reducer = new AgentTaskStateReducer();
  let current = reducer.reduce(state(), {
    type: "tool_observation",
    toolName: "get_active_profile",
    observation: { selected: true, profileId: "profile-1", name: "当前资料库", version: 4 }
  });
  current = reducer.reduce(current, {
    type: "tool_observation",
    toolName: "list_resumes",
    observation: {
      resumes: [{
        id: "resume-general",
        profileId: "profile-1",
        name: "通用简历",
        purpose: "general",
        revision: 2,
        currentRevisionId: "revision-general"
      }]
    }
  });
  current = reducer.reduce(current, {
    type: "tool_observation",
    toolName: "list_jobs",
    observation: {
      jobs: [
        { id: "job-1", title: "Android研发实习生", company: "智乐活", updatedAt: "2026-07-01" },
        { id: "job-2", title: "前端研发实习生", company: "云启", updatedAt: "2026-07-02" },
        { id: "job-3", title: "AI产品实习生", company: "星河", updatedAt: "2026-07-03" }
      ]
    }
  });
  return { reducer, current };
}

describe("tailoring context resolution phase", () => {
  it("auto-binds one profile and one resume, then asks only for job", () => {
    const { current } = context();
    expect(current.selectedEntities).toMatchObject({ profileId: "profile-1", resumeId: "resume-general" });
    expect(current.selectedEntities.jobId).toBeUndefined();
    expect(current.stage).toBe("choose_job");
    expect(current.completionStatus).toBe("waiting_for_user");
    expect(current.knownSlots.jobCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "job-1", title: "Android研发实习生", company: "智乐活", order: 1 })
    ]));
  });

  it("binds the second current job deterministically", () => {
    const { reducer, current } = context();
    const selected = reducer.reduce(current, { type: "user_message", message: "第二个" });
    expect(selected.selectedEntities.jobId).toBe("job-2");
    expect(selected.stage).toBe("analyze_fit");
  });

  it("resolves a natural job alias and leaves ambiguous aliases unbound", () => {
    const { reducer, current } = context();
    const android = reducer.reduce(current, { type: "user_message", message: "Android那个" });
    expect(android.selectedEntities.jobId).toBe("job-1");

    const ambiguousState = {
      ...current,
      knownSlots: {
        ...current.knownSlots,
        jobCandidates: [
          { id: "job-1", title: "Android研发实习生", company: "智乐活", order: 1 },
          { id: "job-4", title: "Android客户端实习生", company: "智乐活", order: 2 }
        ]
      }
    };
    const ambiguous = reducer.reduce(ambiguousState, { type: "user_message", message: "Android那个" });
    expect(ambiguous.selectedEntities.jobId).toBeUndefined();
    expect(ambiguous.knownSlots.jobSelectionError).toBe("ambiguous");
  });

  it("resolves a complete job reference before deep reads", () => {
    const reducer = new AgentTaskStateReducer();
    let current = reducer.reduce(state(), {
      type: "user_message",
      message: "用通用简历优化智乐活的 Android研发实习生"
    });
    current = reducer.reduce(current, {
      type: "tool_observation",
      toolName: "get_active_profile",
      observation: { selected: true, profileId: "profile-1", version: 4 }
    });
    current = reducer.reduce(current, {
      type: "tool_observation",
      toolName: "list_resumes",
      observation: {
        resumes: [{ id: "resume-general", profileId: "profile-1", name: "通用简历", purpose: "general", revision: 2, currentRevisionId: "revision-general" }]
      }
    });
    current = reducer.reduce(current, {
      type: "tool_observation",
      toolName: "list_jobs",
      observation: {
        jobs: [
          { id: "job-1", title: "Android研发实习生", company: "智乐活" },
          { id: "job-2", title: "AI产品实习生", company: "星河" }
        ]
      }
    });
    expect(current.selectedEntities).toMatchObject({ profileId: "profile-1", resumeId: "resume-general", jobId: "job-1" });
    expect(current.stage).toBe("analyze_fit");
  });

  it("waits for the active profile before auto-selecting a resume", () => {
    const reducer = new AgentTaskStateReducer();
    let current = reducer.reduce(state(), {
      type: "tool_observation",
      toolName: "list_resumes",
      observation: {
        resumes: [
          { id: "resume-other", profileId: "profile-other", name: "其他简历", purpose: "general", revision: 3 },
          { id: "resume-general", profileId: "profile-1", name: "通用简历", purpose: "general", revision: 2, currentRevisionId: "revision-general" }
        ]
      }
    });
    expect(current.selectedEntities.resumeId).toBeUndefined();
    current = reducer.reduce(current, {
      type: "tool_observation",
      toolName: "get_active_profile",
      observation: { selected: true, profileId: "profile-1", version: 4 }
    });
    expect(current.selectedEntities).toMatchObject({ profileId: "profile-1", resumeId: "resume-general" });
  });

  it("keeps an ambiguous initial job reference bounded to the matching options", () => {
    const reducer = new AgentTaskStateReducer();
    let current = reducer.reduce(state(), {
      type: "user_message",
      message: "用通用简历优化 Android那个"
    });
    current = reducer.reduce(current, {
      type: "tool_observation",
      toolName: "get_active_profile",
      observation: { selected: true, profileId: "profile-1", version: 4 }
    });
    current = reducer.reduce(current, {
      type: "tool_observation",
      toolName: "list_resumes",
      observation: { resumes: [{ id: "resume-general", profileId: "profile-1", name: "通用简历", purpose: "general", revision: 2, currentRevisionId: "revision-general" }] }
    });
    current = reducer.reduce(current, {
      type: "tool_observation",
      toolName: "list_jobs",
      observation: {
        jobs: [
          { id: "job-1", title: "Android研发实习生", company: "智乐活" },
          { id: "job-2", title: "Android客户端实习生", company: "智乐活" },
          { id: "job-3", title: "AI产品实习生", company: "星河" }
        ]
      }
    });
    expect(current.selectedEntities.jobId).toBeUndefined();
    expect(current.knownSlots.jobSelectionAmbiguity).toEqual([
      expect.objectContaining({ id: "job-1" }),
      expect.objectContaining({ id: "job-2" })
    ]);
    const selected = reducer.reduce(current, { type: "user_message", message: "第二个" });
    expect(selected.selectedEntities.jobId).toBe("job-2");
  });
});
