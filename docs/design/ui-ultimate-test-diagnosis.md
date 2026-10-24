# UI Ultimate 定向测试诊断与 Phase 2

日期：2026-10-24。本地 main / 4f37ae2；保留前轮双强调色和全部未提交成果；没有提交、推送或迁移。

## 证据与复现方式

六个失败文件分别运行 `pnpm exec vitest run tests/unit/<file>`，完整原始日志位于 `.tmp/ui-ultimate/diagnosis/<file去扩展名>.log`。日志保留错误全文、预期/实际差异和堆栈。

进一步用 `git archive 4f37ae2` 将原始 src/tests/scripts/electron/config 安全展开到 `.tmp/ui-ultimate/head-4f37ae2`，从该目录使用现有安装依赖运行原始六文件；没有改写当前工作区。隔离 HEAD 结果为 6 文件失败、10 失败/33 通过、8 未处理错误，与当前修复前完全一致。完整日志 `.tmp/ui-ultimate/diagnosis/isolated-head.log`。最初档案漏含 electron，补齐后才取得上述有效结果，未将模块缺失计为产品失败。

以下每项均在隔离原始 HEAD 复现，与品牌绿/酒红修改无关。修复只涉及测试、匿名夹具；不回退已实现产品行为。

## 逐项分类

### aiContextBar.test.tsx

- 失败：`has one task link instead of duplicate AI workspace links`。
- 实际：TestingLibraryElementError，找不到 role=link；预期唯一 /ai-workspace 链接，实际只有被模拟的 aside 和 asset 内容。
- 堆栈：测试26行 getAllByRole；源码 src/components/layout/AiShell.tsx 已取消资产页任务条，history4 中 4f37ae2 前序明确要求删除共享任务栏。
- 分类：过时测试期望，不影响事实、导入、展示配置或 PDF。
- 最小修复：明确断言资产内容保留、退役任务条与“返回任务”不存在；不重新添加用户已要求移除的功能。已通过。

### export.test.ts

- 失败：`validates export request schema and rejects unsafe filenames or template ids`。
- 实际：snapshot catalogVersion 为 resume-field-catalog-v2.2.0；测试105行期待 v2.1.1。renderSchemaVersion=resume-render-v2、templateVersion=1 正常。
- 源码：src/domain/resumeFields/types.ts 的目录版本；src/services/export/snapshot.ts 正式快照。
- 分类：目录版本断言过旧，并非 PDF 请求被拒绝或内容丢失。
- 最小修复：精确更新为 v2.2.0，保留全部非法文件名、模板、请求与快照断言。已通过。

### p46a-resume-structural-integrity.test.ts

- 失败：`preserves the source branch, derives a structurally complete Job branch, and renders PDF semantics`。
- 实际：项目 presentation.dateRange 为 2024.09.01–2025.06.01；测试242行期待 2024.09–2025.06。
- 源码：src/domain/resumePresentation/projector.ts formatResumePresentationDate；测试提供的原始日期就是 2024-09-01/2025-06-01。前序已明确保留年/月/日精度。
- 分类：旧日期展示断言，未证明资料完整性缺陷。不能把生产日期截短以迎合旧测试。
- 最小修复：精确断言日精度，保留源分支、岗位分支结构/事实和渲染语义全部断言。已通过。

### resumeJsonV2.test.ts

- 失败：`keeps the placeholder-free full AI fixture aligned with every canonical catalog field`。
- 第一错误：测试18行期待目录 v2.1.1，实际 v2.2.0。
- 更新版本后暴露第二错误：测试26行 education.rankPercent 为 undefined，违反完整字段覆盖期望。
- 源码：src/domain/resumeFields/fieldCatalog.ts 新增教育排名百分比；tests/fixtures/resume-v2/fullAiTemplate.ts 使用 createResumeJsonV2Example，而通用示例未填这个可选字段。
- 分类：完整测试夹具与新增可选字段不同步；生产 Schema 接受并保存字段已有其他定向验证，不能删掉覆盖循环或把可选字段强制写入用户简历。
- 最小修复：更新精确版本，在专用匿名全字段夹具的教育项增加 rankPercent=10。继续严格 parse 和逐字段检查。已通过。

### p4.6d-ai-runtime-control-plane.test.tsx

- 失败1：`keeps candidate provider tests local and leaves active runtime state untouched`，测试194行期待旧 p 文案“API Key 无效或没有模型权限。”；实际反馈已细分为服务商拒绝当前已保存密钥的 HTTP 401 提示。
- 失败2：`acknowledges Save & Apply immediately and sends one control command`，259行找不到“保存并重启应用”；实际“保存并应用”，处理中“正在应用…”。
- 失败3：`interrupts an active semantic Run once before applying the new configuration`，280行同一旧按钮名。
- 失败4：`continues the Supervisor-owned apply transaction after Settings routes away`，294行同一旧按钮名。
- 源码：src/app/settings/page.tsx 的测试连接反馈和保存按钮；前序模型切换不一定重启，不能恢复误导文案。
- 分类：测试 UI 契约过旧，以及缺失凭据边界 mock。与简历事实、导入、展示或 PDF 无直接关系。
- 最小修复：使用当前准确语义名称/401文案，并在原有 hermesControl mock 中补齐 describeProviderCredential 的确定性状态。保留20次点击仅一次命令、运行中断、导航卸载后事务继续等全部断言。8项通过且无未处理错误。

### p47c1-import-execution-boundary.test.ts

- 失败：`consent local uses the same facade`、`consent ai uses the same facade`，均在108行期待 executor.execute 零次，实际一次 career.workflow.resume_import，包含 attachmentId/operationId/logicalTurnId/retryFailedOperation。
- 源码：src/agent/runtime/AgentHostStore.ts 2947附近，仅 preference=unset 才弹 consent；src/services/preferences/resumeImportAi.ts 的缺省值已为 ai（5139673，history4 的 B1 默认 AI 路线）。清空 localStorage 不再构造 unset。
- 分类：授权分支测试的前置条件过旧，不是执行器绕过当前产品要求；正式导入仍经 review/confirm/Repository，不在本轮改变默认 AI 语义。
- 最小修复：仅对两条明确测试历史 unset/consent 路径的用例，用一次性 mockReturnValueOnce("unset") 构造该状态，随后仍走真实授权事件、偏好写入、工具 facade、review 和次数断言。默认 AI/local 路径用例继续真实读取偏好。12项通过。

## 8 个未处理错误

全部来自 p4.6d 文件每次挂载 SettingsPage 的凭据状态 effect，不是八种独立数据错误，也不是数据库清理异常。

- 错误：TypeError: Failed to parse URL from /api/agent/runtime/hermes/control；cause TypeError: Invalid URL，code ERR_INVALID_URL。
- 完整调用链：Node URL → undici Request/fetch → describeProviderCredential（修复前 src/services/agent/hermesControl.ts:567）→ SettingsPage effect（修复前 settings/page.tsx:184；主题代码插入后行号变化）→ React effect mount。
- effect 执行 `void describeProviderCredential().then(setCredentialState)`；该测试部分 mock 了 Hermes 命令却遗漏新增 describeProviderCredential，调用穿透至 Node 原生 fetch。浏览器能处理相对 URL，Node 原生 fetch 不能。
- Vitest 前3条归因提示分别为 candidate provider 测试（2条）和 latency 测试（1条）；其余5条只标文件而未精确归因。不能用“最后运行测试”推断独立根因；八个堆栈都指向同一 effect。
- 最小修复为补完整边界 mock，不在生产代码宽泛 catch 或吞错。修复后该文件8项通过、0未处理错误；最终全量1596项通过，也没有未处理错误。

## 编辑器 E2E 根因与正式验证

- SetupGuard 在未配置环境跳转 /setup：旧测试未做设置前置；在测试独立上下文设置匿名 configured 标记，不调用真实模型。
- 实际创建入口可访问名“导入已有简历 核对来源后创建通用简历”，使用 getByRole(button, name=/^导入已有简历/)；不修改产品迎合旧“导入”。
- JSON 入口已改“粘贴 JSON”，页面条和导入弹窗各一份；限定 resume-import-dock 下 summary，使用现有 testid，无新增产品标识。
- 字段确认名更新为“确认字段映射”，保持逐项核对与来源保留；导入末尾显式等待“确认导入”可用。
- 两条原验证完整保留，实际走 /api/resume-export/pdf、断言200、保存下载、pdftotext 验证原始字段、无调试标签、无重复内容；第二条保留顺序及一页/两页预设验证。没有调用打印替代正式导出。

## Phase 2 实施

- ResumeWorkspace 将原样式 JSX 提取为同一 styleControls 值；宽屏编辑模式增加右侧检查器，继续调用现有展示配置/revision/Repository/模板回调。原样式模式保留，1200及以下隐藏重复侧栏，通过既有样式入口访问。
- product-pages.css 为工作区添加表面、低对比边框、16px圆角、轻阴影，独立滚动；顶部文档栏和底部胶囊工具栏。设置区域的字体、颜色、页面和模板仍只提供现有真实能力。
- 宽屏内容/预览/设置同时可见；1024用窄导航、内容与画布，避免旧媒体规则的固定360px画布挤出视口。
- 适合宽度/整页缩放按真实滚动区内边距与可用高度计算；画布显式 minmax(0,1fr)，防止工具栏的内在宽度撑大列。未改变正式 PDF、模板、分页规则或事实内容。
- 未扩展排序Schema/富文本/精细设置/局部样式。当前右侧仍沿用模板/字体/颜色/页面四类既有控件；排版/样式/页面的下一阶段分组尚未实施。


## 最终验证与交付文件

- `pnpm test`：218文件、1596项通过，退出0，无未处理错误（full-after.log）。该次后仅修正布局缩放/网格及相应浏览器断言；没有再改Unit业务逻辑。
- `pnpm lint`：退出0；最终缩放修正后 changed-files ESLint 再次退出0。
- 最终 `pnpm typecheck`、`pnpm build`、`git diff --check`：退出0。构建改写的next-env.d.ts按任务开始的HEAD恢复，没有交付生成路径噪声。
- `pnpm exec playwright test tests/e2e/p38b-resume-presentation.spec.ts tests/e2e/app-accent.spec.ts tests/e2e/resume-center-layout.spec.ts`：4通过（browser-final.log）。
- 最终缩放/窄屏网格修正后再次运行p38b全文件：2通过（p38b-verified.log），正式PDF生成成功。新增断言不放宽容差：A4左右边界在画布内、工具栏位于文档滚动区之外、宽屏右侧设置可见且不与画布重叠、四视口无页面横溢出。
- 四视口：1024×768、1366×768、1440×900、1920×1080。截图 artifacts/p38b-after/<width>x<height>.png、<width>-typography.png、<width>-page.png；1366修改前保存在 .tmp/ui-ultimate/editor-before-1366.png。已实际查看修改前1366、修改后1366/1440与1024，并据图修复窄画布裁切。
- 正式匿名PDF artifacts/p38b-after/canonical-presentation.pdf；实际文本断言通过。没有使用浏览器打印代替下载，没有更改正式PDF生成器。

本轮修改：src/app/resume/ResumeWorkspace.tsx、src/styles/product-pages.css；tests/e2e/p38b-resume-presentation.spec.ts；六个定向失败测试文件；tests/fixtures/resume-v2/fullAiTemplate.ts；本报告、ui-ultimate-audit.md、plan4.md、history4.md。前轮设置页/Provider/强调色Token/appAccent/主题测试原样保留。

剩余范围：排序与精细设置仍待后续独立阶段；V2顺序Schema、富文本、正式PDF逻辑均未修改。1200及以下不同时展示第三个属性栏，可用现有样式模式；小于本轮目标的手机布局和完整Electron打包未验收。截图仅匿名数据，真实模型质量未涉及。开发工具的issue徽标出现在dev截图中，未作为产品UI复制。没有提交或推送。
