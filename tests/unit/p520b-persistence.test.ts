// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { CareerAdaptDb } from "@/services/storage/db";
import { RevisionConflictError, WorkspaceRepository } from "@/services/storage/repositories";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import { buildGeneralBranchFromProfile, buildJobBranchFromProfile } from "@/domain/branch/profileBranch";
import { canonical, decode, exportLegacy, hash, SnapshotTarget, verify, type MigrationPackage } from "../../poc/career-domain-persistence/migration";
import { DomainReadSchema, rejectUnimplementedAction } from "../../poc/career-domain-persistence/client";
const ids = vi.hoisted(() => ({ next: 0 }));
vi.mock("nanoid", () => ({ nanoid: () => `fixture-${++ids.next}` }));

async function fixture() {
  ids.next = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
  try {
  const db = new CareerAdaptDb(`p520b-fixture-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const profile = JSON.parse(JSON.stringify(demoCareerProfile));
  await repository.saveProfile(profile);
  const built = buildGeneralBranchFromProfile({ profile, operationId: "p520b-general", name: "Fixture", includeProfileFacts: true, includeProfileBasics: true, now: "2026-11-01T00:00:00.000Z" });
  await repository.saveResumeBranch(built.branch);
  await db.resumeRevisions.put(built.firstRevision);
  const job = structuredClone(demoJobDescriptions[0]);
  await repository.saveJobDescription(job);
  const jobBuilt = buildJobBranchFromProfile({ profile, jobId: job.id, jobTitle: job.title, jobVersion: job.updatedAt, operationId: "fixture-job", name: "Fixture job", selectedCanonicalItemIds: canonicalProfileLibraryItems(profile).map((item) => item.id), requirementMatchIds: [], sourceMatchSetHash: "fixture-match-hash", now: "2026-11-01T00:00:00.000Z" });
  await repository.saveResumeBranch(jobBuilt.branch);
  await db.resumeRevisions.put(jobBuilt.firstRevision);
  await repository.createApplicationFromBranch({ branchId: jobBuilt.branch.id, expectedBranchRevision: jobBuilt.branch.revision, expectedRevisionId: jobBuilt.firstRevision.id, operationId: "fixture-application" });
  await repository.saveAttachmentSource({ id: "fixture-attachment", agentSessionId: "fixture-session" }, new Uint8Array([37, 80, 68, 70]));
  await db.open();
  return db;
  } finally { vi.useRealTimers(); }
}
function rehash(pkg: MigrationPackage) {
  for (const table of Object.values(pkg.tables)) { table.hashes = table.rows.map(hash); table.count = table.rows.length; }
  return pkg;
}
async function target() { return new SnapshotTarget(join(await mkdtemp(join(tmpdir(), "p520b-")), "domain-snapshot.json")); }

describe("P5.2.0-B isolated migration proof", () => {
  it("exports every v11 table in a read-only transaction and preserves IDs, bytes, content and source DB", async () => {
    const db = await fixture();
    try {
      const before = await exportLegacy(db, "fixture-migration-1");
      expect(Object.keys(before.tables).sort()).toEqual(db.tables.map((t) => t.name).sort());
      expect(Object.keys(before.tables)).toHaveLength(28);
      expect(before.tables.resumeRevisions.count).toBe(2);
      expect(before.tables.jobDescriptions.count).toBe(1);
      expect(before.tables.applications.count).toBe(1);
      expect(verify(before).entities).toBeGreaterThan(3);
      const store = await target();
      expect((await store.import(before)).idempotent).toBe(false);
      expect(await store.read()).toEqual(before);
      expect(await exportLegacy(db, "fixture-migration-1")).toEqual(before);
      expect((await store.import(before)).idempotent).toBe(true);
      expect((await new SnapshotTarget(store.path).read())?.tables.appMeta).toEqual(before.tables.appMeta);
      const worker = () => JSON.parse(execFileSync(process.execPath, [".artifacts/p520b/readback.mjs", store.path], { encoding: "utf8", timeout: 10000 }));
      expect(worker()).toEqual(verify(before));
      expect(worker()).toEqual(verify(before));
      await mkdir(".tmp", { recursive: true });
      await writeFile(".tmp/p520b-migration-run.json", JSON.stringify({
        source: "synthetic fake-indexeddb v11; not real browser or user data", ...verify(before),
        parity: true, sourceUnchanged: true,
        manifest: Object.fromEntries(Object.entries(before.tables).map(([name, table]) => [name, { keyPath: table.keyPath, count: table.count, ids: table.rows.map((r) => r[table.keyPath]), hashes: table.hashes }])),
        branchReferences: before.tables.resumeBranches.rows.map((b) => ({ id: b.id, profileId: b.profileId, currentRevisionId: b.currentRevisionId })),
        revisionReferences: before.tables.resumeRevisions.rows.map((r) => ({ id: r.id, branchId: r.branchId, revisionNumber: r.revisionNumber }))
      }, null, 2));
    } finally { db.close(); }
  });
  it("survives interruption before publication; retries publish once; concurrent identical imports coalesce", async () => {
    const db = await fixture();
    try {
      const pkg = await exportLegacy(db, "restart"); const store = await target();
      await expect(store.import(pkg, true)).rejects.toThrow("injected_interruption");
      expect(await store.read()).toBeUndefined();
      const receipts = await Promise.all([store.import(pkg), new SnapshotTarget(store.path).import(pkg)]);
      expect(receipts.filter((r) => !r.idempotent)).toHaveLength(1);
      expect(await new SnapshotTarget(store.path).read()).toEqual(pkg);
      const conflicting = structuredClone(pkg); conflicting.migrationId = "other";
      await expect(store.import(conflicting)).rejects.toThrow("target_or_migration_conflict");
    } finally { db.close(); }
  });
  it("rejects tampered hashes, missing revision references and wrong ownership", async () => {
    const db = await fixture();
    try {
      const pkg = await exportLegacy(db, "integrity"); const store = await target();
      const bad = structuredClone(pkg); bad.tables.profiles.rows[0].name = "tampered";
      await expect(store.import(bad)).rejects.toThrow("hash_count_mismatch");
      const inventory = structuredClone(pkg); delete inventory.tables.crawlRuns;
      await expect(store.import(inventory)).rejects.toThrow("table_inventory_mismatch");
      const missing = structuredClone(pkg); missing.tables.resumeRevisions.rows = [];
      await expect(store.import(rehash(missing))).rejects.toThrow("missing_reference:resumeRevisions");
      const owner = structuredClone(pkg); owner.tables.resumeBranches.rows[0].profileId = "missing";
      await expect(store.import(rehash(owner))).rejects.toThrow("missing_reference:profiles");
      expect(await store.read()).toBeUndefined();
    } finally { db.close(); }
  });
  it("rejects missing external attachments and unsupported codecs, with no writes to source", async () => {
    const db = await fixture();
    try {
      const pkg = await exportLegacy(db, "attachment");
      pkg.tables.profiles.rows[0].externalEvidence = { filePath: "fixture-only.pdf" };
      expect(() => verify(rehash(pkg))).toThrow("external_attachment_unresolved");
      delete pkg.tables.profiles.rows[0].externalEvidence;
      pkg.tables.profiles.rows[0].materialSource = { attachmentId: "absent" };
      expect(() => verify(rehash(pkg))).toThrow("missing_reference:appMeta");
      expect(decode(canonical({ bytes: new Uint8Array([1]), missing: undefined }))).toEqual({ bytes: new Uint8Array([1]), missing: undefined });
      expect(() => canonical(new Map())).toThrow("unsupported_legacy_value");
      const realName = new CareerAdaptDb("CareerAdaptDb");
      await expect(exportLegacy(realName, "no")).rejects.toThrow("fixture_v11_required");
    } finally { db.close(); }
  });
  it("fails closed for all validated write actions and explicitly blocks rollback after writes", async () => {
    expect(DomainReadSchema.safeParse({ kind: "profile", profileId: "p", sql: "select" }).success).toBe(false);
    expect(() => rejectUnimplementedAction({ kind: "rawCrud" })).toThrow();
    expect(() => rejectUnimplementedAction({ kind: "tailoring", profileId: "p", operationId: "op", expectedRevision: 0, proposalId: "proposal" })).toThrow("domain_action_not_implemented");
    const store = await target();
    await expect(store.rollbackAfterWrites()).rejects.toThrow("BLOCKED");
  });
  it("detects corrupted persisted snapshot on independent readback", async () => {
    const db = await fixture();
    try {
      const pkg = await exportLegacy(db, "disk-corruption"); const store = await target();
      await store.import(pkg);
      const disk = decode(await readFile(store.path, "utf8")) as MigrationPackage;
      disk.tables.profiles.rows[0].name = "corrupt";
      await writeFile(store.path, canonical(disk));
      await expect(new SnapshotTarget(store.path).read()).rejects.toThrow("hash_count_mismatch");
    } finally { db.close(); }
  });
  it("retains canonical Repository CAS concurrency; does not claim target service writes", async () => {
    const db = await fixture();
    try {
      const repository = new WorkspaceRepository(db);
      const branch = (await db.resumeBranches.toArray()).find((b) => b.branchPurpose === "general")!;
      const results = await Promise.allSettled(["one", "two"].map((name) => repository.renameResumeBranch({ branchId: branch.id, name, expectedRevision: branch.revision, operationId: `cas-${name}` })));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(RevisionConflictError);
      expect(await db.resumeRevisions.count()).toBe(3);
      const afterWrite = await exportLegacy(db, "post-write");
      expect(verify(afterWrite).entities).toBeGreaterThan(0);
      const store = await target();
      await store.import(afterWrite);
      expect(await store.read()).toEqual(afterWrite);
    } finally { db.close(); }
  });
});
