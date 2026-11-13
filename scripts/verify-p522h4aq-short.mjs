import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import companion from "../electron/hermesCompanion.js";
import { startFakeOpenAiProvider } from "../tests/support/fake-openai-compatible-provider.mjs";

const root = process.cwd();
const evidence = path.join(root, "docs/quality/p522-h4aq", `browser-${Date.now()}`);
fs.mkdirSync(evidence, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), "p522-h4aq-hermes-"));
function readResume(messages) {
  const message = messages.findLast(m => m.role === "tool" && m.name?.endsWith("career_resume_list"));
  const content = String(message?.content ?? "");
  const start = content.indexOf('{"result"');
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) return undefined;
  try {
    const outer = JSON.parse(content.slice(start, end + 1));
    const result = typeof outer.result === "string" ? JSON.parse(outer.result) : outer.result;
    return result?.data?.resumes?.find(resume => resume.purpose === "general");
  } catch { return undefined; }
}
const provider = await startFakeOpenAiProvider({ mode: "integration", routeSkills: true, delayMs: 2500, responseForRequest: ({ messages, tools }) => {
 const last = messages.findLastIndex(m => m.role === "user");
 const text = JSON.stringify(messages[last]?.content ?? "");
 const names = tools.map(t => t.function?.name);
 const called = suffix => messages.slice(last + 1).some(m => m.role === "tool" && m.name?.endsWith(suffix));
 const resume = readResume(messages);
 let requested;
 if (text.includes("匹配度")) requested = !called("career_job_get") ? "job_get" : !called("career_resume_list") ? "resume_list" : !called("career_resume_get") ? "resume_get" : !called("career_workflow_job_fit") ? "workflow_job_fit" : undefined;
 else if ((text.includes("应聘") || text.includes("投华为")) && !called("career_job_list")) requested = "job_list";
 if (!requested) return { content: text.includes("查看详细匹配") ? "已保留岗位匹配详情。" : "匹配已完成。" };
 const name = names.find(n => n?.replaceAll(".", "_").endsWith(requested));
 if (!name) throw new Error(`missing_tool_${requested}`);
 if (["resume_get", "workflow_job_fit"].includes(requested) && !resume) throw new Error("fixture_resume_list_not_found");
 const args = requested === "job_get" ? { jobId: "h3-job-ai" }
   : requested === "resume_get" ? { resumeId: resume.id }
   : requested === "workflow_job_fit" ? { profileId: resume.profileId, resumeId: resume.id, jobId: "h3-job-ai" } : {};
 return { toolCall: { name, arguments: JSON.stringify(args) } };
} });
const environment = Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "Path", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "ComSpec"].flatMap(k => process.env[k] ? [[k, process.env[k]]] : []));
const port = await companion.findAvailablePort({ preferredPort: 3198 });
const runtimePort = await companion.findAvailablePort({ preferredPort: 29874, reservedPorts: [port] });
const appUrl = `http://127.0.0.1:${port}`;
// Reuse the existing isolated dependency installation, without altering the working app.
const dependencyRoot = process.env.P522_DEPENDENCY_ROOT || path.join(root, ".tmp/rp011-app");
if (!fs.existsSync(path.join(dependencyRoot, "node_modules/next/dist/bin/next"))) throw new Error("p522_isolated_dependencies_missing: set P522_DEPENDENCY_ROOT");
const stage = path.join(dependencyRoot, `p522-h4aq-source-${Date.now()}`);
fs.mkdirSync(stage, { recursive: true });
for (const name of ["src", "public", "electron", "scripts", "skills"]) fs.cpSync(path.join(root, name), path.join(stage, name), { recursive: true });
for (const name of ["package.json", "pnpm-lock.yaml", "next.config.ts", "tsconfig.json", "next-env.d.ts", "postcss.config.mjs", "tailwind.config.ts"]) {
 if (fs.existsSync(path.join(root, name))) fs.copyFileSync(path.join(root, name), path.join(stage, name));
}
// A client-only fixture in the disposable source tree gives Playwright access
// to the real renderer Repository without shipping a test API in the product.
fs.mkdirSync(path.join(stage, "src/app/h3-fixture"), { recursive: true });
fs.copyFileSync(path.join(root, "tests/e2e/support/h3RepositoryFixture.tsx"), path.join(stage, "src/app/h3-fixture/page.tsx"));
const control = `synthetic-${randomUUID()}`;
Object.assign(environment, { NODE_ENV: "development", CAREERADAPT_PROJECT_ROOT: stage, CAREERADAPT_BASE_URL: appUrl,
 CAREERADAPT_APP_PORT: String(port), HERMES_RUNTIME_URL: `http://127.0.0.1:${runtimePort}`,
 HERMES_RUNTIME_ROOT: path.join(root, ".electron-build/hermes-runtime-v4"), HERMES_HOME: home,
 HERMES_WEB_CONTROL_ENABLED: "true", HERMES_RUNTIME_API_KEY: control, API_SERVER_KEY: control,
 AI_PROVIDER: "openai-compatible", AI_BASE_URL: provider.baseUrl, AI_MODEL: "careeradapt-test", HERMES_CUSTOM_CAREERADAPT_API_KEY: provider.apiKey,
 HERMES_INTEGRATION_PROVIDER_URL: provider.baseUrl, HERMES_INTEGRATION_PROVIDER_KEY: provider.apiKey,
 PLAYWRIGHT_BASE_URL: appUrl, H3_EVIDENCE_DIR: evidence, CAREERAD_NEXT_DIST_DIR: `.next-p522-${Date.now()}`, NEXT_TELEMETRY_DISABLED: "1" });
fs.writeFileSync(path.join(home,"config.yaml"), "memory:\n  nudge_interval: 0\ncurator:\n  enabled: false\n");
let child; const output=fs.openSync(path.join(evidence,"server.log"),"a");
const result={status:"RUNNING",realProviderRequests:0};
try {
 child=spawn(process.execPath,[path.join(dependencyRoot,"node_modules/next/dist/bin/next"),"dev","-p",String(port)],{cwd:stage,env:environment,windowsHide:true,stdio:["ignore",output,output]});
 await expect.poll(async()=>{try{return (await fetch(`${appUrl}/api/agent/mcp`,{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},{timeout:60000}).toBe(true);
 result.exitCode=await new Promise((resolve,reject)=>{const pw=spawn(process.execPath,[path.join(root,"node_modules/@playwright/test/cli.js"),"test","tests/e2e/p522h4aq-short.spec.ts","--workers=1","--retries=0",...process.argv.slice(2),`--output=${path.join(evidence,"browser")}`],{cwd:root,env:environment,windowsHide:true,stdio:"inherit"});pw.once("error",reject);pw.once("exit",code=>resolve(code??1));});
 result.status=result.exitCode===0?"PASS":"FAIL";process.exitCode=result.exitCode;
} catch(error){result.status="FAIL";result.error=String(error);process.exitCode=1;}
finally{
 result.requests=provider.requests.map(r=>({model:r.model,messages:r.messages,response:r.response}));
 fs.writeFileSync(path.join(evidence,"summary.json"),JSON.stringify(result,null,2));
 try{await fetch(`${appUrl}/api/agent/runtime/hermes/control`,{method:"POST",headers:{"Content-Type":"application/json",Origin:appUrl},body:JSON.stringify({action:"stop"}),signal:AbortSignal.timeout(5000)});}catch { /* Cleanup only: retain evidence if the owned runtime has already stopped. */ }
 child?.kill();fs.closeSync(output);await provider.close();
 const log=path.join(evidence,"server.log");fs.writeFileSync(log,fs.readFileSync(log,"utf8").replace(/token=careeradapt-token-[A-Za-z0-9_-]+/g,"token=[REDACTED]"));
}
console.log(`P522-H4AQ ${result.status}: ${evidence}`);
