// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository, RevisionConflictError } from "@/services/storage/repositories";
import { DexieCareerPersistenceAdapter } from "@/services/storage/persistence/dexieCareerPersistenceAdapter";
import type { CareerPersistencePort } from "@/services/storage/persistence/careerPersistencePort";
import { SQLiteCareerPersistenceAdapter, mapSQLiteError, type SQLiteFixture } from "../../poc/career-domain-persistence/sqliteCareerPersistenceAdapter";
import { canonical, decode } from "../../poc/career-domain-persistence/migration";

let db: CareerAdaptDb;
let seed: SQLiteFixture;
let generalId: string;
let jobId: string;
let file: string;
const ids = vi.hoisted(() => ({ next: 0 }));
vi.mock("nanoid", () => ({ nanoid: () => `fixture-${++ids.next}` }));
beforeAll(() => {
  execFileSync(process.execPath, ["poc/career-domain-persistence/build-sqlite.mjs"], { timeout: 10000 });
});
const adapters: SQLiteCareerPersistenceAdapter[] = [];
const sqlite = (path = file, wait = 1000) => {
  const adapter = new SQLiteCareerPersistenceAdapter(path, wait);
  adapters.push(adapter);
  return adapter;
};
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sort = (state: SQLiteFixture): SQLiteFixture => {
  for (const [table, rows] of Object.entries(state)) rows.sort((a, b) => {
    if (table === "revisions") {
      const left = a as SQLiteFixture["revisions"][number];
      const right = b as typeof left;
      return compare(left.branchId, right.branchId) || left.revisionNumber - right.revisionNumber || compare(left.id, right.id);
    }
    return compare(a.id, b.id);
  });
  return state;
};
const readDexie = async (): Promise<SQLiteFixture> => sort({ profiles: await db.profiles.toArray(), jobs: await db.jobDescriptions.toArray(), branches: await db.resumeBranches.toArray(), revisions: await db.resumeRevisions.toArray(), operations: await db.resumeBranchOperations.toArray() });

beforeEach(async () => {
  ids.next = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T01:00:00.000Z"));
  file = join(mkdtempSync(join(tmpdir(), "p520b2a-")), "fixture.sqlite");
  db = new CareerAdaptDb(`p520b2a-fixture-${crypto.randomUUID()}`);
  const repo = new WorkspaceRepository(db);
  await repo.saveProfile(demoCareerProfile);
  await repo.saveProfile({ ...demoCareerProfile, id: "other-profile" });
  await repo.saveJobDescription(demoJobDescriptions[0]);
  const general = await repo.createGeneralResumeBranch({ profileId: demoCareerProfile.id, operationId: "general", name: "General", includeProfileFacts: true, includeProfileBasics: true });
  generalId = general.branch.id;
  await repo.createGeneralResumeBranch({ profileId: demoCareerProfile.id, operationId: "other-general", name: "Other General", includeProfileFacts: true, includeProfileBasics: true });
  await repo.createGeneralResumeBranch({ profileId: "other-profile", operationId: "other-person", name: "Other Person", includeProfileFacts: false, includeProfileBasics: false });
  const job = await repo.createJobSpecificBranchFromProfile({ profileId: demoCareerProfile.id, jobId: demoJobDescriptions[0].id, operationId: "job", name: "Job", selectedCanonicalItemIds: general.branch.structuredContentItems!.map(item => item.data.id), requirementMatchIds: [] });
  jobId = job.branch.id;
  seed = await readDexie();
});
afterEach(async () => {
  for (const adapter of adapters.splice(0)) adapter.close();
  db.close(); await db.delete(); vi.restoreAllMocks(); vi.useRealTimers();
  // Temporary SQL files retained for diagnosis; no recursive/batch deletion.
});

async function harness(kind: "Dexie" | "SQLite") {
  const sql = kind === "SQLite" ? sqlite() : undefined;
  if (sql) await sql.seedFixture(seed);
  const port = sql ?? new DexieCareerPersistenceAdapter(db);
  return { port, repo: new WorkspaceRepository(db, port), state: async () => sql ? sql.inspectFixture() : readDexie() };
}
function fault(port: CareerPersistencePort, stage: "saveBranch" | "appendRevision" | "saveOperation" | "beforeReceipt"): CareerPersistencePort {
  return { withBranchMutation: work => port.withBranchMutation(unit => {
    const wrapped = { ...unit };
    const method = stage === "beforeReceipt" ? "saveOperation" : stage;
    Object.assign(wrapped, { [method]: async (row: never) => {
      if (stage === "beforeReceipt") throw new Error(`injected:${stage}`);
      await (unit[method] as (row: never) => Promise<void>)(row);
      throw new Error(`injected:${stage}`);
    } });
    return work(wrapped);
  }) };
}
for (const kind of ["Dexie", "SQLite"] as const) describe(`${kind} shared persistence contract`, () => {
  it("creates Branch/Revision/Receipt records through the existing unit of work", async () => {
    const h = await harness(kind);
    const source = seed.branches.find(b => b.id === generalId)!;
    const branch = { ...source, id: "port-created-branch", currentRevisionId: "port-created-revision" };
    const revision = { ...seed.revisions.find(r => r.id === source.currentRevisionId)!, id: branch.currentRevisionId, branchId: branch.id, operationId: "port-create" };
    const operation = { ...seed.operations.find(o => o.branchId === source.id)!, id: "port-created-receipt", operationId: "port-create", branchId: branch.id, revisionId: revision.id };
    await h.port.withBranchMutation(async unit => {
      await unit.saveBranch(branch);
      await unit.appendRevision(revision);
      await unit.saveOperation(operation);
    });
    expect(await h.state()).toStrictEqual(sort({ ...seed, branches: [...seed.branches, branch], revisions: [...seed.revisions, revision], operations: [...seed.operations, operation] }));
  });
  it("reads exact Profile/Job/Branch/Revision/Receipt and missing keys", async () => {
    const h = await harness(kind);
    await h.port.withBranchMutation(async unit => {
      expect(await unit.readProfile(seed.profiles[0].id)).toStrictEqual(seed.profiles[0]);
      expect(await unit.readJob(seed.jobs[0].id)).toStrictEqual(seed.jobs[0]);
      expect(await unit.readBranch(generalId)).toStrictEqual(seed.branches.find(b => b.id === generalId));
      expect(await unit.readRevision(seed.revisions[0].id)).toStrictEqual(seed.revisions[0]);
      expect(await unit.findOperation(seed.operations[0].operationId)).toStrictEqual(seed.operations[0]);
      for (const method of ["readProfile", "readJob", "readBranch", "readRevision", "findOperation"] as const) expect(await unit[method]("absent")).toBeUndefined();
    });
    expect(await h.state()).toStrictEqual(seed);
  });
  it.each(["general", "job"])("commits %s edit, sequential revisions, receipt and idempotent replay before CAS", async purpose => {
    const h = await harness(kind);
    const id = purpose === "general" ? generalId : jobId;
    const branch = seed.branches.find(b => b.id === id)!;
    const input = { branchId: id, expectedRevision: branch.revision, operationId: "edit", basics: { name: "Resume only" } };
    const result = await h.repo.editResumeBranchBasics(input);
    let state = await h.state();
    expect(state.branches.find(b => b.id === id)).toStrictEqual(result.branch);
    expect(state.revisions.find(r => r.id === result.revision!.id)).toStrictEqual(result.revision);
    expect(state.operations.find(o => o.operationId === "edit")).toMatchObject({ branchId: id, beforeRevision: 0, afterRevision: 1, revisionId: result.revision!.id });
    expect(result.revision!.previousRevisionId).toBe(branch.currentRevisionId);
    expect(await h.repo.editResumeBranchBasics(input)).toStrictEqual({ ...result, idempotent: true });
    expect(await h.state()).toStrictEqual(state);
    await h.repo.editResumeBranchBasics({ ...input, expectedRevision: 1, operationId: "second" });
    state = await h.state();
    const revisions = state.revisions.filter(r => r.branchId === id);
    expect(revisions.map(r => r.revisionNumber)).toEqual([0, 1, 2]);
    expect(revisions[2].previousRevisionId).toBe(revisions[1].id);
    expect(state.profiles).toStrictEqual(seed.profiles);
    expect(state.jobs).toStrictEqual(seed.jobs);
    expect(state.branches.filter(b => b.id !== id)).toStrictEqual(seed.branches.filter(b => b.id !== id));
    expect(state.revisions.filter(r => r.branchId !== id)).toStrictEqual(seed.revisions.filter(r => r.branchId !== id));
    expect(state.operations.filter(o => o.branchId !== id)).toStrictEqual(seed.operations.filter(o => o.branchId !== id));
  });
  it("serializes two competing CAS edits with one winner and no orphan records", async () => {
    const h = await harness(kind);
    const result = await Promise.allSettled(["left", "right"].map(operationId => h.repo.editResumeBranchBasics({ branchId: generalId, expectedRevision: 0, operationId, basics: { name: operationId } })));
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const failed = result.find(r => r.status === "rejected");
    expect(failed?.status === "rejected" && failed.reason).toBeInstanceOf(RevisionConflictError);
    const state = await h.state();
    expect(state.revisions).toHaveLength(seed.revisions.length + 1);
    expect(state.operations).toHaveLength(seed.operations.length + 1);
    const receipt = state.operations.find(o => !seed.operations.some(s => s.id === o.id))!;
    expect(state.branches.find(b => b.id === generalId)!.currentRevisionId).toBe(receipt.revisionId);
    expect(state.revisions.find(r => r.id === receipt.revisionId)!.previousRevisionId).toBe(seed.branches.find(b => b.id === generalId)!.currentRevisionId);
  });
  it.each(["saveBranch", "appendRevision", "beforeReceipt", "saveOperation"] as const)("rolls back formal five-store state at %s", async stage => {
    const h = await harness(kind);
    const repo = new WorkspaceRepository(db, fault(h.port, stage));
    await expect(repo.editResumeBranchBasics({ branchId: generalId, expectedRevision: 0, operationId: "failure", basics: { name: "Rollback" } })).rejects.toThrow(`injected:${stage}`);
    expect(await h.state()).toStrictEqual(seed);
  });
  it("rejects duplicate operationId on another primary key and rolls back Branch", async () => {
    const h = await harness(kind);
    await expect(h.port.withBranchMutation(async unit => {
      await unit.saveBranch({ ...seed.branches[0], name: "Rollback" });
      await unit.saveOperation({ ...seed.operations[0], id: "duplicate-id" });
    })).rejects.toMatchObject(kind === "SQLite" ? { kind: "OPERATION_ID_CONFLICT" } : { name: "ConstraintError" });
    expect(await h.state()).toStrictEqual(seed);
  });
  it("blocks unconfirmed new claims and permits explicit resume-only confirmation without Profile writes", async () => {
    const h = await harness(kind);
    const branch = seed.branches.find(b => b.id === generalId)!;
    const item = branch.contentItems.find(item => item.itemType !== "structural")!;
    const input = { branchId: generalId, expectedRevision: 0, operationId: "claim", edits: [{ itemId: item.id, text: `${item.text} 9999%` }] };
    await expect(h.repo.editResumeBranch(input)).rejects.toThrow("branch_edit_fact_guard_blocked");
    expect(await h.state()).toStrictEqual(seed);
    const result = await h.repo.editResumeBranch({ ...input, confirmAsResumeOnly: true });
    const state = await h.state();
    expect(state.branches.find(b => b.id === generalId)).toStrictEqual(result.branch);
    expect(state.revisions.find(r => r.id === result.revision!.id)).toStrictEqual(result.revision);
    expect(result.branch.contentItems.find(i => i.id === item.id)!.userConfirmation).toMatchObject({ scope: "resume_only" });
    expect(state.profiles).toStrictEqual(seed.profiles);
    expect(state.jobs).toStrictEqual(seed.jobs);
    expect(state.branches.filter(b => b.id !== generalId)).toStrictEqual(seed.branches.filter(b => b.id !== generalId));
  });
});

it("produces exact Dexie/SQLite persisted parity with identical canonical rules, time, IDs and inputs", async () => {
  const dexie = await harness("Dexie");
  const sql = await harness("SQLite");
  for (const h of [dexie, sql]) {
    await h.repo.editResumeBranchBasics({ branchId: generalId, expectedRevision: 0, operationId: "parity-general", basics: { name: "Same" } });
    const input = { branchId: jobId, expectedRevision: 0, operationId: "parity-job", edits: [{ itemId: seed.branches.find(b => b.id === jobId)!.contentItems[0].id, visible: false, order: 99 }] };
    await h.repo.editResumeBranch(input);
    await h.repo.editResumeBranch(input);
  }
  expect(await sql.state()).toStrictEqual(await dexie.state());
  expect(canonical(await sql.state())).toBe(canonical(await dexie.state()));
  const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
  writeFileSync(".artifacts/p520b2a/parity-observation.json", JSON.stringify({
    node: process.versions.node, sqlite: process.versions.sqlite,
    fixtureHash: digest(seed), dexieHash: digest(await dexie.state()), sqliteHash: digest(await sql.state()),
    normalizedFields: [], counts: Object.fromEntries(Object.entries(await sql.state()).map(([key, rows]) => [key, rows.length]))
  }, null, 2));
});

it("reopens the same file in a new Adapter with all rows and idempotency intact", async () => {
  const first = sqlite();
  await first.seedFixture(seed);
  const repo = new WorkspaceRepository(db, first);
  const input = { branchId: generalId, expectedRevision: 0, operationId: "restart", basics: { name: "Persisted" } };
  await repo.editResumeBranchBasics(input);
  const state = first.inspectFixture();
  first.close(); adapters.splice(adapters.indexOf(first), 1);
  const reopened = sqlite();
  expect(reopened.inspectFixture()).toStrictEqual(state);
  expect((await new WorkspaceRepository(db, reopened).editResumeBranchBasics(input)).idempotent).toBe(true);
  expect(reopened.inspectFixture()).toStrictEqual(state);
});

it("serializes independent SQLite instances so competing CAS is one success/one RevisionConflict", async () => {
  const first = sqlite(); const second = sqlite(); await first.seedFixture(seed);
  const results = await Promise.allSettled([first, second].map((port, i) => new WorkspaceRepository(db, port).editResumeBranchBasics({ branchId: generalId, expectedRevision: 0, operationId: `instance-${i}`, basics: { name: `writer-${i}` } })));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const failure = results.find(r => r.status === "rejected");
  expect(failure?.status === "rejected" && failure.reason).toBeInstanceOf(RevisionConflictError);
  expect(first.inspectFixture()).toStrictEqual(second.inspectFixture());
  expect(first.inspectFixture().revisions).toHaveLength(seed.revisions.length + 1);
  expect(first.inspectFixture().operations).toHaveLength(seed.operations.length + 1);
});

it("preserves undefined/null/optional fields, dates, numeric types, nested objects and array order with explicit codec", async () => {
  const sql = sqlite();
  const branch = seed.branches[0];
  branch.legacyPayload = { presentUndefined: undefined, nullValue: null, date: new Date("2026-11-02T00:00:00Z"), number: 42, string: "42", array: [null, undefined, { nested: true }], tagCollision: ["undefined"] };
  await sql.seedFixture(seed);
  expect(sql.inspectFixture()).toStrictEqual(seed);
  expect(decode(canonical(branch.legacyPayload))).toStrictEqual(branch.legacyPayload);
  await expect(sql.withBranchMutation(async unit => { await unit.saveBranch({ ...branch, legacyPayload: () => 1 }); })).rejects.toMatchObject({ kind: "SERIALIZATION" });
  expect(sql.inspectFixture()).toStrictEqual(seed);
});

it("keeps SQLITE_BUSY distinct from CAS conflict and leaves no writes when lock acquisition expires", async () => {
  const first = sqlite(); const second = sqlite(file, 0); await first.seedFixture(seed);
  await first.withBranchMutation(async () => {
    await expect(new WorkspaceRepository(db, second).editResumeBranchBasics({ branchId: generalId, expectedRevision: 0, operationId: "busy", basics: { name: "Blocked" } })).rejects.toMatchObject({ kind: "SQLITE_BUSY" });
  });
  expect(first.inspectFixture()).toStrictEqual(seed);
});

it("maps LOCKED/corruption/other storage errors distinctly, retaining cause", () => {
  for (const [errcode, kind] of [[6, "SQLITE_LOCKED"], [11, "DATABASE_CORRUPT"], [26, "DATABASE_CORRUPT"], [10, "STORAGE"]] as const) {
    const cause = { errcode, message: "probe" };
    expect(mapSQLiteError(cause)).toMatchObject({ kind, cause });
  }
});

it("rejects corrupt files and unknown schema versions without modifying them", () => {
  const bad = `${file}.corrupt`; writeFileSync(bad, "not a sqlite database");
  expect(() => sqlite(bad)).toThrowError("DATABASE_CORRUPT");
  const raw = new DatabaseSync(file); raw.exec("PRAGMA user_version=99"); raw.close();
  expect(() => sqlite()).toThrowError("STORAGE");
  const check = new DatabaseSync(file); expect(check.prepare("PRAGMA user_version").get()!.user_version).toBe(99); check.close();
});

it("round-trips all persisted rows across two terminated Node processes", async () => {
  const { spawnSync } = await import("node:child_process");
  const sql = sqlite(); await sql.seedFixture(seed);
  await new WorkspaceRepository(db, sql).editResumeBranchBasics({ branchId: generalId, expectedRevision: 0, operationId: "process-restart", basics: { name: "Process persistence" } });
  const state = sql.inspectFixture();
  const fixturePath = `${file}.fixture`;
  writeFileSync(fixturePath, canonical(state));
  const target = `${file}.process.sqlite`;
  const worker = join(process.cwd(), ".artifacts/p520b2a/sqlite-fixture-worker.mjs");
  for (const args of [["seed", target, fixturePath], ["read", target]]) {
    const child = spawnSync(process.execPath, [worker, ...args], { encoding: "utf8", timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(decode(child.stdout)).toStrictEqual(state);
  }
});

it("preserves CAS across two independent Node writer processes", async () => {
  const { spawn } = await import("node:child_process");
  const sql = sqlite(); await sql.seedFixture(seed);
  const worker = join(process.cwd(), ".artifacts/p520b2a/sqlite-fixture-worker.mjs");
  const children = ["process-left", "process-right"].map(operationId => {
    const child = spawn(process.execPath, [worker, "compete", file, generalId, operationId], { stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; let stderr = "";
    let readyResolve: () => void;
    let readyReject: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const timer = setTimeout(() => { child.kill(); readyReject(new Error("writer_ready_timeout")); }, 10000);
    child.stdout.on("data", data => { output += String(data); if (output.includes("READY\n")) readyResolve(); });
    child.stderr.on("data", data => { stderr += String(data); });
    const done = new Promise<string>((resolve, reject) => {
      child.on("error", error => { clearTimeout(timer); readyReject(error); reject(error); });
      child.on("exit", code => {
        clearTimeout(timer);
        if (!output.includes("READY\n")) readyReject(new Error(`writer_not_ready:${code}:${stderr}`));
        if (code === 0) resolve(output.slice(output.indexOf("\n") + 1));
        else reject(new Error(`writer_exit:${code}:${stderr}`));
      });
    });
    // Attach rejection handlers while waiting for both READY signals.
    void done.catch(() => undefined);
    return { child, ready, done };
  });
  try {
    await Promise.all(children.map(child => child.ready));
    for (const child of children) child.child.stdin.end("go\n");
    const results = (await Promise.all(children.map(child => child.done))).map(text => JSON.parse(text) as { status: string; revisionId?: string });
    expect(results.map(r => r.status).sort()).toEqual(["RevisionConflict", "committed"]);
    const state = sql.inspectFixture();
    expect(state.revisions).toHaveLength(seed.revisions.length + 1);
    expect(state.operations).toHaveLength(seed.operations.length + 1);
    expect(state.branches.find(b => b.id === generalId)!.currentRevisionId).toBe(results.find(r => r.status === "committed")!.revisionId);
  } finally {
    for (const { child } of children) if (child.exitCode === null) child.kill();
  }
}, 15000);

for (const missing of ["Profile", "Job"] as const) it(`preserves identical missing ${missing} validation and complete rollback`, async () => {
  const altered = structuredClone(seed);
  if (missing === "Profile") {
    altered.profiles = altered.profiles.filter(p => p.id !== demoCareerProfile.id);
    await db.profiles.delete(demoCareerProfile.id);
  } else {
    altered.jobs = [];
    await db.jobDescriptions.clear();
  }
  const sql = sqlite(); await sql.seedFixture(altered);
  for (const port of [new DexieCareerPersistenceAdapter(db), sql]) {
    await expect(new WorkspaceRepository(db, port).editResumeBranchBasics({ branchId: jobId, expectedRevision: 0, operationId: "missing-source", basics: { name: "Blocked" } })).rejects.toThrow("branch_source_missing");
  }
  expect(sql.inspectFixture()).toStrictEqual(altered);
  expect(await readDexie()).toStrictEqual(altered);
});
