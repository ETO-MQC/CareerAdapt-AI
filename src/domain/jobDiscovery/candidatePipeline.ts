/**
 * V4-P2-B 第一轮：本地确定性候选岗位闭环。
 *
 * 流水线：fixture 文本 → normalizeJd / 内容哈希 → 三级去重 → jobListings +
 * jobSnapshots → JobAnalysisDraft（raw_saved，无 AI）→ 用户确认 →
 * 既有 commitJobDraft → JobDescription → markJobListingConverted。
 *
 * 边界：
 * - 不访问网络、Hermes、cron、浏览器；输入只来自调用方（fixture）；
 * - 所有跨表写入经 WorkspaceRepository 事务；本模块只做纯逻辑与决策，
 *   不直接触碰 Dexie；
 * - 候选岗位不会自动成为正式岗位：转换必须由调用方显式传入
 *   userConfirmed: true 并走 repository.convertCandidateListing；
 * - 原文永不覆盖：snapshot.rawText 保存原文，contentHash 是规范化文本的
 *   版本化哈希（sha256-normalized-v1），sourceSpan 始终能回到原文。
 */

import {
  JD_NORMALIZER_VERSION,
  companyTitleFingerprint,
  jdContentHash,
  normalizeJd
} from "@/domain/jobAssets/jdNormalization";
import {
  findDuplicateCandidates,
  isValidDuplicateReference,
  type DedupDecision,
  type DedupExistingPosting
} from "@/domain/jobAssets/jobDeduplication";
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
  now?: string;
};

export type CandidateIngestResult = {
  status: "created" | "updated" | "unchanged" | "merged";
  listing: JobListing;
  snapshot: JobSnapshot;
  snapshotCreated: boolean;
  dedup: ReturnType<typeof findDuplicateCandidates>;
};

export type CandidateIngestWaiting = {
  status: "waiting_input";
  code: "duplicate_decision_required";
  dedup: ReturnType<typeof findDuplicateCandidates>;
};

function toDedupPosting(listing: JobListing): DedupExistingPosting {
  // 去重的"来源身份"轴是 (sourceKey, externalId)——与 jobListings 的唯一键一致。
  return {
    id: listing.id,
    sourceName: listing.sourceKey,
    sourceJobId: listing.externalId,
    title: listing.title,
    companyName: listing.company,
    companyTitleFingerprint: listing.companyTitleFingerprint,
    contentFingerprint: listing.contentFingerprint
  };
}

/**
 * 摄取一个确定性 fixture 岗位：规范化 → 哈希 → 三级去重 → upsert listing →
 * 追加 snapshot。重复摄取完全幂等；内容变化产生新 snapshot 版本并把
 * crawlState 标为 changed。
 */
export async function ingestCandidateFixture(
  repository: WorkspaceRepository,
  input: CandidateIngestInput
): Promise<CandidateIngestResult | CandidateIngestWaiting> {
  const now = input.now ?? new Date().toISOString();
  const normalized = normalizeJd(input.rawText);
  if (!normalized) throw new Error("candidate_jd_empty");
  const contentHash = jdContentHash(input.rawText);
  // listing 的 contentFingerprint 取"纯规范化内容哈希"：三级去重的 content
  // 规则据此才能命中"同 JD 正文、不同标题/公司"的重复（companyTitle 指纹
  // 保持 title+company 语义）。
  const contentFingerprintValue = contentHash;
  const companyTitleFingerprintValue = companyTitleFingerprint(input.title, input.company);

  const existing = await repository.listJobListings();
  // 幂等重试不是去重问题：同一 [sourceKey+externalId] 的 listing 是自身，
  // 必须排除在候选之外，否则重摄同一 fixture 会要求用户做无意义的合并决定。
  const dedupPool = existing.filter((listing) =>
    !(listing.sourceKey === input.sourceKey && listing.externalId === input.externalId));
  const evaluation = findDuplicateCandidates(
    dedupPool.map(toDedupPosting),
    {
      sourceName: input.sourceKey,
      sourceJobId: input.externalId,
      title: input.title,
      companyName: input.company,
      companyTitleFingerprint: companyTitleFingerprintValue,
      contentFingerprint: contentFingerprintValue
    }
  );
  if (evaluation.candidates.length > 0 && input.dedupDecision === undefined) {
    return { status: "waiting_input", code: "duplicate_decision_required", dedup: evaluation };
  }

  if (input.dedupDecision === "merge_existing") {
    const targetId = input.duplicateListingId ?? evaluation.candidates[0]?.jobPostingId;
    if (!targetId || !isValidDuplicateReference(evaluation, targetId)) {
      throw new Error("invalid_duplicate_reference");
    }
    const target = await repository.getJobListing(targetId);
    if (!target) throw new Error("listing_missing");
    // 合并语义：内容进入目标 listing 的 snapshot 历史，不新建岗位。
    const upsert = await repository.upsertJobListing({
      listing: {
        id: target.id,
        schemaVersion: "job-listing-v1",
        sourceKey: target.sourceKey,
        externalId: target.externalId,
        ...(input.canonicalSourceUrl ?? target.canonicalSourceUrl
          ? { canonicalSourceUrl: input.canonicalSourceUrl ?? target.canonicalSourceUrl }
          : {}),
        contentFingerprint: contentFingerprintValue,
        companyTitleFingerprint: companyTitleFingerprintValue,
        listingKind: target.listingKind,
        canonicalSourceKind: "external_job_source",
        title: input.title,
        company: input.company,
        ...(input.location ?? target.location ? { location: input.location ?? target.location } : {}),
        ...(input.salaryText ?? target.salaryText ? { salaryText: input.salaryText ?? target.salaryText } : {}),
        crawlState: target.crawlState,
        policyStatus: target.policyStatus,
        ...(target.blockedReason ? { blockedReason: target.blockedReason } : {})
      },
      now
    });
    const appended = await repository.appendJobSnapshot({
      jobListingId: target.id,
      rawText: input.rawText,
      contentHash,
      normalizerVersion: JD_NORMALIZER_VERSION,
      capturedBy: CANDIDATE_PIPELINE_VERSION,
      provenance: {
        sourceName: target.sourceKey,
        sourceKind: "external_job_source",
        operation: "candidate_fixture_merge",
        adapterId: CANDIDATE_PIPELINE_VERSION,
        adapterVersion: CANDIDATE_PIPELINE_VERSION,
        capturedAt: now
      },
      redactionStatus: "raw",
      capturedAt: now,
      now
    });
    const crawlState = appended.created ? "changed" : "unchanged";
    // 追加快照会更新 listing.latestSnapshotId；状态修正必须基于最新记录，
    // 不能用追加前的陈旧对象覆盖回去。
    const listing = crawlState === target.crawlState
      ? upsert.listing
      : (await repository.upsertJobListing({
        listing: { ...(await repository.getJobListing(target.id))!, crawlState },
        now
      })).listing;
    return {
      status: "merged",
      listing,
      snapshot: appended.snapshot,
      snapshotCreated: appended.created,
      dedup: evaluation
    };
  }

  // keep_separate 或无候选：按调用方身份 upsert（同 [sourceKey+externalId]
  // 的重复摄取在这里天然幂等）。
  const upsert = await repository.upsertJobListing({
    listing: {
      id: input.listingId ?? `listing_${crypto.randomUUID()}`,
      schemaVersion: "job-listing-v1",
      sourceKey: input.sourceKey,
      externalId: input.externalId,
      ...(input.canonicalSourceUrl ? { canonicalSourceUrl: input.canonicalSourceUrl } : {}),
      ...(input.applyUrl ? { applyUrl: input.applyUrl } : {}),
      contentFingerprint: contentFingerprintValue,
      companyTitleFingerprint: companyTitleFingerprintValue,
      listingKind: input.listingKind ?? "job_posting",
      canonicalSourceKind: "external_job_source",
      title: input.title,
      company: input.company,
      ...(input.location ? { location: input.location } : {}),
      ...(input.salaryText ? { salaryText: input.salaryText } : {}),
      ...(input.education ? { education: input.education } : {}),
      ...(input.experience ? { experience: input.experience } : {}),
      ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
      crawlState: "new",
      policyStatus: "allowed"
    },
    now
  });
  const appended = await repository.appendJobSnapshot({
    jobListingId: upsert.listing.id,
    rawText: input.rawText,
    contentHash,
    normalizerVersion: JD_NORMALIZER_VERSION,
    capturedBy: CANDIDATE_PIPELINE_VERSION,
    provenance: {
      sourceName: input.sourceKey,
      sourceKind: "external_job_source",
      operation: "candidate_fixture_ingest",
      adapterId: CANDIDATE_PIPELINE_VERSION,
      adapterVersion: CANDIDATE_PIPELINE_VERSION,
      capturedAt: now
    },
    redactionStatus: "raw",
    capturedAt: now,
    now
  });
  const status: CandidateIngestResult["status"] = upsert.created
    ? "created"
    : appended.created
      ? "updated"
      : "unchanged";
  const crawlState = upsert.created ? "new" : appended.created ? "changed" : "unchanged";
  // 同上：基于追加快照后的最新 listing 修正 crawlState，避免覆盖
  // latestSnapshotId。
  const listing = crawlState === upsert.listing.crawlState
    ? upsert.listing
    : (await repository.upsertJobListing({
      listing: { ...(await repository.getJobListing(upsert.listing.id))!, crawlState },
      now
    })).listing;
  return { status, listing, snapshot: appended.snapshot, snapshotCreated: appended.created, dedup: evaluation };
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
