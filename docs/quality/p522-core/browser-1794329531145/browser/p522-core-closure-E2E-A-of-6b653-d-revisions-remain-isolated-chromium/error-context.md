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
  - waiting for getByRole('button', { name: '排版设置', exact: true })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]:
    - img [ref=e8]
  - alert [ref=e11]
  - generic [ref=e12]:
    - complementary "AI 工作区导航" [ref=e13]:
      - button "展开 AI 导航" [ref=e15] [cursor=pointer]:
        - img [ref=e16]
      - generic [ref=e19]:
        - button [ref=e20] [cursor=pointer]:
          - img [ref=e21]
        - button [ref=e22] [cursor=pointer]:
          - img [ref=e23]
      - navigation "资产" [ref=e26]:
        - link "AI 助手" [ref=e27] [cursor=pointer]:
          - /url: /ai-workspace
          - img [ref=e28]
        - link "我的简历" [ref=e31] [cursor=pointer]:
          - /url: /resume
          - img [ref=e32]
        - link "个人资料库" [ref=e35] [cursor=pointer]:
          - /url: /profile
          - img [ref=e36]
        - link "岗位" [ref=e39] [cursor=pointer]:
          - /url: /jobs
          - img [ref=e40]
        - link "求职进度" [ref=e44] [cursor=pointer]:
          - /url: /applications
          - img [ref=e45]
        - link "回收站" [ref=e47] [cursor=pointer]:
          - /url: /recycle
          - img [ref=e48]
      - region "最近任务" [ref=e55]:
        - button "任务状态：等待输入" [ref=e57] [cursor=pointer]:
          - generic "任务状态：等待输入" [ref=e59]: 等待输入
      - generic [ref=e60]:
        - link [ref=e61] [cursor=pointer]:
          - /url: /settings
          - img [ref=e62]
        - generic [ref=e66]: CA
    - main [ref=e69]:
      - generic [ref=e70]:
        - generic [ref=e71]:
          - button [ref=e72] [cursor=pointer]: AI 应用开发 P522-A - 合成公司 A - Core 候选人
          - button [ref=e73] [cursor=pointer]: 通用简历
        - generic [ref=e74]:
          - button "返回" [ref=e75] [cursor=pointer]
          - generic [ref=e76]:
            - generic [ref=e77]: 岗位简历 / 可编辑
            - heading "AI 应用开发 P522-A - 合成公司 A - Core 候选人" [level=2] [ref=e78]
            - generic [ref=e79]:
              - generic [ref=e80]: 自动保存已开启
              - status [ref=e81]: 已保存
        - navigation "编辑模式" [ref=e82]:
          - button "编辑" [active] [ref=e83] [cursor=pointer]:
            - generic [ref=e84]: 编辑
          - button "AI优化" [pressed] [ref=e85] [cursor=pointer]:
            - generic [ref=e86]: AI优化
        - generic "简历工作栏" [ref=e87]:
          - generic [ref=e88]:
            - group [ref=e89]:
              - generic "1 条需复核" [ref=e90] [cursor=pointer]
            - button "撤销" [ref=e91] [cursor=pointer]
            - button "重做" [disabled] [ref=e92] [cursor=pointer]
            - button "加入求职进度" [ref=e93] [cursor=pointer]
            - button "下载 PDF" [ref=e94] [cursor=pointer]
            - group [ref=e95]:
              - generic "更多" [ref=e96] [cursor=pointer]
              - option "请选择版本" [selected]
              - option "版本 1"
              - option "版本 2"
        - generic [ref=e97]:
          - generic [ref=e98]:
            - generic [ref=e99]: 当前岗位
            - strong [ref=e100]: AI 应用开发 P522-A
          - generic [ref=e101]:
            - generic [ref=e102]: 公司
            - strong [ref=e103]: 合成公司 A
          - generic [ref=e104]:
            - generic [ref=e105]: 来源通用简历
            - strong [ref=e106]: 通用简历
          - generic [ref=e107]:
            - generic [ref=e108]: 匹配更新时间
            - strong [ref=e109]: 11/11 00:53
          - generic [ref=e110]:
            - generic [ref=e111]: 待处理建议
            - strong [ref=e112]: "0"
          - generic [ref=e113]:
            - generic [ref=e114]: 当前风险
            - strong [ref=e115]: 未发现高风险
          - generic [ref=e116]:
            - button "返回岗位" [ref=e117] [cursor=pointer]
            - button "AI 优化" [ref=e118] [cursor=pointer]
      - generic [ref=e119]:
        - generic [ref=e120]:
          - generic [ref=e121]:
            - generic [ref=e122]: AI 岗位优化
            - generic [ref=e123]:
              - button "最小化" [ref=e124] [cursor=pointer]:
                - img [ref=e125]
              - button "最大化" [ref=e126] [cursor=pointer]:
                - img [ref=e127]
              - button "关闭" [ref=e129] [cursor=pointer]:
                - img [ref=e130]
          - generic [ref=e133]:
            - tablist "AI岗位优化工具" [ref=e134]:
              - button "岗位 优化" [ref=e135] [cursor=pointer]:
                - generic [ref=e136]: 岗位
                - generic [ref=e137]: 优化
              - button "投递 检查" [ref=e138] [cursor=pointer]:
                - generic [ref=e139]: 投递
                - generic [ref=e140]: 检查
              - button "📋 日志" [ref=e141] [cursor=pointer]:
                - generic [ref=e142]: 📋
                - generic [ref=e143]: 日志
            - region "AI 岗位优化" [ref=e145]:
              - navigation "岗位定制步骤" [ref=e146]:
                - button "1 匹配概览" [ref=e147] [cursor=pointer]
                - button "2 补充信息" [disabled] [ref=e148] [cursor=pointer]
                - button "3 改写建议" [disabled] [ref=e149] [cursor=pointer]
                - button "4 确认并应用" [disabled] [ref=e150] [cursor=pointer]
              - generic [ref=e151]:
                - generic [ref=e152]:
                  - generic [ref=e153]:
                    - text: 合成公司 A
                    - heading "AI 应用开发 P522-A" [level=2] [ref=e154]
                    - paragraph [ref=e155]: 岗位适配度，不代表 ATS 通过率或录取概率
                  - strong [ref=e156]: "39"
                - generic [ref=e158]: ✅ 此简历已优化 1 次，再次优化将基于当前内容重新生成建议。
                - generic "定制模式（原推荐改写力度）" [ref=e159]:
                  - text: 定制模式
                  - combobox "定制模式（原推荐改写力度）" [ref=e160]:
                    - option "稳健：只用已证明经历"
                    - option "竞争力：加入确认能力" [selected]
                    - option "最大匹配：补问岗位缺口"
                - generic [ref=e161]:
                  - generic [ref=e162]:
                    - generic [ref=e163]: 硬性条件
                    - strong [ref=e164]: "0"
                  - generic [ref=e165]:
                    - generic [ref=e166]: 核心能力
                    - strong [ref=e167]: "0"
                  - generic [ref=e168]:
                    - generic [ref=e169]: 职责匹配
                    - strong [ref=e170]: "72"
                  - generic [ref=e171]:
                    - generic [ref=e172]: 加分项
                    - strong [ref=e173]: "0"
                  - generic [ref=e174]:
                    - generic [ref=e175]: 关键词覆盖
                    - strong [ref=e176]: "0"
                - generic [ref=e177]:
                  - heading "你的优势" [level=3] [ref=e178]
                  - list [ref=e179]:
                    - listitem [ref=e180]: 匹配能力：参与 AI 应用需求梳理和功能验收。
                - generic [ref=e181]:
                  - heading "主要缺口" [level=3] [ref=e182]
                  - list [ref=e183]:
                    - listitem [ref=e184]: 尚无直接证据：熟悉 Python 或 SQL。
                    - listitem [ref=e185]: 尚无直接证据：团队协作能力优先。
                - generic [ref=e186]:
                  - strong [ref=e187]: 当前策略
                  - paragraph [ref=e188]: 优先呈现已证明经历，并把用户确认的可迁移能力集中标为待确认项。
                - button "生成改写建议" [ref=e189] [cursor=pointer]:
                  - img [ref=e190]
                  - text: 生成改写建议
          - generic "拖动窗口" [ref=e193]:
            - img [ref=e194]
        - button "拖拽调整字段面板与 A4 预览宽度"
        - generic [ref=e205]:
          - generic [ref=e208]:
            - generic [ref=e209]: 第 1 页 / 共 1 页
            - article "A4 简历预览第 1 页" [ref=e210]:
              - generic [ref=e211]:
                - generic [ref=e212]:
                  - heading "Core 候选人" [level=1] [ref=e213]
                  - paragraph [ref=e214]: AI 应用开发 P522-A
                - generic [ref=e216]: core@example.org
              - generic [ref=e217]:
                - heading "项目经历" [level=2] [ref=e218]
                - article [ref=e220]:
                  - generic [ref=e221]:
                    - heading "AI 应用项目" [level=3] [ref=e222]
                    - strong [ref=e223]:
                      - generic [ref=e224]: 项目成员
                    - time [ref=e225]:
                      - generic [ref=e226]: "2025.01"
                      - generic [ref=e227]: –2025.06
                  - paragraph [ref=e228]: 参与 AI 应用项目的需求梳理、原型设计和功能验收。
                  - list [ref=e229]:
                    - listitem [ref=e230]: AI 应用项目：参与需求梳理、原型设计和功能验收。
          - generic "A4 预览工具":
            - generic: 1 页
            - group "画布缩放" [ref=e231]:
              - button "缩小预览" [ref=e232] [cursor=pointer]: "-"
              - generic [ref=e233]: 100%
              - button "放大预览" [ref=e234] [cursor=pointer]: +
              - button "适合宽度" [ref=e235] [cursor=pointer]
              - button "整页" [ref=e236] [cursor=pointer]
  - region "操作通知"
```

# Test source

```ts
  1  | import { expect, type Page } from "@playwright/test";
  2  | 
  3  | export async function openManualContentTab(page: Page) {
  4  |   await openResumeEditMode(page);
  5  |   await expect(page.locator(".branch-editor").first()).toBeVisible({ timeout: 15_000 });
  6  | }
  7  | 
  8  | export async function openManualTypographyTab(page: Page) {
  9  |   await openResumeStyleTab(page, 2);
  10 |   await expect(page.getByLabel("全局字号", { exact: true })).toBeVisible({ timeout: 15_000 });
  11 | }
  12 | 
  13 | export async function openManualLayoutTab(page: Page) {
  14 |   await openResumeStyleTab(page, 1);
  15 |   await expect(page.getByTestId("resume-property-panel")).toBeVisible({ timeout: 15_000 });
  16 | }
  17 | 
  18 | export async function openManualPageTab(page: Page) {
  19 |   await openResumeStyleTab(page, 3);
  20 |   const advanced = page.getByTestId("resume-layout-inspector").locator("details.precision-advanced");
  21 |   if (!await advanced.getAttribute("open").then(value => value !== null)) await advanced.locator("summary").click();
  22 |   await expect(page.getByTestId("page-policy-selector")).toBeVisible({ timeout: 15_000 });
  23 | }
  24 | 
  25 | export async function openManualTemplateTab(page: Page) {
  26 |   await openResumeStyleTab(page, 0);
  27 |   await expect(page.locator(".template-center-entry")).toBeVisible({ timeout: 15_000 });
  28 | }
  29 | 
  30 | export async function openManualHistoryTab(page: Page) {
  31 |   await expect(page.getByTestId("resume-studio-workbar")).toBeVisible({ timeout: 15_000 });
  32 |   await page.locator(".toolbar-more summary").click();
  33 |   await expect(page.locator(".toolbar-more-popover")).toBeVisible({ timeout: 15_000 });
  34 | }
  35 | 
  36 | export async function openAiDiagnosticsTab(page: Page) {
  37 |   await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
  38 |   const modeRail = page.locator(".resume-mode-rail button");
  39 |   await expect(modeRail.nth(1)).toBeVisible({ timeout: 15_000 });
  40 |   await modeRail.nth(1).click();
  41 |   const aiTabs = page.locator(".resume-inspector .inspector-tablist button");
  42 |   await expect(aiTabs.nth(2)).toBeVisible({ timeout: 15_000 });
  43 |   await aiTabs.nth(2).click();
  44 |   await expect(page.getByTestId("resume-diagnostics-panel")).toBeVisible({ timeout: 15_000 });
  45 | }
  46 | 
  47 | export async function openApplicationMaterialsTab(page: Page) {
  48 |   const detail = page.getByTestId("application-detail");
  49 |   await expect(detail).toBeVisible({ timeout: 15_000 });
  50 |   const tabs = detail.locator(".application-detail-tablist button");
  51 |   await expect(tabs.nth(2)).toBeVisible({ timeout: 15_000 });
  52 |   await tabs.nth(2).click();
  53 |   await expect(detail.getByTestId("application-materials-panel")).toBeVisible({ timeout: 15_000 });
  54 | }
  55 | 
  56 | export async function openApplicationOverviewTab(page: Page) {
  57 |   const detail = page.getByTestId("application-detail");
  58 |   await expect(detail).toBeVisible({ timeout: 15_000 });
  59 |   const tabs = detail.locator(".application-detail-tablist button");
  60 |   await expect(tabs.first()).toBeVisible({ timeout: 15_000 });
  61 |   await tabs.first().click();
  62 |   await expect(detail.getByLabel("当前状态")).toBeVisible({ timeout: 15_000 });
  63 | }
  64 | 
  65 | export async function openApplicationResumeTab(page: Page) {
  66 |   const detail = page.getByTestId("application-detail");
  67 |   await expect(detail).toBeVisible({ timeout: 15_000 });
  68 |   const tabs = detail.locator(".application-detail-tablist button");
  69 |   await expect(tabs.nth(1)).toBeVisible({ timeout: 15_000 });
  70 |   await tabs.nth(1).click();
  71 |   await expect(detail.getByText("关联简历与导出")).toBeVisible({ timeout: 15_000 });
  72 | }
  73 | 
  74 | export async function openApplicationTimelineTab(page: Page) {
  75 |   const detail = page.getByTestId("application-detail");
  76 |   await expect(detail).toBeVisible({ timeout: 15_000 });
  77 |   const tabs = detail.locator(".application-detail-tablist button");
  78 |   await expect(tabs.nth(3)).toBeVisible({ timeout: 15_000 });
  79 |   await tabs.nth(3).click();
  80 |   await expect(page.getByTestId("application-timeline")).toBeVisible({ timeout: 15_000 });
  81 | }
  82 | 
  83 | async function openResumeEditMode(page: Page) {
  84 |   await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
  85 |   const modeRail = page.locator(".resume-mode-rail button");
  86 |   await expect(modeRail.first()).toBeVisible({ timeout: 15_000 });
  87 |   await modeRail.first().click();
  88 | }
  89 | 
  90 | async function openResumeStyleTab(page: Page, index: number) {
  91 |   await openResumeEditMode(page);
  92 |   const panel = page.getByTestId("resume-layout-inspector");
> 93 |   if (!await panel.isVisible()) await page.getByRole("button", { name: "排版设置", exact: true }).click();
     |                                                                                               ^ TimeoutError: locator.click: Timeout 15000ms exceeded.
  94 |   const labels = ["模板", "样式", "排版", "页面"];
  95 |   await panel.getByRole("tab", { name: labels[index], exact: true }).click();
  96 | }
  97 | 
```