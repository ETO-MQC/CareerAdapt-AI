# V2-G4a Text PDF Resume Import

## 目标

G4a 只完成“已有文本型 PDF 简历结构化导入并一键进入 Resume Studio”的最小闭环：

```text
文本型 PDF
-> PDF.js 提取页文本
-> 结构化 ImportedResumeDraft
-> 用户审阅、取舍、改写和确认
-> CareerProfile 正式事实
-> general ResumeBranch
-> Resume Studio 套模板、编辑和直接 PDF 导出
```

本阶段不做 DOCX、OCR、任意 PDF 原版式还原、坐标级自由编辑、多 Profile 管理、Application 管理或 G5 岗位智能优化。

## 数据和 Schema

- 新增 `ImportedResumeDraft` 相关 Schema，覆盖 draft 状态、来源文件、页文本、基础信息、section、item、pageRef、warning、mergeDecision 和 confirm result。
- `ImportedResumeDraft` 存在 `appMeta`，不新增 Dexie 表，不升级 Dexie，draft revision 使用 `appMeta.revision` 做并发保护。
- 继续复用 `PdfImportSession` 和 `PdfPageText` 保存脱敏页文本、文件 hash、页数和提取状态；不持久化原始 PDF Blob，不记录本地绝对路径。
- `ResumeBranch` 新增 `branchPurpose: "general" | "job_specific"`。G4a 导入确认创建 `general` 分支，必须有 `sourceImportId`，不得伪造 `jobId`、`JobDescription` 或 `RequirementMatch`。
- `BranchContentSource` 增加 `resume_import`，`ResumeRevisionSource` 增加 `import_confirmed`，`ResumeBranchOperationType` 增加 `resume_import_confirm`。
- `ResumeRenderSourceTrace.jobId` 改为可选，允许通用简历在无目标岗位时进入同一套渲染、分页和导出路径。

## 结构化规则

- G4a 使用本地规则解析，不调用 AI，不让 AI 直接写正式事实。
- 识别基础信息：姓名、邮箱、电话、地点、链接。
- 识别常见中英文标题：Summary、Experience、Projects、Skills、Certificates 等。
- 当前进入正式渲染的 section 类型保持在既有 Resume Studio 支持范围：`summary`、`experience`、`skills`、`certificates`。无法稳定映射的内容可保留为 draft `unknown`，默认不进入正式分支。
- 每个导入 item 都保留 `rawText`、`normalizedText`、`pageRefs`、`confidence` 和 `sourceStatus`。
- `sourceStatus=located` 才会作为 `pdf_import` provenance 写入正式事实；用户改写后的内容标记为 `user_confirmed_modified` 并以 `user_input` provenance 写入。
- 扫描版或无可用文本的 PDF 明确提示 G4a 暂不支持 OCR。

## 审阅和确认

审阅 UI 集成在 Resume Studio 顶部：

- 支持点击上传或拖拽文本型 PDF。
- 显示页文本来源面板、页码切换和当前 item 的 sourceQuote 高亮。
- 支持基础信息合并选择：保留已有资料或使用导入值。
- 支持 include/exclude section 和 item。
- 支持 item 文本编辑、上移、下移、与下一条合并、按换行拆分。
- 非 PDF 文件在入口处被阻断，不创建 general branch。

确认时由 Repository 事务完成：

- 校验 draft 状态和 `expectedDraftRevision`。
- 合并或创建 `CareerProfile`，已有 profile 版本递增。
- 为已确认 item 生成正式 facts，保留来源定位。
- 创建一个 verified `general` ResumeBranch、首个 `ResumeRevision` 和 `resume_import_confirm` operation。
- 写入默认 `ResumePresentationConfig`，保证进入 Studio 后能直接套用模板和导出。
- 将 draft 标记为 `confirmed`，将对应 `PdfImportSession` 标记为 `committed`。
- `operationId` 幂等，重复确认返回同一 profile/branch/revision，不重复写 facts 或分支。

## Studio 和导出

- Resume Studio 在没有现有 verified 分支时也显示导入入口。
- 通用导入分支使用“通用简历 / 无目标岗位”上下文，不需要 Job。
- 通用分支仍复用 G0-G3 的直接编辑、展示配置、模板中心、分页策略、直接 PDF 下载和浏览器打印 fallback。
- 直接 PDF 继续使用冻结 `ResumeRenderModel` 与 `ResumePresentationConfig`，导出记录仍写入 `ExportRecord`。

## 验收覆盖

- 单元测试覆盖解析 draft、确认写入 general branch、无 Job 渲染、幂等确认和后续编辑。
- E2E 覆盖文本 PDF 上传、审阅排除 item、确认进入 Studio、切换正式模板、最多两页策略、直接 PDF 下载、ExportRecord 字段和非 PDF 拒绝。

## 明确后置

- DOCX 导入/导出。
- OCR 和扫描 PDF。
- 原 PDF 版式、坐标、图标、边框和字体的一比一还原。
- 双栏/颜色/字号的自动版式映射。
- 多 Profile 显式管理和 Application 绑定。
- 岗位智能优化、模板推荐和排版诊断。
