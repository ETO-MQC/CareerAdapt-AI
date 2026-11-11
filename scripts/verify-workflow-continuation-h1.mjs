import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import companion from "../electron/hermesCompanion.js";
import { startFakeOpenAiProvider } from "../tests/support/fake-openai-compatible-provider.mjs";

const root = process.cwd();
const evidence = path.join(root, "docs/quality/p522-h1", `browser-${Date.now()}`);
fs.mkdirSync(evidence, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), "p522-hermes-"));
const provider = await startFakeOpenAiProvider({ mode: "integration", routeSkills: true, responseForRequest: ({ messages, tools }) => {
 const last = messages.findLastIndex(m => m.role === "user");
 const text = JSON.stringify(messages[last]?.content ?? "");
 if (messages.slice(last+1).some(m => m.role === "tool" && m.name !== "skill_view")) return { content: "当前步骤已处理，请核对业务结果。" };
 const names = tools.map(t=>t.function?.name);
 const tool = text.includes("通用简历") ? "compose_resume" : "job_intake";
 const name=names.find(n=>n?.replaceAll(".","_").endsWith(`workflow_${tool}`));
 if (!name) throw new Error(`missing_tool_${tool}`);
 const rawText="岗位：软件工程师\n岗位职责：参与产品开发和测试。\n任职要求：本科及以上学历，熟悉 Python，具备项目开发与团队协作经验。";
 const input=tool==="compose_resume" ? {mode:"general",generalResumeMode:"create_new"} : text.includes("先保存") ? {persistence:"save"} : {rawText,persistence:"analyze_only"};
 return {toolCall:{name,arguments:JSON.stringify(input)}};
} });
const environment = Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "Path", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "ComSpec"].flatMap(k => process.env[k] ? [[k, process.env[k]]] : []));
const port = await companion.findAvailablePort({ preferredPort: 3198 });
const runtimePort = await companion.findAvailablePort({ preferredPort: 29874, reservedPorts: [port] });
const appUrl = `http://127.0.0.1:${port}`;
// Reuse the existing isolated dependency installation, without altering the working app.
const dependencyRoot = process.env.P522_DEPENDENCY_ROOT || path.join(root, ".tmp/rp011-app");
if (!fs.existsSync(path.join(dependencyRoot, "node_modules/next/dist/bin/next"))) throw new Error("p522_isolated_dependencies_missing: set P522_DEPENDENCY_ROOT");
const stage = path.join(dependencyRoot, "p522-h1-source");
fs.mkdirSync(stage, { recursive: true });
for (const name of ["src", "public", "electron", "scripts", "skills"]) fs.cpSync(path.join(root, name), path.join(stage, name), { recursive: true });
for (const name of ["package.json", "pnpm-lock.yaml", "next.config.ts", "tsconfig.json", "next-env.d.ts", "postcss.config.mjs", "tailwind.config.ts"]) {
 if (fs.existsSync(path.join(root, name))) fs.copyFileSync(path.join(root, name), path.join(stage, name));
}
const control = `synthetic-${randomUUID()}`;
Object.assign(environment, { NODE_ENV: "development", CAREERADAPT_PROJECT_ROOT: stage, CAREERADAPT_BASE_URL: appUrl,
 CAREERADAPT_APP_PORT: String(port), HERMES_RUNTIME_URL: `http://127.0.0.1:${runtimePort}`,
 HERMES_RUNTIME_ROOT: path.join(root, ".electron-build/hermes-runtime-v4"), HERMES_HOME: home,
 HERMES_WEB_CONTROL_ENABLED: "true", HERMES_RUNTIME_API_KEY: control, API_SERVER_KEY: control,
 AI_PROVIDER: "openai-compatible", AI_BASE_URL: provider.baseUrl, AI_MODEL: "careeradapt-test", HERMES_CUSTOM_CAREERADAPT_API_KEY: provider.apiKey,
 HERMES_INTEGRATION_PROVIDER_URL: provider.baseUrl, HERMES_INTEGRATION_PROVIDER_KEY: provider.apiKey,
 PLAYWRIGHT_BASE_URL: appUrl, CAREERAD_NEXT_DIST_DIR: `.next-p522-${Date.now()}`, NEXT_TELEMETRY_DISABLED: "1" });
fs.writeFileSync(path.join(home,"config.yaml"), "memory:\n  nudge_interval: 0\ncurator:\n  enabled: false\n");
let child; const output=fs.openSync(path.join(evidence,"server.log"),"a");
const result={status:"RUNNING",realProviderRequests:0};
try {
 child=spawn(process.execPath,[path.join(dependencyRoot,"node_modules/next/dist/bin/next"),"dev","-p",String(port)],{cwd:stage,env:environment,windowsHide:true,stdio:["ignore",output,output]});
 await expect.poll(async()=>{try{return (await fetch(`${appUrl}/api/agent/mcp`,{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},{timeout:60000}).toBe(true);
 result.exitCode=await new Promise((resolve,reject)=>{const pw=spawn(process.execPath,[path.join(root,"node_modules/@playwright/test/cli.js"),"test","tests/e2e/workflow-continuation-h1.spec.ts","--workers=1","--retries=0",...process.argv.slice(2),`--output=${path.join(evidence,"browser")}`],{cwd:root,env:environment,windowsHide:true,stdio:"inherit"});pw.once("error",reject);pw.once("exit",code=>resolve(code??1));});
 result.status=result.exitCode===0?"PASS":"FAIL";process.exitCode=result.exitCode;
} catch(error){result.status="FAIL";result.error=String(error);process.exitCode=1;}
finally{
 result.requests=provider.requests.map(r=>({model:r.model,messages:r.messages,response:r.response}));
 fs.writeFileSync(path.join(evidence,"summary.json"),JSON.stringify(result,null,2));
 try{await fetch(`${appUrl}/api/agent/runtime/hermes/control`,{method:"POST",headers:{"Content-Type":"application/json",Origin:appUrl},body:JSON.stringify({action:"stop"}),signal:AbortSignal.timeout(5000)});}catch { /* Cleanup only: retain evidence if the owned runtime has already stopped. */ }
 child?.kill();fs.closeSync(output);await provider.close();
 const log=path.join(evidence,"server.log");fs.writeFileSync(log,fs.readFileSync(log,"utf8").replace(/token=careeradapt-token-[A-Za-z0-9_-]+/g,"token=[REDACTED]"));
}
console.log(`P522-H1 ${result.status}: ${evidence}`);
