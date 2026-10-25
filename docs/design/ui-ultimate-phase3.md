# Phase 3：Resume Studio 交互简化

2026-10-24。开始基线 main / 4b3d0c0，tracked无差异，用户资料目录未跟踪。未提交、未推送。

本轮按用户“Phase3交互简化”命名，Simplify → Implement → Verify为本任务步骤。指定careeradapt-editor-ultimate-design-system Skill没有这些流程编号；原MASTER Phase3是结构交互、Phase4检查器闭环、Phase5工具栏反馈。保留原路线，不重编号，也不启动排序/Schema/富文本阶段。

## 简化清单（已实施并定向验收）

- 顶部导入/资料库同步与编辑主操作争抢空间：移入现有更多；保留原回调/禁用/导入testid。
- 顶部和页面Tab重复下载PDF/打印：主栏只留正式下载，打印只在更多；页面Tab保留真实导出状态和错误反馈。
- 顶部和字段页脚重复撤销/重做：主栏为统一入口，隐藏工作区内重复页脚按钮。更多的展示专用回退与混合撤销语义不同，保留并标注“仅回退排版”；删除与主栏完全相同的重做展示入口。
- 窄屏样式模式卸载左侧表单：改为“排版设置/返回预览”在画布栏与设置栏之间切换，编辑区和画布持续挂载，无遮罩覆盖字段；Escape关闭并恢复按钮焦点。
- 设置Tab按排版/样式/页面/模板排列，默认排版，TemplateId和持久化Tab key不变；模板设置仍完整可达。
- 设置Tab滚动位置分别保存于临时视图状态；选中条目、内容草稿、缩放、画布滚动不重置。变更不写业务Repository或任何领域Schema。

开始验证：typecheck通过，presentationConfig/resumePresentation两文件32项通过；实际Playwright基线两条通过，已查看实际1024页面。后续测试与截图结果完成后补记。


## 实施与根因

右侧检查器拆为固定标题/标签与独立滚动正文，分别记住每个标签的滚动位置。初版直接保存整栏scrollTop会被浏览器聚焦标签时的自动滚动覆盖；仅加sticky未解决，最终隔离正文滚动容器后精确恢复通过。

窄屏打开设置时，与画布共享第四列第一行；画布仅暂时隐藏，左侧字段与画布节点保持挂载。初版自动网格把画布推入第二行，实际截图显示面板被挤矮；明确所有列/行后修复，新增设置高度大于300px与页边距控件可见断言。Escape与返回预览均恢复可用焦点。

编辑/AI优化模式切换原本也会卸载字段表单，丢失新建条目的组件内草稿。现保留字段子树并隐藏非当前编辑面板，按模式恢复父面板滚动；选中项、内容草稿、历史写入协议均不改。设置/编辑/AI之间的往返有真实浏览器断言。

主栏统一正式“下载 PDF”；页面标签保留导出状态与失败提示，打印仍在更多。版本数量改为可见分组文字，原版本恢复操作保留；重新检查按是否存在复核入口去重。底部只负责页数/缩放/适合宽度/整页，缩放到范围边界时禁用对应按钮。未新增生产依赖。

## 验证与截图

- 开始基线：`pnpm typecheck`、presentationConfig/resumePresentation 32项单测通过；原p38b两条浏览器通过。
- 最终相关单测：`pnpm exec vitest run tests/unit/presentationConfig.test.ts tests/unit/resumePresentation.test.ts tests/unit/productTokens.test.ts tests/unit/templateRegistry.test.ts tests/unit/export.test.ts`，5文件49项通过，退出0。
- `pnpm exec playwright test tests/e2e/p38b-resume-presentation.spec.ts tests/e2e/app-accent.spec.ts --output=.tmp/ui-phase3/final-acceptance-results`，4项通过，退出0，日志 `.tmp/ui-phase3-final-acceptance.log`。
- 新增状态用例实际通过导入JSON、人工核对到工作区，再创建一条不保存的教育草稿。覆盖1024×768、1366×768、1920×1080的设置开关/标签滚动、模式往返、草稿值、选中ID、字段滚动、画布滚动、手动缩放和无横溢出；只读对比profiles/resumeBranches/resumeRevisions/resumeBranchOperations全量记录完全相等。测试数据只在独立浏览器上下文，不替代用户真实工作区。
- 主题偏好事件在同一编辑页切换绿色浅色/酒红深色：纸张computed background始终rgb(255,255,255)，正式预览文本与上述业务表记录完全一致。主题设置页原持久化验收同时通过。
- 正式PDF用例依旧实际POST `/api/resume-export/pdf`，断言200、保存PDF、提取文本检查字段/顺序/无重复；没有使用打印替代下载。输出 `artifacts/p38b-after/canonical-presentation.pdf`。
- `pnpm lint`、`pnpm typecheck`、`pnpm build`、`git diff --check`均取得退出0。最终构建日志 `.tmp/ui-phase3-build-verified.log`，lint日志 `.tmp/ui-phase3-lint-verified.log`。本轮没有扩展成全量历史E2E/Release Gate。
- 实际查看1024设置/返回预览、1366默认编辑及草稿状态、1920设置截图，并根据截图修复窄屏面板挤压。
- 默认布局图：`artifacts/p38b-after/1024x768.png`、`1366x768.png`、`1920x1080.png`。状态验收图：`.tmp/ui-phase3/settings-1024.png`、`editor-1024.png`、`settings-1366.png`、`editor-1366.png`、`settings-1920.png`；状态截图采用用户操作后的自定义缩放/滚动，不代表默认适合宽度。通过真实关闭导入成功通知清理截图；未改写页面内容制作效果图。

## 文件与边界

本轮文件：src/app/resume/ResumeWorkspace.tsx、src/styles/product-pages.css、tests/e2e/p38b-resume-presentation.spec.ts、tests/e2e/support/g7b2Ui.ts、本报告及本地plan4/history4。双强调色相关文件没有改动。

用户在任务期间修改.gitignore，增加参考资料目录忽略；原样保留，不属于本轮改动。next-env.d.ts构建生成路径已还原到任务开始基线。未提交、未推送，未打包Electron。

领域内容/排序/富文本Schema、Fact Guard、分支隔离、Repository、ResumeRevision、PDF生成器、导出快照与哈希契约均未修改。旧保存的style模式仍兼容，本轮标准设置入口统一在编辑模式中；跨路由/浏览器重启的临时新条目草稿恢复未新增。手机尺寸未作完整验收，后续不自动启动原MASTER的排序/精调阶段。
