# V2-G5a 区块级岗位定向 AI 优化与可验证修改闭环

## 范围

G5a 只实现“基于现有通用简历或岗位简历，对目标岗位生成区块级、可审阅、可验证、可接受的内容建议”这一条纵向闭环：

1. 用户在 Resume Studio 中选择已有岗位，或粘贴 JD 创建新岗位。
2. 系统复用 C1 `RequirementMatch`，把岗位要求映射到当前简历 `ResumeBranch.contentItems`。
3. 用户可从通用分支显式派生 `job_specific` 分支；通用分支不被静默修改。
4. AI 只生成 `AiSuggestion` 草稿；建议绑定 block、requirement、evidence、branch revision、currentRevisionId、原文 hash 和 requirementsHash。
5. 用户可查看原文、建议文案、inline diff、理由、JD/requirement、证据和 Fact Guard 预检。
6. 用户可接受、编辑后接受、拒绝、忽略或重新生成。只有接受建议时才运行正式 Fact Guard 并创建内容 `ResumeRevision`。

本轮没有进入 G5b 排版诊断、dnd-kit 拖拽、DOCX、OCR、多 Profile、Application、模板市场、第二套 AI Provider、第二套 JD/Suggestion/Fact Guard 系统，也没有新增 Dexie 表或升级 Dexie。

## 数据模型

- `JobRequirementCategory` 增加 `required_skill`、`preferred_skill`、`experience`、`education`、`certificate`、`language`、`tool`、`other`，兼容更常见 JD 分类。
- `AiSuggestion` 增加 block 级元数据：`targetContentItemId`、`branchId`、`basedOnBranchRevision`、`basedOnRevisionId`、`originalTextHash`、`requirementsHash`、`evidenceQuotes`、`guardPreview`，并增加 `ignored` 状态和结构/压缩类建议类型。
- `JobAdaptationDraft` 可选记录 `branchId`、`sourceBranchId`、`sourceRevisionId`、`sourceBranchRevision`，用于把 C2 草稿绑定到当前分支上下文。
- `ResumeBranch` 的 `job_specific` 来源允许来自 `sourceBranchId + sourceRevisionId`，不再只能来自 `sourceAdaptationDraftId`。新增 `derive_job_branch` 和 `suggestion_accept` 操作类型。
- 新增 `RequirementBlockMatch`、`RequirementCoverageSummary`、`JobOptimizationSummary`、`ResumeBlockSuggestionPreview` Schema，用于 G5a 的派生视图和安全锁定，不新增持久化表。

## 仓库事务

- `deriveJobSpecificBranchFromBranch`：从 general 或已有 branch 显式派生岗位分支，复制内容项和展示配置，写入 first revision 与 `derive_job_branch` operation；重复派生同一 source/job 时返回已有分支。
- `saveGeneratedBlockSuggestion`：保存单条 block 级建议，推进 `JobAdaptationDraft` revision 和 snapshot。
- `applyResumeBlockSuggestion`：接受建议的唯一写入入口。它重新读取 branch、suggestion、draft、profile、job、matches，校验 expected revision、currentRevisionId、originalTextHash、requirementsHash、suggestion 状态、C2 matches 可用性，再运行 Fact Guard。通过后更新目标 content item，创建 `suggestion_accept` 内容 revision、branch operation、draft snapshot 和 suggestion operation。
- `ignoreSuggestion`：将建议标记为 `ignored`，不修改正式简历内容。

## UI 闭环

Resume Studio 新增 `JobOptimizationPanel`：

- 岗位选择和 JD 手动创建入口复用现有 `RawInputDocument`、`JobAnalysisDraft`、`commitJobDraft` 和手动 JD fallback。
- Requirement 侧栏展示覆盖状态、关联 block 数和证据数，fact gap 时显示缺口提示，不生成虚假建议。
- 建议详情展示原文、建议文本、inline diff、理由、证据和 Fact Guard 预检。
- 接受和编辑后接受走 `applyResumeBlockSuggestion`；拒绝、忽略、重新生成只更新建议状态或创建新建议。
- 结构建议当前只复用展示配置的上移/隐藏入口，不创建内容 `ResumeRevision`。

## 安全边界

- AI 不直接写 `CareerProfile`、`ResumeBranch` 或 `ResumeRevision`。
- 建议必须引用当前输入候选证据；无证据的 requirement 进入 fact gap，不自动编造。
- 接受建议时必须重新运行 Fact Guard；高风险或 needs_edit 阻断写入。
- stale 检查覆盖 branch revision、currentRevisionId、target content item、原文 hash 和 requirementsHash。
- 通用分支派生岗位分支后，通用分支保持不变。
- 所有写入继续使用 `expectedRevision`、`operationId` 和事务幂等。

## 验证

- `pnpm verify` 通过：typecheck、lint、unit 101/101、production build。
- `pnpm vitest run tests/unit/jobOptimization.test.ts` 通过：4/4。
- `pnpm playwright test tests/e2e/v2-g5a-job-optimization.spec.ts` 通过：1/1。
- `pnpm test:e2e` 通过：126/126。
- `pnpm test:c1:eval` 通过：overallQualified=true，hardSafetyFailures=0。
- `pnpm test:c2:eval` 通过：overallQualified=true，safeAllowed=6，unsafeAllowed=0，workflowTests=108/108。

## 已知边界

- 当前 G5a 只做内容建议闭环，不做完整排版诊断、模板推荐、自动压缩到一页或多页策略建议。
- 当前结构建议复用展示配置按钮，不引入拖拽库，不做跨 section 拖拽。
- 当前 JD 创建入口为手动 fallback，可满足本地闭环；更强 JD AI 解析不在本轮扩展。
