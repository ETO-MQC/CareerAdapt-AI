import { createRequire } from "node:module";
import path from "node:path";
const hermes = process.env.HERMES_SOURCE_DIR || path.join(process.env.LOCALAPPDATA, "hermes/hermes-agent");
const { build } = createRequire(path.join(hermes, "apps/desktop/package.json"))("esbuild");
await build({ entryPoints: ["poc/career-domain-persistence/worker.ts"], outfile: ".artifacts/p520b/readback.mjs", bundle: true, platform: "node", format: "esm", target: "node20", sourcemap: false });
process.stdout.write("isolated readback worker build PASS\n");
