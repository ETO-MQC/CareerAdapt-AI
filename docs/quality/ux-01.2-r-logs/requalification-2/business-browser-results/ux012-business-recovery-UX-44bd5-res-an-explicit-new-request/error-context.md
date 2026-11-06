# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux012-business-recovery.spec.ts >> UX012 persisted rate-limit recovery preserves input and requires an explicit new request
- Location: tests\e2e\ux012-business-recovery.spec.ts:13:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "waiting_for_confirmation"
Received: undefined

Call Log:
- Timeout 30000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]:
    - img [ref=e8]
  - alert [ref=e11]
  - generic [ref=e12]:
    - complementary "AI 工作区导航" [ref=e13]:
      - generic [ref=e14]:
        - link "职适AI 首页" [ref=e15] [cursor=pointer]:
          - /url: /
          - generic [ref=e16]: 职
          - generic [ref=e17]: 职适AI
        - button "收起 AI 导航" [ref=e18] [cursor=pointer]:
          - img [ref=e19]
      - generic [ref=e22]:
        - button "新任务" [ref=e23] [cursor=pointer]:
          - img [ref=e24]
          - generic [ref=e25]: 新任务
        - button "搜索 / 历史" [ref=e26] [cursor=pointer]:
          - img [ref=e27]
          - generic [ref=e30]: 搜索 / 历史
      - navigation "资产" [ref=e31]:
        - generic [ref=e32]: 资产
        - link "AI 助手" [ref=e33] [cursor=pointer]:
          - /url: /ai-workspace
          - img [ref=e34]
          - generic [ref=e37]: AI 助手
        - link "我的简历" [ref=e38] [cursor=pointer]:
          - /url: /resume
          - img [ref=e39]
          - generic [ref=e42]: 我的简历
        - link "个人资料库" [ref=e43] [cursor=pointer]:
          - /url: /profile
          - img [ref=e44]
          - generic [ref=e47]: 个人资料库
        - link "岗位" [ref=e48] [cursor=pointer]:
          - /url: /jobs
          - img [ref=e49]
          - generic [ref=e53]: 岗位
        - link "求职进度" [ref=e54] [cursor=pointer]:
          - /url: /applications
          - img [ref=e55]
          - generic [ref=e57]: 求职进度
        - link "回收站" [ref=e58] [cursor=pointer]:
          - /url: /recycle
          - img [ref=e59]
          - generic [ref=e66]: 回收站
      - region "最近任务" [ref=e67]:
        - text: 最近任务
        - generic [ref=e68]:
          - button "新的对话 任务状态：等待核对" [ref=e69] [cursor=pointer]:
            - generic [ref=e71]: 新的对话
            - generic "任务状态：等待核对" [ref=e72]: 等待核对
          - generic [ref=e73]:
            - button "重命名" [ref=e74] [cursor=pointer]:
              - img [ref=e75]
            - button "归档" [ref=e78] [cursor=pointer]:
              - img [ref=e79]
        - generic [ref=e82]:
          - button "新的对话 任务状态：等待输入" [ref=e83] [cursor=pointer]:
            - generic [ref=e85]: 新的对话
            - generic "任务状态：等待输入" [ref=e86]: 等待输入
          - generic [ref=e87]:
            - button "重命名" [ref=e88] [cursor=pointer]:
              - img [ref=e89]
            - button "归档" [ref=e92] [cursor=pointer]:
              - img [ref=e93]
        - generic [ref=e96]:
          - button "新的对话 任务状态：等待输入" [ref=e97] [cursor=pointer]:
            - generic [ref=e99]: 新的对话
            - generic "任务状态：等待输入" [ref=e100]: 等待输入
          - generic [ref=e101]:
            - button "重命名" [ref=e102] [cursor=pointer]:
              - img [ref=e103]
            - button "归档" [ref=e106] [cursor=pointer]:
              - img [ref=e107]
      - generic [ref=e110]:
        - generic "工作区模式" [ref=e111]:
          - button "AI" [pressed] [ref=e112] [cursor=pointer]:
            - generic [ref=e113]: AI
          - button "协作" [ref=e114] [cursor=pointer]:
            - generic [ref=e115]: 协作
          - button "手动" [ref=e116] [cursor=pointer]:
            - generic [ref=e117]: 手动
        - link "设置与更多" [ref=e118] [cursor=pointer]:
          - /url: /settings
          - img [ref=e119]
          - generic [ref=e122]: 设置与更多
        - generic [ref=e123]:
          - generic [ref=e124]: CA
          - generic [ref=e125]:
            - strong [ref=e126]: 求职工作区
            - generic [ref=e127]: 本地数据
    - main [ref=e130]:
      - generic [ref=e131]:
        - generic [ref=e132]:
          - strong [ref=e133]: 新的对话
          - generic [ref=e134]: 固定：Core 候选人 · V1
          - button "Core 候选人 · V1 1 条经历 · 2 项基础信息 · 创建于 2026/11/06" [ref=e136] [cursor=pointer]:
            - generic [ref=e137]:
              - strong [ref=e138]: Core 候选人 · V1
              - generic [ref=e139]: 1 条经历 · 2 项基础信息 · 创建于 2026/11/06
            - img [ref=e140]
        - generic [ref=e142]:
          - button "AI Runtime Hermes，状态 Ready" [ref=e144] [cursor=pointer]:
            - generic [ref=e145]: AI · 服务
            - generic [ref=e146]: Ready
            - generic [ref=e147]: 控制
          - status [ref=e148]: 等待确认
          - button "打开历史记录" [ref=e149] [cursor=pointer]:
            - img [ref=e150]
          - button "更多任务操作" [ref=e155] [cursor=pointer]:
            - img [ref=e156]
      - generic [ref=e161]:
        - region "AI 对话" [ref=e162]:
          - generic [ref=e163]:
            - status "业务进度" [ref=e164]:
              - paragraph [ref=e165]: 等待你明确确认
              - paragraph [ref=e166]: 确认前不会正式保存；确认提交后仍需等待保存回执。
            - article [ref=e167]:
              - generic [ref=e168]:
                - generic [ref=e169]:
                  - paragraph [ref=e173]: P51-C02-COMPOSE 根据当前资料生成通用简历提案，等待我的明确确认，不同步个人资料库。
                  - generic "用户消息操作" [ref=e174]:
                    - button "编辑并重发" [ref=e175] [cursor=pointer]:
                      - img [ref=e176]
                    - button "历史版本" [ref=e178] [cursor=pointer]:
                      - img [ref=e179]
                    - button "复制消息" [ref=e183] [cursor=pointer]:
                      - img [ref=e184]
                    - group [ref=e187]:
                      - generic "更多消息操作" [ref=e188] [cursor=pointer]:
                        - img [ref=e189]
                - generic "你" [ref=e193]:
                  - img [ref=e194]
            - article [ref=e197]:
              - group [ref=e198]:
                - status "已完成 5 个任务步骤" [ref=e199] [cursor=pointer]:
                  - generic [ref=e200]:
                    - img [ref=e201]
                    - img [ref=e203]
                    - img [ref=e205]
                  - strong [ref=e208]: 已完成 5 个任务步骤
              - generic [ref=e209]:
                - generic "AI 助手" [ref=e210]:
                  - img [ref=e211]
                - generic [ref=e214]:
                  - paragraph [ref=e218]: C02COMPOSEREADY，请核对并确认生成。
                  - region "确认执行 Career 操作" [ref=e219]:
                    - generic [ref=e220]:
                      - heading "确认执行 Career 操作" [level=3] [ref=e221]
                      - paragraph [ref=e222]: 这项 Career 操作需要用户确认后才能继续。
                    - generic [ref=e223]:
                      - button "取消" [ref=e224] [cursor=pointer]
                      - button "确认" [ref=e225] [cursor=pointer]
                  - generic "AI 消息操作" [ref=e226]:
                    - button "重新生成" [ref=e227] [cursor=pointer]:
                      - img [ref=e228]
                    - button "基于此继续" [ref=e231] [cursor=pointer]:
                      - img [ref=e232]
                    - button "复制消息" [ref=e234] [cursor=pointer]:
                      - img [ref=e235]
                    - group [ref=e238]:
                      - generic "更多消息操作" [ref=e239] [cursor=pointer]:
                        - img [ref=e240]
            - generic "会话操作" [ref=e244]:
              - button "重新生成最近回答" [ref=e245] [cursor=pointer]:
                - img [ref=e246]
                - text: 重新生成最近回答
        - generic [ref=e249]:
          - generic [ref=e250]:
            - generic [ref=e251]: 描述你的求职任务
            - textbox "描述你的求职任务" [ref=e252]:
              - /placeholder: 描述你的求职任务，或粘贴一份岗位描述...
          - generic [ref=e253]:
            - button "添加材料与工具" [ref=e255] [cursor=pointer]:
              - img [ref=e256]
            - button "上传文件" [ref=e257]
            - generic [ref=e258]:
              - generic [ref=e259]: 等待确认
              - button "发送消息" [disabled] [ref=e260]:
                - img [ref=e261]
          - generic:
            - img
            - text: 松开即可添加文件
  - region "操作通知"
```

# Test source

```ts
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
> 115 |     await expect.poll(async () => (await activeSession(page))?.taskState?.completionStatus).toBe("waiting_for_confirmation");
      |                                                                                             ^ Error: expect(received).toBe(expected) // Object.is equality
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
  146 |     await expect(progress).toHaveAttribute("data-business-state", "completed");
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