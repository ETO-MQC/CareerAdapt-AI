# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: lifecycle-isolation.hermes.ts >> Job Intake real Hermes + Scripted: save unknown company, same Job completion, list visibility and refresh
- Location: tests\e2e\lifecycle-isolation.hermes.ts:7:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 60000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic:
  - generic [active]:
    - generic [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e5]:
          - navigation [ref=e6]:
            - button "previous" [disabled] [ref=e7]:
              - img "previous" [ref=e8]
            - generic [ref=e10]:
              - generic [ref=e11]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e12]:
              - img "next" [ref=e13]
          - img
        - generic [ref=e15]:
          - link "Next.js 16.2.9 (stale) Turbopack" [ref=e16] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e17]
            - generic "There is a newer version (16.4.5) available, upgrade recommended!" [ref=e19]: Next.js 16.2.9 (stale)
            - generic [ref=e20]: Turbopack
          - img
      - dialog "Build Error" [ref=e22]:
        - generic [ref=e25]:
          - generic [ref=e26]:
            - generic [ref=e27]:
              - generic [ref=e29]: Build Error
              - generic [ref=e30]:
                - button "Copy Error Info" [ref=e31] [cursor=pointer]:
                  - img [ref=e32]
                - link "Go to related documentation" [ref=e34] [cursor=pointer]:
                  - /url: https://nextjs.org/docs/messages/module-not-found
                  - img [ref=e35]
                - button "Attach Node.js inspector" [ref=e37] [cursor=pointer]:
                  - img [ref=e38]
            - generic [ref=e47]: "Module not found: Can't resolve '../../../electron/credentialFingerprintPepper.js'"
          - generic [ref=e49]:
            - generic [ref=e51]:
              - img [ref=e53]
              - generic [ref=e57]: ./lifecycle-isolation-source/src/services/agent/aiRuntimeConfiguration.ts (4:1)
              - button "Open in editor" [ref=e58] [cursor=pointer]:
                - img [ref=e60]
            - generic [ref=e63]:
              - generic [ref=e64]: "Module not found: Can't resolve '../../../electron/credentialFingerprintPepper.js'"
              - generic [ref=e65]: 2 |
              - generic [ref=e66]: ...
              - text: ort
              - generic [ref=e67]: "{ hashText, stableHashText }"
              - text: from "@/services/security/text"
              - generic [ref=e68]: ;
              - generic [ref=e69]: 3 |
              - generic [ref=e70]: ...
              - text: ort
              - generic [ref=e71]: "{ resolveHermesProviderBinding }"
              - text: from "../../../electron/hermesProviderBinding.js"
              - generic [ref=e72]: ;
              - text: ">"
              - generic [ref=e73]: 4 |
              - generic [ref=e74]: ...
              - text: ort
              - generic [ref=e75]: "{ credentialFingerprintPepper }"
              - text: from "../../../electron/credentialFingerprintPepper....
              - generic [ref=e76]: "|"
              - text: ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
              - generic [ref=e77]: 5 |
              - generic [ref=e78]: ...
              - generic [ref=e79]: 6 |
              - generic [ref=e80]: ...
              - text: ort type AiRuntimeConfigDraft
              - generic [ref=e81]: =
              - text: AiSettings
              - generic [ref=e82]: ;
              - generic [ref=e83]: 7 |
              - generic [ref=e84]: ...
              - text: ort const DEFAULT_AI_PROVIDER_BASE_URL
              - generic [ref=e85]: =
              - generic [ref=e86]:
                - text: "\""
                - link "https://api.openai.com/v1" [ref=e87] [cursor=pointer]:
                  - /url: https://api.openai.com/v1
                - text: "\""
              - generic [ref=e88]:
                - text: "; Import traces: Client Component Browser: ./lifecycle-isolation-source/src/services/agent/aiRuntimeConfiguration.ts [Client Component Browser] ./lifecycle-isolation-source/src/services/agent/hermesControl.ts [Client Component Browser] ./lifecycle-isolation-source/src/components/agent/runtime/AgentRuntimeProvider.tsx [Client Component Browser] ./lifecycle-isolation-source/src/components/agent/runtime/AgentRuntimeProvider.tsx [Server Component] ./lifecycle-isolation-source/src/app/layout.tsx [Server Component] Client Component SSR: ./lifecycle-isolation-source/src/services/agent/aiRuntimeConfiguration.ts [Client Component SSR] ./lifecycle-isolation-source/src/services/agent/hermesControl.ts [Client Component SSR] ./lifecycle-isolation-source/src/components/agent/runtime/AgentRuntimeProvider.tsx [Client Component SSR] ./lifecycle-isolation-source/src/components/agent/runtime/AgentRuntimeProvider.tsx [Server Component] ./lifecycle-isolation-source/src/app/layout.tsx [Server Component]"
                - link "https://nextjs.org/docs/messages/module-not-found" [ref=e89] [cursor=pointer]:
                  - /url: https://nextjs.org/docs/messages/module-not-found
        - generic [ref=e90]: "1"
        - generic [ref=e91]: "2"
    - generic [ref=e96] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e97]:
        - img [ref=e98]
      - button "Open issues overlay" [ref=e102]:
        - generic [ref=e103]:
          - generic [ref=e104]: "0"
          - generic [ref=e105]: "1"
        - generic [ref=e106]: Issue
  - alert [ref=e107]
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | import { writeFile } from "node:fs/promises";
  3  | import { readStore, prepareCoreSourceResume } from "./support/p51CoreWorkflow";
  4  | import { JOB_INTAKE_INCIDENT_JD } from "../fixtures/jobIntakeIncident";
  5  | import type { AgentSession } from "@/agent/contracts/agentSession";
  6  | 
  7  | test("Job Intake real Hermes + Scripted: save unknown company, same Job completion, list visibility and refresh", async ({ page }, info) => {
  8  |   const directory = process.env.JOB_HOTFIX_DIR!;
  9  |   const provider = process.env.HERMES_INTEGRATION_PROVIDER_URL!, key = process.env.HERMES_INTEGRATION_PROVIDER_KEY!;
  10 |   expect(provider).toMatch(/^http:\/\/127\.0\.0\.1:/u);
  11 |   await page.goto("/setup");
  12 |   await expect.poll(async () => {
  13 |     const response = await page.request.get("/api/agent/runtime/hermes/control");
  14 |     return response.ok() && (await response.json()).snapshot?.runReady === true;
> 15 |   }, { timeout: 60_000 }).toBe(true);
     |                           ^ Error: expect(received).toBe(expected) // Object.is equality
  16 |   await page.getByLabel("API 密钥", { exact: true }).fill(key);
  17 |   await page.getByLabel("API 地址", { exact: true }).fill(provider);
  18 |   await page.getByLabel("模型名称", { exact: true }).fill("careeradapt-test");
  19 |   await page.getByRole("button", { name: "开始使用", exact: true }).click();
  20 |   await expect(page).not.toHaveURL(/\/setup$/u);
  21 |   await prepareCoreSourceResume(page);
  22 |   const baselineJobIds = (await readStore(page, "jobDescriptions")).map(job => job.id);
  23 |   const before = { jobs: await readStore(page, "jobDescriptions"), profiles: await readStore(page, "profiles"), branches: await readStore(page, "resumeBranches"), revisions: await readStore(page, "resumeRevisions") };
  24 |   await page.goto("/ai-workspace");
  25 |   await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u, { timeout: 60_000 });
  26 |   const previousSessionIds = (await readStore(page, "agentSessions")).map(s => s.id);
  27 |   await page.getByRole("button", { name: "新任务", exact: true }).click();
  28 |   await expect.poll(async () => (await readStore(page, "agentSessions")).some(s => !previousSessionIds.includes(s.id))).toBe(true);
  29 |   const jobs = async () => (await readStore(page, "jobDescriptions")).filter(job => !baselineJobIds.includes(job.id));
  30 |   const sessions = async () => (await readStore(page, "agentSessions")) as unknown as AgentSession[];
  31 |   const send = async (text: string, company: string | null) => {
  32 |     const previousRuns = (await sessions()).map(s => s.hermesRun?.runId);
  33 |     await page.getByLabel("描述你的求职任务").fill(text);
  34 |     await page.getByRole("button", { name: "发送消息", exact: true }).click();
  35 |     await expect.poll(async () => {
  36 |       const list = await jobs();
  37 |       const session = (await sessions()).find(s => s.taskState?.workflowId === "job_ingestion");
  38 |       return list.length === 1 && list[0].company === company && session?.hermesRun?.status === "completed"
  39 |         && !previousRuns.includes(session.hermesRun.runId)
  40 |         && session.taskState?.knownSlots.jobPersistenceVerified === true;
  41 |     }).toBe(true).catch(async error => {
  42 |       await writeFile(`${directory}/failure-observation.json`, JSON.stringify({ jobs: await jobs(), sessions: await sessions() }, null, 2));
  43 |       throw error;
  44 |     });
  45 |     const observed = (await sessions()).find(s => s.taskState?.workflowId === "job_ingestion");
  46 |     await writeFile(`${directory}/turn-${observed?.hermesRun?.runId}.json`, JSON.stringify({ jobs: await jobs(), session: observed }, null, 2));
  47 |     expect(observed?.pendingConfirmation).toBeUndefined();
  48 |     expect(await page.getByRole("region", { name: "AI 对话" }).locator("section.agent-confirmation").count()).toBe(0);
  49 |     expect((await page.locator(".agent-tool-status-row").allTextContents()).join(" ")).not.toMatch(/career\.workflow|operationId|commit_job/);
  50 |   };
  51 |   await send(`先保存岗位。\n${JOB_INTAKE_INCIDENT_JD}`, null);
  52 |   const saved = (await jobs())[0];
  53 |   expect(saved.rawText).toBe(JOB_INTAKE_INCIDENT_JD);
  54 | 
  55 |   await page.goto("/jobs");
  56 |   const card = page.locator(".job-card").filter({ hasText: "岗位名称待补充" });
  57 |   await expect(card).toHaveCount(1);
  58 |   page.on("dialog", dialog => dialog.accept());
  59 |   await card.getByRole("button", { name: /删除/ }).click();
  60 |   await expect(card).toHaveCount(0);
  61 |   const bin = (await readStore(page, "appMeta")).find(item => item.key === "workspaceRecycleBin:v1");
  62 |   expect(JSON.stringify(bin)).toContain(saved.id);
  63 |   await page.goto("/ai-workspace");
  64 |   await expect(page.getByRole("region", { name: "AI 对话" })).toContainText("先保存岗位");
  65 |   const previousRuns = (await sessions()).map(s => s.hermesRun?.runId);
  66 |   await page.getByLabel("描述你的求职任务").fill(`先保存岗位。\n${JOB_INTAKE_INCIDENT_JD}`);
  67 |   await page.getByRole("button", { name: "发送消息", exact: true }).click();
  68 |   await expect.poll(async () => (await jobs()).length).toBe(2);
  69 |   await expect.poll(async () => (await sessions()).some(s => s.hermesRun?.status === "completed" && !previousRuns.includes(s.hermesRun.runId))).toBe(true);
  70 |   const fresh = (await jobs()).find(job => job.id !== saved.id)!;
  71 |   expect(fresh.rawText).toBe(saved.rawText);
  72 |   expect((await jobs()).find(job => job.id === saved.id)).toEqual(saved);
  73 |   await page.goto("/jobs");
  74 |   await expect(page.locator(".job-card").filter({ hasText: "岗位名称待补充" })).toHaveCount(1);
  75 |   await page.reload();
  76 |   await expect(page.locator(".job-card").filter({ hasText: "岗位名称待补充" })).toHaveCount(1);
  77 |   expect(await readStore(page, "profiles")).toEqual(before.profiles);
  78 |   await writeFile(`${directory}/repository-evidence.json`, JSON.stringify({ before, saved, fresh, finalJobs: await jobs(), sessions: await sessions() }, null, 2));
  79 | });
  80 | 
```