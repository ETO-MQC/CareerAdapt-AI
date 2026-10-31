import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createHash } from "node:crypto";

const file = "src/services/storage/repositories.ts";
const source = fs.readFileSync(file, "utf8");
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const repository = ast.statements.find((s) => ts.isClassDeclaration(s) && s.name?.text === "WorkspaceRepository");
if (!repository) throw new Error("repository_missing");
const methods = repository.members.filter(ts.isMethodDeclaration).map((method) => {
  const body = method.getText(ast);
  return {
    method: method.name.getText(ast), line: ast.getLineAndCharacterOfPosition(method.getStart(ast)).line + 1,
    directDexie: /this\.db\./.test(body),
    tables: [...new Set([...body.matchAll(/this\.db\.([a-zA-Z]+)/g)].map((m) => m[1]))].sort(),
    transaction: /this\.db\.transaction/.test(body),
    revisionCheck: /expectedRevision|expectedBranchRevision|sessionRevision/.test(body),
    operationId: /operationId/.test(body)
  };
});
const imports = ast.statements.filter(ts.isImportDeclaration).map((s) => s.moduleSpecifier.text);
const db = fs.readFileSync("src/services/storage/db.ts", "utf8");
const tableBlock = db.slice(db.indexOf("this.version(11).stores({") + "this.version(11).stores({".length).split("});")[0];
const tables = [...tableBlock.matchAll(/(\w+): "([^"]+)"/g)].map((m) => ({ name: m[1], indexes: m[2] }));
const pure = ["src/domain/schemas/resumeV2.ts", "src/domain/adaptation/factGuard.ts", "src/ai/prompts/claimSafetyV2.ts", "src/domain/branch/profileBranch.ts", "src/domain/schemas/profileReconciliation.ts"];
const files = [file, "src/services/storage/db.ts", "electron/main.js", "electron/preload.js", "electron/hermesSupervisor.js", "scripts/hermes-runtime-lock.json", ...pure];
const result = { schemaVersion: 11, tables, imports, methods, summary: { methods: methods.length, directDexieMethods: methods.filter((m) => m.directDexie).length, transactionMethods: methods.filter((m) => m.transaction).length },
  sourceHashes: Object.fromEntries(files.map((f) => [f, createHash("sha256").update(fs.readFileSync(f)).digest("hex")])) };
fs.mkdirSync(path.join("poc", "career-domain-persistence", "evidence"), { recursive: true });
fs.writeFileSync("poc/career-domain-persistence/evidence/dependency-audit.json", JSON.stringify(result, null, 2) + "\n");
process.stdout.write(JSON.stringify(result.summary) + "\n");
