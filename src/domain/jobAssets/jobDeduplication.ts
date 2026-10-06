/**
 * V4-P1 阶段 2：三级去重（source_id / company_title / content）。
 *
 * Adapted from MyCareer (https://github.com/low-hands/MyCareer),
 * MIT License, Copyright (c) 2026 Rui Guo — storage/memory.py find_duplicates
 * 与 domain/job_discovery/models.py 的 DuplicateCandidate。
 *
 * 纯逻辑：不查存储、不发网络请求。已有岗位以指纹（阶段 1 产出）形式传入，
 * 由调用方（V4-P2 起的 Repository/管道）负责持久化与用户确认。
 * 判定规则与参考实现逐条对应：对每个已有岗位，按 source_id → company_title →
 * content 的顺序取第一条命中的规则，一个候选只报告一个规则。
 */

export const DEDUPLICATION_ALGORITHM = "careeradapt-dedup-v1";

export type DedupRule = "source_id" | "company_title" | "content";

export type DedupDecision = "merge_existing" | "keep_separate";

/** 已有岗位在去重比较中的最小投影。指纹由 jdNormalization 的版本化函数计算。 */
export type DedupExistingPosting = {
  id: string;
  sourceName: string;
  sourceJobId?: string;
  title: string;
  companyName: string;
  companyTitleFingerprint: string;
  contentFingerprint: string;
};

/** 传入（待评估）岗位在去重比较中的最小投影。 */
export type DedupIncomingPosting = {
  sourceName: string;
  sourceJobId?: string;
  title: string;
  companyName: string;
  companyTitleFingerprint: string;
  contentFingerprint: string;
};

export type DuplicateCandidate = {
  jobPostingId: string;
  rule: DedupRule;
  title: string;
  companyName: string;
};

export type DuplicateEvaluation = {
  candidates: DuplicateCandidate[];
  /** 候选所用的输入指纹与算法版本，便于诊断与回归。 */
  algorithm: typeof DEDUPLICATION_ALGORITHM;
};

/**
 * 三级去重。规则顺序即优先级：同一来源的同一 source_job_id 最强，
 * 其次是公司+标题指纹，最后是内容指纹。候选按传入的已有岗位顺序返回。
 */
export function findDuplicateCandidates(
  existing: readonly DedupExistingPosting[],
  incoming: DedupIncomingPosting
): DuplicateEvaluation {
  const candidates: DuplicateCandidate[] = [];
  for (const posting of existing) {
    if (incoming.sourceJobId
      && posting.sourceJobId === incoming.sourceJobId
      && posting.sourceName === incoming.sourceName) {
      candidates.push({
        jobPostingId: posting.id,
        rule: "source_id",
        title: posting.title,
        companyName: posting.companyName
      });
      continue;
    }
    if (posting.companyTitleFingerprint === incoming.companyTitleFingerprint) {
      candidates.push({
        jobPostingId: posting.id,
        rule: "company_title",
        title: posting.title,
        companyName: posting.companyName
      });
      continue;
    }
    if (posting.contentFingerprint === incoming.contentFingerprint) {
      candidates.push({
        jobPostingId: posting.id,
        rule: "content",
        title: posting.title,
        companyName: posting.companyName
      });
    }
  }
  return { candidates, algorithm: DEDUPLICATION_ALGORITHM };
}

/**
 * 去重决定所需的最少证据：只要存在任何候选，就必须由用户在
 * merge_existing / keep_separate 之间做出选择；这是 V4-P2 确认流程的
 * 纯逻辑前置，不允许默认合并。
 */
export function requiresDuplicateDecision(evaluation: DuplicateEvaluation): boolean {
  return evaluation.candidates.length > 0;
}

/** merge_existing 时校验引用的候选确实在候选列表中。 */
export function isValidDuplicateReference(
  evaluation: DuplicateEvaluation,
  jobPostingId: string
): boolean {
  return evaluation.candidates.some((candidate) => candidate.jobPostingId === jobPostingId);
}
