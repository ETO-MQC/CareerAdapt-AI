import { createRequire } from "node:module";
import path from "node:path";
const hermes = process.env.HERMES_SOURCE_DIR || path.join(process.env.LOCALAPPDATA, "hermes/hermes-agent");
// Reuse existing tooling, no new dev or production dependency.
const { build } = createRequire(path.join(hermes, "apps/desktop/package.json"))("esbuild");
await build({ entryPoints: ["poc/career-domain-persistence/sqliteFixtureWorker.ts"], outfile: ".artifacts/p520b2a/sqlite-fixture-worker.mjs", bundle: true, platform: "node", format: "esm", target: "node24", sourcemap: false });
process.stdout.write("isolated SQLite fixture worker build PASS\n");
