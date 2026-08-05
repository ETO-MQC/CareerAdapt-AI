import type { AgentTaskState } from "@/agent/contracts/agentSession";
import {
  ProfileIntakeReviewProjectionSchema,
  type ProfileIntakeReviewProjection
} from "@/domain/profileIntake/ProfileIntakeReviewProjection";

export type AlignmentObservation = { toolName: string; value: unknown };

export type ConversationAlignmentInput = {
  text: string;
  taskState: AgentTaskState;
  observations?: AlignmentObservation[];
  reviewProjection?: unknown;
  persistenceReceipt?: unknown;
  sourceTurns?: Array<{ processingStatus: string }>;
  deferredSourceTurnIds?: string[];
  narrationOnly?: boolean;
};

export type ConversationAlignmentResult =
  | { aligned: true }
  | { aligned: false; safeErrorCode: string; diagnostic: Record<string, unknown> };

const INTAKE_DIMENSION_STAGES = new Set([
  "resolve_profile_target",
  "failed",
  "structure_facts",
  "review_facts"
]);

/**
 * The final answer is a projection of authoritative state, never an
 * independent workflow.  This guard runs immediately before an answer is
 * persisted or streamed to the user.
 */
export class AuthoritativeConversationAlignmentGuard {
  validate(input: ConversationAlignmentInput): ConversationAlignmentResult {
    const text = input.text.trim();
    const projection = parseProjection(input.reviewProjection ?? input.taskState.knownSlots.profileIntakeReviewProjection);
    const observations = input.observations ?? [];

    if (input.narrationOnly && asksNewWorkflowQuestion(text)) {
      return this.block("narration_regeneration_advanced_workflow", input, { projection });
    }
    if (
      input.taskState.workflowId === "guided_profile_intake"
      && INTAKE_DIMENSION_STAGES.has(input.taskState.stage)
      && asksNextIntakeDimension(text)
    ) {
      return this.block("question_stage_mismatch", input, { projection });
    }

    const candidateCount = claimedCandidateCount(text);
    if (candidateCount !== undefined && (!projection || projection.candidates.length !== candidateCount)) {
      return this.block("candidate_count_unaligned", input, {
        claimedCandidateCount: candidateCount,
        actualCandidateCount: projection?.candidates.length
      });
    }

    if (/档案已整理完成/u.test(text)) {
      const finalReviewRevision = projection?.finalReviewRevision ?? numberValue(input.taskState.knownSlots.finalReviewRevision);
      if (!projection || finalReviewRevision === undefined || !allCandidatesReviewed(projection) || hasUnprocessedSourceTurn(input)) {
        return this.block("final_review_incomplete", input, {
          hasProjection: Boolean(projection),
          finalReviewRevision,
          allCandidatesReviewed: projection ? allCandidatesReviewed(projection) : false
        });
      }
    }

    if (claimsAutosave(text) && !hasPersistenceReceipt(input.persistenceReceipt, observations)) {
      return this.block("autosave_receipt_missing", input);
    }

    if (claimsProfileWrite(text) && !hasVerifiedProfileCommit(observations, input.taskState)) {
      return this.block("profile_commit_verification_missing", input);
    }

    return { aligned: true };
  }

  safeDiagnostic(result: ConversationAlignmentResult) {
    return result.aligned ? undefined : result.diagnostic;
  }

  private block(code: string, input: ConversationAlignmentInput, extra: Record<string, unknown> = {}): ConversationAlignmentResult {
    return {
      aligned: false,
      safeErrorCode: code,
      diagnostic: {
        safeErrorCode: code,
        workflowId: input.taskState.workflowId,
        stage: input.taskState.stage,
        ...extra
      }
    };
  }
}

export function allCandidatesReviewed(projection: ProfileIntakeReviewProjection) {
  return projection.candidates.every((candidate) => candidate.status === "accepted" || candidate.status === "ignored")
    && projection.reviewProgress.proposed === 0
    && projection.reviewProgress.uncertain === 0
    && projection.reviewProgress.reviewed >= projection.reviewProgress.total;
}

function parseProjection(value: unknown) {
  const parsed = ProfileIntakeReviewProjectionSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function claimedCandidateCount(text: string) {
  const match = text.match(/(?:整理出|识别出|发现|提取出)\s*(\d+)\s*(?:项|条)(?:经历|候选|内容)?/u);
  return match ? Number(match[1]) : undefined;
}

function claimsAutosave(text: string) {
  return /(?:自动保存|已保存到本地|草稿(?:已)?保存|本地(?:已)?保存)/u.test(text);
}

function claimsProfileWrite(text: string) {
  return /(?:已|已经)(?:成功)?(?:保存|导入|更新|写入|创建)(?:到)?(?:个人资料库|资料库|档案|简历)/u.test(text)
    || /(?:^|[。；;\s])已保存(?:[。；;\s]|$)/u.test(text)
    || /档案已整理完成/u.test(text);
}

function hasPersistenceReceipt(receipt: unknown, observations: AlignmentObservation[]) {
  const values = [receipt, ...observations.map((observation) => observation.value)];
  return values.some((value) => {
    const record = objectValue(value);
    const candidate = objectValue(record.persistenceReceipt);
    return typeof candidate.autosavedAt === "string" && typeof candidate.resumeToken === "string";
  });
}

function hasVerifiedProfileCommit(observations: AlignmentObservation[], taskState: AgentTaskState) {
  const commit = observations.find((observation) => observation.toolName === "commit_profile_intake");
  if (!commit) {
    const committed = objectValue(taskState.knownSlots.profileCommitResult);
    const verification = objectValue(taskState.knownSlots.profileCommitVerification);
    return typeof committed.profileId === "string"
      && typeof committed.profileVersion === "number"
      && verification.profileId === committed.profileId
      && verification.profileVersion === committed.profileVersion;
  }
  const commitValue = objectValue(commit.value);
  const profileId = stringValue(commitValue.profileId);
  const profileVersion = numberValue(commitValue.profileVersion);
  if (!profileId || profileVersion === undefined) return false;
  return observations.some((observation) => {
    if (observation.toolName !== "get_profile") return false;
    const profile = objectValue(objectValue(observation.value).profile);
    return profile.id === profileId && numberValue(profile.version) === profileVersion;
  });
}

function hasUnprocessedSourceTurn(input: ConversationAlignmentInput) {
  return (input.sourceTurns ?? []).some((turn) =>
    ["journaled", "structuring", "failed"].includes(turn.processingStatus)
  );
}

function asksNewWorkflowQuestion(text: string) {
  return /[？?]/u.test(text)
    || /请(?:告诉|补充|选择|继续|回答)|下一步|继续整理|继续补充/u.test(text);
}

function asksNextIntakeDimension(text: string) {
  return asksNewWorkflowQuestion(text)
    && /教育|实习|项目|研究|校园|技能|证书|奖项|经历|你本人|承担|使用了什么|结果/u.test(text);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
