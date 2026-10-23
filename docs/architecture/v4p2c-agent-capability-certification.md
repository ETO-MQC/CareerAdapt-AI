# V4-P2-C Agent 能力完整性认证报告

- 执行日期：2026-10-08
- 基线：`12fdb4b feat(v4p2bf): close the agent confirmation chain with mandatory binding fields`
- 分支：`main`
- 执行契约：`docs/architecture/v4-plan.md`（§6 五张表、§7 MyCareer 迁移、§11 P2-B/P2-C 边界）
- 前置阶段记录：`Plan3.md` V4-P1 / V4-P2-A / V4-P2-A.1 / V4-P2-B 四轮

本阶段**不实现**网站抓取、浏览器自动化和 cron，未新增 Dexie 表、生产依赖或工作流框架，未修改 Fact Guard 阈值与 P2-B 已确认的转换语义。

---

## 1. 本阶段修复的真实缺陷

### 1.1 JSON 简历导入分支（v4-plan.md §2 第 2 条剩余债务）

根因不是「导入没跑完」，而是**确认目标表达不完整**：

`WorkspaceRepository.confirmImportedResume()` 的建分支判定为
`!existingProfile || (existingGeneralResumeCount === 0 && reconciliationCreatesResumeContent)`。
当 `target.mode === "existing"` 且该资料库**已有**活跃通用简历时，
`createBranch` 恒为 false。但当时 `commit_resume_import` 的 target 是 `.strict()`，
`createGeneralResume` 根本无法传入——用户**没有任何途径**在这个分支下要求建简历。
结果就是确认成功、Profile 被写入、`resumeBranches` 无记录、且返回值不带任何原因。

修复（三处，最小改动）：

| 位置 | 修改 |
|---|---|
| `src/agent/tools/registry.ts:202` | `existing` 模式接受 `createGeneralResume: true` |
| `src/services/agent/agentToolService.ts:1588` | 服务签名同步放宽 |
| `src/services/storage/repositories.ts:2305` | Repository 重载同步放宽 |
| `src/domain/schemas/resumeImport.ts:635` | `branchDisposition` 让「未建分支」成为显式结果 |
| `src/services/storage/repositories.ts:2581` | 无分支时给出 `merged_into_existing_general_resume` / `no_new_resume_content` |

「未建分支」从此不再是静默缺失，而是结构化、可断言的结果。

回归认证：`tests/unit/v4p2cJsonImportBranch.test.ts` 5/5，覆盖新建、已有资料库显式建分支、无标志时的显式 disposition、未决对账的整事务回滚、工具 Schema 接受新字段。

### 1.2 `agentToolNames` 与真实 Registry 漂移

`agentToolNames` 导出 47 个工具，`createAgentToolRegistry` 实际注册 48 个：
**`retrieve_career_context` 已在注册表但漏在导出清单外**。

生产影响：`src/components/agent/AgentWorkspace.tsx:797` 用该清单计算
`allowedToolManifestForStep(...)`，因此该工具在工作区分步过滤中**永远不可能被允许**。

修复：`src/agent/tools/registry.ts:524` 补入，并新增双向一致性断言（注册 48 == 导出 48）。

### 1.3 三个 `risk: "read"` 工具实际写工作流状态

认证过程中发现 `plan_resume_composition`、`reconcile_profile_intake`、
`reconcile_resume_import` 在 Registry 中标记为 `risk: "read"`，
但实现会向 `appMeta` 持久化组装 checkpoint 与对账计划。

处理方式：**不改动 `risk`**（那会改变已发布的 MCP `safetyClass` 与 `contractSchemaHash`，
超出本阶段范围且语义上不正确——checkpoint 不是用户事实），而是在能力矩阵中
把「业务记录」与「工作流状态记录」分成两列，并新增
`capabilityMatrixReadToolsWritingWorkflowState()` 显式暴露这三个工具，由测试钉住。

---

## 2. 能力矩阵（从真实 `AgentToolRegistry` 生成）

生成入口：`src/agent/capability/agentCapabilityMatrix.ts`
版本化矩阵产物：`docs/architecture/v4p2c-capability-matrix.json`

该 JSON **不是手写产物**：由 `tests/unit/v4p2cCapabilityMatrix.test.ts` 从真实
`buildAgentCapabilityMatrix()` 派生并在每次运行时重写，同时断言与真实 Registry 派生结果
逐字节一致，因此无法手工编辑漂移。（`artifacts/` 已被 `.gitignore`，故放在 `docs/` 下。）

矩阵**不手写**工具的读写性、确认要求、幂等与可恢复性——全部读自
`registry.manifest()`。描述表只补 Registry 不携带的语义：领域、用户意图、
业务记录、失败恢复。两侧任一漂移直接抛错：

- `capability_matrix_drift_missing_descriptor:<tool>`
- `capability_matrix_drift_unknown_descriptor:<tool>`
- `capability_matrix_drift_read_tool_writes:<tool>`
- `capability_matrix_drift_session_scope_persists:<tool>`

### 2.1 总量

| 指标 | 数量 |
|---|---|
| 注册工具 | 48 |
| 只读工具 | 27 |
| 写入工具 | 21 |
| 需用户确认的写入（`confirmation_write`） | 10 |
| 结果不落盘（刷新后需重建） | 6 |
| 只读但写工作流状态 | 3 |
| 写入但非幂等或不可恢复 | 0 |
| 用户核心意图未实现 | 3 |

### 2.2 九项认证字段

每个工具行都携带：`tool` / `domain` / `category` / `dataScope` / `risk` /
`access`(读|写) / `requiresConfirmation` / `writeKind` / `idempotent` /
`resumable` / `producesArtifact` / `inputSchema` / `outputSchema` /
`businessRecords` / `workflowStateRecords` / `persistence` / `recovery` / `intents`。

`writeKind` 由真实 `risk` + `requiresConfirmation` 派生，不可手写标注：

| risk | requiresConfirmation | writeKind | 含义 |
|---|---|---|---|
| read | — | `none` | 不产生持久化写入 |
| write | true | `confirmation_write` | 必须显式确认 |
| write | false | `safe_write` | 可安全直接写入 |
| user_declared | — | `declaration_write` | 只记录用户自己的决定 |

### 2.3 需用户确认的 10 个写入能力

`commit_profile_intake`、`create_resume_from_profile`、`compose_resume`、
`ensure_general_resume_from_profile`、`create_job_resume_from_profile`、
`commit_resume_import`、`commit_job`、`apply_tailoring_changes`、
`archive_resume`、`restore_resume`

---

## 3. 用户核心意图 → 真实工具链映射

### 3.1 记录个人资料 / 简历事实 — 已认证

```
capture_profile_intake → synthesize_profile_intake → review_profile_intake
   → reconcile_profile_intake → resolve_profile_intake_conflict → commit_profile_intake
```
Profile 事实只经 `commit_profile_intake` 一个 `confirmation_write` 入口落库；
中间步骤只写 `appMeta` 草稿与对账计划。Job JD 不作为用户事实证据。

### 3.2 导入或记录简历 — 已认证

```
prepare_resume_import → review_resume_import → reconcile_resume_import
   → resolve_resume_reconciliation → commit_resume_import
```
唯一 Profile + 简历写入点：`repository.confirmImportedResume()`。
`parse_resume_file` / `create_resume_import_draft` 为兼容路径，不是 canonical 入口。

### 3.3 记录岗位 — 已认证

```
parse_job_description（只读，产出语义图）
   → commit_job（confirmation_write）
        → ingestCandidateListing（候选层）
        → parseCandidateToDraft（同一条 JobAnalysisDraft）
        → saveJobAnalysisDraftRevision
        → createConversionConfirmation（channel=agent，绑定会话/用户消息）
        → convertCandidateListing（正式岗位）
```
与 UI 的 `JobsWorkspace.startImport` / `commitJob` 共用同一条候选管道与同一个
`convertCandidateListing`。重复岗位返回 `duplicate_decision_required` 并等待用户决策。

### 3.4 分析岗位与简历匹配 — 已认证

`recommend_resume_source` → `analyze_job_fit`，均只读，不写任何业务记录。

### 3.5 创建岗位定制简历 — 已认证

```
create_job_resume_from_profile（从资料库派生，confirmation_write）
或 build_resume_evidence_graph → plan_resume_composition → review_resume_composition
   → compose_resume（confirmation_write）
或 create_tailoring_session → answer_tailoring_question → generate_tailoring_changes
   → review_tailoring_diff → preview_tailoring_changes → apply_tailoring_changes
```
岗位分支与通用简历始终隔离，不反向写入 Profile。

### 3.6 修改并导出简历 — 已认证

`apply_tailoring_changes`（确认后写入新 Revision）、`archive_resume`、`restore_resume`、
`export_resume`（只产出导出入口与 route，不直接写 PDF）。

### 3.7 管理投递记录 — **未实现**

Registry 中**没有任何 application 工具**。`ApplicationRecord` 只能在 UI
（`src/components/applications/ApplicationWorkspace.tsx`）维护。
`applicationDrafts` 表与 `createApplicationAssistDraft` /
`updateApplicationAssistStep` 在 P2-A 已落地 Repository，但没有 Agent 能力面。

### 3.8 ATS 半自动填写 — **未实现**

同上：无任何工具。`v4-plan.md` §10 的半自动网申属 V4-P7。

### 3.9 模拟面试 — **未实现**

无任何工具与表；`v4-plan.md` D5 规定面试后置到 V4-P8。

---

## 4. 真实调用链认证

认证方式：`AgentHostStore → AgentExecutor → AgentToolRegistry →
BrowserAgentToolService → WorkspaceRepository → Dexie`，**不使用直接调用 service 的
捷径，也不 mock Repository**。

- 单元/矩阵层：`tests/unit/v4p2cCapabilityMatrix.test.ts` 19/19
- 全链路层：`tests/integration/v4p2cCapabilityCertification.test.ts` 10/10

### 4.1 每个写入能力的八个维度

| 维度 | 记录岗位 | 简历导入 | 通用简历 | 归档/恢复 |
|---|---|---|---|---|
| 首次调用 | ✅ | ✅ | ✅ | ✅ |
| 缺少确认 → `pending_confirmation` | ✅ 零写入 | ✅ 零写入 | ✅ 零写入 | ✅ 零写入 |
| 确认后执行 | ✅ Host 真实确认轮 | ✅ | ✅ | ✅ |
| 重复执行幂等 | ✅ 岗位仍 1 条 | ✅ 分支仍 2 条 | ✅ 通用简历仍 1 份 | ✅ 幂等重放 |
| 中途失败 | ✅ 缺绑定快速失败，无正式岗位 | ✅ 未决对账整事务回滚 | ✅ 陈旧版本零写入 | ✅ 状态前置拒绝 |
| 刷新/重启恢复 | — | ✅ 关库重开后资料/分支/幂等记录完整 | — | — |
| revision 冲突 | — | ✅ 草稿保持 `reviewing` | ✅ stale 拒绝 | ✅ 陈旧 revision 拒绝 |
| 不写资料库 | ✅ Profile 字节级不变 | ✅ | ✅ Profile 字节级不变 | ✅ Profile 字节级不变 |

关键断言：

- 缺少确认由 `AgentExecutor` 抛 `AgentConfirmationRequiredError`，**在任何写入之前**。
- `commit_job` 缺 Agent 绑定时抛 `agent_confirmation_binding_missing`，
  候选 listing 可保留但 `jobDescriptionId` 必须为空、**不得存在转换确认记录**。
- 转换确认记录必须带 `state: "consumed"`、`userMessageId`、`careerSessionBinding.agentSessionId`。
- 简历生命周期与岗位写入后的 `CareerProfile` 序列化结果与操作前逐字节相同。

### 4.2 五分类结构化结果

`src/agent/contracts/agentCapabilityOutcome.ts` 把既有四套并行结果词汇
（`ok/error.retryable`、`receipt.status`、`CareerWorkflowStatus`、诊断 status）
**归一**到唯一五分类，不新增第四套行为语义：

| 分类 | 触发 |
|---|---|
| `success` | 首次完成 |
| `pending_confirmation` | 确认闸拦截 / facade `waiting_for_confirmation` / `duplicate_decision_required` |
| `retryable_failure` | `error.retryable === true`，或 facade `waiting_for_user` / `review_ready` / `working` / `partial` / `recoverable_failure` |
| `permanent_failure` | `error.retryable === false`，或 facade `failed` / 未知状态 |
| `resumed_idempotent` | 成功且 Repository 返回 `idempotent: true` |

分类器是**全函数且确定性**：任意输入都归入五类之一，未知 workflow 状态归入
`permanent_failure` 而**不折叠为成功**。测试对 10 个状态（含空串与未知值）断言
两次调用结果完全一致。

---

## 5. UI / Agent / Hermes MCP 同写入路径证明

用 `WorkspaceRepository.prototype` spy 记录实际被调用的方法：

**简历导入**（`confirmImportedResume`）：

| 路径 | 入口 | 结果 |
|---|---|---|
| UI | `ResumeImportWizard` 直接调用 repository | 1 次 |
| Agent | `AgentExecutor → Registry → service.commitResumeImport` | 2 次 |
| Hermes MCP | `CareerToolGateway.execute("career.resume.import.commit") → 同一 executor/service` | 3 次 |

**岗位提交**（`convertCandidateListing`）：

| 路径 | 入口 | 结果 |
|---|---|---|
| Agent | `Executor → Registry → service.commitJob` | 1 次 |
| UI | `ingestCandidateListing → parseCandidateToDraft → createConversionConfirmation(channel=jobs_workspace) → convertCandidateListing` | 2 次 |

三条简历导入路径共 3 次调用，全部落在同一个 `WorkspaceRepository` 方法；
两条岗位提交路径共 2 次调用，同样落在同一个方法。**没有第二套业务写入路径。**

需说明的既有事实：UI 写路径**不经过** `AgentToolRegistry` / `AgentExecutor` /
`CareerToolGateway`，它直接持有 `WorkspaceRepository`。因此统一的是**数据写入层**
（符合 v4-plan D8「唯一业务数据所有者」），**不是确认与校验层**。
Agent 导入后的 `external_event` 投影是纯状态归约，不执行工具。

---

## 6. 尚未满足商用要求的清单

| # | 项 | 级别 | 事实依据 |
|---|---|---|---|
| 1 | **管理投递记录** 无 Agent 能力 | 高 | Registry 48 个工具中 application 相关为 0；仅 UI 可维护 `ApplicationRecord` |
| 2 | **ATS 半自动填写** 无 Agent 能力 | 高 | 同上；`applicationDrafts` 表与 Repository 已就绪但无工具面；属 V4-P7 |
| 3 | **模拟面试** 未实现 | 中 | 无工具、无表；v4-plan D5 规定后置到 V4-P8 |
| 4 | UI 写入不经过确认/校验层 | 中 | UI 直接持 repository，绕过 `AgentExecutor` 确认闸与 `CareerToolGateway` 的 staging/eligibility；只有数据写入层统一 |
| 5 | 岗位定制会话刷新即失效 | 中 | `create_tailoring_session` 等 6 个能力为 `session_only`；刷新后整个定制会话需重建 |
| 6 | 三个 `risk: "read"` 工具写工作流状态 | 中 | `plan_resume_composition`、`reconcile_profile_intake`、`reconcile_resume_import`；已显式登记，改 `risk` 会变更已发布 MCP `safetyClass` 与 contract hash |
| 7 | `retryable_failure` / `permanent_failure` 此前不存在 | 中 | 已通过五分类归一补齐，但**没有改写** `AgentTaskStateReducer` 里 `recoverable → waiting_for_user / !recoverable → failed` 的既有行为；状态机仍用旧词汇 |
| 8 | `v4-plan.md` §5.4 待确认协议未完全实现 | 中 | 缺 `affectedRecords`、`requiredUserChoice`（代码中不存在这两个字段）；`ConversionConfirmation` 已有 `confirmationId` + `expiresAt` + 一次性消费；`AgentConfirmation` 无过期时间 |
| 9 | 岗位定制写入需真实 AI Provider 才能端到端验收 | 中 | `apply_tailoring_changes` 的 writer 与 `compose_resume` 的 `CareerResumeWritingService` 依赖 provider；本阶段只认证了其确认闸、revision 门禁与资料库隔离，未取得真实 provider 生成结果 |
| 10 | `v2-g4a` 定位器与当前 UI 不一致 | 低 | v4-plan §0.0 第 3 项遗留测试债，本阶段未触碰 |

---

## 7. 门禁记录

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm lint`（`--max-warnings=0`，全量） | 通过 |
| `pnpm test`（全量 Unit/Integration） | `210 files / 1531 tests` 全部通过（基线 `207 / 1497`，只增不减） |
| V4-P2 系列定向 | `7 files / 96 tests` 全部通过 |
| V4-P2-C 新增 | `3 files / 34 tests` |
| `pnpm build` | 通过 |
| `git diff --check` | 通过 |

未执行：Playwright 四分片、C1/C2、Electron Release Gate、真实 provider E2E。
本报告不将确定性契约认证等同于全站发布通过。

`next-env.d.ts` 的单行改动是 `pnpm build` 生成的产物 churn
（`./.next/dev/types/routes.d.ts` → `./.next/types/routes.d.ts`），不属于本阶段源码变更，
提交前应排除。

---

## 8. 数据语义与边界变化

- **数据语义**：无。Domain Schema、Fact Guard 阈值、Resume Schema v2、
  ApplicationStatus 状态机、五张 V4 表结构、Dexie version（仍 v11）均未改变。
- **新增表**：0。
- **新增生产依赖**：0。
- **工具面变化**：`agentToolNames` 补齐 `retrieve_career_context`（修复既有漂移）；
  `commit_resume_import` 的 `existing` 模式新增可选 `createGeneralResume`。
- **确认边界**：未放宽。`commit_job` 的 Agent 通道绑定校验、`commit_resume_import`
  的确认闸、`apply_tailoring_changes` 的确认写入均保持 P2-B 及更早阶段的行为。

## 9. 下一阶段前置条件

V4-P2-D（若继续）应从下列任一入口开始，且仍不得重写 P2-B：

1. 为 `ApplicationRecord` 补 Agent 能力面（对应 §6.1 第 1 项），复用
   `updateApplicationAssistStep` 的 `userAction` 门禁。
2. 或进入 V4-P3（官方 API / ATS 公开来源），前提是先补 §5.4 待确认协议中缺失的
   `affectedRecords` 与 `requiredUserChoice`。