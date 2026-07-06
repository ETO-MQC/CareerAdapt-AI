# Domain And Architecture

## 核心结论

V2引入 `ResumeDocument` 作为编辑器核心视图模型。G0a中它只从当前 verified `ResumeBranch` 和 `currentRevision` 派生，不持久化，不新增Dexie表，不升级Dexie v8。`CareerProfile` 继续作为事实层，`ResumeBranch` / `ResumeRevision` 继续作为唯一内容事实来源。

## 建议模型

```text
ResumeDocument
- id
- branchId
- profileId
- jobId
- sections
- layoutConfig
- styleConfig
- templateId
- contentRevision
- presentationRevision
- sourceBranchRevision
- createdAt
- updatedAt
```

## Section与ContentBlock

Section：

- id、type、title、order、visible。
- blocks、layoutPlacement、sourceTrace。

ContentBlock：

- id、sectionId、type、text、order、visible。
- factRefs、source、guardStatus、guardFindings。
- editable、presentationOnly。

## 配置

- `LayoutConfig`：单栏/双栏、section placement、页边距、页数策略。
- `StyleConfig`：字号、行高、颜色、字体、间距。
- `TemplateConfig`：templateId、templateVersion、templateCapabilities。
- `EditorState`：selection、editingBlockId、draftText、dirty、guardState。

## Revision

- 内容Revision：G0a继续复用V1 `ResumeRevision`，不建立第二套内容Revision系统。
- 展示Revision：模板、样式、布局、显示隐藏、排序。
- Undo/redo要区分内容和展示，不让样式撤销污染事实历史。

## G4a导入通用分支

G4a 增加“无目标岗位”的通用简历分支，用于承接用户已有文本型 PDF 简历导入：

- `ResumeBranch.branchPurpose` 区分 `job_specific` 和 `general`。
- `job_specific` 分支继续要求 `jobId`、`sourceJobVersion`、`sourceAdaptationDraftId` 和 `requirementMatchIds`。
- `general` 分支必须绑定 `sourceImportId`，不得伪造 `JobDescription`、`RequirementMatch` 或岗位版本。
- 通用分支仍必须是 verified 后才进入正式编辑和导出；内容仍来自 `ResumeRevision` 和 `contentItems`。
- 通用分支的同步状态只检查 Profile 版本和 factRefs，不检查 Job 版本。
- `ResumeDocument` 和 `ResumeRenderModel` 继续作为派生视图；当 `branchPurpose=general` 时，`jobId` 和 `sourceTrace.jobId` 可以为空，渲染上下文降级为“通用简历 / 无目标岗位”。
- 导入审阅草稿 `ImportedResumeDraft` 存在 `appMeta`，不新增 Dexie 表，不持久化 ResumeDocument，不保存原始 PDF Blob。

## G5a岗位分支与区块建议

G5a 在 G4a general branch 基础上补齐岗位定向闭环，但继续复用现有聚合根和 Dexie 表：

- `job_specific` 分支既可以来自 `sourceAdaptationDraftId`，也可以来自 `sourceBranchId + sourceRevisionId`。从通用分支派生岗位分支时复制内容项与展示配置，创建 first revision 和 `derive_job_branch` operation。
- `RequirementBlockMatch`、`RequirementCoverageSummary` 和 `JobOptimizationSummary` 是派生视图，不持久化为新表。
- `AiSuggestion` 承载 block 级建议元数据，锁定 branch revision、currentRevisionId、原文 hash 和 requirementsHash。
- 接受建议通过 `applyResumeBlockSuggestion` 原子写入：校验 stale -> 运行 Fact Guard -> 更新目标 content item -> 创建 `suggestion_accept` 内容 revision -> 更新 draft snapshot 和 suggestion operation。
- 结构建议仍属于展示层配置；上移/隐藏不创建内容 revision，也不运行 Fact Guard。

## G5b派生诊断

G5b 新增 `ResumeDiagnosticSnapshot` 派生视图，输入来自当前 `ResumeBranch`、`ResumeRenderModel`、`ResumePresentationConfig`、`PaginationPlan`、Template Registry 元数据、`JobDescription.requirements` 和 G5a `RequirementBlockMatch`。

- 诊断结果不持久化为 Dexie 表，不升级 Dexie。
- 诊断不写 `CareerProfile`、`ResumeBranch.contentItems`、`factRefs` 或 `ResumeRevision`。
- 忽略状态可按 branch 存到现有 `appMeta`，不是正式事实。
- 安全动作复用 `saveResumePresentationConfig` 和展示配置串行队列。
- ExportRecord 只可选保存诊断摘要，不保存完整诊断缓存或原始 PDF Blob。

## G6a Application Workspace

G6a 新增 `ApplicationRecord`，用于组织求职机会和投递过程，但不成为新的简历事实源。

- Dexie schema 升级到 v8，仅新增 `applications` 表。
- Application 只能从 `job_specific` ResumeBranch 显式创建，`general` 分支不能直接作为正式投递简历。
- Application 通过 id 引用 `CareerProfile`、`JobDescription`、来源 general branch、job-specific branch、`ResumeRevision`、`ResumePresentationConfig` revision、模板和 `ExportRecord`。
- Application 保存岗位标题和公司快照，避免岗位记录后续变化导致列表失真。
- Application 不保存完整简历正文、完整 JD 正文、PDF Blob、第三方登录态或 API Key。
- Application 状态、详情、Revision 选择、ExportRecord 关联、归档和恢复均由 `WorkspaceRepository` 事务写入，使用 `expectedVersion` 和 `operationId`。
- 时间线嵌入 Application 记录，当前不新增独立事件表。
- `applied` 状态会锁定投递时的 revision/export 快照；后续分支编辑不会覆盖历史投递版本。
- Readiness 是详情打开时的派生结果，不作为正式事实持久化，也不表达录用概率、面试概率或 ATS 通过率。

## Repository职责

G0a在 WorkspaceRepository 中增加轻量适配方法或直接复用现有方法：

- 从ResumeBranch创建/派生ResumeDocument。
- 保存内容编辑并运行Fact Guard。
- 保存展示配置。
- 文本保存继续复用现有 `editResumeBranch`、`expectedRevision`、`operationId`、事务和Fact Guard路径。
- 导出前重新校验 branch/profile/job/template。
- G4a导入确认必须通过 Repository 事务写入 profile、general branch、first revision、operation、presentation config 和 import session 状态；`operationId` 必须幂等。
- G5a派生岗位分支、保存 block 建议、接受/拒绝/忽略建议必须通过 Repository 事务完成；接受建议必须校验 C1/C2 matches 仍可用。

## 聚合根和事务边界

- CareerProfile：事实聚合根。
- JobDescription：岗位要求聚合根。
- ResumeBranch：岗位简历分支聚合根。
- ResumeDocument：编辑聚合或派生视图，必须引用Branch和factRefs。
- ExportRecord：导出审计记录。

文本编辑事务必须包含：读取branch最新revision -> Fact Guard -> 写内容 -> 写revision -> 写operation。展示配置事务不得写CareerProfile事实层。

## V1模块复用

直接复用：CareerProfile、JobDescription、RequirementMatch、Fact Guard规则、PDF导入、AI Service、C1/C2 eval、ResumeRenderModel部分字段、ExportRecord幂等。

适配：ResumeBranch到ResumeDocument Mapper、ResumeWorkspace状态、模板渲染接口、overflow检测。

重构：模板注册、编辑器状态、样式配置、导出直接生成、多Profile上下文。

## 技术栈

继续使用 Next.js、TypeScript、Zod、Dexie、Zustand/Tailwind。第一阶段不因编辑器引入大型富文本库；如G1引入Tiptap/Lexical/dnd-kit，必须先完成事实引用和导出一致性评估。

## Workspace/Profile/Application关系

V1存在Workspace概念和 `useWorkspace`，但页面仍隐式使用 `profiles[0]`。V2必须在G6前显式化上下文；若G0遇到分支选择问题，也应局部消除隐式绑定。Application实体后置到Resume Studio稳定之后。

## 数据迁移策略

- G0a不执行数据迁移。
- V2新增表前先完成备份和JSON导出路径确认。
- 迁移幂等，不删除V1数据。
- legacy_unverified继续只读。
- 迁移失败回滚到V1主链路。
- 所有新增索引必须有单元测试覆盖旧数据升级。
