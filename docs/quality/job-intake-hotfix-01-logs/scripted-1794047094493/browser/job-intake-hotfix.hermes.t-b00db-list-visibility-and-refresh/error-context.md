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

Expected: true
Received: false

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
          - button "新的对话 任务状态：等待输入" [ref=e69] [cursor=pointer]:
            - generic [ref=e71]: 新的对话
            - generic "任务状态：等待输入" [ref=e72]: 等待输入
          - generic [ref=e73]:
            - button "重命名" [ref=e74] [cursor=pointer]:
              - img [ref=e75]
            - button "归档" [ref=e78] [cursor=pointer]:
              - img [ref=e79]
      - generic [ref=e82]:
        - generic "工作区模式" [ref=e83]:
          - button "AI" [pressed] [ref=e84] [cursor=pointer]:
            - generic [ref=e85]: AI
          - button "协作" [ref=e86] [cursor=pointer]:
            - generic [ref=e87]: 协作
          - button "手动" [ref=e88] [cursor=pointer]:
            - generic [ref=e89]: 手动
        - link "设置与更多" [ref=e90] [cursor=pointer]:
          - /url: /settings
          - img [ref=e91]
          - generic [ref=e94]: 设置与更多
        - generic [ref=e95]:
          - generic [ref=e96]: CA
          - generic [ref=e97]:
            - strong [ref=e98]: 求职工作区
            - generic [ref=e99]: 本地数据
    - main [ref=e102]:
      - generic [ref=e103]:
        - generic [ref=e104]:
          - strong [ref=e105]: 新的对话
          - generic [ref=e106]: 固定：Core 候选人 · V1
          - button "Core 候选人 · V1 1 条经历 · 2 项基础信息 · 创建于 2026/11/07" [ref=e108] [cursor=pointer]:
            - generic [ref=e109]:
              - strong [ref=e110]: Core 候选人 · V1
              - generic [ref=e111]: 1 条经历 · 2 项基础信息 · 创建于 2026/11/07
            - img [ref=e112]
        - generic [ref=e114]:
          - button "AI Runtime Hermes，状态 Ready" [ref=e116] [cursor=pointer]:
            - generic [ref=e117]: AI · 服务
            - generic [ref=e118]: Ready
            - generic [ref=e119]: 控制
          - status [ref=e120]: AI 就绪
          - button "打开历史记录" [ref=e121] [cursor=pointer]:
            - img [ref=e122]
          - button "更多任务操作" [ref=e127] [cursor=pointer]:
            - img [ref=e128]
      - generic [ref=e133]:
        - group [ref=e134]:
          - generic "精确修改一个字段" [ref=e135] [cursor=pointer]
          - option "请选择简历" [selected]
          - option "通用简历 · 通用"
          - option "请选择条目与字段" [selected]
        - group [ref=e136]:
          - generic "结构化修改简历" [ref=e137] [cursor=pointer]
          - option "请选择简历" [selected]
          - option "通用简历 · 通用"
          - option "事实字段更正" [selected]
          - option "已确认技能新增"
          - option "删除一条要点"
          - option "调整要点顺序"
          - option "请选择明确目标" [selected]
        - region "今天想从哪一步开始？" [ref=e138]:
          - generic [ref=e139]:
            - generic [ref=e140]: 从真实经历开始
            - heading "今天想从哪一步开始？" [level=1] [ref=e141]
            - paragraph [ref=e142]: 导入一次经历，生成每个岗位专属的简历与求职方案。
          - generic [ref=e143]:
            - button "从零整理我的经历 通过简短访谈，把真实经历整理成可复用资料。" [ref=e144] [cursor=pointer]:
              - img [ref=e146]
              - generic [ref=e151]: 从零整理我的经历
              - generic [ref=e152]: 通过简短访谈，把真实经历整理成可复用资料。
            - button "导入现有简历 上传文件，提取内容并逐项核对来源。" [ref=e153] [cursor=pointer]:
              - img [ref=e155]
              - generic [ref=e159]: 导入现有简历
              - generic [ref=e160]: 上传文件，提取内容并逐项核对来源。
            - button "生成岗位定制简历 选择现有简历与岗位，生成安全的定制版本。" [ref=e161] [cursor=pointer]:
              - img [ref=e163]
              - generic [ref=e166]: 生成岗位定制简历
              - generic [ref=e167]: 选择现有简历与岗位，生成安全的定制版本。
            - button "从资料库组装简历 从已确认资料中选择经历，组织一份目标简历。" [ref=e168] [cursor=pointer]:
              - img [ref=e170]
              - generic [ref=e172]: 从资料库组装简历
              - generic [ref=e173]: 从已确认资料中选择经历，组织一份目标简历。
            - button "分析岗位匹配度 核对岗位要求、证据覆盖和需要补充的内容。" [ref=e174] [cursor=pointer]:
              - img [ref=e176]
              - generic [ref=e180]: 分析岗位匹配度
              - generic [ref=e181]: 核对岗位要求、证据覆盖和需要补充的内容。
            - button "检查并导出简历 检查结构、排版与事实风险，准备导出。" [ref=e182] [cursor=pointer]:
              - img [ref=e184]
              - generic [ref=e188]: 检查并导出简历
              - generic [ref=e189]: 检查结构、排版与事实风险，准备导出。
        - generic [ref=e190]:
          - generic [ref=e191]:
            - generic [ref=e192]: 描述你的求职任务
            - textbox "描述你的求职任务" [ref=e193]:
              - /placeholder: 描述你的求职任务，或粘贴一份岗位描述...
          - generic [ref=e194]:
            - button "添加材料与工具" [ref=e196] [cursor=pointer]:
              - img [ref=e197]
            - button "上传文件" [ref=e198]
            - generic [ref=e199]:
              - generic [ref=e200]: AI 就绪
              - button "发送消息" [disabled] [ref=e201]:
                - img [ref=e202]
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
  22 |   const before = { profiles: await readStore(page, "profiles"), branches: await readStore(page, "resumeBranches"), revisions: await readStore(page, "resumeRevisions") };
  23 |   await page.goto("/ai-workspace");
  24 |   await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u, { timeout: 60_000 });
  25 |   await page.getByRole("button", { name: "新任务", exact: true }).click();
  26 |   const jobs = () => readStore(page, "jobDescriptions");
  27 |   const sessions = async () => (await readStore(page, "agentSessions")) as unknown as AgentSession[];
  28 |   const send = async (text: string, company: string | null) => {
  29 |     await page.getByLabel("描述你的求职任务").fill(text);
  30 |     await page.getByRole("button", { name: "发送消息", exact: true }).click();
  31 |     await expect.poll(async () => {
  32 |       const list = await jobs();
  33 |       const session = (await sessions()).find(s => s.taskState?.workflowId === "job_ingestion");
  34 |       return list.length === 1 && list[0].company === company && session?.hermesRun?.status === "completed"
  35 |         && session.taskState?.knownSlots.jobPersistenceVerified === true;
> 36 |     }).toBe(true);
     |        ^ Error: expect(received).toBe(expected) // Object.is equality
  37 |     expect(await page.locator(".agent-confirmation").count()).toBe(0);
  38 |     expect(await page.locator(".agent-tool-status-row").textContent()).not.toMatch(/career\.workflow|operationId|commit_job/);
  39 |   };
  40 |   await send(`先保存岗位。\n${JOB_INTAKE_INCIDENT_JD}`, null);
  41 |   const saved = (await jobs())[0];
  42 |   expect(saved.rawText).toBe(JOB_INTAKE_INCIDENT_JD);
  43 |   await page.screenshot({ path: info.outputPath("saved-no-company.png"), fullPage: true });
  44 |   // Keep a mounted Job List open while a separate Assistant turn updates the Repository.
  45 |   const listPage = await page.context().newPage();
  46 |   await listPage.goto("/jobs");
  47 |   await expect(listPage.locator(".job-card").filter({ hasText: "岗位名称待补充" })).toContainText("公司待补充");
  48 |   await send("公司是华为。", "华为");
  49 |   const updated = (await jobs())[0];
  50 |   expect(updated.id).toBe(saved.id);
  51 |   expect(updated.rawText).toBe(saved.rawText);
  52 |   expect(updated.requirements).toEqual(saved.requirements);
  53 |   await expect(listPage.locator(".job-card").filter({ hasText: "岗位名称待补充" })).toContainText("华为");
  54 |   await listPage.reload();
  55 |   await expect(listPage.locator(".job-card").filter({ hasText: "华为" })).toHaveCount(1);
  56 |   await listPage.screenshot({ path: info.outputPath("updated-job-list.png"), fullPage: true });
  57 |   await page.reload();
  58 |   await send("先保存岗位。", "华为");
  59 |   await send("公司是华为。", "华为");
  60 |   expect(await jobs()).toHaveLength(1);
  61 |   expect(await readStore(page, "profiles")).toEqual(before.profiles);
  62 |   expect(await readStore(page, "resumeBranches")).toEqual(before.branches);
  63 |   expect(await readStore(page, "resumeRevisions")).toEqual(before.revisions);
  64 |   await writeFile(`${directory}/repository-evidence.json`, JSON.stringify({ before, saved, updated, finalJobs: await jobs(), sessions: await sessions() }, null, 2));
  65 |   await listPage.close();
  66 | });
  67 | 
```