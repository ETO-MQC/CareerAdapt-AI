# 左侧简历内容管理与编辑收尾（2026-10-25）

状态：本轮桌面范围定向验收完成。13项浏览器覆盖均取得通过结果（最后合并12通过/1视口截图准备失败；稳定响应式布局后该项单独复验通过），typecheck、全量lint、生产build和diff检查通过。没有提交、推送或Electron打包。

## 用户要求与基线

本轮是在上轮未完成的左栏重构上补全，主要要求真实嵌套编辑卡片、参考图视觉、独立滚动和数据/输出闭环；用户随后明确：模板可提供默认顺序及样式，用户排序后必须以用户顺序为准。

- Git：main / 80b7875；开始时已有11个tracked修改文件及本报告，全部保留，没有reset或覆盖用户成果。
- 阅读plan4/history4、设计Skill、参考索引/MASTER对应章节，实际查看原图04、05、06、08，使用原图而非旧实现截图作设计依据。
- 本轮修改前typecheck、3文件32单测通过；已在编辑前生成三种固定视口的真实before截图。上一轮未取得before的限制不再适用于本轮。

## 最终信息架构与视觉

标题/说明 → 独立个人信息卡片 → 板块总数与展开/收起 → 每个板块头部 → 局部样式入口 → 该板块自己的结构化条目卡片 → 添加条目 → 独立添加板块卡片。

管理列表后集中堆放全部表单的结构已移除。ResumeSectionCard承载原有真实字段编辑器；SectionShell通过SidebarEditorContext提供内嵌模式，移除重复标题和导航页脚。展开/收起只隐藏DOM，卡片按分支和板块保持身份；排序、切换、样式和展示隐藏不会重建草稿。明确恢复历史内容时重置编辑器以读回权威版本，防止表单残留旧值。

按原图使用暖浅底、近白卡片、细边框、14px外圆角/10px条目圆角、克制阴影；板块头部六点手柄、图标、名称/数量、展开按钮独立；辅助操作在hover/focus出现。条目头部有拖拽、上移/下移、显示/隐藏、删除入口，底部保留保存与更多操作。教育、工作和项目继续使用自己的字段结构，明确双列分组；科研、培训、技能、证书等使用字段目录生成的真实输入控件，不删除字段。

左侧使用原branch-editor滚动面；固定高度与min-height:0阻止内容撑高三栏。右侧调宽/折叠/恢复、画布/A4架构与全局应用导航沿用原路径。

## 权威数据与排序

- V2板块顺序：现有presentation.canonicalSectionOrder，仍通过展示队列 → WorkspaceRepository → presentationRevision保存；只在拖拽/键盘排序时建立手动顺序。保留未知、隐藏及自定义key；未列出项稳定追加，不造正文。
- V1 sectionOrder仍只管理summary/experience/skills/certificates四类；没有把V2 key写进V1枚举。条目排序继续使用itemOrderBySection，在同一V2板块内交换其占据的顺序位置，其他板块不动；跨板块条目拖放被拒绝，不隐式转换数据类型。
- 修正了向下移动时移除元素后重算目标下标导致不移动的问题。左侧和V2 render mapper均使用展示顺序，不再单独按内容order重新排回。
- 内容、事实、factRefs、来源和内容Revision不因排序而变化。浏览器比较profiles/resumeBranches/resumeRevisions/resumeBranchOperations快照完全一致。展示撤销/重做走既有展示历史；内容删除/历史恢复走Repository内容版本。
- 板块隐藏一次保存全部目标hiddenItemIds。板块删除一次多edits提交，只移出当前简历，可撤销恢复；资料库不变。旧的V2事实确认、分支隔离和Fact Guard阈值不变。

## 用户排序优先于模板

审计发现：campus-reference/campus-clean/professional-classic在renderer重新按模板预设排序，modern-operations/business-consulting按类型强制分到边栏，可能覆盖用户意图。

现在未手动排序仍保留原模板默认效果；一旦canonicalSectionOrder存在：

1. 这些模板直接消费mapper已排序的structuredSections，不再覆盖用户顺序。
2. 校园浅底不再把手动分开的技能/证书/语言强制组合、改标题或隐藏后续标题。
3. 两个双栏模板改为连续正文流，保留所选模板的字体、标题、配色及装饰，不再强制把特定类型放回边栏。此规则的CSS位于globals.css，预览和正式PDF共用；模板自身未删除，未手动排序的双栏默认不变。
4. 技能分类只合并相邻同类条目，不再将被用户分开的同类技能重新聚到一起。

正式PDF沿原snapshot → presentationConfigFromExportSnapshot → 共享模板renderer/分页路径；没有替换下载接口或增加独立PDF正文模型。已实测校园浅底及现代模板PDF200与pdftotext顺序，切换全部7模板和刷新后顺序保持。

## 添加与编辑

添加板块由resumeSectionCatalog的真实类型提供；已有板块不重复添加，空板块提供真实新增表单。CanonicalNewItemForm按字段目录收集输入，经ResumeItemV2Schema及列表规范化后由用户“保存并确认”，再调用Repository；无内容不落库，失败保留草稿并显示错误。不隐式同步资料库。

新培训条目补测暴露Repository问题：addResumeContentItem在已有structuredItem时仍先将新条目的旧文本投影反解析，触发missing_training_identity。修正为仅同步原有条目，新条目直接采用已校验canonical数据；增加Repository回归验证机构、项目和年月保留、内容版本+1、资料库不变。未放松结构完整性检查。

自定义板块标题沿既有局部样式配置写入，确保预览/PDF使用同一标题。

## 局部样式、富文本和照片边界

局部样式仅暴露真实支持的标题显示和独立标题；无覆盖显示“跟随全局设置”，修改显示“本板块独立设置”，可清除覆盖恢复全局。其他局部字号/条目变体不伪造为可用。

现有V2正文是string/string_list，旧TipTap通过HTML→纯文本桥接；本轮内嵌左栏不再显示或启用无法持久化的粗斜体等marks，结构化列表仍按原路径编辑。未进入富文本实施。独立后续方案：可选版本化字段格式标记（字段路径、文本hash、有界span marks和明确列表结构），需要Schema/Repository/确认/DTO/共享renderer/PDF/旧数据兼容及往返测试，禁止HTML直接进入正文。

照片仍仅审计：ResumeBasicsV2已有photo可选URL；校园浅底真实存在，但supportsPhoto=false，mapper/renderer与共享图片资源持久化尚无完整链路。未开启能力、未加上传按钮。后续需独立设计受控资源引用、大小/类型校验、Repository持久化、快照资源解析、模板位置和预览/PDF一致性，不能擅自加表。

## 修改文件

- 工作区与UI：src/app/resume/ResumeWorkspace.tsx；src/components/editor/ResumeSectionCard.tsx、ResumeItemTools.tsx、SidebarEditorContext.tsx、AccordionList.tsx、SectionShell.tsx、TipTapEditor.tsx；sections/CanonicalSectionPage.tsx、ExperienceSectionPage.tsx、SkillsSectionPage.tsx；src/styles/product-pages.css。
- 共享排序/模板：src/domain/resumeRender/mapper.ts；src/components/resume/TemplateCard.tsx（双栏手动顺序说明）；templates/shared/canonical.tsx、campusReference.tsx、campusClean.tsx、professionalClassic.tsx、modernOperations.tsx、businessConsulting.tsx；src/app/globals.css。
- 原展示扩展继续保留：schemas/presentation.ts、export.ts、branch.ts；export/snapshot.ts；templates/types.ts；storage/repositories.ts。
- 测试：tests/e2e/resume-content-sidebar.spec.ts、p38b-resume-presentation.spec.ts；tests/unit/presentationConfig.test.ts、exportSnapshotRoundTrip.test.ts、referenceCampusImport.test.tsx。

## 验证命令与证据

- pnpm typecheck：通过。
- pnpm lint：通过（全量ESLint）。
- pnpm test tests/unit/branch.test.ts tests/unit/referenceCampusImport.test.tsx tests/unit/presentationConfig.test.ts tests/unit/exportSnapshotRoundTrip.test.ts tests/unit/resumeRenderV2.test.ts tests/unit/editorHelpers.test.ts tests/unit/templateRegistry.test.ts：最终7文件63项通过，包含新增培训Repository回归、全部模板手动顺序及技能分类不重排检查。
- pnpm exec playwright test tests/e2e/resume-content-sidebar.spec.ts tests/e2e/p38b-resume-presentation.spec.ts --workers=1：前次合并11项通过；最终13项合并为12通过/1失败。失败位于三视口切换后截图准备时，排版标签未选中、原字号可见断言失败；加入双rAF等待响应式grid/ResizeObserver稳定，原断言全部保留，该项单独复验1通过（13.6秒）。13项覆盖均获完整通过退出码，不宣称一次合并13/13或全量Release Gate。
- pnpm build：最终退出码0；没有Electron打包。
- git diff --check：末轮通过；构建生成的next-env.d.ts恢复到本轮前内容。

截图保存在artifacts/sidebar-finish/，未提交截图或匿名PDF：

- before/{1920,1366,1024}-{collapsed,expanded}.png：本轮编辑前真实固定视口截图，包含当时实际通知状态。
- after/{1920,1366,1024}-{collapsed,expanded,education-expanded,work-expanded}.png：同尺寸固定视口及完整展开后左栏内滚动取景。
- after/1366-{light,dark}-{green,burgundy}.png：四种主题组合与未保存技能草稿。
- after/campus-reference-manual-order.png、modern-operations-manual-order.png：手动顺序跨模板。
- section-item-order.pdf、campus-reference-manual-order.pdf、modern-operations-manual-order.pdf：正式导出及文本顺序验证。

过程中的拖拽测试先因展开长表单超出可见范围、随后因动态open定位列表缩短失败；改为稳定条目定位并收起再进行鼠标拖拽，保留实际排序/跨板块拒绝/撤销重做/PDF断言。证书/培训用例真实暴露并修复了结构化新建的投影重解析问题，未删断言或降低校验。

已实际查看1920收起、1366教育展开、1024工作展开、1366深色酒红等截图，并据此修正字段退单列、控件过高、底部操作堆叠和无效格式栏。

## 验收范围与限制

本轮目标是1920×1080、1366×768、1024×768桌面左栏；不代表全量Release Gate或移动端/触屏/旧客户端往返验收。键盘和鼠标拖拽已验证，长条目可先收起再拖动，亦可用上/下移。未新增生产依赖、Dexie表、事实字段或不可逆迁移。

内容重做仍沿项目既有职责通过版本恢复，工具栏“重做”负责展示配置；本轮验证了展示撤销/重做与内容删除撤销/历史恢复，没有另造内容历史。富文本和照片保持独立后续任务，不在本阶段实施。

## 后续用户微调衔接（2026-10-25）

本报告是上轮收尾基线；用户随后明确要求字段浮条/逐条描述/主题日历与右栏密度微调，已定向实施并验证，详见[微调记录](resume-sidebar-polish.md)。原“无格式工具”结论由本轮有限原文锚定展示标注替代；不等于实施完整富文本或照片。最终69相关单测、15项合并E2E及日历最终2项复验、typecheck/lint/build/diff通过。限制与实际截图路径以微调记录为准。
