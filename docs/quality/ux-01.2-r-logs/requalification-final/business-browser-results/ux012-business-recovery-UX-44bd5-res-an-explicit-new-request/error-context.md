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
Expected: "completed"
Received: "awaiting_input"
Timeout:  30000ms

Call log:
  - Expect "toHaveAttribute" with timeout 30000ms
  - waiting for getByRole('status', { name: '业务进度' })
    - locator resolved to <div role="status" aria-label="业务进度" data-business-state="blocked" class="mb-3 border-l-2 border-slate-300 pl-3 text-sm text-slate-700">…</div>
    - unexpected value "blocked"
    60 × locator resolved to <div role="status" aria-label="业务进度" data-business-state="awaiting_input" class="mb-3 border-l-2 border-slate-300 pl-3 text-sm text-slate-700">…</div>
       - unexpected value "awaiting_input"

```

```yaml
- status "业务进度":
  - paragraph: 本轮回复已结束
  - paragraph: 尚无业务完成回执，可补充信息或核对当前结果。
```

# Test source

```ts
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
  83  |     stage = "source_fixture_via_official_import";
  84  |     await prepareCoreSourceResume(page);
  85  |     const sourceProfileId = (await readStore(page, "resumeBranches")).at(-1)?.profileId;
  86  |     expect(sourceProfileId).toBeTruthy();
  87  |     expect((await readStore(page, "resumeBranches")).some(branch => branch.profileId === sourceProfileId && branch.branchPurpose === "general")).toBe(true);
  88  |     await page.goto("/ai-workspace");
  89  |     await page.getByRole("button", { name: "新任务", exact: true }).click();
  90  |     await expect.poll(async () => (await activeSession(page))?.activeProfileId).toBe(sourceProfileId);
  91  |     await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u);
  92  |     await writeFile(file("source-ready.json"), JSON.stringify(await snapshot(page), null, 2));
  93  |     stage = "proposal";
  94  |     // A transport-failed writing proposal is retained by the real planner;
  95  |     // confirmed compose retries writing rather than trusting fallback prose.
  96  |     failWriting = true;
  97  |     await writeFile(file("started.json"), JSON.stringify({ startedAt: new Date().toISOString(), maximumRuns: 1 }));
  98  |     await installCoreWritingProvider(page);
  99  |     await page.route("**/api/ai/structured", async route => {
  100 |       const body = route.request().postDataJSON() as { task?: string };
  101 |       if (failWriting && body.task === "resume-career-writer") {
  102 |         writerFailures++;
  103 |         await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false,
  104 |           error: { code: "provider_unavailable", message: "UX012 isolated writing failure", retryable: true },
  105 |           meta: { provider: "isolated-test", model: "core-writer", inputLength: 1, outputLength: 0, latencyMs: 1 } }) });
  106 |         return;
  107 |       }
  108 |       await route.fallback();
  109 |     });
  110 |     const before = await snapshot(page);
  111 |     await writeFile(file("before.json"), JSON.stringify(before, null, 2));
  112 |     await send(page, "P51-C02-COMPOSE 根据当前资料生成通用简历提案，等待我的明确确认，不同步个人资料库。");
  113 |     const progress = page.getByRole("status", { name: "业务进度" });
  114 |     await expect(progress).toHaveAttribute("data-business-state", "awaiting_confirmation");
  115 |     await expect.poll(async () => (await activeSession(page))?.taskState?.completionStatus).toBe("waiting_for_confirmation");
  116 |     expect(states.some(row => row.state === "processing" || row.state === "submitted")).toBe(true);
  117 |     const proposal = await snapshot(page);
  118 |     expect(proposal.revisions).toEqual(before.revisions);
  119 |     expect(proposal.branches).toEqual(before.branches);
  120 |     expect(proposal.session?.taskState?.knownSlots.resumeCompositionCheckpoint).toBeTruthy();
  121 |     await writeFile(file("proposal.json"), JSON.stringify(proposal, null, 2));
  122 |     await page.screenshot({ path: file("proposal.png"), fullPage: true });
  123 |     await page.reload();
  124 |     await expect(progress).toHaveAttribute("data-business-state", "awaiting_confirmation");
  125 |     expect((await activeSession(page))?.id).toBe(proposal.session?.id);
  126 | 
  127 |     stage = "confirmed_writing_failure";
  128 |     failWriting = true;
  129 |     await page.locator(".agent-confirmation").getByRole("button", { name: "确认", exact: true }).click();
  130 |     await expect.poll(async () => Boolean((await activeSession(page))?.taskState?.knownSlots.resumeCompositionWriteFailure)).toBe(true);
  131 |     const failed = await snapshot(page);
  132 |     expect(failed.revisions).toEqual(before.revisions);
  133 |     expect(failed.branches).toEqual(before.branches);
  134 |     await expect(progress).not.toHaveAttribute("data-business-state", "completed");
  135 |     expect(writerFailures).toBeGreaterThan(0);
  136 |     await writeFile(file("write-failed.json"), JSON.stringify(failed, null, 2));
  137 |     await page.screenshot({ path: file("write-failed.png"), fullPage: true });
  138 |     await page.reload();
  139 |     await expect(progress).not.toHaveAttribute("data-business-state", "completed");
  140 |     expect((await activeSession(page))?.taskState?.knownSlots.resumeCompositionCheckpoint).toBeTruthy();
  141 | 
  142 |     stage = "explicit_recovery_and_duplicate_confirm";
  143 |     failWriting = false;
  144 |     await page.getByRole("button", { name: "直接生成", exact: true }).last().dblclick();
  145 |     await expect.poll(async () => (await readStore(page, "resumeRevisions")).length).toBe(before.revisions.length + 1);
> 146 |     await expect(progress).toHaveAttribute("data-business-state", "completed");
      |                            ^ Error: expect(locator).toHaveAttribute(expected) failed
  147 |     const saved = await snapshot(page);
  148 |     expect(saved.branches).toHaveLength(before.branches.length + 1);
  149 |     expect(saved.profiles).toEqual(before.profiles);
  150 |     expect(saved.session?.taskState?.completionStatus).toBe("completed");
  151 |     await writeFile(file("saved.json"), JSON.stringify(saved, null, 2));
  152 |     await page.screenshot({ path: file("saved.png"), fullPage: true });
  153 |     await page.reload();
  154 |     await expect(progress).toHaveAttribute("data-business-state", "completed");
  155 |     expect((await snapshot(page)).revisions).toEqual(saved.revisions);
  156 | 
  157 |     stage = "cancel_after_formal_save";
  158 |     await send(page, "P512-QUEUE-FIRST 请解释当前已保存的结果，不要写入。");
  159 |     await expect(page.getByRole("button", { name: "停止运行", exact: true })).toBeEnabled();
  160 |     await expect.poll(async () => {
  161 |       const session = await activeSession(page);
  162 |       return session?.hermesRun?.turnId === session?.activeTurn?.id ? session?.hermesRun?.status : undefined;
  163 |     }).toBe("running");
  164 |     await page.getByRole("button", { name: "停止运行", exact: true }).click();
  165 |     await expect.poll(async () => (await activeSession(page))?.hermesRun?.status).toBe("cancelled");
  166 |     await expect(progress).toContainText("本次运行已取消");
  167 |     await expect(progress).not.toHaveAttribute("data-business-state", "completed");
  168 |     const cancelled = await snapshot(page);
  169 |     expect(cancelled.revisions).toEqual(saved.revisions);
  170 |     expect(cancelled.branches).toEqual(saved.branches);
  171 |     await writeFile(file("cancelled.json"), JSON.stringify(cancelled, null, 2));
  172 |     await page.screenshot({ path: file("cancelled.png"), fullPage: true });
  173 |     await page.reload();
  174 |     await expect(progress).toContainText("本次运行已取消");
  175 |     expect((await snapshot(page)).revisions).toEqual(saved.revisions);
  176 |     stage = "complete";
  177 |   } finally {
  178 |     const provider = await page.request.get(`${process.env.HERMES_INTEGRATION_PROVIDER_URL}/integration-evidence`, {
  179 |       headers: { Authorization: `Bearer ${process.env.HERMES_INTEGRATION_PROVIDER_KEY}`, Connection: "close" }, timeout: 3000
  180 |     }).then(response => response.json()).catch(error => ({ diagnosticError: String(error) }));
  181 |     await writeFile(file("provider.json"), JSON.stringify(provider, null, 2));
  182 |     const terminal = await snapshot(page).catch(() => undefined);
  183 |     await page.screenshot({ path: file("terminal.png"), fullPage: true }).catch(() => undefined);
  184 |     await writeFile(file("terminal.json"), JSON.stringify({ stage, businessStarted, writerFailures, states, terminal, errors: info.errors.map(error => error.message) }, null, 2));
  185 |     await writeFile(file("network.json"), JSON.stringify(network, null, 2));
  186 |     await writeFile(file("console.log"), consoleLog.join("\n"));
  187 |   }
  188 | });
  189 | 
  190 | async function activeSession(page: Page): Promise<AgentSession | undefined> {
  191 |   const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
  192 |   return (await readStore(page, "agentSessions")).find(row => row.id === id) as unknown as AgentSession | undefined;
  193 | }
  194 | async function snapshot(page: Page) {
  195 |   const [session, profiles, branches, revisions, messages] = await Promise.all([activeSession(page), readStore(page, "profiles"),
  196 |     readStore(page, "resumeBranches"), readStore(page, "resumeRevisions"), readStore(page, "agentMessages")]);
  197 |   return { session, profiles, branches, revisions, messages: messages.filter(message => message.sessionId === session?.id) };
  198 | }
  199 | async function send(page: Page, text: string) {
  200 |   await page.getByLabel("描述你的求职任务").fill(text);
  201 |   await page.getByRole("button", { name: "发送消息", exact: true }).click();
  202 | }
  203 | 
```