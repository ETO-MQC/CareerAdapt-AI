import { afterEach, describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import { AgentTaskCompletionGuard } from "@/agent/kernel/AgentTaskCompletionGuard";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  db?.close();
  if (db) await db.delete();
  db = undefined;
});

describe("P4.3d.2 build_resume_from_profile", () => {
  it("creates an independent general branch from selected confirmed facts and is idempotent", async () => {
    db = new CareerAdaptDb(`CareerAdaptP43d2BuildDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const profile = migrateCareerProfileToV2(demoCareerProfile);
    const selected = profile.structuredFacts?.find((entry) => entry.factIds.length > 0 && entry.data.sectionType !== "summary");
    expect(selected).toBeDefined();
    await repository.saveProfile(profile);
    await repository.setActiveProfileId(profile.id);
    const service = new BrowserAgentToolService(repository);
    const before = await repository.getProfile(profile.id);

    const first = await service.createResumeFromProfile({
      targetProfileId: profile.id,
      expectedProfileVersion: profile.version,
      selectedFactIds: [selected!.data.id],
      name: "示例目标简历"
    }, "p43d2-create-profile-resume");
    const repeated = await service.createResumeFromProfile({
      targetProfileId: profile.id,
      expectedProfileVersion: profile.version,
      selectedFactIds: [selected!.data.id],
      name: "示例目标简历"
    }, "p43d2-create-profile-resume");

    expect(first).toMatchObject({ profileId: profile.id, selectedFactIds: [selected!.data.id], idempotent: false });
    expect(repeated).toMatchObject({ resumeId: first.resumeId, revisionId: first.revisionId, idempotent: true });
    const branch = await repository.getResumeBranch(first.resumeId);
    expect(branch).toMatchObject({ branchPurpose: "general", profileId: profile.id, name: "示例目标简历" });
    expect(branch?.structuredContentItems?.filter((item) => item.data.id === selected!.data.id)).toHaveLength(1);
    expect(await repository.getProfile(profile.id)).toEqual(before);
  });

  it("settles the typed workflow only after a persisted Resume revision exists", () => {
    const reducer = new AgentTaskStateReducer();
    const base = AgentRuntime.create("agent_quick_action", "collecting_intent");
    let state = reducer.create(base);
    state = reducer.reduce(state, {
      type: "new_root_task",
      goal: "create_resume_from_profile",
      workflowId: "build_resume_from_profile",
      stage: "select_profile_scope"
    });
    state = reducer.reduce(state, {
      type: "entity_revision",
      entityType: "profile",
      entityId: "profile-build",
      version: 4
    });
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "get_profile",
      observation: {
        profile: {
          id: "profile-build",
          version: 4,
          items: [{ id: "fact-project", factIds: ["fact-project"] }]
        }
      }
    });
    state = reducer.reduce(state, {
      type: "user_message",
      message: "全部已确认经历",
      turnIntent: "clarification_answer"
    });
    expect(state.stage).toBe("review_resume_plan");
    state = reducer.reduce(state, {
      type: "confirmation_requested",
      toolName: "create_resume_from_profile",
      operationId: "p43d2-confirm-create"
    });
    expect(state).toMatchObject({ stage: "confirm_create", completionStatus: "waiting_for_confirmation" });
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "create_resume_from_profile",
      observation: {
        profileId: "profile-build",
        profileVersion: 4,
        resumeId: "branch-build",
        revisionId: "revision-build",
        selectedFactIds: ["fact-project"]
      }
    });
    expect(new AgentTaskCompletionGuard().evaluate(state)).toEqual({ canFinish: true, reason: "goal_completed" });
  });
});
