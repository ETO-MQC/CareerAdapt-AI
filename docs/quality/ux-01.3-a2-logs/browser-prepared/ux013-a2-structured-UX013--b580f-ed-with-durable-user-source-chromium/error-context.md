# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux013-a2-structured.spec.ts >> UX013 A2 four structured operations reviewed committed and refreshed with durable user source
- Location: tests\e2e\ux013-a2-structured.spec.ts:12:5

# Error details

```
Error: expect(locator).toBeDisabled() failed

Locator:  getByTestId('structured-resume-editor').getByLabel('结构化修改目标', { exact: true }).locator('option').filter({ hasText: 'SQL（已存在）' })
Expected: disabled
Received: enabled
Timeout:  5000ms

Call log:
  - Expect "toBeDisabled" with timeout 5000ms
  - waiting for getByTestId('structured-resume-editor').getByLabel('结构化修改目标', { exact: true }).locator('option').filter({ hasText: 'SQL（已存在）' })
    12 × locator resolved to <option disabled value="skill-WlvQ_bLRMS">SQL（已存在）</option>
       - unexpected value "enabled"

```

```yaml
- alert
- complementary "AI 工作区导航":
  - link "职适AI 首页":
    - /url: /
    - text: 职适AI
  - button "收起 AI 导航"
  - button "新任务"
  - button "搜索 / 历史"
  - navigation "资产":
    - text: 资产
    - link "AI 助手":
      - /url: /ai-workspace
    - link "我的简历":
      - /url: /resume
    - link "个人资料库":
      - /url: /profile
    - link "岗位":
      - /url: /jobs
    - link "求职进度":
      - /url: /applications
    - link "回收站":
      - /url: /recycle
  - region "最近任务":
    - text: 最近任务
    - button "新的对话 任务状态：已完成": 新的对话 已完成
    - button "重命名"
    - button "归档"
  - button "AI" [pressed]
  - button "协作"
  - button "手动"
  - link "设置与更多":
    - /url: /settings
  - strong: 求职工作区
  - text: 本地数据
- main:
  - strong: 新的对话
  - text: 固定：A2匿名候选人 · V1
  - button "A2匿名候选人 · V1 2 条经历 · 2 项基础信息 · 创建于 2026/11/07":
    - strong: A2匿名候选人 · V1
    - text: 2 条经历 · 2 项基础信息 · 创建于 2026/11/07
  - button "AI Runtime Hermes，状态 不可用": AI · 服务 不可用 控制
  - status: 已完成
  - button "打开历史记录"
  - button "更多任务操作"
  - group: 精确修改一个字段
  - group:
    - text: 结构化修改简历
    - paragraph: 每次只处理一项；先选择目标，审核后确认保存。
    - text: 简历
    - combobox "结构化修改简历":
      - option "请选择简历"
      - option "通用简历 · 通用" [selected]
    - text: 操作
    - combobox "结构化操作":
      - option "事实字段更正"
      - option "已确认技能新增" [selected]
      - option "删除一条要点"
      - option "调整要点顺序"
    - text: 目标
    - combobox "结构化修改目标":
      - option "请选择明确目标" [selected]
      - option "SQL（已存在）" [disabled]
    - button "生成结构化审核提案" [disabled]
  - button "暂停任务"
  - region "AI 对话":
    - status "业务进度":
      - paragraph: 所选字段已保存
      - paragraph: 版本：resume-revision-fnv-390b69e5-219
    - article:
      - paragraph: 用户更正的新项目名称
      - button "编辑并重发"
      - button "历史版本"
      - button "复制消息"
      - group
  - text: 描述你的求职任务
  - textbox "描述你的求职任务":
    - /placeholder: 描述你的求职任务，或粘贴一份岗位描述...
  - button "添加材料与工具"
  - button "上传文件"
  - text: 已完成
  - button "发送消息" [disabled]
  - text: 松开即可添加文件
- region "操作通知"
```

# Test source

```ts
  19  |   await page.goto("/setup");
  20  |   await page.getByRole("button", { name: "跳过，先体验其他功能" }).click();
  21  |   await page.goto("/resume");
  22  |   await page.getByRole("button", { name: /导入已有简历/ }).click();
  23  |   let dialog = page.getByRole("dialog", { name: "导入简历" });
  24  |   await dialog.getByText("粘贴 JSON", { exact: true }).click();
  25  |   await dialog.getByLabel("JSON 内容").fill(JSON.stringify({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN",
  26  |     basics: { name: "A2匿名候选人", email: "a2@example.org", portfolioLinks: [], otherLinks: [], customFields: [] },
  27  |     sections: [{ id: "project", sectionType: "project", title: "项目经历", order: 0, visible: true, items: [{ id: "a2-project", sectionType: "project",
  28  |       title: "原项目名称", role: "项目成员", startDate: "2025-01", endDate: "2025-06", current: false,
  29  |       description: "参与接口测试。", highlights: ["执行接口测试。", "SQL 查询验证。", "执行接口测试。"], tools: [], outcomes: [], customFields: [] }] }], unclassifiedBlocks: [] }));
  30  |   await dialog.getByRole("button", { name: "导入 JSON", exact: true }).click();
  31  |   await dialog.locator("label.import-target-option").filter({ hasText: "创建新人物" }).click();
  32  |   for (let i = 0; i < 40 && await page.getByRole("button", { name: "确认此字段", exact: true }).count(); i++) await page.getByRole("button", { name: "确认此字段", exact: true }).first().click();
  33  |   for (let i = 0; i < 40 && await page.getByRole("button", { name: "核对并保留来源", exact: true }).count(); i++) await page.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
  34  |   await dialog.locator(".import-review-footer button.primary-button").click();
  35  |   const open = page.getByRole("button", { name: "打开", exact: true }); if (await open.isVisible()) await open.click();
  36  |   await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  37  |   // Explicit Branch URL waits for hydration instead of racing the transient list/restore view.
  38  |   const sourceId = (await readStore(page, "resumeBranches")).find(b => b.branchPurpose === "general")!.id as string;
  39  |   await page.goto(`/resume?branchId=${encodeURIComponent(sourceId)}`);
  40  |   await page.locator("details.toolbar-more > summary").click();
  41  |   await page.getByTestId("open-resume-import").click();
  42  |   dialog = page.getByRole("dialog", { name: "导入另一份简历" });
  43  |   await dialog.getByText("粘贴 JSON", { exact: true }).click();
  44  |   await dialog.getByLabel("JSON 内容").fill(JSON.stringify({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN",
  45  |     basics: { name: "A2匿名候选人", portfolioLinks: [], otherLinks: [], customFields: [] },
  46  |     sections: [{ id: "skills", sectionType: "skills", title: "专业技能", order: 0, visible: true,
  47  |       items: [{ id: "a2-sql", sectionType: "skills", name: "SQL", description: "使用 SQL 执行查询验证。", customFields: [] }] }], unclassifiedBlocks: [] }));
  48  |   await dialog.getByRole("button", { name: "导入 JSON", exact: true }).click();
  49  |   await dialog.locator("label.import-target-option").filter({ hasText: "导入到已有资料" }).click();
  50  |   await dialog.locator('input[name="import-create-general-resume"]').uncheck();
  51  |   for (let i = 0; i < 40 && await page.getByRole("button", { name: "确认此字段", exact: true }).count(); i++) await page.getByRole("button", { name: "确认此字段", exact: true }).first().click();
  52  |   for (let i = 0; i < 40 && await page.getByRole("button", { name: "核对并保留来源", exact: true }).count(); i++) await page.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
  53  |   await dialog.locator(".import-review-footer button.primary-button").click();
  54  |   await expect.poll(async () => (await readStore(page, "profiles")).some(p => (p.skills as Array<{ name: string }>).some(s => s.name === "SQL"))).toBe(true);
  55  |   const initial = await formal(page);
  56  |   const branch = initial.branches.find(b => b.branchPurpose === "general") as unknown as ResumeBranch;
  57  |   expect(branch).toBeTruthy();
  58  |   await page.goto("/ai-workspace"); await page.getByRole("button", { name: "新任务", exact: true }).click();
  59  |   const panel = page.getByTestId("structured-resume-editor"); await panel.locator("summary").first().click();
  60  |   await mkdir(evidenceDir, { recursive: true });
  61  |   const operations = ["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"];
  62  |   let factRevisionId = "";
  63  |   for (const operation of operations) {
  64  |     if (operation !== operations[0]) await panel.getByRole("button", { name: "开始另一项结构化操作", exact: true }).click();
  65  |     await panel.getByLabel("结构化修改简历", { exact: true }).selectOption(branch.id);
  66  |     await panel.getByLabel("结构化操作", { exact: true }).selectOption(operation);
  67  |     const target = panel.getByLabel("结构化修改目标", { exact: true });
  68  |     const options = await target.locator("option").allTextContents();
  69  |     const index = operation === "fact_correction" ? options.findIndex(t => t.includes("项目名称"))
  70  |       : operation === "bullet_removal" ? options.findIndex(t => t.includes("要点 3")) : 1;
  71  |     expect(index).toBeGreaterThan(0); await target.selectOption({ index });
  72  |     if (operation === "fact_correction") await panel.getByLabel("我的纠正内容", { exact: true }).fill("用户更正的新项目名称");
  73  |     if (operation === "bullet_reordering") await panel.getByLabel("要点新顺序", { exact: true }).fill("2,1");
  74  |     const before = await formal(page);
  75  |     await panel.getByRole("button", { name: "生成结构化审核提案", exact: true }).click();
  76  |     await expect(panel.getByRole("region", { name: "结构化修改审核" })).toBeVisible();
  77  |     expect((await formal(page)).revisions).toEqual(before.revisions);
  78  |     await page.reload(); await panel.locator("summary").first().click();
  79  |     await expect(panel.getByRole("region", { name: "结构化修改审核" })).toBeVisible();
  80  |     await page.setViewportSize({ width: 1024, height: 900 });
  81  |     const confirm = panel.getByRole("button", { name: "确认结构化修改", exact: true });
  82  |     await expect(confirm).toBeVisible();
  83  |     await page.screenshot({ path: info.outputPath(`${operation}-review-1024.png`), fullPage: true });
  84  |     await page.setViewportSize({ width: 1440, height: 1000 });
  85  |     await page.screenshot({ path: info.outputPath(`${operation}-review-wide.png`), fullPage: true });
  86  |     await confirm.click();
  87  |     await expect(panel.getByText(/已保存版本：/)).toBeVisible();
  88  |     const after = await formal(page), changed = after.branches.find(b => b.id === branch.id) as unknown as ResumeBranch;
  89  |     const revisionId = changed.currentRevisionId!;
  90  |     if (operation === "fact_correction") factRevisionId = revisionId;
  91  |     expect(after.profiles).toEqual(before.profiles);
  92  |     expect(after.branches.filter(b => b.id !== branch.id)).toEqual(before.branches.filter(b => b.id !== branch.id));
  93  |     expect(after.revisions).toHaveLength(before.revisions.length + 1);
  94  |     expect(after.revisions.filter(r => r.id !== revisionId)).toEqual(before.revisions);
  95  |     const original = (before.branches.find(b => b.id === branch.id) as unknown as ResumeBranch), expected = structuredClone(original);
  96  |     const project = expected.structuredContentItems!.find(i => i.data.sectionType === "project")!;
  97  |     if (operation === "confirmed_skill_addition") {
  98  |       expect(changed.structuredContentItems!.slice(0, -1)).toEqual(expected.structuredContentItems);
  99  |       expect(changed.contentItems.slice(0, -1)).toEqual(expected.contentItems);
  100 |     } else {
  101 |       const next = changed.structuredContentItems!.find(i => i.id === project.id)!;
  102 |       expect(changed.structuredContentItems!.filter(i => i.id !== project.id)).toEqual(expected.structuredContentItems!.filter(i => i.id !== project.id));
  103 |       expect(changed.contentItems.filter(i => i.id !== project.id)).toEqual(expected.contentItems.filter(i => i.id !== project.id));
  104 |       expect(next.data).toEqual({ ...project.data, ...(operation === "fact_correction" ? { title: "用户更正的新项目名称" }
  105 |         : { highlights: operation === "bullet_removal" ? ["执行接口测试。", "SQL 查询验证。"] : ["SQL 查询验证。", "执行接口测试。"] }) });
  106 |       expect(next.factRefs).toEqual(project.factRefs);
  107 |     }
  108 |     expect(changed).toEqual({ ...original, structuredContentItems: changed.structuredContentItems, contentItems: changed.contentItems,
  109 |       revision: original.revision + 1, currentRevisionId: revisionId, updatedAt: changed.updatedAt });
  110 |     const receipt = after.operations.find(r => r.revisionId === revisionId); expect(receipt).toBeTruthy();
  111 |     await page.reload(); await panel.locator("summary").first().click();
  112 |     await expect(panel.getByText(`已保存版本：${revisionId}`, { exact: true })).toBeVisible();
  113 |     expect((await formal(page)).revisions).toEqual(after.revisions);
  114 |     await writeFile(`${evidenceDir}/${operation}.json`, JSON.stringify({ before, after, receipt }, null, 2));
  115 |     if (operation === "confirmed_skill_addition") {
  116 |       await panel.getByRole("button", { name: "开始另一项结构化操作", exact: true }).click();
  117 |       await panel.getByLabel("结构化修改简历", { exact: true }).selectOption(branch.id);
  118 |       await panel.getByLabel("结构化操作", { exact: true }).selectOption("confirmed_skill_addition");
> 119 |       await expect(panel.getByLabel("结构化修改目标", { exact: true }).locator("option").filter({ hasText: "SQL（已存在）" })).toBeDisabled();
      |                                                                                                                    ^ Error: expect(locator).toBeDisabled() failed
  120 |       // A reload restores the saved authoritative outcome; no new task has been selected or committed.
  121 |       await page.reload(); await panel.locator("summary").first().click();
  122 |     }
  123 |   }
  124 |   // The first correction remains traceable after three subsequent tasks replaced its TaskState proposal.
  125 |   await page.goto(`/resume?branchId=${encodeURIComponent(branch.id)}`);
  126 |   await page.locator("details.toolbar-more > summary").click();
  127 |   await page.getByText("查询版本操作来源", { exact: true }).click();
  128 |   await page.getByLabel("历史版本来源", { exact: true }).selectOption(factRevisionId);
  129 |   const historical = page.getByTestId("precise-revision-evidence"); await historical.locator("summary").click();
  130 |   await expect(historical.getByText("原始纠正声明：用户更正的新项目名称", { exact: true })).toBeVisible();
  131 |   await page.screenshot({ path: info.outputPath("historical-source.png"), fullPage: true });
  132 |   expect((await formal(page)).profiles).toEqual(initial.profiles);
  133 |   expect(providerCalls).toBe(0);
  134 |   await writeFile(`${evidenceDir}/summary.json`, JSON.stringify({ operations, factRevisionId, providerCalls, final: await formal(page) }, null, 2));
  135 | });
  136 | 
```