import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
const hermes = process.env.HERMES_SOURCE_DIR || path.join(process.env.LOCALAPPDATA, "hermes/hermes-agent");
const requireHermes = createRequire(path.join(hermes, "apps/desktop/package.json"));
const ts = createRequire(import.meta.url)("typescript");
const { build } = requireHermes("esbuild"); // existing locked Desktop development tool, no dependency added
const allowed = ["@hermes/plugin-sdk", "react", "react/jsx-runtime"];
const postcss = createRequire(import.meta.url)("postcss");
const scopedProductStyles = { name: "scoped-product-styles", setup(builder) {
  builder.onLoad({ filter: /product-(components|tokens)\.css$/ }, args => {
    const tree = postcss.parse(fs.readFileSync(args.path, "utf8"));
    tree.walkRules(rule => {
      if (args.path.endsWith("product-tokens.css")) {
        if (rule.selector === ":root") rule.selector = ".ca-experience";
        else if (rule.selector === ':root[data-theme="dark"]') rule.selector = '[data-hermes-mode="dark"] .ca-experience';
        else rule.remove();
      } else rule.selectors = rule.selectors.map(selector => ".ca-experience " + selector);
    });
    return { contents: tree.toString(), loader: "text" };
  });
}};
// Project canonical demo data at build time; renderer receives display DTO only.
const fixtureModule = path.resolve(".artifacts/p522-host-experience/fixture.mjs");
fs.mkdirSync(path.dirname(fixtureModule), { recursive: true });
await build({entryPoints:["poc/host-experience/profile-fixture.ts"],outfile:fixtureModule,bundle:true,platform:"node",format:"esm",target:"node24"});
const { createFaithfulFixture } = await import("node:url").then(({pathToFileURL})=>import(pathToFileURL(fixtureModule).href));
fs.writeFileSync("poc/host-experience/profile-fixture.json",JSON.stringify(createFaithfulFixture(),null,2)+"\n");
const metrics = {};
for (const debug of [false]) {
  const mode = debug ? "debug" : "production-like";
  const outdir = path.resolve(".artifacts/p522-host-experience", mode);
  fs.mkdirSync(outdir, { recursive: true });
  const start = performance.now();
  const result = await build({ entryPoints: ["poc/host-experience/plugin.tsx"], outfile: path.join(outdir, "plugin.js"), bundle: true, format: "esm", platform: "browser", target: "es2022", jsx: "automatic", external: allowed, splitting: false, sourcemap: debug ? "external" : false, minify: !debug, metafile: true, plugins: [scopedProductStyles], loader: { ".css": "text" }, define: { "process.env.NODE_ENV": JSON.stringify("production") } });
  const durationMs = performance.now() - start;
  const outputs = Object.entries(result.metafile.outputs);
  const js = outputs.filter(([name]) => name.endsWith(".js"));
  if (js.length !== 1) throw new Error("Expected single ESM");
  const imports = js[0][1].imports;
  if (outputs.length !== 1) throw new Error("Unexpected output files");
  if (imports.some(i => !i.external || !allowed.includes(i.path) || i.kind !== "import-statement")) throw new Error("Unsupported import: " + JSON.stringify(imports));
  const inputs = Object.keys(result.metafile.inputs);
  const forbidden = inputs.filter(i => /(^|[/\\])(next|dexie)([/\\])|services[/\\](storage|workspace)|ai[/\\]client/.test(i));
  if (forbidden.length) throw new Error("Forbidden inputs: " + forbidden);
  let source = fs.readFileSync(js[0][0], "utf8");
  // Locked loader regex mistakes the catalog's literal "from" for an import.
  // Equal-width template literal preserves value and sourcemap columns; no Core patch.
  const before = ts.createSourceFile("plugin.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const replacements = [];
  function collect(node) {
    if (ts.isStringLiteral(node) && node.text === "from" && source.slice(node.getStart(before), node.end).length === 6) replacements.push([node.getStart(before), node.end]);
    ts.forEachChild(node, collect);
  }
  collect(before);
  for (const [start, end] of replacements.reverse()) source = source.slice(0, start) + "`from`" + source.slice(end);
  fs.writeFileSync(js[0][0], source);
  const loaderRegex = /(from\s*|import\s*\(\s*|import\s+)(['"])([^'"]+)\2/g;
  for (const match of source.matchAll(loaderRegex)) if (!allowed.includes(match[3])) throw new Error("Locked loader rejects: " + match[3]);
  const ast = ts.createSourceFile("plugin.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function scan(node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) throw new Error("Dynamic import");
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && !allowed.includes(node.moduleSpecifier.text)) throw new Error("Unsupported module specifier");
    ts.forEachChild(node, scan);
  }
  scan(ast);
  metrics[mode] = { jsBytes: Buffer.byteLength(source), outputFiles: outputs.map(([name]) => name), dynamicChunks: 0, unresolvedImports: [], sourceMaps: false, cssBytes: fs.statSync("poc/host-experience/experience.css").size, cssDelivery: "embedded in JS, no CSS sidecar", sourceMapBytes: debug ? fs.statSync(path.join(outdir, "plugin.js.map")).size : 0, durationMs, lockedLoaderLiteralWorkarounds: replacements.length, bundledInputCount: inputs.length, loadedModuleCount: null, imports, inputFiles: inputs };
  fs.writeFileSync(path.join(outdir, "metafile.json"), JSON.stringify(result.metafile, null, 2));
}
fs.mkdirSync("docs/architecture/evidence/p522-slice1", { recursive: true });
fs.writeFileSync("docs/architecture/evidence/p522-slice1/plugin-build.json", JSON.stringify({ hermesCommit: "eb52760564dbba2e5971fa54bd67384e281cd3b8", metrics }, null, 2) + "\n");
console.log(JSON.stringify(metrics, null, 2));
