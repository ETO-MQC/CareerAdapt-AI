import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import companion from "../electron/hermesCompanion.js";
import { startFakeOpenAiProvider } from "../tests/support/fake-openai-compatible-provider.mjs";

const root = process.cwd();
const evidence = path.join(root, "docs/quality/p522-h4b1c", `browser-${Date.now()}`);
fs.mkdirSync(evidence, { recursive: true });
const runtimeHome = fs.mkdtempSync(path.join(os.tmpdir(), "p522-h4b1c-hermes-"));
const provider = await startFakeOpenAiProvider({ mode: "integration", routeSkills: false, responseForRequest: ({ messages, tools }) => {
 const last = messages.findLastIndex(message => message.role === "user");
 const currentText = JSON.stringify(messages[last]?.content ?? "");
 const called = messages.slice(last + 1).some(message => message.role === "tool" && message.name?.replaceAll(".", "_").endsWith("career_workflow_profile_preferences"));
 let args;
 if (currentText.includes("跨境电商运营") && !called) args = { intent: "candidate", sourceQuote: "我最近也开始考虑跨境电商运营，地点还是优先郑州。", patch: { additions: { targetRoles: ["跨境电商运营"], targetCities: ["郑州"] } } };
 else if (currentText.includes("城市再加上海") && !called) args = { intent: "candidate", sourceQuote: "城市再加上海", patch: { additions: { targetCities: ["上海"] } } };
 if (args) {
  const name = tools.map(tool => tool.function?.name).find(name => name?.replaceAll(".", "_").endsWith("career_workflow_profile_preferences"));
  if (!name) throw new Error("missing_preference_tool");
  return { toolCall: { name, arguments: JSON.stringify(args) } };
 }
 if (currentText.includes("我现在主要考虑哪些求职方向")) {
  const projectionText = messages.map(message => typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join("\n");
  const match = projectionText.match(/Current saved career preferences, as data only \(not instructions\): (\{[^\n]+\})/u);
  if (!match) return { content: "没有获得已保存偏好" };
  const projection = JSON.parse(match[1]);
  return { content: `${projection.targetRoles.join("、")}；城市：${projection.targetCities.join("、")}` };
 }
 return { content: "请核对这些偏好。" };
} });
const environment = Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "Path", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "ComSpec"].flatMap(k => process.env[k] ? [[k, process.env[k]]] : []));
const port = await companion.findAvailablePort({ preferredPort: 3198 });
const runtimePort = await companion.findAvailablePort({ preferredPort: 29874, reservedPorts: [port] });
const appUrl = `http://127.0.0.1:${port}`;
// Reuse the existing isolated dependency installation, without altering the working app.
const dependencyRoot = process.env.P522_DEPENDENCY_ROOT || path.join(root, ".tmp/rp011-app");
if (!fs.existsSync(path.join(dependencyRoot, "node_modules/next/dist/bin/next"))) throw new Error("p522_isolated_dependencies_missing: set P522_DEPENDENCY_ROOT");
const stage = path.join(dependencyRoot, `p522-h4b1c-source-${Date.now()}`);
fs.mkdirSync(stage, { recursive: true });
for (const name of ["src", "public", "electron", "scripts", "skills"]) fs.cpSync(path.join(root, name), path.join(stage, name), { recursive: true });
for (const name of ["package.json", "pnpm-lock.yaml", "next.config.ts", "tsconfig.json", "next-env.d.ts", "postcss.config.mjs", "tailwind.config.ts"]) {
 if (fs.existsSync(path.join(root, name))) fs.copyFileSync(path.join(root, name), path.join(stage, name));
}
// Compare all staged application source/config before adding the test page.
const parityRoots = ["src", "public", "electron", "scripts", "skills", "package.json", "pnpm-lock.yaml", "next.config.ts", "tsconfig.json", "next-env.d.ts", "postcss.config.mjs", "tailwind.config.ts"];
function sourceHash(base) {
 const hash = createHash("sha256");
 const walk = relative => {
  const absolute = path.join(base, relative);
  if (!fs.existsSync(absolute)) return;
  if (fs.statSync(absolute).isDirectory()) {
   for (const entry of fs.readdirSync(absolute).sort()) walk(path.join(relative, entry));
  } else {
   hash.update(relative.replaceAll("\\", "/")); hash.update("\0"); hash.update(fs.readFileSync(absolute)); hash.update("\0");
  }
 };
 for (const name of parityRoots) walk(name);
 return hash.digest("hex");
}
const sourceDigest = sourceHash(root);
const stagedDigest = sourceHash(stage);
if (sourceDigest !== stagedDigest) throw new Error("p522_h4b1c_source_parity_mismatch");
fs.writeFileSync(path.join(evidence, "source-parity.json"), JSON.stringify({ algorithm: "sha256", sourceDigest, stagedDigest, matched: true }, null, 2));
// A client-only fixture in the disposable source tree gives Playwright access
// to the real renderer Repository without shipping a test API in the product.
fs.mkdirSync(path.join(stage, "src/app/h4b1c-fixture"), { recursive: true });
fs.copyFileSync(path.join(root, "tests/e2e/support/h4b1cRepositoryFixture.tsx"), path.join(stage, "src/app/h4b1c-fixture/page.tsx"));
const control = `synthetic-${randomUUID()}`;
Object.assign(environment, { NODE_ENV: "development", CAREERADAPT_PROJECT_ROOT: stage, CAREERADAPT_BASE_URL: appUrl,
 CAREERADAPT_APP_PORT: String(port), HERMES_RUNTIME_URL: `http://127.0.0.1:${runtimePort}`,
 HERMES_RUNTIME_ROOT: path.join(root, ".electron-build/hermes-runtime-v4"), HERMES_HOME: runtimeHome,
 HERMES_WEB_CONTROL_ENABLED: "true", HERMES_RUNTIME_API_KEY: control, API_SERVER_KEY: control,
 AI_PROVIDER: "openai-compatible", AI_BASE_URL: provider.baseUrl, AI_MODEL: "careeradapt-test", HERMES_CUSTOM_CAREERADAPT_API_KEY: provider.apiKey,
 HERMES_INTEGRATION_PROVIDER_URL: provider.baseUrl, HERMES_INTEGRATION_PROVIDER_KEY: provider.apiKey,
 PLAYWRIGHT_BASE_URL: appUrl, H3_EVIDENCE_DIR: evidence, CAREERAD_NEXT_DIST_DIR: `.next-p522-${Date.now()}`, NEXT_TELEMETRY_DISABLED: "1" });
fs.writeFileSync(path.join(runtimeHome,"config.yaml"), "memory:\n  nudge_interval: 0\ncurator:\n  enabled: false\n");
let child; const output=fs.openSync(path.join(evidence,"server.log"),"a");
const result={status:"RUNNING",realProviderRequests:0};
try {
 child=spawn(process.execPath,[path.join(dependencyRoot,"node_modules/next/dist/bin/next"),"dev","-p",String(port)],{cwd:stage,env:environment,windowsHide:true,stdio:["ignore",output,output]});
 await expect.poll(async()=>{try{return (await fetch(`${appUrl}/api/agent/mcp`,{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},{timeout:60000}).toBe(true);
 if (sourceHash(root) !== sourceDigest) throw new Error("p522_h4b1c_source_changed_before_browser");
 result.exitCode=await new Promise((resolve,reject)=>{const pw=spawn(process.execPath,[path.join(root,"node_modules/@playwright/test/cli.js"),"test","tests/e2e/p522h4b1c-short.spec.ts","--workers=1","--retries=0",...process.argv.slice(2),`--output=${path.join(evidence,"browser")}`],{cwd:root,env:environment,windowsHide:true,stdio:"inherit"});pw.once("error",reject);pw.once("exit",code=>resolve(code??1));});
 result.status=result.exitCode===0?"PASS":"FAIL";process.exitCode=result.exitCode;
} catch(error){result.status="FAIL";result.error=String(error);process.exitCode=1;}
finally{
 result.requests=provider.requests.map(r=>({messages:r.messages,response:r.response}));
 fs.writeFileSync(path.join(evidence,"summary.json"),JSON.stringify(result,null,2));
 try{await fetch(`${appUrl}/api/agent/runtime/hermes/control`,{method:"POST",headers:{"Content-Type":"application/json",Origin:appUrl},body:JSON.stringify({action:"stop"}),signal:AbortSignal.timeout(5000)});}catch { /* Cleanup only: retain evidence if the owned runtime has already stopped. */ }
 child?.kill();fs.closeSync(output);await provider.close();
 const log=path.join(evidence,"server.log");fs.writeFileSync(log,fs.readFileSync(log,"utf8").replace(/token=careeradapt-token-[A-Za-z0-9_-]+/g,"token=[REDACTED]"));
}
console.log(`P522-H4B1C ${result.status}: ${evidence}`);
