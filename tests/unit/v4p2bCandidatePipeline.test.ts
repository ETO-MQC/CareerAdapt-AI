import { afterEach, describe, expect, it } from "vitest";
import {
  ingestCandidateFixture,
  parseCandidateToDraft,
  CANDIDATE_PIPELINE_VERSION
} from "@/domain/jobDiscovery/candidatePipeline";
import { companyTitleFingerprint, jdContentHash } from "@/domain/jobAssets/jdNormalization";
import { JobAnalysisDraftSchema, JdAnalyzerRequirementSchema } from "@/domain/schemas";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { analyzeJobDescriptionV4 } from "@/domain/jobOptimization";
import { stableHashText } from "@/services/security/text";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

const NOW = "2026-10-06T00:00:00.000Z";
const LATER = "2026-10-07T00:00:00.000Z";
const EVEN_LATER = "2026-10-09T00:00:00.000Z";

const JD_A = "职责：\n负责 Go 后端服务开发。\n要求：\n3 年以上经验。";
const JD_A_WHITESPACE_VARIANT = "职责：  \n负责  Go 后端服务开发。\n要求：\n3 年以上经验。  ";
const JD_B = "职责：\n负责 Go 后端服务开发。\n要求：\n3 年以上经验。\n加分：熟悉 Kubernetes。";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  if (!db) return;
  db.close();
  await db.delete();
  db = undefined;
});

function makeDb(name?: string): { db: CareerAdaptDb; repository: WorkspaceRepository } {
  db = new CareerAdaptDb(name ?? `careeradapt-v4p2b-${crypto.randomUUID()}`);
  return { db, repository: new WorkspaceRepository(db) };
}

function fixtureInput(overrides: Record<string, unknown> = {}) {
  return {
    sourceKey: "fixture.board",
    externalId: "job-001",
    listingId: "listing_a",
    rawText: JD_A,
    title: "Go 工程师",
    company: "Acme",
    now: NOW,
    ...overrides
  };
}

function confirmedRequirementFixture() {
  return JdAnalyzerRequirementSchema.parse({
    id: "req-1",
    createdAt: LATER,
    updatedAt: LATER,
    category: "required_skill",
    description: "3 年以上 Go 后端经验",
    priority: "must",
    hardConstraint: true,
    sourceQuote: "3 年以上经验。",
    sourceSpan: { start: JD_A.indexOf("3 年以上经验。"), end: JD_A.indexOf("3 年以上经验。") + "3 年以上经验。".length, text: "3 年以上经验。" },
    keywords: ["Go"],
    confidenceLevel: "high",
    confidenceReason: "JD 原文明确写出",
    needsConfirmation: false,
    confirmedByUser: true
  });
}

type IngestResult = Exclude<Awaited<ReturnType<typeof ingestCandidateFixture>>, { status: "waiting_input" }>;

async function ingestA(repository: WorkspaceRepository): Promise<IngestResult> {
  const result = await ingestCandidateFixture(repository, fixtureInput());
  if (result.status === "waiting_input") throw new Error("expected ingest to succeed");
  return result;
}

/** P2-B 第二轮：把 raw_saved 草稿推进到"已分析、已核对"的可提交状态。 */
async function prepareReviewedDraft(repository: WorkspaceRepository) {
  const draft = await repository.getJobAnalysisDraft("draft_a");
  if (!draft) throw new Error("draft_missing");
  const analyzed = JobAnalysisDraftSchema.parse({
    ...draft,
    status: "editing",
    manualRequirements: [confirmedRequirementFixture()],
    analysisRunStatus: "review_ready",
    updatedAt: LATER
  });
  return repository.saveJobAnalysisDraftRevision(analyzed, draft.revision);
}

async function createConfirmationA(repository: WorkspaceRepository, overrides: Record<string, unknown> = {}) {
  return repository.createConversionConfirmation({
    channel: "jobs_workspace",
    operationId: "op_convert_a",
    listingId: "listing_a",
    draftId: "draft_a",
    now: LATER,
    ...overrides
  });
}

async function convertA(repository: WorkspaceRepository, overrides: Record<string, unknown> = {}) {
  const confirmation = overrides.confirmation instanceof Object
    ? (overrides.confirmation as Awaited<ReturnType<typeof createConfirmationA>>)
    : await createConfirmationA(repository);
  const rest = { ...overrides };
  delete rest.confirmation;
  return repository.convertCandidateListing({
    listingId: "listing_a",
    draftId: "draft_a",
    commitId: "commit_a",
    confirmationId: confirmation.confirmationId,
    now: LATER,
    ...rest
  });
}

describe("V4-P2-B stage 1-2: deterministic ingest (normalize, hash, dedupe, snapshot, listing)", () => {
  it("ingests a fixture into jobListings + jobSnapshots with versioned hashes and preserved rawText", async () => {
    const { repository } = makeDb();
    const result = await ingestA(repository);
    expect(result.status).toBe("created");
    expect(result.listing.canonicalSourceKind).toBe("external_job_source");
    expect(result.listing.contentFingerprint).toBe(jdContentHash(JD_A));
    expect(result.listing.companyTitleFingerprint).toBe(companyTitleFingerprint("Go 工程师", "Acme"));
    expect(result.snapshotCreated).toBe(true);
    expect(result.snapshot.version).toBe(1);
    // 原文不被覆盖：快照保存原始文本，哈希是规范化文本的版本化哈希。
    expect(result.snapshot.rawText).toBe(JD_A);
    expect(result.snapshot.contentHash).toBe(jdContentHash(JD_A));
    expect(result.snapshot.normalizerVersion).toBe("careeradapt-jd-normalizer-v1");
    expect(result.snapshot.provenance.adapterId).toBe(CANDIDATE_PIPELINE_VERSION);
    expect(result.snapshot.provenance.sourceKind).toBe("external_job_source");
  });

  it("is idempotent on retry: same fixture yields the same listing, same snapshot, no new version", async () => {
    const { repository } = makeDb();
    const first = await ingestA(repository);
    const second = await ingestA(repository);
    expect(second.status).toBe("unchanged");
    expect(second.listing.id).toBe(first.listing.id);
    expect(second.snapshot.id).toBe(first.snapshot.id);
    expect(second.snapshot.version).toBe(1);
    expect(second.snapshotCreated).toBe(false);
  });

  it("treats whitespace-only variants as the same content (normalized hash idempotency)", async () => {
    // 变体只改行内空白与首尾空白，不改段落结构（空行是内容的一部分，
    // 规范化器有意保留，sourceSpan 才能回到原文）。
    const { repository } = makeDb();
    await ingestA(repository);
    const variant = await ingestCandidateFixture(repository, fixtureInput({ rawText: JD_A_WHITESPACE_VARIANT }));
    expect(variant.status).toBe("unchanged");
    if (variant.status === "waiting_input") throw new Error("expected ingest to succeed");
    expect(variant.snapshot.version).toBe(1);
    expect(variant.snapshotCreated).toBe(false);
  });

  it("produces a new snapshot version and marks crawlState=changed when content changes", async () => {
    const { repository } = makeDb();
    await ingestA(repository);
    const changed = await ingestCandidateFixture(repository, fixtureInput({ rawText: JD_B }));
    expect(changed.status).toBe("updated");
    if (changed.status === "waiting_input") throw new Error("expected ingest to succeed");
    expect(changed.snapshot.version).toBe(2);
    expect(changed.snapshotCreated).toBe(true);
    expect(changed.snapshot.contentHash).toBe(jdContentHash(JD_B));
    expect(changed.listing.crawlState).toBe("changed");
    expect(changed.listing.latestSnapshotId).toBe(changed.snapshot.id);
  });

  it("asks for a user decision when the same content arrives under a new external id", async () => {
    const { repository } = makeDb();
    await ingestA(repository);
    const waiting = await ingestCandidateFixture(repository, fixtureInput({
      listingId: "listing_b",
      externalId: "job-002"
    }));
    expect(waiting.status).toBe("waiting_input");
    if (waiting.status !== "waiting_input") throw new Error("expected waiting_input");
    expect(waiting.code).toBe("duplicate_decision_required");
    expect(waiting.dedup.candidates[0]).toMatchObject({ jobPostingId: "listing_a", rule: "company_title" });
    expect(await repository.listJobListings()).toHaveLength(1);
  });

  it("merges into the existing listing on merge_existing without creating a second listing", async () => {
    const { repository } = makeDb();
    await ingestA(repository);
    const merged = await ingestCandidateFixture(repository, fixtureInput({
      listingId: "listing_b",
      externalId: "job-002",
      dedupDecision: "merge_existing"
    }));
    expect(merged.status).toBe("merged");
    if (merged.status === "waiting_input") throw new Error("expected merge to succeed");
    expect(merged.listing.id).toBe("listing_a");
    // 同内容合并进已有 listing：快照幂等，不产生新版本。
    expect(merged.snapshot.version).toBe(1);
    expect(merged.snapshotCreated).toBe(false);
    expect(await repository.listJobListings()).toHaveLength(1);
    await expect(ingestCandidateFixture(repository, fixtureInput({
      listingId: "listing_c",
      externalId: "job-003",
      dedupDecision: "merge_existing",
      duplicateListingId: "listing_unknown"
    }))).rejects.toThrow("invalid_duplicate_reference");
  });

  it("creates a separate listing on keep_separate", async () => {
    const { repository } = makeDb();
    await ingestA(repository);
    const separate = await ingestCandidateFixture(repository, fixtureInput({
      listingId: "listing_b",
      externalId: "job-002",
      dedupDecision: "keep_separate"
    }));
    expect(separate.status).toBe("created");
    if (separate.status === "waiting_input") throw new Error("expected ingest to succeed");
    expect(separate.listing.id).toBe("listing_b");
    expect(separate.snapshot.version).toBe(1);
    expect(await repository.listJobListings()).toHaveLength(2);
  });
});

describe("V4-P2-B stage 3-5: draft, user-confirmed conversion, no half-commit", () => {
  it("creates a raw_saved analysis draft once and reuses it on later calls, keeping the traceability chain", async () => {
    const { repository } = makeDb();
    const ingested = await ingestA(repository);
    const first = await parseCandidateToDraft(repository, {
      listingId: ingested.listing.id, snapshotId: ingested.snapshot.id, draftId: "draft_a", now: LATER
    });
    expect(first.reused).toBe(false);
    expect(first.draft.status).toBe("raw_saved");
    expect(first.draft.revision).toBe(0);
    expect(first.draft.promptVersion).toBe(CANDIDATE_PIPELINE_VERSION);

    const rawInput = await repository.getRawInput(first.rawInputId);
    expect(rawInput?.kind).toBe("job_jd");
    expect(rawInput?.rawText).toBe(JD_A);
    expect(rawInput?.inputHash).toBe(jdContentHash(JD_A));

    const second = await parseCandidateToDraft(repository, {
      listingId: ingested.listing.id, draftId: "draft_other", now: EVEN_LATER
    });
    expect(second.reused).toBe(true);
    expect(second.draft.id).toBe(first.draft.id);

    const listing = await repository.getJobListing(ingested.listing.id);
    expect(listing?.analysisDraftId).toBe(first.draft.id);
    expect(listing?.parsedSnapshotId).toBe(ingested.snapshot.id);
  });

  it("refuses conversion without a real confirmation record and writes nothing", async () => {
    const { repository } = makeDb();
    const ingested = await ingestA(repository);
    await parseCandidateToDraft(repository, { listingId: ingested.listing.id, draftId: "draft_a", now: LATER });
    await prepareReviewedDraft(repository);

    // 不存在确认记录时无法转换：userConfirmed 布尔不再是有效确认依据。
    await expect(repository.convertCandidateListing({
      listingId: ingested.listing.id,
      draftId: "draft_a",
      commitId: "commit_a",
      confirmationId: "convconf_missing",
      now: LATER
    })).rejects.toThrow("conversion_confirmation_missing");

    expect(await repository.getJobDescription("job_a")).toBeUndefined();
    const listing = await repository.getJobListing(ingested.listing.id);
    expect(listing?.jobDescriptionId).toBeUndefined();
    expect(listing?.convertedAt).toBeUndefined();
  });

  it("refuses to hand out or use a conversion confirmation for a raw_saved draft", async () => {
    const { repository } = makeDb();
    const ingested = await ingestA(repository);
    await parseCandidateToDraft(repository, { listingId: ingested.listing.id, draftId: "draft_a", now: LATER });

    // 创建确认时即拒绝不可提交状态（raw_saved 未完成分析核对）。
    await expect(createConfirmationA(repository)).rejects.toThrow("尚未完成分析与用户核对");
    expect(await repository.getJobDescription("job_a")).toBeUndefined();
  });

  it("converts atomically after user review: DraftCommit, JobDescription, and listing conversion together", async () => {
    const { db: database, repository } = makeDb();
    const ingested = await ingestA(repository);
    await parseCandidateToDraft(repository, { listingId: ingested.listing.id, draftId: "draft_a", now: LATER });
    const reviewed = await prepareReviewedDraft(repository);

    const profilesBefore = await database.profiles.toArray();
    const converted = await convertA(repository);
    // 资料库零写入：候选岗位管道与转换不触碰个人资料库。
    const profilesAfter = await database.profiles.toArray();
    expect(profilesAfter).toEqual(profilesBefore);

    expect(converted.idempotent).toBe(false);
    // 正式岗位由 mapJobDraftToJobDescription 从草稿生成：只包含用户核对过的要求。
    expect(converted.jobDescription.rawText).toBe(JD_A);
    expect(converted.jobDescription.requirements).toHaveLength(1);
    expect(converted.jobDescription.requirements[0].description).toBe("3 年以上 Go 后端经验");
    expect(converted.jobDescription.source).toBe("imported_text");
    expect(converted.commit.kind).toBe("job");
    expect(converted.commit.entityId).toBe(converted.jobDescription.id);
    expect(converted.listing.jobDescriptionId).toBe(converted.jobDescription.id);
    expect(converted.listing.convertedAt).toBe(LATER);
    expect(converted.draft.status).toBe("committed");
    expect(converted.draft.revision).toBe(reviewed.revision + 1);
  });

  it("is idempotent on conversion retry with the same consumed confirmation and commitId", async () => {
    const { repository } = makeDb();
    const ingested = await ingestA(repository);
    await parseCandidateToDraft(repository, { listingId: ingested.listing.id, draftId: "draft_a", now: LATER });
    await prepareReviewedDraft(repository);
    const confirmation = await createConfirmationA(repository);
    const first = await convertA(repository, { confirmation });
    expect(first.idempotent).toBe(false);
    // 同一 commitId 的重试：consumed 确认幂等重放，不产生第二个岗位。
    const retry = await convertA(repository, { confirmation });
    expect(retry.idempotent).toBe(true);
    expect(retry.jobDescription.id).toBe(first.jobDescription.id);
    expect((await repository.listJobDescriptions()).filter((job) => job.id === first.jobDescription.id)).toHaveLength(1);
  });

  it("rolls back the whole conversion when the draft changes after the confirmation (no half-commit)", async () => {
    const { repository } = makeDb();
    const ingested = await ingestA(repository);
    await parseCandidateToDraft(repository, { listingId: ingested.listing.id, draftId: "draft_a", now: LATER });
    await prepareReviewedDraft(repository);
    const confirmation = await createConfirmationA(repository);

    // 确认之后草稿又发生变化（revision 前进）：内容指纹失效，整个事务回滚。
    const current = await repository.getJobAnalysisDraft("draft_a");
    await repository.saveJobAnalysisDraftRevision({ ...JobAnalysisDraftSchema.parse(current), updatedAt: EVEN_LATER }, current!.revision);

    await expect(convertA(repository, { confirmation })).rejects.toThrow("conversion_confirmation_stale_content");
    expect(await repository.getJobDescription("job_a")).toBeUndefined();
    const listing = await repository.getJobListing(ingested.listing.id);
    expect(listing?.jobDescriptionId).toBeUndefined();
    expect(listing?.convertedAt).toBeUndefined();
    // 确认记录随事务回滚，仍是 pending：修正内容后可重新消费。
    const stillOpen = await repository.findOpenConversionConfirmations("draft_a", LATER);
    expect(stillOpen.map((item) => item.confirmationId)).toContain(confirmation.confirmationId);
  });

  it("runs the consume → formal write → complete chain in one multi-table transaction", async () => {
    const { repository } = makeDb();
    const ingested = await ingestA(repository);
    await parseCandidateToDraft(repository, { listingId: ingested.listing.id, draftId: "draft_a", now: LATER });

    const proposal = await repository.createPendingConfirmation({
      proposal: {
        id: "proposal_conv",
        proposalType: "missing_skill",
        question: "你是否有 Go 生产环境经验？",
        relatedRequirementId: "req-go",
        provenance: [{
          sourceType: "ai_suggestion", sourceId: "job-analysis:draft_a", sourceText: "JD 要求 3 年以上经验",
          confidence: 0.9, confirmedByUser: false, riskLevel: "low", createdAt: NOW
        }],
        scope: "job_specific"
      },
      now: NOW
    });

    await prepareReviewedDraft(repository);
    const confirmation = await createConfirmationA(repository);
    const converted = await convertA(repository, {
      confirmation,
      pendingProposal: { proposalId: proposal.id, answer: "有三年经验", at: LATER }
    });
    expect(converted.consumedProposal?.candidateAnswer).toBe("有三年经验");
    // 多表事务一次落位：草稿已提交、岗位已建、候选已转换、确认已消费。
    expect(converted.draft.status).toBe("committed");
    expect(converted.listing.jobDescriptionId).toBe(converted.jobDescription.id);
    expect((await repository.getConsumedConfirmation(proposal.id))?.candidateAnswer).toBe("有三年经验");
    expect(await repository.getPendingConfirmation(proposal.id)).toBeUndefined();

    // 目标写入已成功：显式完成清理；同一确认 + commitId 的重试幂等重放，
    // 不再触碰已清理的提议。
    await repository.completePendingConfirmation(proposal.id);
    expect(await repository.getConsumedConfirmation(proposal.id)).toBeUndefined();
    const replay = await convertA(repository, { confirmation });
    expect(replay.idempotent).toBe(true);
    expect(replay.jobDescription.id).toBe(converted.jobDescription.id);
  });

  it("rolls back the entire conversion when the pending confirmation is expired, keeping the proposal usable", async () => {
    const { repository } = makeDb();
    const ingested = await ingestA(repository);
    await parseCandidateToDraft(repository, { listingId: ingested.listing.id, draftId: "draft_a", now: LATER });

    const proposal = await repository.createPendingConfirmation({
      proposal: {
        id: "proposal_expired",
        proposalType: "clarification",
        question: "目标城市是哪里？",
        provenance: [{
          sourceType: "ai_suggestion", sourceId: "job-analysis:draft_a", sourceText: "JD 未说明地点",
          confidence: 0.8, confirmedByUser: false, riskLevel: "low", createdAt: NOW
        }],
        scope: "job_specific"
      },
      now: NOW
    });

    await prepareReviewedDraft(repository);
    const confirmation = await createConfirmationA(repository);

    // 过期确认与转换在同一事务：consume 抛错 → 全部回滚。
    await expect(convertA(repository, {
      confirmation,
      pendingProposal: { proposalId: proposal.id, answer: "上海", at: "2027-01-01T00:00:00.000Z" }
    })).rejects.toThrow("fact_proposal_expired");

    expect(await repository.getJobDescription("job_a")).toBeUndefined();
    const listing = await repository.getJobListing(ingested.listing.id);
    expect(listing?.jobDescriptionId).toBeUndefined();
    expect((await repository.getJobAnalysisDraft("draft_a"))?.status).toBe("editing");

    // 待确认记录未受损：修正时间后同一确认与转换可以完整重放。
    const recovered = await convertA(repository, {
      confirmation,
      pendingProposal: { proposalId: proposal.id, answer: "上海", at: LATER }
    });
    expect(recovered.consumedProposal?.candidateAnswer).toBe("上海");
    expect(recovered.listing.jobDescriptionId).toBe(recovered.jobDescription.id);
  });

  it("survives a restart: persisted state is intact and a rerun of the same conversion stays idempotent", async () => {
    const dbName = `careeradapt-v4p2b-restart-${crypto.randomUUID()}`;
    let confirmationId = "";
    let convertedJobId = "";
    {
      const { repository } = makeDb(dbName);
      const ingested = await ingestA(repository);
      await parseCandidateToDraft(repository, { listingId: ingested.listing.id, draftId: "draft_a", now: LATER });
      await prepareReviewedDraft(repository);
      const confirmation = await createConfirmationA(repository);
      confirmationId = confirmation.confirmationId;
      await convertA(repository, {
        confirmation,
        pendingProposal: {
          proposalId: (await repository.createPendingConfirmation({
            proposal: {
              id: "proposal_restart",
              proposalType: "clarification",
              question: "是否接受异地？",
              provenance: [{
                sourceType: "ai_suggestion", sourceId: "job-analysis:draft_a", sourceText: "JD 地点异地",
                confidence: 0.7, confirmedByUser: false, riskLevel: "low", createdAt: NOW
              }],
              scope: "job_specific"
            },
            now: NOW
          })).id,
          answer: "接受",
          at: LATER
        }
      });
      const firstAfterConvert = await repository.getJobListing("listing_a");
      convertedJobId = firstAfterConvert?.jobDescriptionId ?? "";
      db?.close();
      db = undefined;
    }
    {
      const reopened = new CareerAdaptDb(dbName);
      db = reopened;
      const repository = new WorkspaceRepository(reopened);
      const listing = await repository.getJobListing("listing_a");
      expect(listing?.jobDescriptionId).toBe(convertedJobId);
      expect((await repository.getJobAnalysisDraft("draft_a"))?.status).toBe("committed");
      expect((await repository.listJobSnapshots("listing_a"))).toHaveLength(1);

      // 崩溃在 complete 之前：consumed 记录仍在，同一确认重放幂等后可完成清理。
      const consumed = await repository.getConsumedConfirmation("proposal_restart");
      expect(consumed?.candidateAnswer).toBe("接受");
      const rerun = await convertA(repository, { confirmation: { confirmationId } as never });
      expect(rerun.idempotent).toBe(true);
      expect(rerun.jobDescription.id).toBe(convertedJobId);
      expect(await repository.completePendingConfirmation("proposal_restart")).toEqual({ completed: true, existed: true });

      // 重启后重复摄取同一 fixture 仍然幂等。
      const again = await ingestA(repository);
      expect(again.status).toBe("unchanged");
    }
  });
});

describe("V4-P2-B round 2: agent commitJob shares the candidate pipeline", () => {
  it("ingests through the manual identity, binds the same draft chain, and converts with a real confirmation", async () => {
    const { db: database, repository } = makeDb();
    const service = new BrowserAgentToolService(repository);
    const profilesBefore = await database.profiles.toArray();
    const graph = analyzeJobDescriptionV4({ rawText: JD_A }).graph;
    const result = await service.commitJob({
      title: "Go 工程师",
      company: "Acme",
      rawText: JD_A,
      graph
    }, "op-agent-job-1", undefined, {
      operationId: "op-agent-job-1",
      careerSessionBinding: {
        personId: "person-1", profileId: "profile-1",
        profileVersionNumber: 1, profileRevision: 0, agentSessionId: "session-1"
      }
    });

    // 与 UI 入口共用同一管道：manual 身份、候选 listing、快照、草稿链。
    const listings = await repository.listJobListings();
    expect(listings).toHaveLength(1);
    expect(listings[0].sourceKey).toBe("local.manual");
    expect(listings[0].canonicalSourceKind).toBe("external_job_source");
    expect(listings[0].jobDescriptionId).toBe(result.jobId);
    expect((await repository.listJobSnapshots(listings[0].id))).toHaveLength(1);
    const draft = await repository.getJobAnalysisDraft(`job-draft-agent-${stableHashText("op-agent-job-1").slice(0, 20)}`);
    expect(draft?.status).toBe("committed");
    expect(draft?.rawInputId).toBeTruthy();

    // 转换确认绑定 agent 会话且已消费。
    const confirmation = await repository.findOpenConversionConfirmations(draft!.id);
    expect(confirmation).toHaveLength(0);

    // 资料库零写入。
    expect(await database.profiles.toArray()).toEqual(profilesBefore);

    // 已转换候选的新一次提交（如用户重跑 Agent 流程）：幂等返回既有正式岗位。
    const replay = await service.commitJob({
      title: "Go 工程师",
      company: "Acme",
      rawText: JD_A,
      graph
    }, "op-agent-job-2", undefined, {
      operationId: "op-agent-job-2",
      careerSessionBinding: {
        personId: "person-1", profileId: "profile-1",
        profileVersionNumber: 1, profileRevision: 0, agentSessionId: "session-1"
      }
    });
    expect(replay.jobId).toBe(result.jobId);
    expect((replay as { idempotent?: boolean }).idempotent).toBe(true);
    expect(await repository.listJobListings()).toHaveLength(1);
    expect((await repository.listJobDescriptions()).filter((job) => job.id === result.jobId)).toHaveLength(1);
  });

  it("refuses conversion without a pending confirmation record even for an agent-shaped payload", async () => {
    const { repository } = makeDb();
    const ingested = await ingestA(repository);
    await parseCandidateToDraft(repository, { listingId: ingested.listing.id, draftId: "draft_a", now: LATER });
    await prepareReviewedDraft(repository);
    // 不存在确认记录：没有用户批准的凭证，转换不可能发生。
    await expect(repository.convertCandidateListing({
      listingId: ingested.listing.id,
      draftId: "draft_a",
      commitId: "commit_agent",
      confirmationId: "convconf_agent_missing",
      now: LATER
    })).rejects.toThrow("conversion_confirmation_missing");
    expect(ingested.listing.jobDescriptionId).toBeUndefined();
  });
});

describe("V4-P2-B: applicationDraft linkage and submit gating", () => {
  async function setupConvertedCandidate() {
    const { db: database, repository } = makeDb();
    const ingested = await ingestA(repository);
    await parseCandidateToDraft(repository, { listingId: ingested.listing.id, draftId: "draft_a", now: LATER });
    await prepareReviewedDraft(repository);
    const converted = await convertA(repository);
    const convertedJobId = converted.jobDescription.id;
    const draft = await repository.createApplicationAssistDraft({
      draft: {
        id: "draft_apply", schemaVersion: "application-draft-v1",
        jobListingId: ingested.listing.id, platform: "greenhouse", step: "created",
        fieldPlans: [{ fieldKey: "coverLetter", value: "自我介绍", source: "resume_data" }]
      },
      now: LATER
    });
    return { db: database, repository, draft, listingId: ingested.listing.id, convertedJobId };
  }

  function applicationFixture(id: string, jobId: string) {
    return {
      schemaVersion: "application-v1" as const,
      id,
      profileId: "profile_1",
      jobId,
      jobTitleSnapshot: "Go 工程师",
      companySnapshot: "Acme",
      jobSpecificBranchId: "branch_1",
      selectedRevisionId: "rev_1",
      selectedBranchRevision: 0,
      selectedPresentationRevision: 0,
      selectedTemplateId: "classic-technical" as const,
      status: "preparing" as const,
      priority: "normal" as const,
      tags: [],
      timeline: [{
        id: "event_1", type: "created" as const, occurredAt: LATER, createdAt: LATER,
        summary: "created", operationId: "op_1"
      }],
      version: 1,
      createdAt: LATER,
      updatedAt: LATER
    };
  }

  it("links an applicationId only when the formal ApplicationRecord exists and matches the converted job", async () => {
    const { db: database, repository, convertedJobId } = await setupConvertedCandidate();

    await expect(repository.updateApplicationAssistStep({
      draftId: "draft_apply", step: "login_required", applicationId: "app_missing", now: EVEN_LATER
    })).rejects.toThrow("application_missing");

    await database.applications.put(applicationFixture("app_other", "job_other"));
    await expect(repository.updateApplicationAssistStep({
      draftId: "draft_apply", step: "login_required", applicationId: "app_other", now: EVEN_LATER
    })).rejects.toThrow("application_job_mismatch");

    await database.applications.put(applicationFixture("app_1", convertedJobId));
    const linked = await repository.updateApplicationAssistStep({
      draftId: "draft_apply", step: "login_required", applicationId: "app_1", now: EVEN_LATER
    });
    expect(linked.applicationId).toBe("app_1");
  });

  it("refuses application linkage before the candidate is converted", async () => {
    const { db, repository } = makeDb();
    const ingested = await ingestA(repository);
    await repository.createApplicationAssistDraft({
      draft: {
        id: "draft_unconverted", schemaVersion: "application-draft-v1",
        jobListingId: ingested.listing.id, platform: "greenhouse", step: "created"
      },
      now: NOW
    });
    // 应用记录本身有效（指向 job_a），但候选尚未转换：关联必须拒绝。
    await db.applications.put(applicationFixture("app_1", "job_a"));
    await expect(repository.updateApplicationAssistStep({
      draftId: "draft_unconverted", step: "running", applicationId: "app_1", now: LATER
    })).rejects.toThrow("listing_not_converted");
  });

  it("keeps field plans safe and never lets the pipeline submit on the user's behalf", async () => {
    const { repository } = makeDb();
    const ingested = await ingestA(repository);
    await parseCandidateToDraft(repository, { listingId: ingested.listing.id, draftId: "draft_a", now: LATER });
    await prepareReviewedDraft(repository);
    await convertA(repository);

    await expect(repository.createApplicationAssistDraft({
      draft: {
        id: "draft_bad", schemaVersion: "application-draft-v1",
        jobListingId: ingested.listing.id, platform: "greenhouse", step: "created",
        fieldPlans: [{ fieldKey: "verificationCode", value: "123456", source: "manual" }]
      },
      now: LATER
    })).rejects.toThrow();

    const draft = await repository.createApplicationAssistDraft({
      draft: {
        id: "draft_submit", schemaVersion: "application-draft-v1",
        jobListingId: ingested.listing.id, platform: "greenhouse", step: "created"
      },
      now: LATER
    });
    for (const step of ["login_required", "running", "awaiting_user_review", "ready_for_user_submit", "handed_off"] as const) {
      await repository.updateApplicationAssistStep({ draftId: draft.id, step, now: EVEN_LATER });
    }
    // 确定性流水线（无 userAction）不能把草稿推到 user_marked_submitted。
    await expect(repository.updateApplicationAssistStep({
      draftId: draft.id, step: "user_marked_submitted", applicationId: undefined, now: EVEN_LATER
    })).rejects.toThrow("user_confirmation_required_for_submitted");
  });
});
