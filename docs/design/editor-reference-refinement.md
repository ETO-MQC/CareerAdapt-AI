# 编辑器个性化完善（2026-10-26）

状态：**PASS（本轮指定范围）**。接续 2026-10-25 编辑器收尾；本轮实现与验收完成，不代表全项目 Release Gate 或 Agent 阶段验收。

## 范围与决策

- 根据用户提供的截图和本地参考 PDF，完善现有编辑器，不另建正文模型或固定模板系统。PDF 只在本机阅读与渲染；其中个人数据未复制进测试和报告。
- 基线 `main / 5b5cf1e53da42c1f9e9e1269dd542bdcb9258b56`，承接上轮 30 个未提交文件。未提交、推送或重新打包 Electron。
- 沿用 Resume Schema v2、WorkspaceRepository、内容 revision 和展示配置队列；没有新增表、生产依赖或修改 Fact Guard。

## 已实现行为

1. 新上传或更换照片时，同步保存显示开关；个人信息照片下方也可以控制显示。六个支持照片的排版保持姓名、求职意向、联系方式相对整页内容区居中。ATS 极简单栏继续明确不支持照片。
2. 抬头高度改为包含姓名/联系信息的整体顶部留白；增加 40px 时，姓名、联系方式和第一栏目一起下移 40px。头部分隔线可关闭。
3. 日常保存成功不弹通知，顶栏显示自动保存说明和状态徽标：绿色已保存、红色未保存、保存中、保存失败。基本信息、经历、结构化条目草稿与展示保存纳入状态；基本信息保存失败不清空输入，可重试。下载、导入、危险操作和错误反馈继续保留。
4. 个人信息支持预设字段、自定义字段、插入换行、拖动、上/下移和 Alt+方向键。桌面悬停/聚焦出现操作按钮，触屏可见。数据只写当前简历；预设敏感信息由用户自行填写，不推断。已有自定义值保留字符串/数字/布尔/列表类型。
5. 新增个人信息顺序配置；未知键不生成事实、未列出项稳定补入。分支自定义信息贯通渲染、JSON 导出/核对再导入，展示顺序贯通导出快照和恢复。手动编辑不反写资料库。
6. “显示个人信息标签”显示“手机号：”“邮箱：”等文字，不再输出装饰图标。旧配置键保留，避免另建迁移。
7. 可视化选择栏目标题样式（纯文字、底线、浅底、竖线、短强调线、圆角浅底），经历条目三列/分行/紧凑同行与副标题对齐；显式样式消除模板叠加的重复底线。参考排版是一组可继续修改的配置，不锁定内容、顺序或模板。
8. 提供截图中的字体组合。内嵌思源黑体、思源宋体、Inter、Roboto、EB Garamond，保留官方 OFL 许可和来源/SHA-256。共约 43 MB；浏览器和独立 PDF 使用同一组本地文件，PDF 只嵌入当前选择。Helvetica Neue、苹方、Palatino、Times New Roman 等明确标为系统字体，缺失时使用回退，不复制商业字体文件。

## 本轮主要增量

- `src/domain/resumePresentation/contacts.ts`：个人字段目录、值格式和稳定顺序。
- `src/components/editor/EditorDraftStatus.tsx` 与编辑器各分区：草稿状态；`ResumeWorkspace.tsx`：聚合徽标、照片与展示保存衔接。
- `BasicsSectionPage.tsx`：新增字段、排序、换行和照片显示入口。
- `presentationPrecision.ts`、`PrecisionInspector.tsx`、共享 canonical renderer 与 CSS：组件样式、文字标签和抬头留白。
- branch/render/import/export/presentation Schema、mapper、Repository 与快照：沿既有链路保存分支字段和展示顺序。
- `fonts.ts`、`resume-fonts.css`、`public/fonts/` 与独立 PDF CSS：本地字体和许可。
- `tests/unit/editorRefinement.test.tsx`、`tests/e2e/p38b-resume-presentation.spec.ts`：本轮回归。

## 验证记录

- 修改前：typecheck 与直接相关 3 文件 44 项测试通过。
- `pnpm typecheck`、相关 ESLint、`pnpm lint`、`git diff --check`：完整退出 0。
- `pnpm test -- --run`：221 文件 1623/1623 项通过，完整退出 0（76.42 秒）。
- `pnpm exec playwright test tests/e2e/p38b-resume-presentation.spec.ts --workers=1 --grep 'editor closure|reference refinement'`：2/2 通过，完整退出 0（3 分钟）。覆盖七模板实际 PDF、浏览器打印、整页居中、无损坏照片成功导出、自动显示、更换/隐藏/移除、字段新增和顺序/换行、失败保留输入与重试、抬头三处同移、文字标签、组件样式和刷新持久化。
- `pnpm build`：最终 CSS 修正后再次构建，完整退出 0。随后使用编译产物服务（3107）重跑 `reference refinement`：1/1 通过，完整退出 0（17 秒）。验证后停止本轮服务；用户原有 3000 开发服务未停止。`next start` 会提示 standalone 推荐启动方式，此次验证确实请求了编译后的路由并成功导出 PDF，不等同于 Electron 打包验收。
- 1920/1366/1024 实际页面截图无横向溢出；已查看个人信息面板、窄屏保存徽标和 PDF 第一页栅格。窄屏隐藏冗余自动保存说明，保留完整状态徽标。真实 PDF 文本包含末尾事实、自定义信息和文字标签；`pdffonts` 确认 Inter / SourceHanSans 嵌入，七模板输出同时覆盖 SourceHanSerif。
- 中间回归纠正了两个测试前提：保存失败使用已有字段内联错误，没有错误悬窗；内嵌完整中文字体后，PDF 响应等待与下载等待统一为 120 秒。未跳过断言或删除测试。
- 曾尝试旧 p3/recovery 历史浏览器集合，旧入口前提不适配当前界面，未完成；已撤销对这两个文件的本轮临时标签修改，不在本轮扩展修复旧测试。

## 证据与边界

匿名浏览器截图及真实 PDF 位于 `artifacts/editor-refinement/`（`personal-1366.png`、`personal-1024.png`、`personal-1920.png`、`refined.pdf`、`refined-pdf.png`），七模板照片/打印证据位于 `artifacts/editor-closure/`。这些是本机忽略产物，不包含用户参考 PDF 正文的仓库副本。测试日志位于 `.tmp/editor-refinement-*.log`。

已有 `release/` 和安装包不会随源码更新；本轮未重新打包。旧简历若此前关闭显示照片，可在个人信息照片下方开启。系统字体可用性依赖运行机器；内嵌的五个字体家族可离线使用。

## 最后一轮截图微调（2026-10-26）

- 用户补充标注：无照片也应默认整体居中；照片开关同行、减少姓名侧空白；六点手柄在左、上下移在字段右侧；再对照参考 PDF 的配色与标题，完成后提交 Git。
- 联系信息原先继承父抬头的 `justify-content: space-between`，覆盖了模板居中。现在默认头部/联系人整体居中，检查器默认值与实际一致；用户显式的左对齐/左右分栏仍保留。没有覆盖已保存的显式设置。
- 照片显示和移除合并为紧凑单行，开关固定尺寸并与文字垂直居中。字段左侧只有拖动手柄，右侧独立上下移；悬停、聚焦与触屏可达性保留，排序仍走原展示队列。
- 底线标题显式清除模板背景/左边框，避免浅底叠加；参考预设使用中性深灰链接和细线、14px 栏目间距，保持正文和栏目顺序。没有根据参考 PDF 自动改写用户事实或强制改变已有样式。
- 修改前 typecheck 与 2 文件 12 项测试通过；浏览器实测复现开关 `align-items: normal`。修改后 typecheck、全量 lint、最终 changed-files lint 通过；4 文件 48 项编辑器相关测试、7 文件 68 项输出/分页相关测试通过。
- 新增标注回归通过（23.8 秒）：开关和文字中心差小于 2px、照片侧多余空间小于 45px、左右操作按钮位置与移动、无照片联系人组中心差小于 1px、显式左对齐与恢复居中、刷新、底线无浅底、真实 PDF 文本守恒。前序个性化流程再次通过（32.5 秒）。七模板照片/文本/打印/更换/隐藏/移除与损坏图片拒绝导出用例通过（2.2 分钟）；三条定向浏览器均取得完整退出 0。
- 最终 `pnpm build` 完整退出 0；构建后还原自动生成的 next-env.d.ts，`git diff --check` 通过。
- 七模板用例补齐“模板已渲染且展示保存完成”前提；此前仅等照片数量没有变化，可能在模板切换期间启动下载而等不到响应。照片显示是异步持久化，测试使用点击后等待勾选状态，不要求 IndexedDB 写入在同一点击栈内完成。保留全部原断言。
- 最新匿名截图/PDF：`artifacts/editor-final-polish/after-field-controls.png`、`after-no-photo.png`、`final-polish.pdf`、`final-polish-pdf.png`。已查看浅色页面与 PDF 栅格，确认姓名/联系方式居中及细线标题；修改前证据 `before-photo.png`。
- 用户本轮已授权提交；提交包含本会话连续的编辑器收尾与个性化相关文件，不包含个人参考 PDF、临时日志、忽略的计划记录或其他任务。未推送、未重新打包 Electron。
