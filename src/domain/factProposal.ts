import { z } from "zod";
import { EntityBaseSchema, FactProvenanceSchema, IsoDateStringSchema } from "@/domain/schemas/common";

/**
 * V4-P1 前置 + 阶段资产：Fact Proposal（v4-plan.md §7.5）。
 *
 * 岗位匹配发现事实缺口时产生的待确认提议。它是"事实之前"的结构：只有
 * `userConfirmed === true` 的提议内容才允许进入岗位分支预览；同步个人资料库
 * 必须另有明确操作（scope 为 profile_sync_candidate 时也不例外），该同步
 * 流程不属于本纯逻辑资产。
 *
 * expiresAt 语义（V4-P1 前置 2 的正式决定——实现过期机制，不再隐式缺失）：
 * - 提议必须带 `expiresAt`，无法构造无过期时间的提议；
 * - `expiresAt` 必须严格晚于 `createdAt`；
 * - 过期提议不可被确认（`confirmFactProposal` 拒绝），只能被丢弃或重建；
 * - 未显式给定时，工厂按 `FACT_PROPOSAL_DEFAULT_TTL_DAYS`（30 天）计算；
 * - 过期判定 `factProposalExpired` 是纯时间比较，不依赖存储或时钟。
 */

export const FactProposalTypeSchema = z.enum([
  "missing_skill",
  "missing_experience",
  "missing_certificate",
  "missing_education",
  "clarification"
]);

export const FactProposalScopeSchema = z.enum(["job_specific", "profile_sync_candidate"]);

export const FACT_PROPOSAL_DEFAULT_TTL_DAYS = 30;

export const FactProposalSchema = EntityBaseSchema.extend({
  schemaVersion: z.literal("fact-proposal-v1"),
  proposalType: FactProposalTypeSchema,
  question: z.string().min(1).max(500),
  relatedRequirementId: z.string().min(1).optional(),
  candidateAnswer: z.string().max(2000).default(""),
  userConfirmed: z.boolean(),
  provenance: z.array(FactProvenanceSchema).min(1),
  scope: FactProposalScopeSchema,
  createdAt: IsoDateStringSchema,
  expiresAt: IsoDateStringSchema
}).strict().superRefine((proposal, context) => {
  if (new Date(proposal.expiresAt).getTime() <= new Date(proposal.createdAt).getTime()) {
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "fact proposal expiry must follow creation"
    });
  }
  if (proposal.proposalType !== "clarification" && !proposal.relatedRequirementId) {
    context.addIssue({
      code: "custom",
      path: ["relatedRequirementId"],
      message: "gap proposals must reference the requirement they fill"
    });
  }
  if (proposal.proposalType === "clarification" && proposal.relatedRequirementId) {
    context.addIssue({
      code: "custom",
      path: ["relatedRequirementId"],
      message: "clarification proposals are not tied to a single requirement"
    });
  }
  if (proposal.userConfirmed && !proposal.candidateAnswer.trim()) {
    context.addIssue({
      code: "custom",
      path: ["candidateAnswer"],
      message: "confirmed proposals carry the user's answer"
    });
  }
});

export type FactProposal = z.infer<typeof FactProposalSchema>;
export type FactProposalType = z.infer<typeof FactProposalTypeSchema>;
export type FactProposalScope = z.infer<typeof FactProposalScopeSchema>;

export const FACT_PROPOSAL_ERROR_CODES = [
  "fact_proposal_expired",
  "fact_proposal_already_confirmed",
  "fact_proposal_answer_required"
] as const;

export type FactProposalErrorCode = (typeof FACT_PROPOSAL_ERROR_CODES)[number];

export type FactProposalConfirmResult =
  | { ok: true; proposal: FactProposal }
  | { ok: false; code: FactProposalErrorCode };

export function factProposalExpired(proposal: FactProposal, at: string): boolean {
  return new Date(at).getTime() >= new Date(proposal.expiresAt).getTime();
}

/** 确认提议：过期或已确认即拒绝；确认必须携带（或已有）候选答案。 */
export function confirmFactProposal(
  proposal: FactProposal,
  input: { at: string; answer?: string }
): FactProposalConfirmResult {
  if (factProposalExpired(proposal, input.at)) return { ok: false, code: "fact_proposal_expired" };
  if (proposal.userConfirmed) return { ok: false, code: "fact_proposal_already_confirmed" };
  const answer = input.answer?.trim() ?? proposal.candidateAnswer.trim();
  if (!answer) return { ok: false, code: "fact_proposal_answer_required" };
  return {
    ok: true,
    proposal: {
      ...proposal,
      userConfirmed: true,
      candidateAnswer: answer
    }
  };
}

/** 仅允许确认后的提议内容进入岗位分支预览的判断依据。 */
export function factProposalRenderable(proposal: FactProposal, at: string): boolean {
  return proposal.userConfirmed && !factProposalExpired(proposal, at);
}

export type CreateFactProposalInput = {
  proposalType: FactProposalType;
  question: string;
  relatedRequirementId?: string;
  candidateAnswer?: string;
  provenance: FactProposal["provenance"];
  scope: FactProposalScope;
  /** ISO 字符串；缺省时由 now + 默认 TTL 计算 */
  expiresAt?: string;
  id: string;
};

/** 纯工厂：时间由调用方注入（now），不读取时钟。 */
export function createFactProposal(
  input: CreateFactProposalInput,
  options: { now: string }
): FactProposal {
  const now = options.now;
  const expiresAt = input.expiresAt
    ?? new Date(new Date(now).getTime() + FACT_PROPOSAL_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const proposal: FactProposal = {
    id: input.id,
    createdAt: now,
    updatedAt: now,
    schemaVersion: "fact-proposal-v1",
    proposalType: input.proposalType,
    question: input.question,
    ...(input.relatedRequirementId ? { relatedRequirementId: input.relatedRequirementId } : {}),
    candidateAnswer: input.candidateAnswer ?? "",
    userConfirmed: false,
    provenance: input.provenance,
    scope: input.scope,
    expiresAt
  };
  const parsed = FactProposalSchema.safeParse(proposal);
  if (!parsed.success) {
    throw new Error(`fact_proposal_invalid: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}:${issue.message}`).join("; ")}`);
  }
  return parsed.data;
}
