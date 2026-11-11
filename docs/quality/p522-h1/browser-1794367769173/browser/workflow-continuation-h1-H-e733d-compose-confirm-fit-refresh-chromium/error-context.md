# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workflow-continuation-h1.spec.ts >> H1 bundled Hermes analyze/save/compose/confirm/fit/refresh
- Location: tests\e2e\workflow-continuation-h1.spec.ts:4:5

# Error details

```
Test timeout of 240000ms exceeded.
```

```
Error: locator.click: Test timeout of 240000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: '导入资料' })

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
        - paragraph [ref=e68]: 完成第一条任务后会显示在这里。
      - generic [ref=e69]:
        - generic "工作区模式" [ref=e70]:
          - button "AI" [pressed] [ref=e71] [cursor=pointer]:
            - generic [ref=e72]: AI
          - button "协作" [ref=e73] [cursor=pointer]:
            - generic [ref=e74]: 协作
          - button "手动" [ref=e75] [cursor=pointer]:
            - generic [ref=e76]: 手动
        - link "设置与更多" [ref=e77] [cursor=pointer]:
          - /url: /settings
          - img [ref=e78]
          - generic [ref=e81]: 设置与更多
        - generic [ref=e82]:
          - generic [ref=e83]: CA
          - generic [ref=e84]:
            - strong [ref=e85]: 求职工作区
            - generic [ref=e86]: 本地数据
    - generic [ref=e90]:
      - generic [ref=e91]:
        - img [ref=e93]
        - heading "欢迎使用职适AI" [level=1] [ref=e97]
        - paragraph [ref=e98]: 配置 AI 接口后即可开始使用
      - generic [ref=e99]:
        - generic [ref=e100]:
          - generic [ref=e101]: API 密钥
          - generic [ref=e102]:
            - textbox "API 密钥" [ref=e103]:
              - /placeholder: sk-...
            - button "显示" [ref=e104] [cursor=pointer]
          - paragraph [ref=e105]: 内置 Hermes 会在应用启动时接管 AI；密钥经系统安全存储加密后保存在本机，不会保存在浏览器中。
        - generic [ref=e106]:
          - generic [ref=e107]: API 地址
          - textbox "API 地址" [ref=e108]:
            - /placeholder: 使用应用内置配置，或填写自定义 OpenAI 兼容地址
          - paragraph [ref=e109]: 留空即可使用应用随附的 AI 接口配置。
        - generic [ref=e110]:
          - generic [ref=e111]: 模型名称
          - textbox "模型名称" [ref=e112]:
            - /placeholder: 使用应用内置模型，或填写自定义模型
          - paragraph [ref=e113]: 留空即可使用应用随附的模型配置。
      - generic [ref=e114]:
        - button "开始使用" [disabled] [ref=e115]
        - button "跳过，先体验其他功能" [ref=e116] [cursor=pointer]
      - generic [ref=e117]:
        - paragraph [ref=e118]: 密钥由系统安全存储加密保存在本机，不会上传到任何服务器
        - paragraph [ref=e119]: 可随时在「设置 → AI 配置」中修改
  - region "操作通知"
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | import { readStore, installCoreWritingProvider } from "./support/p51CoreWorkflow";
  3  | 
  4  | test("H1 bundled Hermes analyze/save/compose/confirm/fit/refresh", async ({ page }, info) => {
  5  |  test.setTimeout(240_000);
  6  |  await page.goto("/setup");
  7  |  await expect.poll(async () => (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot?.apiReady, { timeout: 90_000 }).toBe(true);
  8  |  await page.getByLabel("API 密钥", { exact: true }).fill(process.env.HERMES_INTEGRATION_PROVIDER_KEY!);
  9  |  await page.getByLabel("API 地址", { exact: true }).fill(process.env.HERMES_INTEGRATION_PROVIDER_URL!);
  10 |  await page.getByLabel("模型名称", { exact: true }).fill("careeradapt-test");
  11 |  await page.getByRole("button", { name: "开始使用", exact: true }).click();
  12 |  await page.goto("/resume");
> 13 |  await page.getByRole("button", { name: "导入资料", exact: false }).click();
     |                                                                 ^ Error: locator.click: Test timeout of 240000ms exceeded.
  14 |  const dialog = page.getByRole("dialog", { name: "导入资料", exact: true });
  15 |  await dialog.getByLabel("识别方式").selectOption("local");
  16 |  const material={schemaVersion:"careeradapt-resume-v2",locale:"zh-CN",basics:{name:"H1合成人物",portfolioLinks:[],otherLinks:[],customFields:[]},sections:[
  17 |   {id:"project",sectionType:"project",title:"项目经历",order:0,visible:true,items:[{id:"h1-project",sectionType:"project",title:"AI应用项目",role:"项目成员",description:"参与 AI 应用项目的需求梳理、原型设计和功能验收。",highlights:["参与 AI 应用项目的需求梳理、原型设计和功能验收。"],tools:[],outcomes:[],customFields:[]}]},
  18 |   {id:"internship",sectionType:"internship",title:"实习经历",order:1,visible:true,items:[{id:"h1-internship",sectionType:"internship",organization:"合成公司",role:"开发实习生",highlights:["参与产品测试与缺陷记录。"],tools:[],outcomes:[],customFields:[]}]}
  19 |  ],unclassifiedBlocks:[]};
  20 |  await dialog.getByLabel("选择职业材料").setInputFiles({name:"h1-profile.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(material))});
  21 |  await expect(dialog.locator("article.review-row").first()).toBeVisible();
  22 |  await dialog.getByText("创建新人物", {exact:true}).click();
  23 |  await dialog.locator('input[name="new-profile-name"]').fill("H1合成人物");
  24 |  const accept=dialog.getByRole("button",{name:"采用此条",exact:true});
  25 |  while(await accept.count()) await accept.first().click();
  26 |  await expect(dialog.locator('input[name="import-create-general-resume"]').first()).not.toBeChecked();
  27 |  await dialog.getByRole("button",{name:"确认导入",exact:true}).click();
  28 |  await expect(dialog).not.toBeVisible();
  29 |  expect(await readStore(page,"resumeBranches")).toHaveLength(0);
  30 |  const before=await readStore(page,"profiles");
  31 |  await installCoreWritingProvider(page);
  32 |  await page.goto("/ai-workspace");
  33 |  await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u,{timeout:90000});
  34 |  const send=async(text:string)=>{await page.getByLabel("描述你的求职任务").fill(text);await page.getByRole("button",{name:"发送消息",exact:true}).click();};
  35 |  const sessions=()=>readStore(page,"agentSessions");
  36 |  await send("分析这个岗位 JD：岗位：软件工程师；岗位职责：参与产品开发和测试；任职要求：本科及以上学历，熟悉 Python，具备项目开发与团队协作经验。");
  37 |  await expect.poll(async()=> (await sessions()).some(s=> (s.taskState as {workflowId?:string;completionStatus?:string})?.workflowId==="job_ingestion" && (s.taskState as {completionStatus?:string}).completionStatus==="completed"),{timeout:60000}).toBe(true);
  38 |  expect(await readStore(page,"jobDescriptions")).toHaveLength(0);
  39 |  await send("先保存该岗位，再进行岗位匹配分析");
  40 |  await expect.poll(async()=> (await readStore(page,"jobDescriptions")).length,{timeout:60000}).toBe(1);
  41 |  await expect(page.getByRole("button",{name:"发送消息",exact:true})).toBeEnabled({timeout:60000});
  42 |  await send("基于已确认的 Profile 创建一份通用简历，然后再做岗位匹配");
  43 |  await expect(page.getByRole("button",{name:"直接生成",exact:true}).last()).toBeVisible({timeout:60000});
  44 |  await page.reload();
  45 |  await page.getByRole("button",{name:"直接生成",exact:true}).last().click();
  46 |  await expect.poll(async()=> (await sessions()).some(s=> (s.taskState as {workflowId?:string;completionStatus?:string})?.workflowId==="analyze_job_fit" && (s.taskState as {completionStatus?:string}).completionStatus==="completed"),{timeout:60000}).toBe(true);
  47 |  await page.reload();
  48 |  const branches=await readStore(page,"resumeBranches");
  49 |  expect(branches).toHaveLength(1);expect(branches[0].branchPurpose).toBe("general");
  50 |  expect(await readStore(page,"jobDescriptions")).toHaveLength(1);
  51 |  expect(await readStore(page,"profiles")).toEqual(before);
  52 |  const final=await sessions();expect(JSON.stringify(final)).not.toMatch(/duplicate_invalid_call|jobId invalid_type|mode invalid/);
  53 |  await info.attach("h1-final",{body:JSON.stringify({branches,sessions:final}),contentType:"application/json"});
  54 | });
  55 | 
```