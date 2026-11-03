const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
const seen = new Set(), forbidden = [];
function visit(file, chain) {
  file = path.resolve(file);
  if (seen.has(file)) return;
  seen.add(file);
  const tree = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  function dependency(spec) {
    if (spec.startsWith("node:") || ["crypto", "fs", "path", "child_process", "os", "util", "stream", "buffer"].includes(spec)) forbidden.push([...chain, file, spec]);
    const resolved = ts.resolveModuleName(spec, file, options, ts.sys).resolvedModule;
    if (resolved && !resolved.isExternalLibraryImport && !resolved.resolvedFileName.endsWith(".d.ts")) visit(resolved.resolvedFileName, [...chain, file]);
  }
  function walk(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (!clause || !clause.isTypeOnly && (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings) || clause.namedBindings.elements.some(e => !e.isTypeOnly))) dependency(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.exportClause || !ts.isNamedExports(node.exportClause) || node.exportClause.elements.some(e => !e.isTypeOnly)) dependency(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteral(node.arguments[0]) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) dependency(node.arguments[0].text);
    ts.forEachChild(node, walk);
  }
  walk(tree);
}
visit("src/app/jobs/JobsWorkspace.tsx", []);
console.log(JSON.stringify({entry:"src/app/jobs/JobsWorkspace.tsx", scope:"repository runtime imports; external packages validated by production build/browser test", visited:seen.size, forbidden}, null, 2));
if (forbidden.length) process.exitCode = 1;
