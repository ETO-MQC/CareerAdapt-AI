import {
  ProfileIntakeReviewProjectionSchema,
  type ProfileIntakeReviewCandidate,
  type ProfileIntakeReviewProjection
} from "@/domain/profileIntake/ProfileIntakeReviewProjection";

export type ProfileIntakeFinalizationDecision = {
  projection?: ProfileIntakeReviewProjection;
  autoAcceptCandidateIds: string[];
  unresolvedCandidateIds: string[];
  shouldReconcile: boolean;
  shouldCommit: boolean;
};

/**
 * Owns the deterministic end of Profile Intake. It can select only candidates
 * whose structured fields are already source-grounded; it never invents a
 * resolution for an uncertain or conflicting item.
 */
export class ProfileIntakeFinalizationSupervisor {
  isExplicitSaveIntent(text: string) {
    return /^(?:确认|完成整理并保存|完成整理并保存(?:到)?(?:个人)?资料库?|导入资料库|保存为经历档案|写入资料库|确认导入资料库|确认保存到资料库)[。！!]?$/u.test(
      text.trim()
    );
  }

  isFinalizationStage(stage: string) {
    return ["final_review", "reconcile_profile", "resolve_conflicts", "confirm_commit"].includes(stage);
  }

  decide(input: {
    text: string;
    stage: string;
    reviewProjection?: unknown;
    explicitCommit?: boolean;
  }): ProfileIntakeFinalizationDecision {
    const projection = ProfileIntakeReviewProjectionSchema.safeParse(input.reviewProjection);
    const parsed = projection.success ? projection.data : undefined;
    const autoAcceptCandidateIds = parsed
      ? parsed.candidates.filter(isSafeAutoAcceptCandidate).map((candidate) => candidate.id)
      : [];
    const unresolvedCandidateIds = parsed
      ? parsed.candidates
          .filter((candidate) => !["accepted", "ignored"].includes(candidate.status))
          .filter((candidate) => !autoAcceptCandidateIds.includes(candidate.id))
          .map((candidate) => candidate.id)
      : [];
    const explicitSave = input.explicitCommit === true || this.isExplicitSaveIntent(input.text);
    return {
      projection: parsed,
      autoAcceptCandidateIds,
      unresolvedCandidateIds,
      shouldReconcile: this.isFinalizationStage(input.stage) && Boolean(parsed),
      shouldCommit: explicitSave && this.isFinalizationStage(input.stage) && Boolean(parsed) && unresolvedCandidateIds.length === 0
    };
  }
}

export function isSafeAutoAcceptCandidate(candidate: ProfileIntakeReviewCandidate) {
  return candidate.status === "proposed"
    && Boolean(candidate.structuredItem)
    && candidate.canAccept
    && candidate.uncertainFields.length === 0
    && candidate.fieldEvidence.every((evidence) => evidence.needsConfirmation === false && evidence.support !== "uncertain");
}

export function profileIntakePersistenceReceipt(input: {
  operationId: string;
  commit: Record<string, unknown>;
  verification: Record<string, unknown>;
  verifiedAt: string;
}) {
  return {
    type: "profile_persistence_receipt" as const,
    operationId: input.operationId,
    targetProfileId: input.commit.profileId,
    newProfileVersion: input.commit.profileVersion,
    committedItemCount: input.commit.committedItemCount,
    committedFactCount: input.commit.committedFactCount,
    verifiedItemCount: input.verification.verifiedItemCount,
    verifiedAt: input.verifiedAt
  };
}
