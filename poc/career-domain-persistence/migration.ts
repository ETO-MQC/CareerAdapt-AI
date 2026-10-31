import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { CareerAdaptDb } from "../../src/services/storage/db";

export type Row = Record<string, unknown>;
const V11_TABLES = "profiles jobDescriptions rawInputs pdfImportSessions pdfPageTexts profileImportDrafts jobAnalysisDrafts draftCommits requirementMatches matchOperations jobAdaptationDrafts aiSuggestions adaptationSnapshots suggestionOperations resumeBranches resumeRevisions resumeBranchOperations aiLogs exportRecords applications agentSessions agentMessages crawlSources jobListings jobSnapshots crawlRuns applicationDrafts appMeta".split(" ").sort();
export type MigrationPackage = {
  exportVersion: 1; schemaVersion: 11; migrationId: string;
  tables: Record<string, { keyPath: string; rows: Row[]; hashes: string[]; count: number }>;
};

// Every container is tagged, so user content cannot collide with binary/undefined tags.
export function canonical(value: unknown): string {
  function encode(input: unknown): unknown {
    if (input === undefined) return ["undefined"];
    if (input === null || typeof input === "string" || typeof input === "boolean") return ["scalar", input];
    if (typeof input === "number" && Number.isFinite(input) && !Object.is(input, -0)) return ["scalar", input];
    if (input instanceof Uint8Array) return ["uint8", Buffer.from(input).toString("base64")];
    if (input instanceof ArrayBuffer) return ["buffer", Buffer.from(input).toString("base64")];
    if (input instanceof Date && Number.isFinite(input.getTime())) return ["date", input.toISOString()];
    if (Array.isArray(input)) return ["array", input.map(encode)];
    if (input && typeof input === "object" && Object.getPrototypeOf(input) === Object.prototype) {
      return ["object", Object.keys(input).sort().map((key) => [key, encode((input as Row)[key])])];
    }
    throw new Error("unsupported_legacy_value: explicit codec required");
  }
  return JSON.stringify(encode(value));
}
export function decode(text: string): unknown {
  function unpack(value: unknown): unknown {
    if (!Array.isArray(value)) throw new Error("invalid_codec");
    const [tag, body] = value;
    if (tag === "undefined" && value.length === 1) return undefined;
    if (value.length !== 2) throw new Error("invalid_codec");
    if (tag === "scalar" && (body === null || typeof body === "string" || typeof body === "boolean" || (typeof body === "number" && Number.isFinite(body)))) return body;
    if (tag === "array" && Array.isArray(body)) return body.map(unpack);
    if (tag === "object" && Array.isArray(body)) return Object.fromEntries(body.map((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string") throw new Error("invalid_codec");
      return [pair[0], unpack(pair[1])];
    }));
    if ((tag === "uint8" || tag === "buffer") && typeof body === "string") {
      const bytes = Buffer.from(body, "base64");
      if (bytes.toString("base64") !== body) throw new Error("invalid_codec");
      const result = Uint8Array.from(bytes);
      return tag === "uint8" ? result : result.buffer;
    }
    if (tag === "date" && typeof body === "string" && Number.isFinite(new Date(body).getTime())) return new Date(body);
    throw new Error("invalid_codec");
  }
  return unpack(JSON.parse(text));
}
export const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

/** Only explicitly named synthetic v11 DBs. Never opens the production default DB. */
export async function exportLegacy(db: CareerAdaptDb, migrationId: string): Promise<MigrationPackage> {
  if (!db.name.startsWith("p520b-fixture-") || !db.isOpen() || db.verno !== 11 || !migrationId) throw new Error("fixture_v11_required");
  const tables: MigrationPackage["tables"] = {};
  await db.transaction("r", db.tables, async () => {
    for (const table of [...db.tables].sort((a, b) => a.name.localeCompare(b.name))) {
      const keyPath = table.schema.primKey.keyPath;
      if (typeof keyPath !== "string") throw new Error("unsupported_key");
      const rows = await table.toArray() as Row[];
      rows.sort((a, b) => String(a[keyPath]).localeCompare(String(b[keyPath])));
      tables[table.name] = { keyPath, rows, hashes: rows.map(hash), count: rows.length };
    }
  });
  return { exportVersion: 1, schemaVersion: 11, migrationId, tables };
}

/** Limited explicit reference graph; not a complete validator for opaque appMeta payloads. */
export function verify(pkg: MigrationPackage) {
  if (pkg.exportVersion !== 1 || pkg.schemaVersion !== 11 || !pkg.migrationId) throw new Error("package_version");
  if (canonical(Object.keys(pkg.tables).sort()) !== canonical(V11_TABLES)) throw new Error("table_inventory_mismatch");
  for (const [name, table] of Object.entries(pkg.tables)) {
    if (table.keyPath !== (name === "appMeta" ? "key" : name === "draftCommits" ? "commitId" : "id")) throw new Error("primary_key_mismatch");
    if (table.count !== table.rows.length || canonical(table.hashes) !== canonical(table.rows.map(hash))) throw new Error("hash_count_mismatch");
    const keys = table.rows.map((row) => row[table.keyPath]);
    if (keys.some((key) => typeof key !== "string" || !key) || new Set(keys).size !== keys.length) throw new Error("duplicate_or_missing_id");
  }
  const rows = (table: string) => pkg.tables[table]?.rows ?? [];
  const requireRef = (table: string, id: unknown) => {
    if (typeof id !== "string" || !rows(table).some((row) => row[pkg.tables[table].keyPath] === id)) throw new Error(`missing_reference:${table}:${String(id)}`);
  };
  for (const branch of rows("resumeBranches")) {
    requireRef("profiles", branch.profileId);
    if (branch.jobId) requireRef("jobDescriptions", branch.jobId);
    if (branch.sourceBranchId) requireRef("resumeBranches", branch.sourceBranchId);
    if (branch.sourceRevisionId) requireRef("resumeRevisions", branch.sourceRevisionId);
    if (branch.currentRevisionId) {
      requireRef("resumeRevisions", branch.currentRevisionId);
      if (!rows("resumeRevisions").some((r) => r.id === branch.currentRevisionId && r.branchId === branch.id)) throw new Error("revision_owner_mismatch");
    }
  }
  const sequence = new Set<string>();
  for (const revision of rows("resumeRevisions")) {
    requireRef("resumeBranches", revision.branchId);
    if (revision.previousRevisionId) {
      requireRef("resumeRevisions", revision.previousRevisionId);
      const previous = rows("resumeRevisions").find((r) => r.id === revision.previousRevisionId)!;
      if (previous.branchId !== revision.branchId || Number(previous.revisionNumber) + 1 !== revision.revisionNumber) throw new Error("revision_order_mismatch");
    } else if (revision.revisionNumber !== 0) throw new Error("revision_predecessor_missing");
    if (revision.restoredFromRevisionId) requireRef("resumeRevisions", revision.restoredFromRevisionId);
    const key = `${String(revision.branchId)}:${String(revision.revisionNumber)}`;
    if (sequence.has(key)) throw new Error("duplicate_revision_number");
    sequence.add(key);
  }
  for (const application of rows("applications")) {
    requireRef("profiles", application.profileId);
    requireRef("jobDescriptions", application.jobId);
    if (application.jobSpecificBranchId) requireRef("resumeBranches", application.jobSpecificBranchId);
    if (application.selectedRevisionId) requireRef("resumeRevisions", application.selectedRevisionId);
  }
  for (const message of rows("agentMessages")) requireRef("agentSessions", message.sessionId);
  // Never dereference arbitrary local paths. External file copying remains blocked.
  function attachments(value: unknown): void {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "filePath" && child) throw new Error("external_attachment_unresolved");
      if (key === "materialSource" && child && typeof child === "object") {
        const id = (child as Row).attachmentId;
        requireRef("appMeta", `attachment-source:${String(id)}`);
      }
      attachments(child);
    }
  }
  attachments(pkg.tables);
  return { tables: Object.keys(pkg.tables).length, entities: Object.values(pkg.tables).reduce((n, t) => n + t.count, 0), hash: hash(pkg) };
}

/** Isolated immutable snapshot store, NOT a production Repository replacement.
 * Hard-link publish is atomic create-if-absent; no overwriting concurrent migrations.
 */
export class SnapshotTarget {
  constructor(readonly path: string) {}
  async read(): Promise<MigrationPackage | undefined> {
    let bytes: string;
    try { bytes = await readFile(this.path, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    const pkg = decode(bytes) as MigrationPackage;
    verify(pkg);
    return pkg;
  }
  async import(pkg: MigrationPackage, failBeforePublish = false) {
    const integrity = verify(pkg);
    const existing = await this.read();
    if (existing) {
      if (hash(existing) !== integrity.hash) throw new Error("target_or_migration_conflict");
      return { idempotent: true, ...integrity };
    }
    await mkdir(dirname(this.path), { recursive: true });
    const stage = `${this.path}.${crypto.randomUUID()}.stage`;
    await writeFile(stage, canonical(pkg), { flag: "wx" });
    // A crash here leaves only a staging artifact. A retry never reads staging files.
    if (failBeforePublish) throw new Error("injected_interruption");
    const { link } = await import("node:fs/promises");
    try { await link(stage, this.path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const winner = await this.read();
      if (!winner || hash(winner) !== integrity.hash) throw new Error("target_or_migration_conflict");
      return { idempotent: true, ...integrity };
    }
    return { idempotent: false, ...integrity };
  }
  // No business writes are provided: fail closed until the canonical Repository is ported.
  async rollbackAfterWrites(): Promise<never> { throw new Error("BLOCKED: reverse journal and Repository replay not implemented"); }
}

