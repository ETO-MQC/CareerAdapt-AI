import { afterEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import type { z } from "zod";
import {
  ApplicationDraftSchema,
  CrawlPolicyVersionSchema,
  CrawlRunSchema,
  CrawlSourceSchema,
  JobSnapshotProvenanceSchema,
  JobListingSchema,
  JobSnapshotSchema,
  SENSITIVE_FIELD_KEYS,
  isSensitiveFieldKey,
  isTerminalApplicationDraftStep
} from "@/domain/schemas/jobDiscovery";
import { FactProposalSchema } from "@/domain/factProposal";
import { JobDescriptionSchema } from "@/domain/schemas/job";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { jdContentHash } from "@/domain/jobAssets/jdNormalization";

const NOW = "2026-10-06T00:00:00.000Z";
const LATER = "2026-10-07T00:00:00.000Z";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  if (!db) return;
  db.close();
  await db.delete();
  db = undefined;
});

function makeDb(): { db: CareerAdaptDb; repository: WorkspaceRepository } {
  db = new CareerAdaptDb(`careeradapt-v4p2a-${crypto.randomUUID()}`);
  return { db, repository: new WorkspaceRepository(db) };
}

function policyVersion(overrides: Partial<z.input<typeof CrawlPolicyVersionSchema>> = {}): z.input<typeof CrawlPolicyVersionSchema> {
  return {
    version: 1,
    automationLevel: "scheduled",
    permissionBasis: "官方公开 API 条款允许",
    robotsPolicy: "not_applicable",
    dataPolicy: "仅保留岗位文本，转换后 90 天清理",
    complianceStatus: "allowed",
    createdAt: NOW,
    ...overrides
  };
}

function crawlSourceFixture(overrides: Partial<z.input<typeof CrawlSourceSchema>> = {}): z.input<typeof CrawlSourceSchema> {
  return {
    id: "source-greenhouse",
    schemaVersion: "crawl-source-v1",
    key: "greenhouse.acme",
    displayName: "Acme 官方招聘",
    channelType: "official_api",
    mode: "scheduled",
    automationLevel: "scheduled",
    complianceStatus: "allowed",
    profileRef: "job-board:acme",
    adapterId: "greenhouse-board",
    adapterVersion: "v1",
    rateLimit: { maxRequestsPerMinute: 60, minIntervalMs: 1000 },
    supportsSchedule: true,
    supportsDetail: true,
    supportsApplicationAssist: false,
    retentionPolicy: "90_days",
    enabled: true,
    policyVersions: [policyVersion()],
    currentPolicyVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function listingFixture(
  overrides: Partial<z.input<typeof JobListingSchema>> = {}
): Omit<z.input<typeof JobListingSchema>, "createdAt" | "updatedAt" | "firstSeenAt" | "lastSeenAt"> {
  const rawText = "职责：开发 Go 服务";
  return {
    id: `listing_${crypto.randomUUID()}`,
    schemaVersion: "job-listing-v1",
    sourceKey: "greenhouse.acme",
    externalId: "job-001",
    canonicalSourceUrl: "https://jobs.acme.com/p/1",
    contentFingerprint: jdContentHash(rawText),
    companyTitleFingerprint: "f".repeat(64),
    listingKind: "job_posting",
    canonicalSourceKind: "external_job_source",
    title: "Go 工程师",
    company: "Acme",
    crawlState: "new",
    policyStatus: "allowed",
    ...overrides
  };
}

/** 负例专用：故意传入非法字面量，交由运行时 Schema 拒绝。 */
function invalidOverrides<T>(value: object): T {
  return value as unknown as T;
}

function provenance(overrides: Partial<z.input<typeof JobSnapshotProvenanceSchema>> = {}): z.input<typeof JobSnapshotProvenanceSchema> {
  return {
    sourceName: "Acme 官方招聘",
    sourceKind: "external_job_source",
    operation: "official_api_fetch",
    adapterId: "greenhouse-board",
    adapterVersion: "v1",
    capturedAt: NOW,
    ...overrides
  };
}

describe("V4-P2-A schema contracts", () => {
  it("parses the five approved table schemas and rejects invalid enum values", () => {
    expect(CrawlSourceSchema.parse(crawlSourceFixture()).key).toBe("greenhouse.acme");
    expect(JobListingSchema.parse({ ...listingFixture(), createdAt: NOW, updatedAt: NOW, firstSeenAt: NOW, lastSeenAt: NOW }).canonicalSourceKind).toBe("external_job_source");
    expect(() => CrawlSourceSchema.parse(crawlSourceFixture(invalidOverrides({ channelType: "dark_crawler" })))).toThrow();
    expect(() => JobListingSchema.parse({ ...listingFixture(invalidOverrides({ canonicalSourceKind: "boss_private" })), createdAt: NOW, updatedAt: NOW, firstSeenAt: NOW, lastSeenAt: NOW })).toThrow();
    expect(() => CrawlRunSchema.parse({
      id: "run_1", createdAt: NOW, updatedAt: NOW, schemaVersion: "crawl-run-v1",
      sourceKey: "greenhouse.acme", trigger: "manual", autonomyLevel: "scheduled",
      status: "succeeded", startedAt: NOW, counters: {}, diagnostics: [], policySnapshot: policyVersion()
    })).toThrow();
  });

  it("enforces crawlSource policy invariants (blocked not enabled; scheduled needs allowed policy and support)", () => {
    expect(() => CrawlSourceSchema.parse(crawlSourceFixture({ enabled: true, complianceStatus: "blocked" }))).toThrow();
    expect(() => CrawlSourceSchema.parse(crawlSourceFixture({
      mode: "scheduled",
      supportsSchedule: false
    }))).toThrow();
    expect(() => CrawlSourceSchema.parse(crawlSourceFixture({
      mode: "scheduled",
      automationLevel: "manual_only"
    }))).toThrow();
    expect(() => CrawlSourceSchema.parse(crawlSourceFixture({
      mode: "scheduled",
      policyVersions: [policyVersion({ complianceStatus: "review_required" })]
    }))).toThrow();
  });

  it("keeps jobListing conversion state consistent and requires a reason for blocked listings", () => {
    expect(() => JobListingSchema.parse({ ...listingFixture({ jobDescriptionId: "job-1" }), createdAt: NOW, updatedAt: NOW, firstSeenAt: NOW, lastSeenAt: NOW })).toThrow();
    expect(() => JobListingSchema.parse({ ...listingFixture({ convertedAt: LATER }), createdAt: NOW, updatedAt: NOW, firstSeenAt: NOW, lastSeenAt: NOW })).toThrow();
    expect(() => JobListingSchema.parse({ ...listingFixture({ policyStatus: "blocked" }), createdAt: NOW, updatedAt: NOW, firstSeenAt: NOW, lastSeenAt: NOW })).toThrow();
    expect(JobListingSchema.parse({ ...listingFixture({ policyStatus: "blocked", blockedReason: "来源被禁" }), createdAt: NOW, updatedAt: NOW, firstSeenAt: NOW, lastSeenAt: NOW }).blockedReason).toBe("来源被禁");
    expect(() => JobListingSchema.parse({ ...listingFixture({ firstSeenAt: LATER, lastSeenAt: NOW }), createdAt: NOW, updatedAt: NOW })).toThrow();
  });

  it("binds snapshot contentSize to rawText and rejects sensitive credential fields in applicationDrafts", () => {
    const snapshotInput = {
      id: "snapshot_1", createdAt: NOW, updatedAt: NOW, schemaVersion: "job-snapshot-v1",
      jobListingId: "listing_1", version: 1, contentHash: "a".repeat(64),
      rawText: "职责：开发", normalizerVersion: "careeradapt-jd-normalizer-v1",
      capturedBy: "greenhouse-board", provenance: provenance(),
      redactionStatus: "redacted", contentSize: 5, capturedAt: NOW
    };
    expect(JobSnapshotSchema.parse(snapshotInput).version).toBe(1);
    expect(() => JobSnapshotSchema.parse({ ...snapshotInput, contentSize: 999 })).toThrow();

    for (const key of SENSITIVE_FIELD_KEYS) {
      expect(() => ApplicationDraftSchema.parse({
        id: "draft_1", createdAt: NOW, updatedAt: NOW, schemaVersion: "application-draft-v1",
        jobListingId: "listing_1", platform: "greenhouse", step: "created",
        fieldPlans: [{ fieldKey: key, value: "x", source: "manual" }]
      })).toThrow();
    }
    const draft = ApplicationDraftSchema.parse({
      id: "draft_1", createdAt: NOW, updatedAt: NOW, schemaVersion: "application-draft-v1",
      jobListingId: "listing_1", platform: "greenhouse", step: "created",
      sensitiveFieldsPending: ["password", "otp"]
    });
    expect(draft.sensitiveFieldsPending).toEqual(["password", "otp"]);
  });
});

describe("V4-P2-A crawlSources repository", () => {
  it("creates a source, enforces key uniqueness, and appends policy versions without overwriting history", async () => {
    const { repository } = makeDb();
    const created = await repository.createCrawlSource({ source: crawlSourceFixture(), now: NOW });
    expect(created.currentPolicyVersion).toBe(1);
    await expect(repository.createCrawlSource({ source: crawlSourceFixture({ id: "other" }), now: NOW }))
      .rejects.toThrow("crawl_source_key_exists");

    const updated = await repository.updateCrawlSourcePolicy({
      sourceKey: "greenhouse.acme",
      expectedCurrentVersion: 1,
      policy: policyVersion({ complianceStatus: "review_required", automationLevel: "user_present" }),
      now: LATER
    });
    expect(updated.currentPolicyVersion).toBe(2);
    expect(updated.policyVersions).toHaveLength(2);
    expect(updated.policyVersions[0].complianceStatus).toBe("allowed");
    expect(updated.complianceStatus).toBe("review_required");
    // review_required 的来源自动退出 scheduled 模式（§6.1 不变量）。
    expect(updated.mode).toBe("manual");

    await expect(repository.updateCrawlSourcePolicy({
      sourceKey: "greenhouse.acme",
      expectedCurrentVersion: 1,
      policy: policyVersion(),
      now: LATER
    })).rejects.toThrow("crawl_source_policy_version_conflict");
  });

  it("disables a source automatically when its policy turns blocked", async () => {
    const { repository } = makeDb();
    await repository.createCrawlSource({ source: crawlSourceFixture(), now: NOW });
    const updated = await repository.updateCrawlSourcePolicy({
      sourceKey: "greenhouse.acme",
      expectedCurrentVersion: 1,
      policy: policyVersion({ complianceStatus: "blocked" }),
      now: LATER
    });
    expect(updated.complianceStatus).toBe("blocked");
    expect(updated.enabled).toBe(false);
  });
});

describe("V4-P2-A crawlRuns repository", () => {
  it("creates a run from an allowed source, copying the current policy snapshot", async () => {
    const { repository } = makeDb();
    await repository.createCrawlSource({ source: crawlSourceFixture(), now: NOW });
    const run = await repository.createCrawlRun({
      run: { id: "run_1", sourceKey: "greenhouse.acme", trigger: "manual", startedAt: NOW },
      now: NOW
    });
    expect(run.status).toBe("running");
    expect(run.policySnapshot.version).toBe(1);
    expect(run.counters.itemsDiscovered).toBe(0);
  });

  it("rejects runs from disabled or blocked sources and scheduled triggers on non-schedulable sources", async () => {
    const { repository } = makeDb();
    await repository.createCrawlSource({ source: crawlSourceFixture(), now: NOW });
    await repository.updateCrawlSourcePolicy({
      sourceKey: "greenhouse.acme",
      expectedCurrentVersion: 1,
      policy: policyVersion({ complianceStatus: "blocked" }),
      now: LATER
    });
    await expect(repository.createCrawlRun({
      run: { id: "run_x", sourceKey: "greenhouse.acme", trigger: "manual", startedAt: NOW }, now: LATER
    })).rejects.toThrow("crawl_source_blocked");

    const { repository: repository2 } = makeDb();
    await repository2.createCrawlSource({ source: crawlSourceFixture({
      mode: "manual",
      automationLevel: "user_present",
      supportsSchedule: false,
      policyVersions: [policyVersion({ automationLevel: "user_present" })]
    }), now: NOW });
    await expect(repository2.createCrawlRun({
      run: { id: "run_y", sourceKey: "greenhouse.acme", trigger: "scheduled", startedAt: NOW }, now: NOW
    })).rejects.toThrow("crawl_source_not_schedulable");
  });

  it("settles a run with counters and is idempotent on repeated finish with the same status", async () => {
    const { repository } = makeDb();
    await repository.createCrawlSource({ source: crawlSourceFixture(), now: NOW });
    await repository.createCrawlRun({
      run: { id: "run_1", sourceKey: "greenhouse.acme", trigger: "manual", startedAt: NOW }, now: NOW
    });
    const { run: finished } = await repository.finishCrawlRun({
      runId: "run_1",
      status: "finished",
      counters: { itemsDiscovered: 5, itemsNew: 3, itemsChanged: 1, requestsSpent: 9 },
      finishedAt: LATER
    });
    expect(finished.status).toBe("finished");
    expect(finished.finishedAt).toBe(LATER);
    expect(finished.counters.itemsNew).toBe(3);

    const retry = await repository.finishCrawlRun({
      runId: "run_1", status: "finished", counters: { itemsNew: 999 }, finishedAt: LATER
    });
    expect(retry.idempotent).toBe(true);
    expect(retry.run.counters.itemsNew).toBe(3);

    await expect(repository.finishCrawlRun({
      runId: "run_1", status: "failed", finishedAt: LATER
    })).rejects.toThrow("crawl_run_already_finished");
  });
});

describe("V4-P2-A jobListings and jobSnapshots repository", () => {
  it("upserts idempotently on [sourceKey+externalId], preserving firstSeenAt and conversion state", async () => {
    const { repository } = makeDb();
    const first = await repository.upsertJobListing({ listing: listingFixture(), now: NOW });
    expect(first.created).toBe(true);

    const second = await repository.upsertJobListing({
      listing: listingFixture({
        id: "ignored-on-update",
        title: "Go 高级工程师",
        crawlState: "changed"
      }),
      now: LATER
    });
    expect(second.created).toBe(false);
    expect(second.listing.id).toBe(first.listing.id);
    expect(second.listing.title).toBe("Go 高级工程师");
    expect(second.listing.firstSeenAt).toBe(NOW);
    expect(second.listing.lastSeenAt).toBe(LATER);

    await expect(repository.upsertJobListing({
      listing: listingFixture({ externalId: "job-002", canonicalSourceUrl: "https://jobs.acme.com/p/1" }),
      now: LATER
    })).rejects.toThrow("listing_canonical_url_conflict");
  });

  it("computes snapshot versions inside the transaction and is idempotent for identical content", async () => {
    const { repository } = makeDb();
    const { listing } = await repository.upsertJobListing({ listing: listingFixture(), now: NOW });
    const rawText = "职责：开发 Go 服务";

    const first = await repository.appendJobSnapshot({
      jobListingId: listing.id,
      rawText,
      contentHash: jdContentHash(rawText),
      normalizerVersion: "careeradapt-jd-normalizer-v1",
      capturedBy: "greenhouse-board",
      provenance: provenance(),
      redactionStatus: "redacted",
      capturedAt: NOW,
      now: NOW
    });
    expect(first.created).toBe(true);
    expect(first.snapshot.version).toBe(1);

    const duplicate = await repository.appendJobSnapshot({
      jobListingId: listing.id,
      rawText,
      contentHash: jdContentHash(rawText),
      normalizerVersion: "careeradapt-jd-normalizer-v1",
      capturedBy: "greenhouse-board",
      provenance: provenance(),
      redactionStatus: "redacted",
      capturedAt: LATER,
      now: LATER
    });
    expect(duplicate.created).toBe(false);
    expect(duplicate.snapshot.version).toBe(1);

    const changedRaw = `${rawText}\n新增：视频面试`;
    const second = await repository.appendJobSnapshot({
      jobListingId: listing.id,
      rawText: changedRaw,
      contentHash: jdContentHash(changedRaw),
      normalizerVersion: "careeradapt-jd-normalizer-v1",
      capturedBy: "greenhouse-board",
      provenance: provenance(),
      redactionStatus: "redacted",
      capturedAt: LATER,
      now: LATER
    });
    expect(second.created).toBe(true);
    expect(second.snapshot.version).toBe(2);

    const all = await repository.listJobSnapshots(listing.id);
    expect(all).toHaveLength(2);
    expect(all[0].contentHash).not.toBe(all[1].contentHash);
  });

  it("serializes concurrent appends into distinct versions (no lost update, no duplicate version)", async () => {
    const { repository } = makeDb();
    const { listing } = await repository.upsertJobListing({ listing: listingFixture(), now: NOW });
    const results = await Promise.all(["内容A", "内容B", "内容C"].map((rawText, index) =>
      repository.appendJobSnapshot({
        jobListingId: listing.id,
        rawText,
        contentHash: jdContentHash(rawText),
        normalizerVersion: "careeradapt-jd-normalizer-v1",
        capturedBy: "greenhouse-board",
        provenance: provenance(),
        redactionStatus: "redacted",
        capturedAt: NOW,
        now: NOW
      }).then((result) => ({ index, version: result.snapshot.version }))
    ));
    expect(results.map((result) => result.version).sort((left, right) => left - right)).toEqual([1, 2, 3]);
  });

  it("rejects new snapshots that carry a legacy FactSourceType in provenance", async () => {
    const { repository } = makeDb();
    const { listing } = await repository.upsertJobListing({ listing: listingFixture(), now: NOW });
    await expect(repository.appendJobSnapshot({
      jobListingId: listing.id,
      rawText: "x",
      contentHash: jdContentHash("x"),
      normalizerVersion: "careeradapt-jd-normalizer-v1",
      capturedBy: "greenhouse-board",
      provenance: provenance({ legacySourceType: "imported_text" }),
      redactionStatus: "redacted",
      capturedAt: NOW,
      now: NOW
    })).rejects.toThrow("snapshot_provenance_legacy_source_type_forbidden");
  });

  it("marks parsed snapshots only when the snapshot belongs to the listing", async () => {
    const { repository } = makeDb();
    const { listing } = await repository.upsertJobListing({ listing: listingFixture(), now: NOW });
    const { snapshot } = await repository.appendJobSnapshot({
      jobListingId: listing.id,
      rawText: "职责",
      contentHash: jdContentHash("职责"),
      normalizerVersion: "careeradapt-jd-normalizer-v1",
      capturedBy: "greenhouse-board",
      provenance: provenance(),
      redactionStatus: "redacted",
      capturedAt: NOW,
      now: NOW
    });
    const marked = await repository.markJobListingParsed({
      listingId: listing.id, snapshotId: snapshot.id, analysisDraftId: "draft_1", now: LATER
    });
    expect(marked.analysisDraftId).toBe("draft_1");
    await expect(repository.markJobListingParsed({
      listingId: "listing_missing", snapshotId: snapshot.id, analysisDraftId: "draft_1", now: LATER
    })).rejects.toThrow("listing_missing");
  });

  it("converts a candidate only onto an existing formal job, exactly once, without half-committing", async () => {
    const { db: database, repository } = makeDb();
    const { listing } = await repository.upsertJobListing({ listing: listingFixture(), now: NOW });

    // 正式岗位不存在：整个事务必须回滚，listing 保持候选状态（无半提交）。
    await expect(repository.markJobListingConverted({
      listingId: listing.id, jobDescriptionId: "job-missing", now: LATER
    })).rejects.toThrow("converted_job_missing");
    const afterFailure = await repository.getJobListingByExternalId("greenhouse.acme", "job-001");
    expect(afterFailure?.jobDescriptionId).toBeUndefined();
    expect(afterFailure?.convertedAt).toBeUndefined();

    const job = JobDescriptionSchema.parse({
      id: "job-1", createdAt: NOW, updatedAt: NOW,
      title: "Go 工程师", company: "Acme", rawText: "职责：开发 Go 服务", source: "url"
    });
    await database.jobDescriptions.put(job);
    const converted = await repository.markJobListingConverted({
      listingId: listing.id, jobDescriptionId: "job-1", now: LATER
    });
    expect(converted.idempotent).toBe(false);
    expect(converted.listing.jobDescriptionId).toBe("job-1");
    expect(converted.listing.convertedAt).toBe(LATER);

    const again = await repository.markJobListingConverted({
      listingId: listing.id, jobDescriptionId: "job-1", now: LATER
    });
    expect(again.idempotent).toBe(true);
    await expect(repository.markJobListingConverted({
      listingId: listing.id, jobDescriptionId: "job-2", now: LATER
    })).rejects.toThrow("listing_already_converted");
  });

  it("keeps Dexie transactions all-or-nothing when a repository write sequence fails mid-transaction", async () => {
    const { db: database } = makeDb();
    await database.jobListings.put(JobListingSchema.parse({ ...listingFixture(), createdAt: NOW, updatedAt: NOW, firstSeenAt: NOW, lastSeenAt: NOW }));
    await database.jobSnapshots.put(JobSnapshotSchema.parse({
      id: "snapshot_1", createdAt: NOW, updatedAt: NOW, schemaVersion: "job-snapshot-v1",
      jobListingId: (await database.jobListings.toArray())[0].id,
      version: 1, contentHash: "b".repeat(64), rawText: "旧内容",
      normalizerVersion: "careeradapt-jd-normalizer-v1", capturedBy: "x",
      provenance: provenance(), redactionStatus: "redacted",
      contentSize: 3, capturedAt: NOW
    }));
    const listingId = (await database.jobListings.toArray())[0].id;

    await expect(database.transaction("rw", database.jobSnapshots, database.jobListings, async () => {
      await database.jobSnapshots.put(JobSnapshotSchema.parse({
        id: "snapshot_2", createdAt: NOW, updatedAt: NOW, schemaVersion: "job-snapshot-v1",
        jobListingId: listingId, version: 2, contentHash: "c".repeat(64), rawText: "新内容",
        normalizerVersion: "careeradapt-jd-normalizer-v1", capturedBy: "x",
        provenance: provenance(), redactionStatus: "redacted", contentSize: 3, capturedAt: NOW
      }));
      await database.jobListings.update(listingId, { latestSnapshotId: "snapshot_2" });
      throw new Error("mid_transaction_failure");
    })).rejects.toThrow("mid_transaction_failure");

    const snapshots = await database.jobSnapshots.where("jobListingId").equals(listingId).toArray().catch(() => []);
    const snapshotsViaIndex = await database.jobSnapshots
      .where("[jobListingId+version]").between([listingId, Dexie.minKey], [listingId, Dexie.maxKey]).toArray();
    expect(snapshotsViaIndex).toHaveLength(1);
    expect(snapshots).toHaveLength(1);
    const listingAfter = await database.jobListings.get(listingId);
    expect(listingAfter?.latestSnapshotId).toBeUndefined();
  });
});

describe("V4-P2-A applicationDrafts repository", () => {
  async function setupWithListing() {
    const { repository } = makeDb();
    const { listing } = await repository.upsertJobListing({ listing: listingFixture(), now: NOW });
    return { repository, listing };
  }

  it("creates a draft and walks the recommended step machine, rejecting invalid transitions", async () => {
    const { repository, listing } = await setupWithListing();
    const draft = await repository.createApplicationAssistDraft({
      draft: {
        id: "draft_1",
        schemaVersion: "application-draft-v1",
        jobListingId: listing.id,
        platform: "greenhouse",
        step: "created"
      },
      now: NOW
    });
    expect(draft.step).toBe("created");

    const running = await repository.updateApplicationAssistStep({ draftId: "draft_1", step: "running", now: LATER });
    expect(running.step).toBe("running");

    const review = await repository.updateApplicationAssistStep({
      draftId: "draft_1", step: "awaiting_user_review",
      sensitiveFieldsPending: ["password"],
      now: LATER
    });
    expect(review.sensitiveFieldsPending).toEqual(["password"]);

    await repository.updateApplicationAssistStep({ draftId: "draft_1", step: "ready_for_user_submit", now: LATER });
    await repository.updateApplicationAssistStep({ draftId: "draft_1", step: "handed_off", now: LATER });
    // P2-A.1：handed_off → user_marked_submitted 必须由用户显式动作触发。
    await expect(repository.updateApplicationAssistStep({
      draftId: "draft_1", step: "user_marked_submitted", now: LATER
    })).rejects.toThrow("user_confirmation_required_for_submitted");
    await expect(repository.updateApplicationAssistStep({
      draftId: "draft_1", step: "abandoned", now: LATER
    })).rejects.toThrow("invalid_application_draft_transition");
    await repository.updateApplicationAssistStep({
      draftId: "draft_1", step: "user_marked_submitted", userAction: true, now: LATER
    });

    await expect(repository.updateApplicationAssistStep({
      draftId: "draft_1", step: "running", now: LATER
    })).rejects.toThrow("invalid_application_draft_transition");

    // applicationId 关联的存在性与岗位对应校验由 V4-P2-B 的专项测试覆盖；
    // 本用例只验证步进机，不带 applicationId。
    const drafts = await repository.listApplicationDrafts(listing.id);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].applicationId).toBeUndefined();
  });

  it("rejects drafts for missing or blocked listings and stores no credential field values", async () => {
    const { repository, listing } = await setupWithListing();
    await expect(repository.createApplicationAssistDraft({
      draft: {
        id: "draft_missing", schemaVersion: "application-draft-v1",
        jobListingId: "listing_missing", platform: "greenhouse", step: "created"
      },
      now: NOW
    })).rejects.toThrow("listing_missing");

    const { repository: repository2 } = makeDb();
    const { listing: blockedListing } = await repository2.upsertJobListing({
      listing: listingFixture({ policyStatus: "blocked", blockedReason: "来源被禁" }),
      now: NOW
    });
    await expect(repository2.createApplicationAssistDraft({
      draft: {
        id: "draft_blocked", schemaVersion: "application-draft-v1",
        jobListingId: blockedListing.id, platform: "greenhouse", step: "created"
      },
      now: NOW
    })).rejects.toThrow("listing_blocked");

    await expect(repository.createApplicationAssistDraft({
      draft: {
        id: "draft_sensitive", schemaVersion: "application-draft-v1",
        jobListingId: listing.id, platform: "greenhouse", step: "created",
        fieldPlans: [{ fieldKey: "bank_card", value: "6222 0202 0000 0000", source: "manual" }]
      },
      now: NOW
    })).rejects.toThrow();
  });
});

describe("V4-P2-A pending confirmations on appMeta (no sixth table)", () => {
  it("stores, returns, and consumes a fact proposal with expiry enforcement", async () => {
    const { repository } = makeDb();
    const proposal = await repository.createPendingConfirmation({
      proposal: {
        id: "proposal_1",
        proposalType: "missing_skill",
        question: "你是否有 Go 生产经验？",
        relatedRequirementId: "req-1",
        provenance: [{
          sourceType: "ai_suggestion",
          sourceId: "job-analysis:job-1",
          sourceText: "JD 要求 Go 经验",
          confidence: 0.9,
          confirmedByUser: false,
          riskLevel: "low",
          createdAt: NOW
        }],
        scope: "job_specific"
      },
      now: NOW
    });
    expect(proposal.expiresAt).toBe("2026-11-05T00:00:00.000Z");

    const fetched = await repository.getPendingConfirmation("proposal_1");
    expect(fetched?.userConfirmed).toBe(false);

    const consumed = await repository.consumePendingConfirmation({
      proposalId: "proposal_1", at: LATER, answer: "有三年经验"
    });
    expect(consumed.proposal.userConfirmed).toBe(true);
    expect(consumed.idempotent).toBe(false);
    // P2-A.1：消费不再不可恢复地删除记录——提议保留为 consumed，待目标写入完成后显式清理。
    expect(await repository.getPendingConfirmation("proposal_1")).toBeUndefined();
    expect((await repository.getConsumedConfirmation("proposal_1"))?.candidateAnswer).toBe("有三年经验");

    // 崩溃恢复重试：幂等返回同一确认结果，不重复确认。
    const retry = await repository.consumePendingConfirmation({
      proposalId: "proposal_1", at: LATER, answer: "有三年经验"
    });
    expect(retry.idempotent).toBe(true);
    expect(retry.proposal.candidateAnswer).toBe("有三年经验");

    // 下游持久化失败：显式恢复到待确认，用户可重新确认。
    const restored = await repository.restorePendingConfirmation("proposal_1");
    expect(restored.userConfirmed).toBe(false);
    expect((await repository.getPendingConfirmation("proposal_1"))?.userConfirmed).toBe(false);

    const reconsumed = await repository.consumePendingConfirmation({
      proposalId: "proposal_1", at: LATER, answer: "有四年经验"
    });
    expect(reconsumed.idempotent).toBe(false);
    expect(reconsumed.proposal.candidateAnswer).toBe("有四年经验");

    // 目标写入成功：显式完成并删除；再次完成幂等。
    expect(await repository.completePendingConfirmation("proposal_1")).toEqual({ completed: true, existed: true });
    expect(await repository.getConsumedConfirmation("proposal_1")).toBeUndefined();
    expect(await repository.completePendingConfirmation("proposal_1")).toEqual({ completed: true, existed: false });
    await expect(repository.consumePendingConfirmation({
      proposalId: "proposal_1", at: LATER, answer: "x"
    })).rejects.toThrow("fact_proposal_missing");
  });

  it("keeps a P2-A first-release raw proposal record readable as pending", async () => {
    const { db: database, repository } = makeDb();
    await database.appMeta.put({
      key: "fact-proposal:legacy_1",
      value: FactProposalSchema.parse({
        id: "legacy_1", createdAt: NOW, updatedAt: NOW, schemaVersion: "fact-proposal-v1",
        proposalType: "clarification", question: "目标城市？", candidateAnswer: "",
        userConfirmed: false,
        provenance: [{
          sourceType: "ai_suggestion", sourceId: "job-analysis:job-1", sourceText: "无地点",
          confidence: 0.8, confirmedByUser: false, riskLevel: "low", createdAt: NOW
        }],
        scope: "job_specific", expiresAt: "2026-11-05T00:00:00.000Z"
      }),
      updatedAt: NOW
    });
    const fetched = await repository.getPendingConfirmation("legacy_1");
    expect(fetched?.question).toBe("目标城市？");
    const consumed = await repository.consumePendingConfirmation({
      proposalId: "legacy_1", at: LATER, answer: "上海"
    });
    expect(consumed.proposal.candidateAnswer).toBe("上海");
    expect(await repository.completePendingConfirmation("legacy_1")).toEqual({ completed: true, existed: true });
  });

  it("refuses expired proposals, duplicate ids, and answerless confirmations", async () => {
    const { repository } = makeDb();
    const proposalInput = {
      id: "proposal_1",
      proposalType: "clarification" as const,
      question: "目标城市是哪里？",
      provenance: [{
        sourceType: "ai_suggestion" as const,
        sourceId: "job-analysis:job-1",
        sourceText: "JD 未说明地点",
        confidence: 0.8,
        confirmedByUser: false,
        riskLevel: "low" as const,
        createdAt: NOW
      }],
      scope: "job_specific" as const
    };
    await repository.createPendingConfirmation({ proposal: proposalInput, now: NOW });
    await expect(repository.createPendingConfirmation({ proposal: proposalInput, now: NOW }))
      .rejects.toThrow("fact_proposal_exists");

    await expect(repository.consumePendingConfirmation({
      proposalId: "proposal_1", at: "2027-01-01T00:00:00.000Z", answer: "上海"
    })).rejects.toThrow("fact_proposal_expired");

    await expect(repository.consumePendingConfirmation({
      proposalId: "proposal_1", at: LATER
    })).rejects.toThrow("fact_proposal_answer_required");
  });
});

describe("V4-P2-A.1 contract hardening", () => {
  it("pins jobListings.origin to external_job_source and rejects every other canonical kind", () => {
    const base = { ...listingFixture(), createdAt: NOW, updatedAt: NOW, firstSeenAt: NOW, lastSeenAt: NOW };
    expect(JobListingSchema.parse(base).canonicalSourceKind).toBe("external_job_source");
    for (const kind of ["user_declared", "document_import", "ai_generated", "verified_evidence", "system", "job_requirement", "resume_content"]) {
      expect(() => JobListingSchema.parse({ ...base, canonicalSourceKind: kind })).toThrow();
    }
  });

  it("requires top-level automationLevel/complianceStatus to match the current policy version", () => {
    expect(() => CrawlSourceSchema.parse(crawlSourceFixture(invalidOverrides({
      complianceStatus: "review_required",
      policyVersions: [policyVersion({ complianceStatus: "allowed" })]
    })))).toThrow("top-level complianceStatus must match the current policy version");
    expect(() => CrawlSourceSchema.parse(crawlSourceFixture(invalidOverrides({
      automationLevel: "user_present",
      mode: "manual"
    })))).toThrow("top-level automationLevel must match the current policy version");
    // 一致时正常解析。
    expect(CrawlSourceSchema.parse(crawlSourceFixture()).complianceStatus).toBe("allowed");
  });

  it("treats handed_off as non-terminal and gates user_marked_submitted behind explicit user action", async () => {
    expect(isTerminalApplicationDraftStep("handed_off")).toBe(false);
    expect(isTerminalApplicationDraftStep("user_marked_submitted")).toBe(true);
    expect(isTerminalApplicationDraftStep("abandoned")).toBe(true);

    const { repository } = makeDb();
    const { listing } = await repository.upsertJobListing({ listing: listingFixture(), now: NOW });
    await repository.createApplicationAssistDraft({
      draft: {
        id: "draft_ho", schemaVersion: "application-draft-v1",
        jobListingId: listing.id, platform: "greenhouse", step: "created"
      },
      now: NOW
    });
    for (const step of ["running", "awaiting_user_review", "ready_for_user_submit", "handed_off"] as const) {
      await repository.updateApplicationAssistStep({ draftId: "draft_ho", step, now: LATER });
    }
    // 自动化路径（无 userAction）不得代用户提交。
    await expect(repository.updateApplicationAssistStep({
      draftId: "draft_ho", step: "user_marked_submitted", now: LATER
    })).rejects.toThrow("user_confirmation_required_for_submitted");
    await repository.updateApplicationAssistStep({
      draftId: "draft_ho", step: "user_marked_submitted", userAction: true, now: LATER
    });
  });

  it("normalizes sensitive field names across casings, separators, and common abbreviations", () => {
    for (const alias of [
      "verificationCode", "verification-code", "verification code", "VERIFICATION_CODE",
      "pwd", "Passwd", "bank card", "bank-card", "bank_card", "idCard", "ID Card",
      "smsCode", "student_id", "cvv", "CVC", "oneTimePassword"
    ]) {
      expect(ApplicationDraftSchema.safeParse({
        id: "draft_x", createdAt: NOW, updatedAt: NOW, schemaVersion: "application-draft-v1",
        jobListingId: "listing_1", platform: "greenhouse", step: "created",
        fieldPlans: [{ fieldKey: alias, value: "x", source: "manual" }]
      }).success).toBe(false);
      expect(isSensitiveFieldKey(alias)).toBe(true);
    }
    // 非敏感字段不受影响。
    for (const legit of ["coverLetter", "expected_salary", "availableFrom", "自我评价"]) {
      expect(isSensitiveFieldKey(legit)).toBe(false);
    }
  });
});
