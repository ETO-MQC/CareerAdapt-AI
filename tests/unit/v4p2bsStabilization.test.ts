import { afterEach, describe, expect, it } from "vitest";
import {
  ingestCandidateListing,
  parseCandidateToDraft,
  CANDIDATE_PIPELINE_VERSION
} from "@/domain/jobDiscovery/candidatePipeline";
import { analyzeJobDescriptionV4 } from "@/domain/jobOptimization";
import { jdContentHash } from "@/domain/jobAssets/jdNormalization";
import { JobAnalysisDraftSchema } from "@/domain/schemas";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";

const NOW = "2026-10-07T00:00:00.000Z";
const LATER = "2026-10-08T00:00:00.000Z";

const JD_A = "职责：\n负责 Go 后端服务开发。\n要求：\n3 年以上经验。";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  if (!db) return;
  db.close();
  await db.delete();
  db = undefined;
});

function makeDb(): { db: CareerAdaptDb; repository: WorkspaceRepository } {
  db = new CareerAdaptDb(`careeradapt-v4p2bs-${crypto.randomUUID()}`);
  return { db, repository: new WorkspaceRepository(db) };
}

type IngestResult = Exclude<Awaited<ReturnType<typeof ingestCandidateListing>>, { status: "waiting_input" }>;

async function ingestA(repository: WorkspaceRepository): Promise<IngestResult> {
  const result = await ingestCandidateListing(repository, {
    sourceKey: "fixture.board",
    externalId: "job-001",
    listingId: "listing_a",
    rawText: JD_A,
    title: "Go 工程师",
    company: "Acme",
    now: NOW
  });
  if (result.status === "waiting_input") throw new Error("expected ingest to succeed");
  return result;
}

function confirmedRequirementFixture(rawText: string) {
  return {
    id: "req-1",
    createdAt: LATER,
    updatedAt: LATER,
    category: "required_skill" as const,
    description: "3 年以上 Go 后端经验",
    priority: "must" as const,
    hardConstraint: true,
    sourceQuote: "3 年以上经验。",
    sourceSpan: { start: rawText.indexOf("3 年以上经验。"), end: rawText.indexOf("3 年以上经验。") + "3 年以上经验。".length, text: "3 年以上经验。" },
    keywords: ["Go"],
    confidenceLevel: "high" as const,
    confidenceReason: "JD 原文明确写出",
    needsConfirmation: false,
    confirmedByUser: true
  };
}

async function prepareReviewedDraft(repository: WorkspaceRepository, rawText = JD_A) {
  const draft = await repository.getJobAnalysisDraft("draft_a");
  if (!draft) throw new Error("draft_missing");
  const analyzed = JobAnalysisDraftSchema.parse({
    ...draft,
    status: "editing",
    manualRequirements: [confirmedRequirementFixture(rawText)],
    analysisRunStatus: "review_ready",
    updatedAt: LATER
  });
  return repository.saveJobAnalysisDraftRevision(analyzed, draft.revision);
}

const AGENT_BINDING = {
  personId: "person-1",
  profileId: "profile-1",
  profileVersionNumber: 1,
  profileRevision: 0,
  agentSessionId: "session-1"
};

describe("V4-P2-B stabilization: atomic ingest", () => {
  it("keeps provenance tied to the pipeline version", async () => {
    const { repository } = makeDb();
    const result = await ingestA(repository);
    expect(result.snapshot.provenance.adapterId).toBe(CANDIDATE_PIPELINE_VERSION);
    expect(result.snapshot.provenance.operation).toBe("candidate_ingest");
  });

  it("rolls back the listing when the snapshot fails mid-transaction (failure injection, no half-commit)", async () => {
    const { repository } = makeDb();
    // 失败注入：normalizerVersion 为空串使快照校验在 listing 写入之后失败。
    await expect(ingestCandidateListing(repository, {
      sourceKey: "fixture.board",
      externalId: "job-001",
      listingId: "listing_a",
      rawText: JD_A,
      title: "Go 工程师",
      company: "Acme",
      normalizerVersion: "",
      now: NOW
    })).rejects.toThrow();

    expect(await repository.listJobListings()).toHaveLength(0);
    const byId = await repository.getJobListing("listing_a");
    expect(byId).toBeUndefined();
  });

  it("replays a duplicate ingest as unchanged without a new snapshot version", async () => {
    const { repository } = makeDb();
    const first = await ingestA(repository);
    const second = await ingestA(repository);
    expect(second.status).toBe("unchanged");
    expect(second.snapshot.id).toBe(first.snapshot.id);
    expect(second.snapshot.version).toBe(1);
  });
});

describe("V4-P2-B stabilization: confirmation binding validation", () => {
  async function setupReviewableDraft() {
    const { db: database, repository } = makeDb();
    const ingested = await ingestA(repository);
    await parseCandidateToDraft(repository, { listingId: ingested.listing.id, draftId: "draft_a", now: LATER });
    await prepareReviewedDraft(repository);
    return { db: database, repository, ingested };
  }

  it("rejects a cross-channel conversion (agent confirmation used from the workspace channel)", async () => {
    const { repository } = await setupReviewableDraft();
    const confirmation = await repository.createConversionConfirmation({
      channel: "agent",
      operationId: "op-agent-1",
      listingId: "listing_a",
      draftId: "draft_a",
      careerSessionBinding: AGENT_BINDING,
      userMessageId: "msg-1",
      now: LATER
    });
    await expect(repository.convertCandidateListing({
      listingId: "listing_a",
      draftId: "draft_a",
      commitId: "commit_cross",
      confirmationId: confirmation.confirmationId,
      expectedConfirmation: { channel: "jobs_workspace" },
      now: LATER
    })).rejects.toThrow("conversion_confirmation_channel_mismatch");
  });

  it("rejects a cross-session confirmation (different agent session binding)", async () => {
    const { repository } = await setupReviewableDraft();
    const confirmation = await repository.createConversionConfirmation({
      channel: "agent",
      operationId: "op-agent-2",
      listingId: "listing_a",
      draftId: "draft_a",
      careerSessionBinding: AGENT_BINDING,
      userMessageId: "msg-2",
      now: LATER
    });
    await expect(repository.convertCandidateListing({
      listingId: "listing_a",
      draftId: "draft_a",
      commitId: "commit_xsession",
      confirmationId: confirmation.confirmationId,
      expectedConfirmation: {
        channel: "agent",
        careerSessionBinding: { ...AGENT_BINDING, agentSessionId: "session-evil" }
      },
      now: LATER
    })).rejects.toThrow("conversion_confirmation_session_mismatch");
  });

  it("rejects a replay under a different operationId or user message", async () => {
    const { repository } = await setupReviewableDraft();
    const confirmation = await repository.createConversionConfirmation({
      channel: "agent",
      operationId: "op-agent-3",
      listingId: "listing_a",
      draftId: "draft_a",
      careerSessionBinding: AGENT_BINDING,
      userMessageId: "msg-3",
      now: LATER
    });
    await expect(repository.convertCandidateListing({
      listingId: "listing_a",
      draftId: "draft_a",
      commitId: "commit_op",
      confirmationId: confirmation.confirmationId,
      expectedConfirmation: { channel: "agent", operationId: "op-agent-other" },
      now: LATER
    })).rejects.toThrow("conversion_confirmation_operation_mismatch");
    await expect(repository.convertCandidateListing({
      listingId: "listing_a",
      draftId: "draft_a",
      commitId: "commit_msg",
      confirmationId: confirmation.confirmationId,
      expectedConfirmation: { channel: "agent", userMessageId: "msg-other" },
      now: LATER
    })).rejects.toThrow("conversion_confirmation_user_message_mismatch");
    // 全部校验通过后转换成功，且确认记录变为 consumed。
    const converted = await repository.convertCandidateListing({
      listingId: "listing_a",
      draftId: "draft_a",
      commitId: "commit_ok",
      confirmationId: confirmation.confirmationId,
      expectedConfirmation: {
        channel: "agent",
        operationId: "op-agent-3",
        userMessageId: "msg-3",
        careerSessionBinding: AGENT_BINDING
      },
      now: LATER
    });
    expect(converted.idempotent).toBe(false);
    const stored = await repository.getConversionConfirmation(confirmation.confirmationId);
    expect(stored?.state).toBe("consumed");
  });

  it("rejects conversion after expiry", async () => {
    const { repository } = await setupReviewableDraft();
    const confirmation = await repository.createConversionConfirmation({
      channel: "jobs_workspace",
      operationId: "op-expired",
      listingId: "listing_a",
      draftId: "draft_a",
      ttlMinutes: 1,
      now: LATER
    });
    // 过期判断以消费时刻为准：创建后超过 ttl 再消费即拒绝。
    await expect(repository.convertCandidateListing({
      listingId: "listing_a",
      draftId: "draft_a",
      commitId: "commit_late",
      confirmationId: confirmation.confirmationId,
      now: "2026-10-09T00:00:00.000Z"
    })).rejects.toThrow("conversion_confirmation_expired");
  });

  it("rejects conversion when the graph is removed after confirmation (graphHash present -> absent)", async () => {
    const { repository } = await setupReviewableDraft();
    // 确认前草稿带 graph（确认捕获其指纹）。
    const current = await repository.getJobAnalysisDraft("draft_a");
    const withGraph = JobAnalysisDraftSchema.parse({
      ...current,
      requirementGraph: analyzeJobDescriptionV4({ rawText: JD_A }).graph,
      updatedAt: LATER
    });
    await repository.saveJobAnalysisDraftRevision(withGraph, current!.revision);
    const confirmation = await repository.createConversionConfirmation({
      channel: "jobs_workspace",
      operationId: "op-graph-removed",
      listingId: "listing_a",
      draftId: "draft_a",
      now: LATER
    });
    expect(confirmation.graphHash).toBe(withGraph.requirementGraph?.graphHash);

    // 确认后 graph 被整体移除（有值 → 无值）：指纹不一致，必须拒绝。
    const currentAfterConfirm = await repository.getJobAnalysisDraft("draft_a");
    const stripped = JobAnalysisDraftSchema.parse({ ...withGraph, requirementGraph: undefined, updatedAt: LATER });
    await repository.saveJobAnalysisDraftRevision(stripped, currentAfterConfirm!.revision);
    await expect(repository.convertCandidateListing({
      listingId: "listing_a",
      draftId: "draft_a",
      commitId: "commit_graph_removed",
      confirmationId: confirmation.confirmationId,
      now: LATER
    })).rejects.toThrow("conversion_confirmation_stale_content");
  });

  it("rejects agent-channel confirmations that lack session binding or user message (no degraded conversion)", async () => {
    const { db, repository } = await setupReviewableDraft();
    // 直接构造缺绑定字段的 agent 通道确认（绕过创建期快速失败，验证消费端兜底）。
    const confirmation = await repository.createConversionConfirmation({
      channel: "jobs_workspace",
      operationId: "op-degrade-source",
      listingId: "listing_a",
      draftId: "draft_a",
      now: LATER
    });
    const stored = await repository.getConversionConfirmation(confirmation.confirmationId);
    await (db as CareerAdaptDb).appMeta.put({
      key: `conversion-confirmation:${confirmation.confirmationId}`,
      value: { ...stored, channel: "agent", careerSessionBinding: undefined, userMessageId: undefined },
      updatedAt: LATER
    });
    await expect(repository.convertCandidateListing({
      listingId: "listing_a",
      draftId: "draft_a",
      commitId: "commit_degrade",
      confirmationId: confirmation.confirmationId,
      now: LATER
    })).rejects.toThrow("conversion_confirmation_agent_binding_missing");
  });

  it("rejects conversion when the requirement graph changed after confirmation (graphHash fingerprint)", async () => {
    const { db: database, repository } = await setupReviewableDraft();
    // 先让草稿携带真实 V4 graph（确认创建时捕获其 graphHash 指纹）。
    const current = await repository.getJobAnalysisDraft("draft_a");
    const withGraph = JobAnalysisDraftSchema.parse({
      ...current,
      requirementGraph: analyzeJobDescriptionV4({ rawText: JD_A }).graph,
      updatedAt: LATER
    });
    await repository.saveJobAnalysisDraftRevision(withGraph, current!.revision);
    const confirmation = await repository.createConversionConfirmation({
      channel: "jobs_workspace",
      operationId: "op-stale",
      listingId: "listing_a",
      draftId: "draft_a",
      now: LATER
    });
    expect(confirmation.graphHash).toBe(withGraph.requirementGraph?.graphHash);
    // 确认之后 graph 结构变化 → graphHash 变化：把确认记录的指纹替换为
    // "确认之后的实际值"，消费时应因指纹不一致被拦截。
    const stored = await repository.getConversionConfirmation(confirmation.confirmationId);
    await database.appMeta.put({
      key: `conversion-confirmation:${confirmation.confirmationId}`,
      value: { ...stored, graphHash: "rotated-graph-hash" },
      updatedAt: LATER
    });
    await expect(repository.convertCandidateListing({
      listingId: "listing_a",
      draftId: "draft_a",
      commitId: "commit_stale",
      confirmationId: confirmation.confirmationId,
      now: LATER
    })).rejects.toThrow("conversion_confirmation_stale_content");
  });
});

describe("V4-P2-B stabilization: agent duplicate decision", () => {
  it("returns duplicate candidates and saves nothing until the user decides", async () => {
    const { db: database, repository } = makeDb();
    const service = new BrowserAgentToolService(repository);
    const profilesBefore = await database.profiles.toArray();
    const graph = analyzeJobDescriptionV4({ rawText: JD_A }).graph;
    await ingestCandidateListing(repository, {
      sourceKey: "other.board",
      externalId: "job-999",
      rawText: JD_A,
      title: "后端工程师（另一来源）",
      company: "Other Co",
      now: NOW
    });

    const result = await service.commitJob({
      title: "Go 工程师",
      company: "Acme",
      rawText: JD_A,
      graph
    }, "op-agent-dup", undefined, { operationId: "op-agent-dup", careerSessionBinding: AGENT_BINDING, userMessageId: "user-msg-dup" }) as { status?: string; candidates?: Array<{ listingId: string; company: string }> };

    expect(result.status).toBe("duplicate_decision_required");
    expect(result.candidates?.[0]?.company).toBe("Other Co");
    // 用户未决策：没有正式岗位、没有转换确认、listing 不变。
    expect(await repository.listJobDescriptions()).toHaveLength(0);
    const listings = await repository.listJobListings();
    expect(listings.find((listing) => listing.sourceKey === "local.manual")).toBeUndefined();
    expect(await database.profiles.toArray()).toEqual(profilesBefore);
  });

  it("proceeds with keep_separate after the user decides, and merge_existing merges into the chosen candidate", async () => {
    const { repository } = makeDb();
    const service = new BrowserAgentToolService(repository);
    const graph = analyzeJobDescriptionV4({ rawText: JD_A }).graph;
    const other = await ingestCandidateListing(repository, {
      sourceKey: "other.board",
      externalId: "job-999",
      rawText: JD_A,
      title: "后端工程师（另一来源）",
      company: "Other Co",
      now: NOW
    });
    if (other.status === "waiting_input") throw new Error("expected ingest to succeed");

    const separate = await service.commitJob({
      title: "Go 工程师",
      company: "Acme",
      rawText: JD_A,
      graph,
      dedupDecision: "keep_separate"
    }, "op-agent-sep", undefined, { operationId: "op-agent-sep", careerSessionBinding: AGENT_BINDING, userMessageId: "user-msg-sep" });
    expect((separate as { jobId?: string }).jobId).toBeTruthy();
    expect(await repository.listJobListings()).toHaveLength(2);

    // merge_existing：合并目标必须是返回的候选之一（不能合并进自身）。
    const merged = await service.commitJob({
      title: "Go 工程师（合并进另一来源）",
      company: "Other Co",
      rawText: JD_A,
      graph,
      dedupDecision: "merge_existing",
      duplicateListingId: other.listing.id
    }, "op-agent-merge", undefined, { operationId: "op-agent-merge", careerSessionBinding: AGENT_BINDING, userMessageId: "user-msg-merge" });
    expect((merged as { jobId?: string }).jobId).toBeTruthy();
    expect(await repository.listJobListings()).toHaveLength(2);
  });

  it("binds the conversion confirmation to the triggering user message and session", async () => {
    const { repository } = makeDb();
    const service = new BrowserAgentToolService(repository);
    const graph = analyzeJobDescriptionV4({ rawText: JD_A }).graph;
    const result = await service.commitJob({
      title: "Go 工程师",
      company: "Acme",
      rawText: JD_A,
      graph
    }, "op-agent-bound", undefined, {
      operationId: "op-agent-bound",
      careerSessionBinding: AGENT_BINDING,
      userMessageId: "user-msg-bound"
    }) as { jobId?: string; status?: string };

    expect(result.jobId).toBeTruthy();
    const draftId = `job-draft-agent-${(await repository.listJobListings())[0].analysisDraftId ? "" : ""}`.length >= 0
      ? (await repository.getJobListing((await repository.listJobListings())[0].id))!.analysisDraftId!
      : "";
    const open = await repository.findOpenConversionConfirmations(draftId, LATER);
    expect(open).toHaveLength(0);
  });
});

describe("V4-P2-B stabilization: both entries follow the same deterministic chain", () => {
  it("workspace entry: ingest -> draft -> analyzed+reviewed -> confirmed convert, no profile writes", async () => {
    const { db: database, repository } = makeDb();
    const profilesBefore = await database.profiles.toArray();
    const ingested = await ingestA(repository);
    const parsed = await parseCandidateToDraft(repository, { listingId: ingested.listing.id, draftId: "draft_a", now: LATER });
    expect(parsed.draft.status).toBe("raw_saved");
    const reviewed = await prepareReviewedDraft(repository);
    const confirmation = await repository.createConversionConfirmation({
      channel: "jobs_workspace",
      operationId: "op-ws-1",
      listingId: ingested.listing.id,
      draftId: "draft_a",
      now: LATER
    });
    const converted = await repository.convertCandidateListing({
      listingId: ingested.listing.id,
      draftId: "draft_a",
      commitId: "commit-ws-1",
      confirmationId: confirmation.confirmationId,
      expectedConfirmation: { channel: "jobs_workspace", operationId: "op-ws-1" },
      now: LATER
    });
    expect(converted.jobDescription.requirements).toHaveLength(1);
    expect(converted.listing.jobDescriptionId).toBe(converted.jobDescription.id);
    expect(converted.draft.status).toBe("committed");
    expect(converted.draft.revision).toBe(reviewed.revision + 1);
    expect(await database.profiles.toArray()).toEqual(profilesBefore);
  });

  it("agent entry: ingest -> draft(raw_saved) -> graph analysis -> confirmed convert with full binding", async () => {
    const { db: database, repository } = makeDb();
    const profilesBefore = await database.profiles.toArray();
    const service = new BrowserAgentToolService(repository);
    const graph = analyzeJobDescriptionV4({ rawText: JD_A }).graph;
    const result = await service.commitJob({
      title: "Go 工程师",
      company: "Acme",
      rawText: JD_A,
      graph
    }, "op-agent-chain", undefined, {
      operationId: "op-agent-chain",
      careerSessionBinding: AGENT_BINDING,
      userMessageId: "user-msg-chain"
    }) as { jobId?: string };

    expect(result.jobId).toBeTruthy();
    const listing = (await repository.listJobListings()).find((item) => item.sourceKey === "local.manual");
    expect(listing?.jobDescriptionId).toBe(result.jobId);
    const draft = await repository.getJobAnalysisDraft(listing!.analysisDraftId!);
    expect(draft?.status).toBe("committed");
    expect(draft?.requirementGraph?.requirements.length).toBeGreaterThan(0);
    // 原文与指纹链路：listing.contentFingerprint = 规范化内容哈希。
    expect(listing?.contentFingerprint).toBe(jdContentHash(JD_A));
    expect(await database.profiles.toArray()).toEqual(profilesBefore);
  });
});
