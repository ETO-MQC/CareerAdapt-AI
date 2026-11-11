# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p522-core-closure.spec.ts >> E2E-A: official import, General PDF, Job A and Job B confirmed revisions remain isolated
- Location: tests\e2e\p522-core-closure.spec.ts:20:5

# Error details

```
TimeoutError: locator.click: Timeout 15000ms exceeded.
Call log:
  - waiting for getByTestId('job-manual-mode-dialog')

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
      - generic [ref=e104]:
        - heading "岗位" [level=1] [ref=e105]
        - generic [ref=e106]: 3 个当前岗位 · 0 个已归档
      - generic [ref=e107]:
        - article [ref=e108]:
          - generic [ref=e109]:
            - generic [ref=e110]:
              - heading "新增 / 更新岗位" [level=2] [ref=e111]
              - paragraph [ref=e112]: 粘贴完整 JD，系统会保留原文和来源。
            - generic [ref=e113]: 等待保存
          - generic [ref=e114]:
            - generic [ref=e115]:
              - text: 岗位名称
              - textbox "岗位名称" [ref=e116]:
                - /placeholder: 例如：数据产品经理…
                - text: AI 应用开发 P522-B
            - generic [ref=e117]:
              - text: 公司名称
              - textbox "公司名称" [ref=e118]:
                - /placeholder: 例如：某科技公司…
                - text: 合成公司 B
            - generic [ref=e119]:
              - text: 岗位描述
              - textbox "岗位描述" [ref=e120]:
                - /placeholder: 粘贴岗位职责、任职要求和加分项…
                - text: 岗位职责 1. 参与 AI 应用需求梳理和功能验收。 任职要求 1. 熟悉 Python 或 SQL。 2. 团队协作能力优先。
          - generic [ref=e121]:
            - group "重复岗位选择" [ref=e122]:
              - generic [ref=e123]: 与已有候选岗位「合成公司 A / AI 应用开发 P522-A」内容相同：合并到它，还是独立保存？
              - button "合并到已有岗位" [ref=e124] [cursor=pointer]
              - button "保存为独立岗位" [ref=e125] [cursor=pointer]
            - button "请先选择处理方式" [disabled] [ref=e126] [cursor=pointer]
        - complementary [ref=e127]:
          - generic [ref=e129]:
            - heading "岗位列表" [level=2] [ref=e130]
            - paragraph [ref=e131]: 3 个当前岗位 · 0 个已归档
          - group "岗位状态" [ref=e132]:
            - button "当前" [ref=e133] [cursor=pointer]
            - button "已归档" [ref=e134] [cursor=pointer]
          - generic [ref=e135]:
            - generic [ref=e136]:
              - button "数据分析实习生 示例科技公司 2 条要求 · 7/1 · 示例岗位" [ref=e137] [cursor=pointer]:
                - strong [ref=e138]: 数据分析实习生
                - generic [ref=e139]: 示例科技公司
                - generic [ref=e140]: 2 条要求 · 7/1 · 示例岗位
              - generic [ref=e141]:
                - button "编辑 数据分析实习生" [ref=e142] [cursor=pointer]:
                  - img [ref=e143]
                - button "删除 数据分析实习生" [ref=e146] [cursor=pointer]:
                  - img [ref=e147]
            - generic [ref=e150]:
              - button "AI 应用开发 P522-A 合成公司 A 3 条要求 · 11/11 · 文本导入" [ref=e151] [cursor=pointer]:
                - strong [ref=e152]: AI 应用开发 P522-A
                - generic [ref=e153]: 合成公司 A
                - generic [ref=e154]: 3 条要求 · 11/11 · 文本导入
              - generic [ref=e155]:
                - button "编辑 AI 应用开发 P522-A" [ref=e156] [cursor=pointer]:
                  - img [ref=e157]
                - button "删除 AI 应用开发 P522-A" [ref=e160] [cursor=pointer]:
                  - img [ref=e161]
            - generic [ref=e164]:
              - button "外贸/跨境运营实习生 示例跨境公司 2 条要求 · 7/1 · 示例岗位" [ref=e165] [cursor=pointer]:
                - strong [ref=e166]: 外贸/跨境运营实习生
                - generic [ref=e167]: 示例跨境公司
                - generic [ref=e168]: 2 条要求 · 7/1 · 示例岗位
              - generic [ref=e169]:
                - button "编辑 外贸/跨境运营实习生" [ref=e170] [cursor=pointer]:
                  - img [ref=e171]
                - button "删除 外贸/跨境运营实习生" [ref=e174] [cursor=pointer]:
                  - img [ref=e175]
      - generic [ref=e178]:
        - img [ref=e179]
        - heading "先添加或选择一个岗位" [level=2] [ref=e183]
        - paragraph [ref=e184]: 正式岗位提交后，这里会提供两种岗位简历生成方式。
  - region "操作通知"
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | import { prepareCoreSourceResume, completeCoreResumeWorkflow, readStore, verifyCoreResumePdf } from "./support/p51CoreWorkflow";
  3   | 
  4   | test.use({ actionTimeout: 15_000 });
  5   | 
  6   | async function setup(page: Page) {
  7   |   await page.goto("/setup");
  8   |   await expect.poll(async () => (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot?.apiReady, { timeout: 90_000 }).toBe(true);
  9   |   await page.getByLabel("API 密钥", { exact: true }).fill(process.env.HERMES_INTEGRATION_PROVIDER_KEY!);
  10  |   await page.getByLabel("API 地址", { exact: true }).fill(process.env.HERMES_INTEGRATION_PROVIDER_URL!);
  11  |   await page.getByLabel("模型名称", { exact: true }).fill("careeradapt-test");
  12  |   await page.getByRole("button", { name: "开始使用", exact: true }).click();
  13  |   await expect(page).not.toHaveURL(/\/setup$/u, { timeout: 90_000 });
  14  | }
  15  | 
  16  | async function snapshot(page: Page) {
  17  |   return Object.fromEntries(await Promise.all(["profiles", "resumeBranches", "resumeRevisions", "jobDescriptions", "exportRecords"].map(async name => [name, await readStore(page, name)])));
  18  | }
  19  | 
  20  | test("E2E-A: official import, General PDF, Job A and Job B confirmed revisions remain isolated", async ({ page }, info) => {
  21  |   test.setTimeout(300_000);
  22  |   await setup(page);
  23  |   await prepareCoreSourceResume(page);
  24  |   const general = (await readStore(page, "resumeBranches")).find(b => b.branchPurpose === "general")!;
  25  |   expect(general).toBeTruthy();
  26  |   const baseline = await snapshot(page);
  27  |   await verifyCoreResumePdf(page, String(general.id));
  28  |   await info.attach("general-preview", { body: await page.screenshot(), contentType: "image/png" });
  29  |   let previous: Awaited<ReturnType<typeof snapshot>> | undefined;
  30  |   for (const suffix of ["A", "B"]) {
  31  |     await page.goto("/jobs");
  32  |     await page.getByTestId("job-title-input").fill(`AI 应用开发 P522-${suffix}`);
  33  |     await page.getByTestId("job-company-input").fill(`合成公司 ${suffix}`);
  34  |     await page.getByTestId("job-raw-textarea").fill("岗位职责\n1. 参与 AI 应用需求梳理和功能验收。\n任职要求\n1. 熟悉 Python 或 SQL。\n2. 团队协作能力优先。");
  35  |     await page.getByTestId("save-job-raw-input").click();
> 36  |     await page.getByTestId("job-manual-mode-dialog").click();
      |                                                      ^ TimeoutError: locator.click: Timeout 15000ms exceeded.
  37  |     const dialog = page.getByRole("dialog");
  38  |     const checks = dialog.getByRole("checkbox");
  39  |     for (let i = 0; i < await checks.count(); i++) await checks.nth(i).check();
  40  |     await dialog.getByTestId("commit-job").click();
  41  |     await expect(page.getByTestId("conversion-result")).toBeVisible();
  42  |     const job = (await readStore(page, "jobDescriptions")).find(j => String(j.title).includes(`P522-${suffix}`))!;
  43  |     await completeCoreResumeWorkflow(page, String(job.id));
  44  |     const after = await snapshot(page);
  45  |     expect(after.profiles).toEqual(baseline.profiles);
  46  |     expect(after.resumeBranches.find(b => b.id === general.id)).toEqual(general);
  47  |     if (previous) {
  48  |       for (const branch of previous.resumeBranches) expect(after.resumeBranches.find(b => b.id === branch.id)).toEqual(branch);
  49  |       for (const revision of previous.resumeRevisions) expect(after.resumeRevisions.find(r => r.id === revision.id)).toEqual(revision);
  50  |     }
  51  |     previous = after;
  52  |     await info.attach(`job-${suffix}-preview`, { body: await page.screenshot(), contentType: "image/png" });
  53  |   }
  54  |   expect(previous!.resumeBranches.filter(b => b.profileId === general.profileId)).toHaveLength(3);
  55  |   await info.attach("business-before-after", { body: JSON.stringify({ baseline, after: previous }, null, 2), contentType: "application/json" });
  56  | });
  57  | 
  58  | test("E2E-B: material edit/reject, refresh confirmation, Agent stop and edited-message recovery", async ({ page }, info) => {
  59  |   test.setTimeout(240_000);
  60  |   await setup(page);
  61  |   await page.goto("/resume");
  62  |   const open = async () => {
  63  |     await page.getByRole("button", { name: "导入资料", exact: false }).click();
  64  |     return page.getByRole("dialog", { name: "导入资料", exact: true });
  65  |   };
  66  |   let dialog = await open();
  67  |   await dialog.getByLabel("识别方式").selectOption("local");
  68  |   const material = { schemaVersion: "careeradapt-resume-v2", locale: "zh-CN", basics: { portfolioLinks: [], otherLinks: [], customFields: [] }, sections: [
  69  |     { id: "cert", sectionType: "certificates", title: "证书", order: 0, visible: true, items: [{ id: "cert1", sectionType: "certificates", name: "P522 合成资格证书", issuer: "原机构", customFields: [] }] },
  70  |     { id: "award", sectionType: "awards", title: "奖项", order: 1, visible: true, items: [{ id: "award1", sectionType: "awards", name: "不应入库奖项", customFields: [] }] }
  71  |   ], unclassifiedBlocks: [] };
  72  |   await dialog.getByLabel("选择职业材料").setInputFiles({ name: "p522-material.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(material)) });
  73  |   await expect(dialog.getByLabel("材料候选证书名称")).toHaveValue("P522 合成资格证书");
  74  |   const before = await snapshot(page);
  75  |   await dialog.getByText("创建新人物", { exact: true }).click();
  76  |   await dialog.locator('input[name="new-profile-name"]').fill("P522 合成人物");
  77  |   const certificate = () => dialog.locator("article.review-row").filter({ has: page.locator('select[aria-label="证书栏目类型"]') });
  78  |   const issuer = certificate().getByLabel("材料候选颁发方", { exact: true });
  79  |   await issuer.fill("人工核对机构"); await issuer.blur();
  80  |   await dialog.getByRole("button", { name: "采用此条", exact: true }).click();
  81  |   await dialog.locator("article.review-row").filter({ has: page.locator('select[aria-label="奖项栏目类型"]') }).locator('input[name$="-included"]').last().uncheck();
  82  |   expect(await snapshot(page)).toEqual(before);
  83  |   await page.reload(); dialog = await open();
  84  |   await expect(certificate().getByLabel("材料候选颁发方", { exact: true })).toHaveValue("人工核对机构");
  85  |   await expect(dialog.locator('input[name="import-create-general-resume"]').first()).not.toBeChecked();
  86  |   await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  87  |   await expect(dialog).not.toBeVisible();
  88  |   await page.reload();
  89  |   const saved = await snapshot(page);
  90  |   expect(saved.resumeBranches).toEqual(before.resumeBranches);
  91  |   expect(saved.resumeRevisions).toEqual(before.resumeRevisions);
  92  |   const profile = saved.profiles.find(p => p.name === "P522 合成人物")!;
  93  |   expect(JSON.stringify(profile)).toContain("人工核对机构");
  94  |   expect(JSON.stringify(profile)).not.toContain("不应入库奖项");
  95  |   await page.goto("/ai-workspace");
  96  |   await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u, { timeout: 90_000 });
  97  |   await page.getByLabel("描述你的求职任务").fill("P512-QUEUE-FIRST P522-STOP-A 读取当前资料，不要修改。");
  98  |   await page.getByRole("button", { name: "发送消息", exact: true }).click();
  99  |   const sessions = () => readStore(page, "agentSessions");
  100 |   await expect.poll(async () => (await sessions()).some(s => (s.hermesRun as { status?: string })?.status === "running"), { timeout: 60_000 }).toBe(true);
  101 |   await page.getByRole("button", { name: "停止运行", exact: true }).click();
  102 |   await expect(page.getByRole("button", { name: "停止运行", exact: true })).toBeDisabled();
  103 |   await page.getByRole("button", { name: "编辑并重发", exact: true }).last().click();
  104 |   await page.getByLabel("编辑消息", { exact: true }).fill("P522-EDIT-B 读取当前资料，仅概览。");
  105 |   await page.getByRole("button", { name: "确认并重发", exact: true }).click();
  106 |   await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("P522 当前资料已读取", { timeout: 90_000 });
  107 |   await page.reload();
  108 |   await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("P522 当前资料已读取");
  109 |   expect(await snapshot(page)).toEqual(saved);
  110 |   await info.attach("material-agent-before-after", { body: JSON.stringify({ before, saved, sessions: await sessions() }, null, 2), contentType: "application/json" });
  111 |   await info.attach("recovered-workspace", { body: await page.screenshot(), contentType: "image/png" });
  112 | });
  113 | 
```