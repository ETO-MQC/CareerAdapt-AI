/**
 * V4-P2-B：本地候选岗位闭环。
 *
 * 流水线：用户/Agent 提供的 JD 文本 → normalizeJd / 内容哈希 → 三级去重 →
 * jobListings + jobSnapshots → JobAnalysisDraft（raw_saved，无 AI）→
 * 用户核对 → ConversionConfirmation → repository.convertCandidateListing →
 * JobDescription → markJobListingConverted。
 *
 * 边界：
 * - 不访问网络、Hermes、cron、浏览器；输入只来自调用方；
 * - 所有跨表写入经 WorkspaceRepository 事务；本模块只做纯逻辑与决策，
 *   不直接触碰 Dexie；
 * - 候选岗位不会自动成为正式岗位：转换必须持有效的 ConversionConfirmation
 *   （用户在 UI 或 Agent 确认轮中明确批准后发放，单次消费）；
 * - 原文永不覆盖：snapshot.rawText 保存原文，contentHash 是规范化文本的
 *   版本化哈希（sha256-normalized-v1），sourceSpan 始终能回到原文。
 */

import {
  companyTitleFingerprint,
  jdContentHash,
  normalizeJd
} from "@/domain/jobAssets/jdNormalization";
import type { DedupDecision } from "@/domain/jobAssets/jobDeduplication";
import type { ListingKind } from "@/domain/schemas/jobDiscovery";
import type { JobListing, JobSnapshot } from "@/domain/schemas/jobDiscovery";
import type { WorkspaceRepository } from "@/services/storage/repositories";

export const CANDIDATE_PIPELINE_VERSION = "careeradapt-candidate-pipeline-v1";

/**
 * P2-B 第二轮：本地手动输入（用户粘贴 / Agent 接收用户提供 JD）的稳定身份。
 * 岗位身份 = 公司 + 标题指纹：同 (公司, 标题) 的重复输入落到同一 listing
 * （内容变化产生新 snapshot 版本，同内容完全幂等）；不同 (公司, 标题) 的
 * 相同正文是三级去重的候选，由用户决定合并或独立保存。
 */
export const MANUAL_JOB_SOURCE_KEY = "local.manual";

export function manualCandidateIdentity(title: string, company: string) {
  const fingerprint = companyTitleFingerprint(title, company);
  return {
    sourceKey: MANUAL_JOB_SOURCE_KEY,
    externalId: `manual-${fingerprint}`,
    listingId: `listing-manual-${fingerprint}`
  };
}

export type CandidateIngestInput = {
  sourceKey: string;
  externalId: string;
  /** 原始 JD 文本；原样进入 snapshot.rawText，永不改写。 */
  rawText: string;
  title: string;
  company: string;
  /** 新建 listing 时的 id；merge/幂等重试时忽略。 */
  listingId?: string;
  canonicalSourceUrl?: string;
  applyUrl?: string;
  listingKind?: ListingKind;
  location?: string;
  salaryText?: string;
  education?: string;
  experience?: string;
  publishedAt?: string;
  /** 三级去重命中时的用户决定；缺省返回 waiting_input。 */
  dedupDecision?: DedupDecision;
  duplicateListingId?: string;
  /** 失败注入点（测试）：缺省为 JD_NORMALIZER_VERSION。 */
  normalizerVersion?: string;
  now?: string;
};

export type CandidateIngestResult = {
  status: "created" | "updated" | "unchanged" | "merged";
  listing: JobListing;
  snapshot: JobSnapshot;
  snapshotCreated: boolean;
  dedup: { candidates: CandidateIngestCandidate[]; algorithm: "careeradapt-dedup-v1" };
};

export type CandidateIngestWaiting = {
  status: "waiting_input";
  code: "duplicate_decision_required";
  dedup: { candidates: CandidateIngestCandidate[]; algorithm: "careeradapt-dedup-v1" };
};

/**
 * 摄取一个候选岗位：规范化 → 哈希 → 三级去重 → 原子写入 listing →
 * 追加 snapshot。重复摄取完全幂等；内容变化产生新 snapshot 版本并把
 * crawlState 标为 changed。
 */
export type CandidateIngestCandidate = {
  jobPostingId: string;
  rule: "source_id" | "company_title" | "content";
  title: string;
  companyName: string;
};

/**
 * 摄取一个候选岗位：规范化 → 哈希 → 三级去重 → 原子写入 listing 与 snapshot。
 * 存储与决策应用全部在 Repository 的单个事务内完成（listing、snapshot、
 * latestSnapshotId、crawlState 不会半提交）；本函数只做纯逻辑与决策结果
 * 映射。重复摄取完全幂等；内容变化产生新 snapshot 版本并把 crawlState
 * 标为 changed。
 */
export async function ingestCandidateListing(
  repository: WorkspaceRepository,
  input: CandidateIngestInput
): Promise<CandidateIngestResult | CandidateIngestWaiting> {
  const normalized = normalizeJd(input.rawText);
  if (!normalized) throw new Error("candidate_jd_empty");
  const contentHash = jdContentHash(input.rawText);
  // listing 的 contentFingerprint 取"纯规范化内容哈希"：三级去重的 content
  // 规则据此才能命中"同 JD 正文、不同标题/公司"的重复（companyTitle 指纹
  // 保持 title+company 语义）。
  const result = await repository.ingestCandidateListing({
    sourceKey: input.sourceKey,
    externalId: input.externalId,
    ...(input.listingId ? { listingId: input.listingId } : {}),
    rawText: input.rawText,
    title: input.title,
    company: input.company,
    contentHash,
    contentFingerprint: contentHash,
    companyTitleFingerprint: companyTitleFingerprint(input.title, input.company),
    ...(input.canonicalSourceUrl ? { canonicalSourceUrl: input.canonicalSourceUrl } : {}),
    ...(input.applyUrl ? { applyUrl: input.applyUrl } : {}),
    ...(input.listingKind ? { listingKind: input.listingKind } : {}),
    ...(input.location ? { location: input.location } : {}),
    ...(input.salaryText ? { salaryText: input.salaryText } : {}),
    ...(input.education ? { education: input.education } : {}),
    ...(input.experience ? { experience: input.experience } : {}),
    ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
    ...(input.dedupDecision ? { dedupDecision: input.dedupDecision } : {}),
    ...(input.duplicateListingId ? { duplicateListingId: input.duplicateListingId } : {}),
    ...(input.normalizerVersion !== undefined ? { normalizerVersion: input.normalizerVersion } : {}),
    capturedBy: CANDIDATE_PIPELINE_VERSION,
    ...(input.now ? { now: input.now } : {})
  });
  if (result.status === "waiting_input") {
    return {
      status: "waiting_input",
      code: "duplicate_decision_required",
      dedup: { candidates: result.candidates, algorithm: "careeradapt-dedup-v1" }
    };
  }
  return {
    status: result.status,
    listing: result.listing,
    snapshot: result.snapshot,
    snapshotCreated: result.snapshotCreated,
    dedup: {
      candidates: [] as CandidateIngestCandidate[],
      algorithm: "careeradapt-dedup-v1"
    }
  };
}

export type CandidateParseResult = {
  draft: Awaited<ReturnType<WorkspaceRepository["createCandidateAnalysisDraft"]>>["draft"];
  rawInputId: string;
  reused: boolean;
};

/**
 * 候选岗位 → 分析草稿（raw_saved，无 AI）。复用 listing 上已绑定的草稿；
 * 原文与规范化元数据经 listing.parsedSnapshotId → jobSnapshots 追溯。
 */
export async function parseCandidateToDraft(
  repository: WorkspaceRepository,
  input: { listingId: string; snapshotId?: string; draftId: string; promptVersion?: string; now?: string }
): Promise<CandidateParseResult> {
  const result = await repository.createCandidateAnalysisDraft({
    listingId: input.listingId,
    snapshotId: input.snapshotId,
    draftId: input.draftId,
    promptVersion: input.promptVersion,
    now: input.now
  });
  return { draft: result.draft, rawInputId: result.rawInputId, reused: result.reused };
}
