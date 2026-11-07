# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: job-intake-hotfix.hermes.ts >> Job Intake real Hermes + Scripted: save unknown company, same Job completion, list visibility and refresh
- Location: tests\e2e\job-intake-hotfix.hermes.ts:7:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 0
Received: 2
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
          - button "新的对话 任务状态：已完成" [ref=e69] [cursor=pointer]:
            - generic [ref=e71]: 新的对话
            - generic "任务状态：已完成" [ref=e72]: 已完成
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
        - generic "工作区模式" [ref=e97]:
          - button "AI" [pressed] [ref=e98] [cursor=pointer]:
            - generic [ref=e99]: AI
          - button "协作" [ref=e100] [cursor=pointer]:
            - generic [ref=e101]: 协作
          - button "手动" [ref=e102] [cursor=pointer]:
            - generic [ref=e103]: 手动
        - link "设置与更多" [ref=e104] [cursor=pointer]:
          - /url: /settings
          - img [ref=e105]
          - generic [ref=e108]: 设置与更多
        - generic [ref=e109]:
          - generic [ref=e110]: CA
          - generic [ref=e111]:
            - strong [ref=e112]: 求职工作区
            - generic [ref=e113]: 本地数据
    - main [ref=e116]:
      - generic [ref=e117]:
        - generic [ref=e118]:
          - strong [ref=e119]: 新的对话
          - generic [ref=e120]: 固定：Core 候选人 · V1
          - button "Core 候选人 · V1 1 条经历 · 2 项基础信息 · 创建于 2026/11/07" [ref=e122] [cursor=pointer]:
            - generic [ref=e123]:
              - strong [ref=e124]: Core 候选人 · V1
              - generic [ref=e125]: 1 条经历 · 2 项基础信息 · 创建于 2026/11/07
            - img [ref=e126]
        - generic [ref=e128]:
          - button "AI Runtime Hermes，状态 Ready" [ref=e130] [cursor=pointer]:
            - generic [ref=e131]: AI · 服务
            - generic [ref=e132]: Ready
            - generic [ref=e133]: 控制
          - status [ref=e134]: 已完成
          - button "打开历史记录" [ref=e135] [cursor=pointer]:
            - img [ref=e136]
          - button "更多任务操作" [ref=e141] [cursor=pointer]:
            - img [ref=e142]
      - generic [ref=e147]:
        - group [ref=e148]:
          - generic "精确修改一个字段" [ref=e149] [cursor=pointer]
          - option "请选择简历" [selected]
          - option "通用简历 · 通用"
          - option "请选择条目与字段" [selected]
        - group [ref=e150]:
          - generic "结构化修改简历" [ref=e151] [cursor=pointer]
          - option "请选择简历" [selected]
          - option "通用简历 · 通用"
          - option "事实字段更正" [selected]
          - option "已确认技能新增"
          - option "删除一条要点"
          - option "调整要点顺序"
          - option "请选择明确目标" [selected]
        - button "暂停任务" [ref=e153] [cursor=pointer]:
          - img [ref=e154]
          - text: 暂停任务
        - region "AI 对话" [ref=e157]:
          - generic [ref=e158]:
            - status "业务进度" [ref=e159]:
              - paragraph [ref=e160]: 岗位已正式保存
            - article [ref=e161]:
              - generic [ref=e162]:
                - generic [ref=e163]:
                  - paragraph [ref=e167]: 先保存岗位。 毕业要求：2027届 投递时间：2026年9月1日-2026年9月30日（即将截止） 岗位职责 1、参与实际产品的AI大模型与AI算法在各类业务场景中的应用开发、集成与迭代优化； 2、参与AI大模型与AI算法应用相关的需求分析、模型微调、RAG检索 ，提升模型在各类场景下的应用效果； 3、参与产品、数据、业务等团队协作，建立AI大模型与AI应用相关的数据分析、效果评估、问题定位与持续优化，提升用户体验和业务价值。 岗位要求 1、人工智能、计算机、软件工程、电子信息、自动化等相关专业； 2、熟悉主流大模型应用开发框架，掌握大模型原理（如Transformer架构、微调技术、向量数据库等）或AI算法原理（如神经网络、强化学习、树模型、知识图谱等）；或有大模型（如GPT、DeepSeek、Qwen系列等）应用或神经网络（CNN、RNN、GNN等）开发经验，熟悉NLP/知识图谱/智能问答/对话系统/文生图/文生视频等领域； 3、具备扎实的编程能力，熟练掌握 Python、C++、Java 等至少一种编程语言。
                  - generic "用户消息操作" [ref=e168]:
                    - button "编辑并重发" [ref=e169] [cursor=pointer]:
                      - img [ref=e170]
                    - button "历史版本" [ref=e172] [cursor=pointer]:
                      - img [ref=e173]
                    - button "复制消息" [ref=e177] [cursor=pointer]:
                      - img [ref=e178]
                    - group [ref=e181]:
                      - generic "更多消息操作" [ref=e182] [cursor=pointer]:
                        - img [ref=e183]
                - generic "你" [ref=e187]:
                  - img [ref=e188]
            - article [ref=e191]:
              - group [ref=e192]:
                - status "已完成 1 个任务步骤" [ref=e193] [cursor=pointer]:
                  - generic [ref=e194]:
                    - img [ref=e195]
                    - img [ref=e197]
                    - img [ref=e199]
                  - strong [ref=e202]: 已完成 1 个任务步骤
              - generic [ref=e203]:
                - generic "AI 助手" [ref=e204]:
                  - img [ref=e205]
                - generic [ref=e208]:
                  - paragraph [ref=e212]: 岗位信息已经整理，但尚未完成保存。当前资料已保留，可以继续完成保存。
                  - generic "AI 消息操作" [ref=e213]:
                    - button "重新生成" [ref=e214] [cursor=pointer]:
                      - img [ref=e215]
                    - button "基于此继续" [ref=e218] [cursor=pointer]:
                      - img [ref=e219]
                    - button "复制消息" [ref=e221] [cursor=pointer]:
                      - img [ref=e222]
                    - group [ref=e225]:
                      - generic "更多消息操作" [ref=e226] [cursor=pointer]:
                        - img [ref=e227]
            - generic "会话操作" [ref=e231]:
              - button "重新生成最近回答" [ref=e232] [cursor=pointer]:
                - img [ref=e233]
                - text: 重新生成最近回答
        - generic [ref=e236]:
          - generic [ref=e237]:
            - generic [ref=e238]: 描述你的求职任务
            - textbox "描述你的求职任务" [ref=e239]:
              - /placeholder: 描述你的求职任务，或粘贴一份岗位描述...
          - generic [ref=e240]:
            - button "添加材料与工具" [ref=e242] [cursor=pointer]:
              - img [ref=e243]
            - button "上传文件" [ref=e244]
            - generic [ref=e245]:
              - generic [ref=e246]: 已完成
              - button "发送消息" [disabled] [ref=e247]:
                - img [ref=e248]
          - generic:
            - img
            - text: 松开即可添加文件
  - region "操作通知"
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
  15 |   }, { timeout: 60_000 }).toBe(true);
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
> 45 |     expect(await page.locator(".agent-confirmation").count()).toBe(0);
     |                                                               ^ Error: expect(received).toBe(expected) // Object.is equality
  46 |     expect((await page.locator(".agent-tool-status-row").allTextContents()).join(" ")).not.toMatch(/career\.workflow|operationId|commit_job/);
  47 |   };
  48 |   await send(`先保存岗位。\n${JOB_INTAKE_INCIDENT_JD}`, null);
  49 |   const saved = (await jobs())[0];
  50 |   expect(saved.rawText).toBe(JOB_INTAKE_INCIDENT_JD);
  51 |   await page.screenshot({ path: info.outputPath("saved-no-company.png"), fullPage: true });
  52 |   // Keep a mounted Job List open while a separate Assistant turn updates the Repository.
  53 |   const listPage = await page.context().newPage();
  54 |   await listPage.goto("/jobs");
  55 |   await expect(listPage.locator(".job-card").filter({ hasText: "岗位名称待补充" })).toContainText("公司待补充");
  56 |   await send("公司是华为。", "华为");
  57 |   const updated = (await jobs())[0];
  58 |   expect(updated.id).toBe(saved.id);
  59 |   expect(updated.rawText).toBe(saved.rawText);
  60 |   expect(updated.requirements).toEqual(saved.requirements);
  61 |   await expect(listPage.locator(".job-card").filter({ hasText: "岗位名称待补充" })).toContainText("华为");
  62 |   await listPage.reload();
  63 |   await expect(listPage.locator(".job-card").filter({ hasText: "华为" })).toHaveCount(1);
  64 |   await listPage.screenshot({ path: info.outputPath("updated-job-list.png"), fullPage: true });
  65 |   await page.reload();
  66 |   await send("先保存岗位。", "华为");
  67 |   await send("公司是华为。", "华为");
  68 |   expect(await jobs()).toHaveLength(1);
  69 |   expect(await readStore(page, "jobDescriptions")).toHaveLength(baselineJobIds.length + 1);
  70 |   expect(await readStore(page, "profiles")).toEqual(before.profiles);
  71 |   expect(await readStore(page, "resumeBranches")).toEqual(before.branches);
  72 |   expect(await readStore(page, "resumeRevisions")).toEqual(before.revisions);
  73 |   await writeFile(`${directory}/repository-evidence.json`, JSON.stringify({ before, saved, updated, finalJobs: await jobs(), sessions: await sessions() }, null, 2));
  74 |   await listPage.close();
  75 | });
  76 | 
```