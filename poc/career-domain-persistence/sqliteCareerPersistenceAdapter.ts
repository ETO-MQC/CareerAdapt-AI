import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import {
  CareerProfileSchema, JobDescriptionSchema, ResumeBranchSchema,
  ResumeRevisionSchema, ResumeBranchOperationSchema
} from "../../src/domain/schemas";
import type { CareerProfile, JobDescription, ResumeBranch, ResumeRevision, ResumeBranchOperation } from "../../src/domain/schemas";
import type { BranchMutationUnitOfWork, CareerPersistencePort } from "../../src/services/storage/persistence/careerPersistencePort";
import { canonical, decode } from "./migration";

export type SQLiteFailure = "SQLITE_BUSY" | "SQLITE_LOCKED" | "DATABASE_CORRUPT" | "OPERATION_ID_CONFLICT" | "SERIALIZATION" | "STORAGE";
export class SQLitePersistenceError extends Error {
  constructor(readonly kind: SQLiteFailure, cause: unknown) {
    super(kind, { cause });
    this.name = "SQLitePersistenceError";
  }
}
/** Only map storage errors; Repository errors (including RevisionConflictError) retain identity. */
export function mapSQLiteError(cause: unknown): SQLitePersistenceError {
  const error = cause as { errcode?: number; message?: string };
  const code = (error?.errcode ?? -1) & 255;
  const kind = code === 5 ? "SQLITE_BUSY" : code === 6 ? "SQLITE_LOCKED"
    : code === 11 || code === 26 ? "DATABASE_CORRUPT"
    : code === 19 && error.message?.includes("operations.operation_id") ? "OPERATION_ID_CONFLICT" : "STORAGE";
  return new SQLitePersistenceError(kind, cause);
}

const schemas = {
  profiles: CareerProfileSchema, jobs: JobDescriptionSchema, branches: ResumeBranchSchema,
  revisions: ResumeRevisionSchema, operations: ResumeBranchOperationSchema
};
type Rows = { profiles: CareerProfile; jobs: JobDescription; branches: ResumeBranch; revisions: ResumeRevision; operations: ResumeBranchOperation };
export type SQLiteFixture = { [K in keyof Rows]: Rows[K][] };

/** Isolated B2-A infrastructure. Never imported by the production composition root.
 * BEGIN IMMEDIATE owns CAS and receipt lookup through COMMIT. Only lock acquisition
 * retries asynchronously; the business callback is never retried after execution.
 */
export class SQLiteCareerPersistenceAdapter implements CareerPersistencePort {
  private readonly db: DatabaseSync;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  constructor(path: string, private readonly lockWaitMs = 1000) {
    try { this.db = new DatabaseSync(path); }
    catch (error) { throw mapSQLiteError(error); }
    try {
      this.sql(() => this.db.exec("PRAGMA busy_timeout=0"));
      this.sql(() => this.db.exec("BEGIN IMMEDIATE"));
      const version = Number(this.sql(() => this.db.prepare("PRAGMA user_version").get())!.user_version);
      if (version !== 0 && version !== 1) throw new SQLitePersistenceError("STORAGE", new Error(`unsupported_schema_version:${version}`));
      if (version === 0) this.sql(() => this.db.exec(`
        CREATE TABLE profiles(id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE jobs(id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE branches(id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, job_id TEXT,
          revision INTEGER NOT NULL, current_revision_id TEXT, payload TEXT NOT NULL);
        CREATE INDEX branches_owner ON branches(profile_id, job_id);
        CREATE TABLE revisions(id TEXT PRIMARY KEY NOT NULL, branch_id TEXT NOT NULL,
          revision_number INTEGER NOT NULL, previous_revision_id TEXT, payload TEXT NOT NULL);
        CREATE INDEX revisions_order ON revisions(branch_id, revision_number);
        CREATE TABLE operations(id TEXT PRIMARY KEY NOT NULL, operation_id TEXT NOT NULL UNIQUE,
          branch_id TEXT, revision_id TEXT, payload TEXT NOT NULL);
        CREATE INDEX operations_branch ON operations(branch_id);
        PRAGMA user_version=1;
      `));
      this.sql(() => this.db.exec("COMMIT"));
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      this.db.close();
      throw error;
    }
  }
  private sql<T>(work: () => T): T {
    try { return work(); } catch (error) { throw mapSQLiteError(error); }
  }
  private payload<K extends keyof Rows>(table: K, value: unknown): string {
    try {
      // Validate without replacing the value: Zod defaults/stripping must not alter storage semantics.
      schemas[table].parse(value);
      return canonical(value);
    } catch (error) { throw new SQLitePersistenceError("SERIALIZATION", error); }
  }
  private unpack<K extends keyof Rows>(table: K, text: string): Rows[K] {
    try {
      const value = decode(text);
      schemas[table].parse(value);
      return value as Rows[K];
    } catch (error) { throw new SQLitePersistenceError("SERIALIZATION", error); }
  }
  private read<K extends keyof Rows>(table: K, id: string): Rows[K] | undefined {
    const row = this.sql(() => this.db.prepare(`SELECT payload FROM ${table} WHERE id=?`).get(id));
    return row ? this.unpack(table, row.payload as string) : undefined;
  }
  private put<K extends keyof Rows>(table: K, value: Rows[K]): void {
    const payload = this.payload(table, value);
    // Same primary-key put semantics as Dexie, including revision overwrites.
    if (table === "branches") {
      const row = value as ResumeBranch;
      this.sql(() => this.db.prepare(`INSERT INTO branches VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        profile_id=excluded.profile_id, job_id=excluded.job_id, revision=excluded.revision,
        current_revision_id=excluded.current_revision_id, payload=excluded.payload`).run(row.id, row.profileId, row.jobId ?? null, row.revision, row.currentRevisionId ?? null, payload));
    } else if (table === "revisions") {
      const row = value as ResumeRevision;
      this.sql(() => this.db.prepare(`INSERT INTO revisions VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        branch_id=excluded.branch_id, revision_number=excluded.revision_number,
        previous_revision_id=excluded.previous_revision_id, payload=excluded.payload`).run(row.id, row.branchId, row.revisionNumber, row.previousRevisionId ?? null, payload));
    } else if (table === "operations") {
      const row = value as ResumeBranchOperation;
      this.sql(() => this.db.prepare(`INSERT INTO operations VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        operation_id=excluded.operation_id, branch_id=excluded.branch_id,
        revision_id=excluded.revision_id, payload=excluded.payload`).run(row.id, row.operationId, row.branchId ?? null, row.revisionId ?? null, payload));
    } else this.sql(() => this.db.prepare(`INSERT INTO ${table} VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`).run(value.id, payload));
  }
  withBranchMutation<T>(work: (unit: BranchMutationUnitOfWork) => Promise<T>): Promise<T> {
    this.pending++;
    const result = this.tail.then(async () => {
      const deadline = Date.now() + this.lockWaitMs;
      for (;;) {
        try { this.sql(() => this.db.exec("BEGIN IMMEDIATE")); break; }
        catch (error) {
          if (!(error instanceof SQLitePersistenceError) || error.kind !== "SQLITE_BUSY" || Date.now() >= deadline) throw error;
          await delay(5);
        }
      }
      try {
        const result = await work({
          findOperation: async id => {
            const row = this.sql(() => this.db.prepare("SELECT payload FROM operations WHERE operation_id=?").get(id));
            return row ? this.unpack("operations", row.payload as string) : undefined;
          },
          readBranch: async id => this.read("branches", id),
          readRevision: async id => this.read("revisions", id),
          readProfile: async id => this.read("profiles", id),
          readJob: async id => this.read("jobs", id),
          saveBranch: async row => this.put("branches", row),
          appendRevision: async row => this.put("revisions", row),
          saveOperation: async row => this.put("operations", row)
        });
        this.sql(() => this.db.exec("COMMIT"));
        return result;
      } catch (error) {
        try { this.sql(() => this.db.exec("ROLLBACK")); }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], "sqlite_rollback_failed"); }
        throw error;
      }
    });
    this.tail = result.then(() => undefined, () => undefined);
    return result.finally(() => { this.pending--; });
  }
  /** Fixture harness only; no business data import API. */
  async seedFixture(fixture: SQLiteFixture): Promise<void> {
    await this.withBranchMutation(async () => {
      for (const table of Object.keys(schemas) as (keyof Rows)[]) for (const row of fixture[table]) this.put(table, row);
    });
  }
  /** Formal persisted rows, sorted using explicit equivalents of Dexie query keys. */
  inspectFixture(): SQLiteFixture {
    if (this.pending) throw new Error("sqlite_inspection_during_transaction");
    return Object.fromEntries((Object.keys(schemas) as (keyof Rows)[]).map(table => [table,
      this.sql(() => this.db.prepare(`SELECT payload FROM ${table} ORDER BY ${table === "revisions" ? "branch_id, revision_number, id" : "id"}`).all())
        .map(row => this.unpack(table, row.payload as string))])) as SQLiteFixture;
  }
  close(): void {
    if (this.pending) throw new Error("sqlite_close_during_transaction");
    this.sql(() => this.db.close());
  }
}

