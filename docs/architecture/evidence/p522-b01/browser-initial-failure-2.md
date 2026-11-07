# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p40a1-job-source-modes.spec.ts >> P4.0a.1 job resume source modes >> creates Job A and Job B through the current source panel and preserves both after reload
- Location: tests\e2e\p40a1-job-source-modes.spec.ts:81:7

# Error details

```
Error: page.evaluate: Execution context was destroyed, most likely because of a navigation
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
    - main [ref=e89]:
      - generic [ref=e90]:
        - heading "正在加载数据" [level=2] [ref=e91]
        - paragraph [ref=e92]: 首次打开会准备一份本地示例数据，随后你可以创建自己的资料、简历和岗位。
  - region "操作通知"
```

# Test source

```ts
  51  |   test("analyzes one general resume and creates a branch without changing its source", async ({ page }) => {
  52  |     // 跳过向导会进入 mock AI 模式；本用例断言确定性匹配，需屏蔽可选语义增强。
  53  |     await page.route("**/api/ai/structured", (route) => route.fulfill({
  54  |       status: 502,
  55  |       contentType: "application/json",
  56  |       body: JSON.stringify({ ok: false, error: { code: "invalid_json", message: "AI request failed." } })
  57  |     }));
  58  |     await ensureGeneralResume(page);
  59  |     const generalBranches = (await readAllFromStore(page, "resumeBranches") as DbBranch[]).filter((branch) => branch.branchPurpose === "general");
  60  |     const sourceId = generalBranches.sort((left, right) => right.id.localeCompare(left.id))[0].id;
  61  |     const sourceBefore = await readFromStore<DbBranch>(page, "resumeBranches", sourceId);
  62  |     expect(sourceBefore?.branchPurpose).toBe("general");
  63  | 
  64  |     await skipSetupWizard(page);
  65  |     await page.getByRole("radio", { name: /优化已有简历/ }).click();
  66  |     await page.getByLabel("来源通用简历").selectOption(sourceId);
  67  |     await page.getByTestId("analyze-and-generate-job-resume").click();
  68  | 
  69  |     await expect(page).toHaveURL(/\/resume\?.*branchId=/, { timeout: 20_000 });
  70  |     const derivedId = new URL(page.url()).searchParams.get("branchId")!;
  71  |     const derived = await readFromStore<DbBranch>(page, "resumeBranches", derivedId);
  72  |     expect(derived).toMatchObject({
  73  |       branchPurpose: "job_specific",
  74  |       sourceBranchId: sourceId,
  75  |       sourceRevisionId: sourceBefore?.currentRevisionId
  76  |     });
  77  |     const sourceAfter = await readFromStore<DbBranch>(page, "resumeBranches", sourceId);
  78  |     expect(sourceAfter).toEqual(sourceBefore);
  79  |   });
  80  | 
  81  |   test("creates Job A and Job B through the current source panel and preserves both after reload", async ({ page }) => {
  82  |     // 同上：屏蔽 mock 模式下的可选语义增强，保持确定性匹配。
  83  |     await page.route("**/api/ai/structured", (route) => route.fulfill({
  84  |       status: 502,
  85  |       contentType: "application/json",
  86  |       body: JSON.stringify({ ok: false, error: { code: "invalid_json", message: "AI request failed." } })
  87  |     }));
  88  |     await ensureGeneralResume(page);
  89  |     const source = (await readAllFromStore(page, "resumeBranches") as DbBranch[])
  90  |       .find((branch) => branch.branchPurpose === "general")!;
  91  |     const sourceBefore = await readFromStore<DbBranch>(page, "resumeBranches", source.id);
  92  |     const profilesBefore = await readAllFromStore(page, "profiles");
  93  |     const jobs = await readAllFromStore(page, "jobDescriptions") as Array<{ id: string; title: string }>;
  94  |     expect(jobs.length).toBeGreaterThanOrEqual(2);
  95  | 
  96  |     const branchIds: string[] = [];
  97  |     for (const job of jobs.slice(0, 2)) {
  98  |       await skipSetupWizard(page);
  99  |       await page.locator(".job-card").filter({ hasText: job.title }).first().click();
  100 |       await page.getByRole("radio", { name: /优化已有简历/ }).click();
  101 |       await page.getByLabel("来源通用简历").selectOption(source.id);
  102 |       await page.getByTestId("analyze-and-generate-job-resume").click();
  103 |       await expect(page).toHaveURL(/\/resume\?.*branchId=/, { timeout: 20_000 });
  104 |       branchIds.push(new URL(page.url()).searchParams.get("branchId")!);
  105 |     }
  106 | 
  107 |     const [branchA, branchB] = await Promise.all(branchIds.map((id) =>
  108 |       readFromStore<DbBranch & { jobId: string }>(page, "resumeBranches", id)
  109 |     ));
  110 |     expect(branchA?.jobId).not.toBe(branchB?.jobId);
  111 |     for (const branch of [branchA, branchB]) {
  112 |       expect(branch).toMatchObject({
  113 |         branchPurpose: "job_specific",
  114 |         sourceBranchId: source.id,
  115 |         sourceRevisionId: sourceBefore?.currentRevisionId,
  116 |         currentRevisionId: expect.any(String)
  117 |       });
  118 |     }
  119 |     const branchABeforeReload = JSON.stringify(branchA);
  120 |     await page.reload();
  121 |     expect(JSON.stringify(await readFromStore(page, "resumeBranches", branchIds[0]))).toBe(branchABeforeReload);
  122 |     expect(await readFromStore(page, "resumeBranches", branchIds[1])).toEqual(branchB);
  123 |     expect(await readFromStore(page, "resumeBranches", source.id)).toEqual(sourceBefore);
  124 |     expect(await readAllFromStore(page, "profiles")).toEqual(profilesBefore);
  125 |   });
  126 | });
  127 | 
  128 | async function ensureGeneralResume(page: Page) {
  129 |   await skipSetupWizard(page);
  130 |   await page.goto("/resume");
  131 |   const createButton = page.getByRole("button").filter({ hasText: "从个人资料库创建" });
  132 |   await expect(createButton).toBeEnabled({ timeout: 20_000 });
  133 |   await createButton.click();
  134 |   await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
  135 | }
  136 | 
  137 | async function readFromStore<T>(page: Page, storeName: string, key: string): Promise<T | undefined> {
  138 |   return page.evaluate(async ({ storeName, key }) => {
  139 |     const request = indexedDB.open("CareerAdaptDb");
  140 |     const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  141 |     return new Promise<T | undefined>((resolve, reject) => {
  142 |       const transaction = database.transaction(storeName, "readonly");
  143 |       const getRequest = transaction.objectStore(storeName).get(key);
  144 |       getRequest.onsuccess = () => resolve(getRequest.result as T | undefined);
  145 |       getRequest.onerror = () => reject(getRequest.error);
  146 |     });
  147 |   }, { storeName, key });
  148 | }
  149 | 
  150 | async function readAllFromStore(page: Page, storeName: string): Promise<unknown[]> {
> 151 |   return page.evaluate(async (name) => {
      |               ^ Error: page.evaluate: Execution context was destroyed, most likely because of a navigation
  152 |     const request = indexedDB.open("CareerAdaptDb");
  153 |     const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  154 |     return new Promise<unknown[]>((resolve, reject) => {
  155 |       const transaction = database.transaction(name, "readonly");
  156 |       const getRequest = transaction.objectStore(name).getAll();
  157 |       getRequest.onsuccess = () => resolve(getRequest.result);
  158 |       getRequest.onerror = () => reject(getRequest.error);
  159 |     });
  160 |   }, storeName);
  161 | }
  162 | 
```