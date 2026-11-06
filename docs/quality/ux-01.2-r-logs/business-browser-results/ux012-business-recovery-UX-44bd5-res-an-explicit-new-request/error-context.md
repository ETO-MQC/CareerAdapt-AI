# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux012-business-recovery.spec.ts >> UX012 persisted rate-limit recovery preserves input and requires an explicit new request
- Location: tests\e2e\ux012-business-recovery.spec.ts:13:5

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  getByRole('status', { name: '业务进度' })
Expected: "awaiting_confirmation"
Received: "awaiting_input"
Timeout:  30000ms

Call log:
  - Expect "toHaveAttribute" with timeout 30000ms
  - waiting for getByRole('status', { name: '业务进度' })
    23 × locator resolved to <div role="status" aria-label="业务进度" data-business-state="processing" class="mb-3 border-l-2 border-slate-300 pl-3 text-sm text-slate-700">…</div>
       - unexpected value "processing"
    37 × locator resolved to <div role="status" aria-label="业务进度" data-business-state="awaiting_input" class="mb-3 border-l-2 border-slate-300 pl-3 text-sm text-slate-700">…</div>
       - unexpected value "awaiting_input"

```

```yaml
- status "业务进度":
  - paragraph: 本轮回复已结束
  - paragraph: 尚无业务完成回执，可补充信息或核对当前结果。
```

# Test source

```ts
  4   | import type { AgentSession } from "@/agent/contracts/agentSession";
  5   | import { readStore, installCoreWritingProvider } from "./support/p51CoreWorkflow";
  6   | 
  7   | const preflightOnly = process.env.HERMES_INTEGRATION_PREFLIGHT_ONLY === "1";
  8   | const phase = preflightOnly ? "initialization" : "business";
  9   | const evidenceDir = process.env.UX012_EVIDENCE_DIR || "docs/quality/ux-01.2-r-logs";
  10  | const file = (name: string) => path.join(evidenceDir, `${phase}-${name}`);
  11  | 
  12  | // Original test identity retained. No Runtime mock or business-state fixture writes.
  13  | test("UX012 persisted rate-limit recovery preserves input and requires an explicit new request", async ({ page }, info) => {
  14  |   let stage = "initialization";
  15  |   let businessStarted = false;
  16  |   let failWriting = false;
  17  |   let writerFailures = 0;
  18  |   const network: Array<{ action?: string; status?: number; path: string }> = [];
  19  |   const consoleLog: string[] = [];
  20  |   const states: Array<{ state: string; text: string }> = [];
  21  |   await mkdir(evidenceDir, { recursive: true });
  22  |   page.on("console", message => consoleLog.push(`${message.type()}: ${message.text()}`));
  23  |   page.on("pageerror", error => consoleLog.push(`pageerror: ${error.message}`));
  24  |   page.on("response", response => {
  25  |     const url = new URL(response.url());
  26  |     if (!url.pathname.startsWith("/api/")) return;
  27  |     const body = response.request().postData();
  28  |     let action: string | undefined;
  29  |     try { action = body ? JSON.parse(body).action : undefined; } catch { /* non-JSON transport */ }
  30  |     network.push({ path: url.pathname, status: response.status(), ...(action ? { action } : {}) });
  31  |   });
  32  |   await page.exposeFunction("ux012Observe", (state: string, text: string) => states.push({ state, text }));
  33  |   await page.addInitScript(() => {
  34  |     let previous = "";
  35  |     new MutationObserver(() => {
  36  |       const node = document.querySelector('[aria-label="业务进度"]');
  37  |       const state = node?.getAttribute("data-business-state");
  38  |       const text = node?.textContent ?? "";
  39  |       if (state && `${state}:${text}` !== previous) {
  40  |         previous = `${state}:${text}`;
  41  |         void (window as unknown as { ux012Observe(s: string, t: string): Promise<void> }).ux012Observe(state, text);
  42  |       }
  43  |     }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  44  |   });
  45  |   try {
  46  |     const baseUrl = process.env.HERMES_INTEGRATION_PROVIDER_URL;
  47  |     const apiKey = process.env.HERMES_INTEGRATION_PROVIDER_KEY;
  48  |     expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
  49  |     if (!baseUrl || !apiKey || !process.env.HERMES_HOME) throw new Error("isolated_scripted_runtime_missing");
  50  |     await page.goto("/setup");
  51  |     await expect(page.getByRole("heading", { name: "欢迎使用职适AI" })).toBeVisible();
  52  |     await page.getByLabel("API 密钥", { exact: true }).fill(apiKey);
  53  |     await page.getByLabel("API 地址", { exact: true }).fill(baseUrl);
  54  |     await page.getByLabel("模型名称", { exact: true }).fill("careeradapt-test");
  55  |     await page.getByRole("button", { name: "开始使用", exact: true }).click();
  56  |     await expect(page).not.toHaveURL(/\/setup$/);
  57  |     await page.goto("/ai-workspace");
  58  |     await expect(page.getByRole("heading", { name: "欢迎使用职适AI" })).toHaveCount(0);
  59  |     await expect(page.getByRole("button", { name: "跳过，先体验其他功能" })).toHaveCount(0);
  60  |     await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u);
  61  |     await expect.poll(async () => (await readStore(page, "appMeta")).some(row => row.key === "demoSeededAt")).toBe(true);
  62  |     await page.getByRole("button", { name: "新任务", exact: true }).click();
  63  |     await expect.poll(async () => (await activeSession(page))?.activeProfileId).toBe("profile-demo-student");
  64  |     await expect(page.getByLabel("描述你的求职任务")).toBeEnabled();
  65  |     const bridge = await (await page.request.get("/api/agent/mcp")).json();
  66  |     expect(bridge.status.connected).toBe(true);
  67  |     expect(bridge.status.bridgeId).toBeTruthy();
  68  |     const control = await (await page.request.get("/api/agent/runtime/hermes/control")).json();
  69  |     expect(control.snapshot).toMatchObject({ overallState: "ready", processReady: true, apiReady: true, runReady: true, careerMcpReady: true, toolSurfaceReady: true });
  70  |     expect(control.snapshot.requiredCareerFacadesReady).toBe(control.snapshot.requiredCareerFacadesTotal);
  71  |     const provider = await page.request.get(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  72  |     expect(provider.ok()).toBe(true);
  73  |     await writeFile(file("preconditions.json"), JSON.stringify({ allPassed: true, businessStarted: false,
  74  |       setup: "completed through official Setup form, synthetic credential only", normalWorkspace: true,
  75  |       isolatedHome: process.env.HERMES_HOME, providerBaseUrl: baseUrl, providerModel: "careeradapt-test",
  76  |       bridge: bridge.status, runtime: { overallState: control.snapshot.overallState, runReady: control.snapshot.runReady,
  77  |         careerMcpReady: control.snapshot.careerMcpReady, requiredCareerFacadesReady: control.snapshot.requiredCareerFacadesReady },
  78  |       sessionId: (await activeSession(page))!.id }, null, 2));
  79  |     await page.screenshot({ path: file("ready.png"), fullPage: true });
  80  |     if (preflightOnly) return;
  81  | 
  82  |     businessStarted = true;
  83  |     stage = "proposal";
  84  |     // A transport-failed writing proposal is retained by the real planner;
  85  |     // confirmed compose retries writing rather than trusting fallback prose.
  86  |     failWriting = true;
  87  |     await writeFile(file("started.json"), JSON.stringify({ startedAt: new Date().toISOString(), maximumRuns: 1 }));
  88  |     await installCoreWritingProvider(page);
  89  |     await page.route("**/api/ai/structured", async route => {
  90  |       const body = route.request().postDataJSON() as { task?: string };
  91  |       if (failWriting && body.task === "resume-career-writer") {
  92  |         writerFailures++;
  93  |         await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false,
  94  |           error: { code: "provider_unavailable", message: "UX012 isolated writing failure", retryable: true },
  95  |           meta: { provider: "isolated-test", model: "core-writer", inputLength: 1, outputLength: 0, latencyMs: 1 } }) });
  96  |         return;
  97  |       }
  98  |       await route.fallback();
  99  |     });
  100 |     const before = await snapshot(page);
  101 |     await writeFile(file("before.json"), JSON.stringify(before, null, 2));
  102 |     await send(page, "P51-C02-COMPOSE 根据当前资料生成通用简历提案，等待我的明确确认，不同步个人资料库。");
  103 |     const progress = page.getByRole("status", { name: "业务进度" });
> 104 |     await expect(progress).toHaveAttribute("data-business-state", "awaiting_confirmation");
      |                            ^ Error: expect(locator).toHaveAttribute(expected) failed
  105 |     await expect.poll(async () => (await activeSession(page))?.taskState?.completionStatus).toBe("waiting_for_confirmation");
  106 |     expect(states.some(row => row.state === "processing" || row.state === "submitted")).toBe(true);
  107 |     const proposal = await snapshot(page);
  108 |     expect(proposal.revisions).toEqual(before.revisions);
  109 |     expect(proposal.branches).toEqual(before.branches);
  110 |     expect(proposal.session?.taskState?.knownSlots.resumeCompositionCheckpoint).toBeTruthy();
  111 |     await writeFile(file("proposal.json"), JSON.stringify(proposal, null, 2));
  112 |     await page.screenshot({ path: file("proposal.png"), fullPage: true });
  113 |     await page.reload();
  114 |     await expect(progress).toHaveAttribute("data-business-state", "awaiting_confirmation");
  115 |     expect((await activeSession(page))?.id).toBe(proposal.session?.id);
  116 | 
  117 |     stage = "confirmed_writing_failure";
  118 |     failWriting = true;
  119 |     await page.locator(".agent-confirmation").getByRole("button", { name: "确认", exact: true }).click();
  120 |     await expect.poll(async () => Boolean((await activeSession(page))?.taskState?.knownSlots.resumeCompositionWriteFailure)).toBe(true);
  121 |     const failed = await snapshot(page);
  122 |     expect(failed.revisions).toEqual(before.revisions);
  123 |     expect(failed.branches).toEqual(before.branches);
  124 |     await expect(progress).not.toHaveAttribute("data-business-state", "completed");
  125 |     expect(writerFailures).toBeGreaterThan(0);
  126 |     await writeFile(file("write-failed.json"), JSON.stringify(failed, null, 2));
  127 |     await page.screenshot({ path: file("write-failed.png"), fullPage: true });
  128 |     await page.reload();
  129 |     await expect(progress).not.toHaveAttribute("data-business-state", "completed");
  130 |     expect((await activeSession(page))?.taskState?.knownSlots.resumeCompositionCheckpoint).toBeTruthy();
  131 | 
  132 |     stage = "explicit_recovery_and_duplicate_confirm";
  133 |     failWriting = false;
  134 |     await page.getByRole("button", { name: "直接生成", exact: true }).last().dblclick();
  135 |     await expect.poll(async () => (await readStore(page, "resumeRevisions")).length).toBe(before.revisions.length + 1);
  136 |     await expect(progress).toHaveAttribute("data-business-state", "completed");
  137 |     const saved = await snapshot(page);
  138 |     expect(saved.branches).toHaveLength(before.branches.length + 1);
  139 |     expect(saved.profiles).toEqual(before.profiles);
  140 |     expect(saved.session?.taskState?.completionStatus).toBe("completed");
  141 |     await writeFile(file("saved.json"), JSON.stringify(saved, null, 2));
  142 |     await page.screenshot({ path: file("saved.png"), fullPage: true });
  143 |     await page.reload();
  144 |     await expect(progress).toHaveAttribute("data-business-state", "completed");
  145 |     expect((await snapshot(page)).revisions).toEqual(saved.revisions);
  146 | 
  147 |     stage = "cancel_after_formal_save";
  148 |     await send(page, "P512-QUEUE-FIRST 请解释当前已保存的结果，不要写入。");
  149 |     await expect(page.getByRole("button", { name: "停止运行", exact: true })).toBeEnabled();
  150 |     await page.getByRole("button", { name: "停止运行", exact: true }).click();
  151 |     await expect.poll(async () => (await activeSession(page))?.hermesRun?.status).toBe("cancelled");
  152 |     await expect(progress).toContainText("本次运行已取消");
  153 |     await expect(progress).not.toHaveAttribute("data-business-state", "completed");
  154 |     const cancelled = await snapshot(page);
  155 |     expect(cancelled.revisions).toEqual(saved.revisions);
  156 |     expect(cancelled.branches).toEqual(saved.branches);
  157 |     await writeFile(file("cancelled.json"), JSON.stringify(cancelled, null, 2));
  158 |     await page.screenshot({ path: file("cancelled.png"), fullPage: true });
  159 |     await page.reload();
  160 |     await expect(progress).toContainText("本次运行已取消");
  161 |     expect((await snapshot(page)).revisions).toEqual(saved.revisions);
  162 |     stage = "complete";
  163 |   } finally {
  164 |     const terminal = await snapshot(page).catch(() => undefined);
  165 |     await page.screenshot({ path: file("terminal.png"), fullPage: true }).catch(() => undefined);
  166 |     await writeFile(file("terminal.json"), JSON.stringify({ stage, businessStarted, writerFailures, states, terminal, errors: info.errors.map(error => error.message) }, null, 2));
  167 |     await writeFile(file("network.json"), JSON.stringify(network, null, 2));
  168 |     await writeFile(file("console.log"), consoleLog.join("\n"));
  169 |   }
  170 | });
  171 | 
  172 | async function activeSession(page: Page): Promise<AgentSession | undefined> {
  173 |   const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
  174 |   return (await readStore(page, "agentSessions")).find(row => row.id === id) as unknown as AgentSession | undefined;
  175 | }
  176 | async function snapshot(page: Page) {
  177 |   const [session, profiles, branches, revisions, messages] = await Promise.all([activeSession(page), readStore(page, "profiles"),
  178 |     readStore(page, "resumeBranches"), readStore(page, "resumeRevisions"), readStore(page, "agentMessages")]);
  179 |   return { session, profiles, branches, revisions, messages: messages.filter(message => message.sessionId === session?.id) };
  180 | }
  181 | async function send(page: Page, text: string) {
  182 |   await page.getByLabel("描述你的求职任务").fill(text);
  183 |   await page.getByRole("button", { name: "发送消息", exact: true }).click();
  184 | }
  185 | 
```