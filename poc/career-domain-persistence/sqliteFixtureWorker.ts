import { readFileSync } from "node:fs";
import { WorkspaceRepository, RevisionConflictError } from "../../src/services/storage/repositories";
import { SQLiteCareerPersistenceAdapter, type SQLiteFixture } from "./sqliteCareerPersistenceAdapter";
import { canonical, decode } from "./migration";

const [mode, path, argument, operationId] = process.argv.slice(2);
const adapter = new SQLiteCareerPersistenceAdapter(path);
try {
  if (mode === "seed") {
    await adapter.seedFixture(decode(readFileSync(argument, "utf8")) as SQLiteFixture);
    process.stdout.write(canonical(adapter.inspectFixture()));
  } else if (mode === "read") process.stdout.write(canonical(adapter.inspectFixture()));
  else if (mode === "compete") {
    process.stdout.write("READY\n");
    await new Promise<void>(resolve => process.stdin.once("data", () => resolve()));
    try {
      // Only the B1 portable edit path. Any accidental legacy Dexie IO fails in Node.
      const result = await new WorkspaceRepository(undefined, adapter).editResumeBranchBasics({ branchId: argument, expectedRevision: 0, operationId, basics: { name: operationId } });
      process.stdout.write(JSON.stringify({ status: "committed", revisionId: result.revision!.id }));
    } catch (error) {
      if (!(error instanceof RevisionConflictError)) throw error;
      process.stdout.write(JSON.stringify({ status: "RevisionConflict" }));
    }
    process.stdin.pause();
  } else throw new Error("unknown_fixture_worker_mode");
} finally { adapter.close(); }
