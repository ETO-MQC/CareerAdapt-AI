# Phase4后微调：工作台空间、字段联动和滑杆响应

2026-10-25，main / 4b3d0c0；保留Phase3、Phase4及用户.gitignore未提交成果，无提交/推送/打包。

## 按截图调整

- 顶部文档栏最小高度60→54px，压缩padding，状态与标题组织为两行；保留保存提示、撤销/重做/PDF/更多。
- 顶栏至面板间距4px；Studio左右外边距24→12px（跟随现有页面Token的一半），不影响其他页面。
- 右栏“页面排版+四标签”的顶部区域约压至原来一半：减少标题/说明字体、顶部padding、组间距和旧heading的14px额外margin。控件正文与实际设置保持。
- 四标签共用滚动容器隐藏滚动条，仍可滚轮、触摸、键盘滚动。
- 中间滚动区域延伸至与左右面板同高；缩放工具栏在画布内绝对浮动，不占第二个布局行。底部内容保留可滚到工具栏上方的空间；整页缩放不再多扣该工具栏预留高度。
- AI及手动主壳进入具体简历自动折叠主导航，允许本次编辑中手动展开；退出后使用原导航偏好，没有改写用户全局折叠偏好。

## 滑杆根因与修复

原滑杆每次input均进入串行Repository保存，并更新整个工作区、撤销历史及分页。密集拖动把多个陈旧中间值排队，导致预览追赶鼠标。
现在：range原生输入即时同步数字框；rAF合并每帧可见纸张样式更新，不在拖动时重建整工作区、不修改隐藏测量树、不向Repository写中间值。松手/取消指针/键盘结束/失焦经原展示队列保存最终值，随后按正式配置重新测量分页。相同值去重依旧走既有逻辑。保存期间正式下载不可用；保存完成或失败后，临时DOM覆盖回到权威展示配置，避免残留未保存样式。
没有新增持久化状态、表或展示配置分支；临时DOM预览只存在于输入手势中。没有改PDF哈希/快照契约。拖动时沿用当前分页，松手后正式重新分页；未宣称跨机器恒定60fps。

## 点击预览 → 左栏

- Studio点击/双击及Enter/F2均路由左栏，旁路原预览悬浮编辑器。
- 自动展开字段栏、切回编辑模式、定位栏目/条目并打开条目，再滚动聚焦匹配输入框。
- 左栏匹配支持文本框、文本域及下拉选择；下拉项可按可见选项文本定位。
- 基本信息按稳定字段ID定位；经历/技能等按源条目ID和字段值匹配；跨页fragment还原原条目ID。专业/学历等组合标题及起止日期增加保留原文的行内定位节点，使合并显示的子字段可独立定位。
- 栏目标题使用左栏真实输入并沿用既有titleOverride保存。没有新增事实，未改变来源、分支、正文版本或富文本结构。

## 验证

| 检查 | 实际结果 |
|---|---|
| `pnpm typecheck` | exit0，最新源码通过（.tmp/ui-tune-control-typecheck.log） |
| changed-files ESLint，7个相关TS/TSX文件，`--max-warnings=0` | exit0（.tmp/ui-tune-last-lint.log） |
| `pnpm build` | exit0（.tmp/ui-tune-control-build.log）；生成next-env恢复原内容 |
| `pnpm exec vitest run tests/unit/aiFirstShell.test.tsx tests/unit/editorHelpers.test.ts tests/unit/pagination.test.ts tests/unit/presentationConfig.test.ts tests/unit/export.test.ts` | 5文件53项通过（.tmp/ui-tune-unit-final.log） |
| `pnpm exec playwright test tests/e2e/p38b-resume-presentation.spec.ts --workers=1` | 5项通过，1.2分钟（.tmp/ui-tune-all-final.log） |
| `git diff --check` | exit0 |

补充下拉控件定位后，最新定向用例再次通过（.tmp/ui-tune-control-e2e.log），最新Workspace ESLint/typecheck/build也均exit0。

新增浏览器用例证明：导航自动折叠且可手动展开；姓名/工作条目/学校/专业/起止日期/栏目标题聚焦左栏且没有浮窗；四次滑动中间值在松手前逐一出现在可见纸张，持久化revision保持不变，松手后仅+1；刷新后最终值保留；正式PDF请求携带headerGapPx=32且返回200并下载。既有用例继续验证正文守恒、分页、草稿/选择/缩放、展示撤销重做、四标签、主题白纸和正式PDF。

首次补充失败回退闭包曾触发React Compiler ESLint的可变对象分析错误，改为捕获原始branchId后通过，未放宽规则。初次导航effect依赖warning亦已修正。

实际截图（已查看）和正式PDF：
- artifacts/ui-tune/1920.png
- artifacts/ui-tune/1366.png
- artifacts/ui-tune/1024.png
- artifacts/ui-tune/slider.pdf（Poppler确认2页A4，文本可提取，包含最后的技能与语言内容）

## 本轮修改文件

- src/styles/product-pages.css：紧凑布局、隐藏滚动条、工具栏覆盖画布。
- src/components/agent/shell/AgentSidebar.tsx、src/components/layout/AppShell.tsx：编辑会话主导航自动折叠。
- src/components/resume/PrecisionInspector.tsx：滑杆输入缓冲、预览与最终提交分离。
- src/app/resume/ResumeWorkspace.tsx：rAF临时预览与权威保存回收、下载保存门禁、字段导航、左栏栏目标题、完整画布缩放。
- src/components/resume/A4ResumePreview.tsx：Studio点击/双击/键盘导航，旁路浮窗。
- src/components/resume/templates/shared/canonical.tsx：组合字段/日期行内定位节点，文字不变。
- tests/e2e/p38b-resume-presentation.spec.ts：浮动栏新布局断言、字段联动/滑杆单次保存/正式PDF/截图。
- docs/design/ui-ultimate-phase4-tuning.md、plan4.md、history4.md：交接。

不进入新阶段；未扩展排序Schema、富文本、Repository业务语义或无关页面。未运行全量历史Release Gate、手机或Electron打包验收。
