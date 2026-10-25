# 左栏字段交互与右栏密度微调（2026-10-25，桌面定向验收完成）

## 本轮范围
用户按新三张图要求：每个可支持的文字输入附近显示真实字段格式/显示/删除浮条；经历描述数组逐条编辑与排序；标题重复点击收起；保持公司/职位同行、部门回到主表单、日期手输加主题日历；左标题约缩10%、右栏标题恢复呼吸空间、卡片组内紧凑而组间清楚，并有轻量hover提亮/阴影。

沿用careeradapt-editor-ultimate-design-system；main/80b7875，保留上两轮全部未提交成果，未提交推送打包。起点已有63项相关单测证据，本轮修改前再次typecheck/实际浏览器截图通过。before见artifacts/sidebar-finish/polish-before，原sidebar-finish/before未覆盖。

## 已实现与数据流
- ResumeSectionCard的名称与箭头均执行onToggle，再次点击真实收起；铅笔入口仍明确打开和定位。收起不卸载表单。
- StructuredExperienceForm/StructuredProjectForm及CanonicalField的string_list使用StringListEditor：数组每条对应独立AutoTextarea、独立六点手柄、上/下移与Alt方向键、添加/删除。不拆标点、不将三条合并成HTML或另存一份正文；顺序依旧由V2 highlights/outcomes等数组权威保存，经原结构化编辑/Fact Guard/人工确认/Repository内容版本路径。
- 公司/职位保持双列；工作部门从下方附加字段移到主表单，教育院系等原字段保留。
- FieldInput和CanonicalField日期继续保存YYYY / YYYY-MM / YYYY-MM-DD字符串，DatePicker只提供可选输入辅助，支持年、月或具体日，保留手输。弹层按左栏边界左右夹取、空间不足时向上，实际截图发现第一列左裁切后已修正并加边界断言。
- 字段格式用可选presentation.fieldAppearances：itemId、字段、原文、重复出现序号、有界B/I/U范围及hidden。纯展示操作走原展示队列/WorkspaceRepository/presentationRevision/展示撤销重做，不创建内容版本、不更改事实、来源、branch/Schema v2正文。
- FieldFormatting在hover/focus提供B/I/U、字段显示/隐藏、清空，以及列表的邻近新增；选区或整段格式可保存。首次未保存的新条目尚无正式itemId时格式按钮禁用并注明先保存条目，不伪造持久化。格式并非HTML正文；文本锚点不匹配时不应用旧标注，避免样式套错字段，旧数据无标注仍按原样显示。
- 预览与正式PDF共用FormattedText及模板renderer：React安全拆分文字范围，不通过dangerouslySetInnerHTML；隐藏描述在渲染列表过滤，源数组仍保留。样式字段贯通presentation/export/export-record Schema、style/snapshot patch及双向snapshot codec，旧快照缺省不多写该字段。
- 已提供基本信息、公司/职位、正文/描述、技能/语言等已存在文字字段的样式路径；这是有限文字标注，不是任意HTML、链接/色彩工具或全功能富文本系统。复杂合成字段仍服从模板呈现，不新增无效的链接/色板按钮。
- 右栏仅UI密度调整：标题/标签恢复空间，precision-group内部gap16→10、padding20→16，组间18；卡片hover/focus微提亮与轻阴影，没有修改简历成品行距或已验收的右栏拖宽折叠机制。

## 最终验证（均取得退出码0）

- `pnpm test tests/unit/branch.test.ts tests/unit/referenceCampusImport.test.tsx tests/unit/presentationConfig.test.ts tests/unit/exportSnapshotRoundTrip.test.ts tests/unit/resumeRenderV2.test.ts tests/unit/editorHelpers.test.ts tests/unit/templateRegistry.test.ts tests/unit/fieldAppearance.test.tsx`：8文件69项通过，最终修改后复验通过。
- `pnpm exec playwright test tests/e2e/p38b-resume-presentation.spec.ts tests/e2e/resume-content-sidebar.spec.ts tests/e2e/resume-sidebar-polish.spec.ts --workers=1`：15项一次合并通过（4分钟）。覆盖旧展示/右栏调宽折叠、草稿、双向定位、排序与展示撤销重做/内容历史、新建隐藏删除/刷新、跨模板用户顺序和正式PDF。
- 最终日历裁切修正后，`pnpm exec playwright test tests/e2e/resume-sidebar-polish.spec.ts --workers=1`：2项通过（25.6秒）。日历边界断言从外侧左栏强化为所属条目卡片；实际查看确认左侧年份、前月箭头和底部“仅年份”完整。
- `pnpm typecheck`、`pnpm lint`（全量）、`pnpm build`：全部通过；build仅生产Web构建，没有Electron打包。
- `git diff --check`：通过。未提交、推送或打包。

新增浏览器用例涵盖三条描述、逐条原值、鼠标/键盘排序、添加删除、重复标题开关、B/I/U、隐藏恢复、刷新、正式PDF200及文本、日历和手输；三视口四设置标签、gap/hover阴影、无页面横向溢出/异常撑高。

过程记录：旧13项E2E首次12通过/1失败，因为旧用例重复点标题仍假定永远打开；改用明确的铅笔“编辑板块”完成编辑定位，草稿断言保留。日历修正后追加截图清理通知时，测试点击弹层外通知会正常关闭日历，导致一次150秒超时；通知清理移到打开日历前，随后2项通过。未skip、删断言或降低阈值。

## 截图与实际输出

同尺寸修改前后（1920×1080、1366×768、1024×768）：

- 修改前：`artifacts/sidebar-finish/polish-before/{1920,1366,1024}-{collapsed,expanded,education-expanded,work-expanded}.png`。
- 修改后同匿名数据/同视口：`artifacts/sidebar-finish/after/{1920,1366,1024}-{collapsed,expanded,education-expanded,work-expanded}.png`。
- 新增三条描述交互：`artifacts/sidebar-polish/1366-field-floating-tools.png`、`1366-calendar.png`、`1366-paragraph-tools.png`。
- 三视口右栏四标签/hover/段落：`artifacts/sidebar-polish/{1920,1366,1024}-{排版,样式,页面,模板,inspector-hover,paragraphs}.png`；1024沿既有机制切换设置视图，返回后左栏可编辑。
- 正式匿名PDF：`artifacts/sidebar-polish/field-format.pdf`；实际渲染图`field-format-page1.png`已查看，工作条目首段有真实加粗/斜体/下划线，四条描述按保存顺序完整输出。

已实际查看1366浮条/日历/卡片、1024长字段及PDF图；发现日历首列裁切后改为所有横向裁切祖先的边界交集，截图复核无裁切。此前交互瞬间截图曾捕获预览缩放过渡中的NaN显示，双rAF稳定取景后恢复正常54%，未修改中间预览架构；不宣称已专门修复缩放组件的瞬时问题。

## 修改文件与边界

- 表单与交互：FieldFormatting / FieldAppearanceContext / StringListEditor / DatePicker（新增）；FieldInput / StructuredExperienceForm / StructuredProjectForm / ResumeSectionCard / ExperienceSectionPage / CanonicalSectionPage / SummarySectionPage。
- 权威展示链：ResumeWorkspace、schemas/{fieldAppearance,presentation,branch,export}、resumePresentation/fieldFormatting、storage/repositories、export/snapshot、templates/{types,shared/canonical,shared/FormattedText}。
- 视觉：product-pages.css；测试：fieldAppearance.test.tsx、presentationConfig.test.ts、resume-sidebar-polish.spec.ts、p38b-resume-presentation.spec.ts；其余当前Git差异沿用上一轮成果。

格式支持已保存条目和已接入renderer的原文锚定字段。新条目先保存取得itemId；GPA/课程汇总等尚无独立渲染映射的字段明确禁用格式/隐藏并提示原因，清空等真实编辑操作保留。原文修改后旧范围标注不会套到新文字，需要重新设置；原生textarea只展示整段格式，选区局部格式在预览/PDF呈现。上述限制不冒充完整富文本编辑器，完整文本编辑时范围迁移、复合字段拆分、链接/色彩仍属独立设计任务。照片、其他页面及完整富文本文档模型未实施。

仅标记本轮桌面微调定向验收完成，不代表全量Release Gate、整个基础路线、移动端或所有富文本能力完成。无新增依赖/表/正文事实，无批量删除，旧快照兼容及Repository隔离保持。


## 本阶段最后四处图示微调（2026-10-25）

用户标注要求仅调整全局导航折叠态与编辑工作区底部。产品修改限两处CSS：

- `src/styles/agent-shell.css`：折叠态隐藏品牌首页标记，顶部保留并居中既有展开按钮；折叠态隐藏最近任务的归档/重命名辅助工具及底部工作区模式切换。展开态仍使用原品牌、模式切换及历史操作，不改变会话、导航、归档或偏好保存逻辑。
- `src/styles/product-pages.css`：仅正在编辑简历的`.ai-asset-content > .resume-workspace:has(.resume-studio-shell)`底部padding改为1px，简历中心和其他页面沿用原值；未缩减预览内为浮动工具栏预留的滚动空间。

修改前取得`artifacts/sidebar-finish/nav-before/`三视口截图及typecheck基线。新增定向E2E（同`resume-sidebar-polish.spec.ts`）以Schema校验的匿名浏览器测试session检查历史hover，验证折叠按钮完全可见、展开态入口恢复，以及三视口工作区底边实测分别为1079/767/767，无页面异常撑高。

修改后截图：`artifacts/sidebar-nav-polish/{1920,1366,1024}-{collapsed,expanded}.png`。实际查看1366折叠及1920展开截图，底边与悬停行为符合标注。

验证：`pnpm typecheck`、changed-files ESLint及`git diff --check`通过；`pnpm exec playwright test tests/e2e/resume-sidebar-polish.spec.ts --workers=1`三项通过（30.3秒，含此前段落/日历/格式/正式PDF以及三视口右栏设置回归）。纯CSS微调未新增镜像单测，前轮69项单测结果单独保留，不宣称本轮重新运行。

`pnpm build`通过（退出码0）；生成的next-env.d.ts恢复本轮前内容。保留全部既有未提交修改，不提交、推送、打包或扩展新功能。
