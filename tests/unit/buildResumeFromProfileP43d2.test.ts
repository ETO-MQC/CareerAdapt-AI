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

describe("P4.3d.2 legacy build_resume_from_profile compatibility", () => {
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
    expect(state.workflowId).toBe("compose_resume");
    state = reducer.reduce(state, {
      type: "user_message",
      message: "用于互联网的秋招",
      turnIntent: "clarification_answer"
    });
    expect(state).toMatchObject({ workflowId: "compose_resume", stage: "review_composition" });
    expect(state.knownSlots.resumeCompositionLastAnswer).toMatchObject({
      informationNeedId: "target_direction",
      value: "用于互联网的秋招",
      source: "user_message"
    });
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "plan_resume_composition",
      observation: {
        profileId: "profile-build",
        profileRevision: 4,
        evidenceGraph: { nodes: [], edges: [] },
        blueprint: { sections: [] },
        compositionProposal: { title: "通用简历组装预览" },
        reviewResult: { status: "PASS" }
      }
    });
    state = reducer.reduce(state, {
      type: "confirmation_requested",
      toolName: "compose_resume",
      operationId: "p43d2-confirm-create"
    });
    expect(state).toMatchObject({ stage: "confirm_create", completionStatus: "waiting_for_confirmation" });
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "compose_resume",
      observation: {
        profileId: "profile-build",
        profileVersion: 4,
        resumeId: "branch-build",
        revisionId: "revision-build",
        composition: { profileId: "profile-build" }
      }
    });
    expect(new AgentTaskCompletionGuard().evaluate(state)).toEqual({ canFinish: true, reason: "goal_completed" });
  });
});
