import { describe, expect, it, vi } from "vitest";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { buildJobBranchFromProfile } from "@/domain/branch/profileBranch";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import { ResumeTailoringPlanSchema } from "@/domain/schemas";
import {
  TailoringSessionSchema,
  createTailoringSessionCommand,
  reviewTailoringDiffCommand,
  tailoringDiffId
} from "@/services/jobs/tailoringCommands";
import type { AgentSession } from "@/agent/contracts/agentSession";

describe("P4.3d.1 artifact action runtime", () => {
  it("applies a diff through executor, reducer and persistence without a model call", async () => {
    const job = demoJobDescriptions[0];
    const built = buildJobBranchFromProfile({
      profile: demoCareerProfile,
      jobId: job.id,
      jobTitle: job.title,
      jobVersion: "artifact-test-v1",
      operationId: "artifact-branch-create",
      name: "Artifact 岗位简历",
      selectedCanonicalItemIds: canonicalProfileLibraryItems(demoCareerProfile).slice(0, 4).map((item) => item.id),
      requirementMatchIds: [],
      sourceMatchSetHash: "artifact-match-hash",
      now: "2026-08-02T12:00:00.000Z"
    });
    const created = createTailoringSessionCommand({
      operationId: "artifact-tailoring-create",
      profile: demoCareerProfile,
      branch: built.branch,
      job
    });
    const diffA = {
      target: { sectionId: "summary", itemId: "summary-a", fieldPath: "text" as const },
      operation: "replace" as const,
      original: "原文 A", value: "新文 A", reason: "匹配岗位 A",
      requirementIds: [], targetKeywords: [], evidenceRefs: [], supportLevel: "verified" as const
    };
    const diffB = {
      ...diffA,
      target: { sectionId: "summary", itemId: "summary-b", fieldPath: "text" as const },
      original: "原文 B", value: "新文 B", reason: "匹配岗位 B"
    };
    const now = "2026-08-02T12:00:00.000Z";
    const plan = ResumeTailoringPlanSchema.parse({
      ...created.session.plan,
      questionPlan: { ...created.session.plan.questionPlan!, status: "completed", activeQuestionId: undefined, completedAt: now },
      diffs: [diffA, diffB],
      diffReviews: [diffA, diffB].map((diff) => ({ diffId: tailoringDiffId(diff), status: "suggested", updatedAt: now }))
    });
    const tailoringSession = TailoringSessionSchema.parse({ ...created.session, plan, revision: 4, generatedDiffRevision: 1 });
    const base = AgentRuntime.create("tailor_existing_resume", "preview_changes", "Artifact runtime");
    const reducer = new AgentTaskStateReducer();
    const initial = reducer.create(base, "create_tailored_resume");
    const taskState = reducer.reduce(initial, {
      type: "tool_observation",
      toolName: "generate_tailoring_changes",
      observation: { session: tailoringSession, appliedDiffs: [diffA, diffB] }
    });
    const initialSession: AgentSession = {
      ...base,
      taskState,
      activeTurn: {
        id: "artifact-turn",
        sessionId: base.id,
        status: "waiting_for_user",
        startedAt: now
      }
    };
    let persisted = initialSession;
    const save = vi.fn(async (value: AgentSession) => { persisted = value; return value; });
    const execute = vi.fn(async (input: { toolName: string; toolInput: Record<string, unknown>; operationId: string }) => {
      const data = input.toolName === "review_tailoring_diff"
        ? reviewTailoringDiffCommand({ operationId: input.operationId, ...input.toolInput } as never)
        : input.toolName === "preview_tailoring_changes"
          ? { operationId: input.operationId, preview: true }
          : (() => { throw new Error(`unexpected:${input.toolName}`); })();
      return { ok: true, operationId: input.operationId, toolName: input.toolName, data, artifactIds: [], completedAt: now };
    });
    const runTurn = vi.fn();
    const resumeTurn = vi.fn();
    const host = new AgentHostStore({
      kernel: { runTurn, resumeTurn } as never,
      executor: { execute } as never,
      persistence: { save } as never
    });
    host.adopt(initialSession);

    const beforeRevision = tailoringSession.revision;
    const result = await host.dispatch({
      type: "artifact_action",
      action: { type: "tailoring_diff_decision", diffId: tailoringDiffId(diffA), decision: "accept" }
    }, { pageContext: { pathname: "/ai-workspace", query: {} } });
    const afterTailoring = result?.taskState?.knownSlots.tailoringSession as typeof tailoringSession;
    expect(afterTailoring.revision).toBe(beforeRevision + 1);
    expect(result?.taskState?.knownSlots.remainingDiffCount).toBe(1);
    expect(afterTailoring.plan.diffReviews?.find((review) => review.diffId === tailoringDiffId(diffA))?.status).toBe("accepted");
    expect(runTurn).not.toHaveBeenCalled();
    expect(resumeTurn).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(persisted).toEqual(result);

    const activityCount = result?.messages.filter((message) => message.toolName === "review_tailoring_diff").length;
    const repeated = await host.dispatch({
      type: "artifact_action",
      action: { type: "tailoring_diff_decision", diffId: tailoringDiffId(diffA), decision: "accept" }
    }, { pageContext: { pathname: "/ai-workspace", query: {} } });
    const repeatedTailoring = repeated?.taskState?.knownSlots.tailoringSession as typeof tailoringSession;
    expect(repeatedTailoring.revision).toBe(beforeRevision + 1);
    expect(repeated?.messages.filter((message) => message.toolName === "review_tailoring_diff")).toHaveLength(activityCount ?? 0);

    const completed = await host.dispatch({
      type: "artifact_action",
      action: { type: "tailoring_diff_decision", diffId: tailoringDiffId(diffB), decision: "accept" }
    }, { pageContext: { pathname: "/ai-workspace", query: {} } });
    expect(completed?.taskState).toMatchObject({
      stage: "confirm_apply",
      completionStatus: "waiting_for_confirmation",
      knownSlots: { remainingDiffCount: 0 }
    });
    expect(completed?.pendingConfirmation).toMatchObject({
      toolName: "apply_tailoring_changes",
      status: "pending"
    });
    expect(completed?.pendingToolCall).toMatchObject({ toolName: "apply_tailoring_changes" });
    expect(completed?.activeTurn?.status).toBe("waiting_for_confirmation");
    expect(completed?.pendingConfirmation?.turnId).toBe("artifact-turn");
    expect(runTurn).not.toHaveBeenCalled();
    expect(resumeTurn).not.toHaveBeenCalled();

    const reloadedHost = new AgentHostStore({ kernel: {} as never, executor: {} as never, persistence: { save } as never });
    reloadedHost.adopt(persisted);
    const reloaded = reloadedHost.getSnapshot().activeSession?.taskState?.knownSlots.tailoringSession as typeof tailoringSession;
    expect(reloaded.plan.diffReviews?.find((review) => review.diffId === tailoringDiffId(diffA))?.status).toBe("accepted");
  });
});
