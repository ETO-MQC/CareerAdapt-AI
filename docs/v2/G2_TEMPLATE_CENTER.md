# V2-G2：正式模板中心第一阶段

状态：已实现并通过验证。

日期：2026-07-04

## 1. 实际基线

启动前基线核查：

- `git status --short`：干净工作树。
- G1b 永久测试已被 Git 跟踪：`tests/e2e/v2-g1b-style-panel.spec.ts`。
- 未发现 `v2-g1b-complete` 标签。
- `pnpm verify` 通过：typecheck、lint、unit 70/70、build 通过。
- 实际基线与历史记录差异：历史摘要写有 unit 72/72，本轮启动前实际仓库为 unit 70/70，以代码和命令输出为准。
- Dexie 仍为 v7；本轮未新增表、未升级 Dexie、未持久化 ResumeDocument。

## 2. Template Registry

模板继续使用单一静态类型化 Registry：`src/components/resume/templates/templateRegistry.tsx`。

最终 `ResumeTemplateDefinition` 字段：

- `id`
- `name`
- `shortName`
- `description`
- `category`
- `layout`
- `atsLevel`
- `suitableRoles`
- `tags`
- `capabilities`
- `defaultPresentationStyle`
- `version`
- `status`
- `className`
- `render`
- `renderThumbnail`

`TemplateIdSchema` 扩展为：

- `classic-technical`
- `modern-operations`
- `ats-minimal`
- `business-consulting`

未知或已删除 templateId 继续通过 Schema parse 失败后回退到默认配置；旧 templateId 保持兼容。

## 3. 四套模板

| ID | 名称 | 分类 | 布局 | ATS友好等级 | 定位 |
|---|---|---|---|---|---|
| `classic-technical` | 稳重技术 | technical | single-column | high | 技术、数据、研究、产品 |
| `modern-operations` | 简洁现代 | modern | two-column | medium | 运营、产品、项目管理、综合岗位 |
| `ats-minimal` | ATS极简单栏 | ats | single-column | high | 技术、运营、产品、数据、校招、通用岗位 |
| `business-consulting` | 商务咨询正式 | business | two-column | medium | 经济、金融、咨询、外贸、供应链、商务、管理 |

ATS 等级为产品内部结构标签，不表示外部认证或保证通过。

## 4. Capabilities

四套模板均声明：

- `supportsAccentColor`
- `supportsDensity`
- `supportsBodyScale`
- `supportsHeadingScale`
- `supportsLineHeight`
- `supportsSectionGap`
- `supportsItemGap`
- `supportsSectionTitleVisibility`
- `supportsTwoPages`

当前四套模板均支持 G1b 已开放样式 token；`supportsTwoPages=false`，UI 显示“当前模板不支持两页策略”，不删除用户配置，不进入 G3 两页策略。

## 5. Template Center 交互

新增组件：

- `TemplateCenter`
- `TemplateCard`
- `TemplateThumbnail`

入口位于 `/resume` 右侧属性与导出面板，原快速模板下拉保留作为兼容 fallback。

模板中心提供：

- 模板卡片和当前模板高亮。
- 缩略预览。
- 模板名称、说明、布局、ATS友好等级、适用岗位。
- 应用模板按钮，带明确 `aria-label`。
- 第一阶段筛选：全部、ATS优先、单栏、双栏、技术简洁、商务正式。
- 空状态。
- 小屏幕滚动和关闭入口。

打开、关闭和筛选模板中心不写入 presentation config，不清理当前 block 选择，不丢未保存正文草稿。

## 6. 缩略图方案

缩略图复用正式模板 renderer 和当前 `ResumeRenderModel`：

- `TemplateThumbnail` 调用 `template.renderThumbnail(model, context)`。
- 使用与 A4 预览相同的 `resumeTemplateStyleVars`。
- 缩略图容器 `pointer-events: none`，不截获编辑器键盘事件。
- 不进行独立 overflow 测量。
- 不写入 presentation config。
- 不创建 ResumeRevision 或 presentationRevision。
- 通过 `.no-print` 所在模板中心隔离，不进入 PDF。

本阶段没有接入外部服务，也没有新增静态远程模板资源。

## 7. 模板切换与 Revision 边界

模板中心应用模板复用 `ResumeWorkspace.updatePresentationTemplate`：

```text
TemplateCard apply
-> updatePresentationTemplate(templateId)
-> enqueuePresentation
-> saveResumePresentationConfig
-> appMeta: resumePresentationConfig:${branchId}
```

边界：

- 增加 `presentationRevision`。
- 不创建 `ResumeRevision`。
- 不运行 Fact Guard。
- 使用独立 operationId。
- 相同模板不重复写入。
- 保留 `itemOrderBySection`、`hiddenItemIds`、样式 token 和 `sectionStyleOverrides`。
- 支持展示 Undo/Redo。
- 分支隔离，刷新后保持。

## 8. Overflow 和 PDF

模板切换后 A4 预览依赖项包含 `templateId` 和 `presentationRevision`，会重新测量 overflow。

导出继续使用当前 A4 DOM 与同一 RenderModel：

- overflow 时仍写入 `blocked_overflow` 并阻止正式打印。
- `ExportRecord.templateId` 和 `presentationSnapshot.templateId` 使用当前模板。
- `presentationSnapshot` 保留排序、隐藏、样式和 section title overrides。
- 模板中心、卡片、按钮和编辑控件均在 `.no-print` 内，不进入打印 PDF。

## 9. 测试

新增永久测试：

- `tests/unit/templateRegistry.test.ts`
- `tests/e2e/v2-g2-template-center.spec.ts`

更新测试：

- `tests/unit/presentationConfig.test.ts`

覆盖点：

- Registry ID 唯一、总数 4、metadata、renderer、thumbnail renderer、capabilities、默认样式。
- 新旧 TemplateId Schema 兼容，未知 templateId 回退。
- 筛选逻辑。
- 新模板切换不修改正文、factRefs、隐藏配置或排序。
- ExportRecord 快照包含新模板 ID。
- 模板中心打开关闭、4 套模板展示、筛选、应用 ATS 和商务模板。
- 当前模板高亮、刷新保持、Undo/Redo、未保存草稿保留、样式和隐藏状态保留、打印隔离。
- 四套模板逐一生成 A4 PDF，验证 1 页 A4、包含候选人核心信息、不包含模板中心和编辑控件。

## 10. Bug

开发中发现并修复 2 个 G2 范围内问题，并调整 1 个 E2E 基建参数：

- 技术简洁筛选最初只读取 `category/tags`，未纳入 `suitableRoles`，导致 `ats-minimal` 虽适合技术岗但未出现在技术简洁筛选结果中。
- 根因：筛选口径遗漏适用岗位字段。
- 修复：`filterResumeTemplates("technical")` 同时检查 `category`、`tags` 和 `suitableRoles`。
- 永久回归：`tests/unit/templateRegistry.test.ts`。
- 影响 V1：否。
- 数据迁移：否。
- 高并发完整 E2E 中，模板快速选择可能早于 `presentationConfig` 加载完成，旧逻辑在已选分支场景下只更新本地 `templateId`，没有持久化展示配置，导致刷新或后续断言看到旧模板。
- 根因：加载时序窗口下存在 local-only fallback。
- 修复：有 selectedBranch 但展示配置尚未加载时禁用模板切换并给出提示；已加载后统一走 `saveResumePresentationConfig` 和 presentation 串行队列。
- 永久回归：`tests/e2e/v2-g2-template-center.spec.ts` 覆盖模板应用、刷新保持、ExportRecord 快照和组合回归。
- 影响 V1：否。
- 数据迁移：否。
- 四模板 PDF 验证加入后，完整 E2E 在 11 worker 并发下 30 秒用例超时过紧；`playwright.config.ts` 全局 timeout 调整为 45 秒，未放宽断言。

## 11. 验证结果

- `pnpm typecheck` 通过。
- `pnpm lint` 通过。
- `pnpm test` 通过：79/79。
- `pnpm build` 通过。
- G2 专项 E2E 通过：4/4。
- G0a/G1a/G1b/G2 组合 E2E 通过：18/18。
- D1/D2 E2E 通过：17/17。
- `stageD2ExportFlow` 通过：1/1。
- `pnpm test:e2e` 通过：81/81。
- `pnpm test:c1:eval` 通过，overallQualified=true。
- `pnpm test:c2:eval` 通过：safeAllowed=6、safeBlocked=0、unsafeBlocked=10、unsafeAllowed=0、overallQualified=true。
- 最终 `pnpm verify` 通过：typecheck、lint、unit 79/79、build。

## 12. 遗留问题

- 本阶段不做模板市场、搜索、收藏、付费、远程下载。
- 本阶段不做 G3 直接 PDF 下载、两页完整策略、DOCX 或 OCR。
- 四套模板全部复用当前 A4/浏览器打印链路，直接 PDF 下载仍待 G3。
- `v2-g1b-complete` 标签启动前未发现；本轮未创建 Git 标签。

## 13. 下一阶段

候选方向：

- V2-G3 导出增强：PDF 直接下载、浏览器打印 fallback、PDF golden tests。
- V2-G5 排版诊断和模板推荐。
- 单独启动 dnd-kit 拖拽增强。

不得自动进入 DOCX、OCR、多 Profile、Application、模板市场或远程模板。
