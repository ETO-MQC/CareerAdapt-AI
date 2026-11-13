import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { resolveCareerSessionBinding } from "@/agent/runtime/careerSessionBinding";
import { resolveCareerAgentContext } from "@/agent/runtime/careerContextBindingResolver";
import type { WorkspaceRepository } from "@/services/storage/repositories";

function fixture() {
  const session = AgentRuntime.createConversationSession();
  session.personId = "person-1";
  session.activeProfileId = "wrong-profile";
  session.activeJobId = "wrong-job";
  session.activeResumeId = "wrong-resume";
  session.taskState = new AgentTaskStateReducer().create(session, undefined, { workflowId: "analyze_job_fit", step: "choose_job" });
  session.taskState.selectedEntities = { profileId: "profile-1", profileVersion: 3, jobId: "job-1", resumeId: "resume-1", revisionId: "revision-1" };
  const repository = {
    getAvailableProfile: vi.fn(async (id: string) => id === "profile-1" ? { id, personId: "person-1", version: 3 } : undefined),
    getAvailableJobDescription: vi.fn(async (id: string) => id === "job-1" ? { id, updatedAt: "2026-01-01T00:00:00.000Z" } : undefined),
    getAvailableResumeBranch: vi.fn(async (id: string) => id === "resume-1" ? { id, profileId: "profile-1", currentRevisionId: "revision-1" } : undefined),
    getResumeRevision: vi.fn(async (id: string) => id === "revision-1" ? { id, branchId: "resume-1" } : undefined)
  };
  return { session, repository, resolve: () => resolveCareerAgentContext(session, repository as unknown as WorkspaceRepository) };
}

describe("H4A repository validated career context", () => {
  it("uses TaskState selections instead of conflicting aliases", async () => {
    const f = fixture();
    expect(await f.resolve()).toMatchObject({ personId: "person-1", profileId: "profile-1", jobId: "job-1", resumeBranchId: "resume-1", revisionId: "revision-1" });
    expect(f.repository.getAvailableJobDescription).toHaveBeenCalledWith("job-1");
    expect(f.repository.getAvailableResumeBranch).toHaveBeenCalledWith("resume-1");
  });
  it("does not seed a new task from aliases when TaskState already exists", () => {
    const f = fixture();
    const next = new AgentTaskStateReducer().create(f.session, undefined, { workflowId: "analyze_job_fit", step: "choose_job" });
    expect(next.selectedEntities).toMatchObject({ profileId: "profile-1", jobId: "job-1", resumeId: "resume-1" });
  });
  it("projects the resolved profile over a stale alias before a quick action", async () => {
    const f = fixture();
    f.session.titleOrigin = "user";
    const host = new AgentHostStore({ executor: {} as never, persistence: {} as never });
    const prepared = await host["prepareQuickActionSession"](f.session, "analyze_job_fit", {
      activePerson: { id: "person-1" },
      activeProfile: { id: "profile-1", profileVersionNumber: 1, profileRevision: 3 }
    } as never);
    expect(prepared.activeProfileId).toBe("profile-1");
    expect(prepared.profileRevision).toBe(3);
    expect(prepared.taskState?.selectedEntities.profileId).toBe("profile-1");
    expect(resolveCareerSessionBinding({ sessionId: prepared.id, session: prepared })?.profileId).toBe("profile-1");
  });
  it("does not replace missing, hidden, stale, or wrong-owner entities with aliases", async () => {
    const f = fixture();
    f.repository.getAvailableJobDescription.mockResolvedValueOnce(undefined);
    f.repository.getAvailableProfile.mockResolvedValueOnce({ id: "profile-1", personId: "other-person", version: 3 });
    expect(await f.resolve()).toMatchObject({ profileId: undefined, jobId: undefined, resumeBranchId: undefined, revisionId: undefined });
    f.session.taskState!.selectedEntities.jobRevision = "2025-01-01T00:00:00.000Z";
    expect((await f.resolve()).jobId).toBeUndefined();
    f.session.taskState!.selectedEntities.profileVersion = 2;
    expect((await f.resolve()).profileId).toBeUndefined();
    f.session.taskState!.selectedEntities = {};
    expect(await f.resolve()).toMatchObject({ profileId: undefined, jobId: undefined, resumeBranchId: undefined, revisionId: undefined });
  });
  it("never binds a task profile using another alias's revision metadata", () => {
    const f = fixture();
    f.session.profileVersionNumber = 1;
    f.session.profileRevision = 3;
    expect(resolveCareerSessionBinding({ sessionId: f.session.id, session: f.session })).toBeUndefined();
    f.session.activeProfileId = "profile-1";
    expect(resolveCareerSessionBinding({ sessionId: f.session.id, session: f.session })?.profileId).toBe("profile-1");
    f.session.taskState!.selectedEntities.profileVersion = 4;
    expect(resolveCareerSessionBinding({ sessionId: f.session.id, session: f.session })).toBeUndefined();
  });
  it("rejects a foreign or noncurrent resume revision", async () => {
    const f = fixture();
    f.repository.getResumeRevision.mockResolvedValueOnce({ id: "revision-1", branchId: "other-resume" });
    expect((await f.resolve()).revisionId).toBeUndefined();
    f.repository.getAvailableResumeBranch.mockResolvedValueOnce({ id: "resume-1", profileId: "profile-1", currentRevisionId: "newer" });
    expect((await f.resolve()).revisionId).toBeUndefined();
  });
});
