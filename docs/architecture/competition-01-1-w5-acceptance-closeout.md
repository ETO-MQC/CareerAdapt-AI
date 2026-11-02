# COMP-01.1 — W5 Acceptance Closure / Run State Contract Reconciliation

2026-11-02。**W5 CLOSED（限 COMP-01 当前职业工作流验收范围）**。J1–J10 均有通过证据；通用上游授权为 NOT_APPLICABLE，实际交互仍 UNVERIFIED。这不是全库测试全绿或 Release Gate。

## 基线与范围

fetch 成功，起始分支 competition/5.1.8；HEAD 与 origin/competition/5.1.8 均为 `65d6db96f0e3dd682a2dd017d82b0d6621d9fb83`，工作区干净。核对 log -10、worktree list；未导入 main/5.2.1。只修改测试、报告和本地交接，无生产源码/Fixture/Runtime/Host/Repository/Schema/依赖变化。未调用真实 Provider、未读真实用户数据、未打包。机器摘要：[acceptance-evidence.json](competition-01-1-w5-acceptance-evidence.json)。

## 原始失败与根因

在未修改的冻结 COMP-01 HEAD、隔离端口 3029 上运行：

`pnpm exec playwright test tests/e2e/agent-workspace.spec.ts --grep 'keeps the current tailoring facade' --reporter=line`

退出 1，原第 386 行 `getByText("正在处理").toBeVisible()` 超时；原日志 `.tmp/comp011-original-repro.log`，原页面快照 `.tmp/comp011-original-error-context.md` 保留。历史 COMP-01 的失败和 evidence 未覆盖。

结论是**旧测试契约过时，不是本轮发现的生产状态转换错误**，具体有三层：

1. 之前 Fixture 提前 completed、尚未交付 Tool Events 的缺陷已在 COMP-01 修正；本轮冻结 Fixture 保持 running，直到构造/交付含 tool.started/tool.completed 的事件响应。本轮无需再修改 Fixture。
2. 工作流 `waiting_for_user` 与 Hermes 单次 invocation `completed` 可以同时成立。原测试先断言等待用户，再强求忙碌文案，混淆了两者。`/resume` 在 AI 模式下是资产页，没有 AgentWorkspace 顶部 status；该页真实入口是侧栏“任务状态：等待输入”。返回 AI 工作区后才显示“等待你回答”。
3. 原读取助手把 localStorage 键写成 `careerad.agent.activeSessionId`，真实键是 `careeradapt.agent.activeSessionId`；旧 fallback 可能读到空白会话。原 PDF 断言还把文件选择（待发送附件）当成已解析；当前流程明确要求用户发送，故替换为附件预览入口、PDF 待发送、没有“简历已解析”的正反验证。原文件选择、产物打开/关闭/保留、URL 断言保留。实际解析/PDF 的覆盖仍来自 COMP-01 真实 Hermes M 证据，不将待发送测试冒充导入认证。

## Host / Runtime / Checkpoint / UI 对照

| 时点 | Runtime | Host/持久化权威 | UI |
| --- | --- | --- | --- |
| 启动 | fixture run_start → running，Tool Events 后 completed | Host 处理工具结果投影 TaskState | 执行期显示 running，随后等待 |
| 选择来源前 | Run 1 completed | activeTurn waiting_for_user；TaskState choose_resume_source / waiting_for_user；resume_choice active | 询问通用简历来源 |
| 用户回答“测试通用简历”后 | Run 2 completed | 同一 Session、新合法 Turn；choose_job / waiting_for_user；clarification active | 等待岗位输入 |
| /resume | 原 Run 2 completed，不启动新 Run | 相同 Session 的 waiting_for_user | 侧栏“等待输入”，没有“正在处理” |
| 返回与刷新 | 保持 Run 2 completed | Session/Turn/Run/Checkpoint 读回一致 | 顶部“等待你回答”，无 thinking/streaming |

实际 source/job Session ID、Turn ID、Run ID 与正式业务表 SHA 见机器证据。两个快照业务表 SHA 相同；测试直接比较 profiles/resumeBranches/resumeRevisions/jobDescriptions 全行内容，包含既有演示数据，不能将原有行误称本轮新增。首次输入 1 个 Run、回答后合计 2 个 Run；导航与刷新后仍为 2。用户回答推进原任务允许新 Turn/Run，禁止的是同一个输入被重复启动，并非要求跨用户 Turn 永远复用一个 Run。

源码依据：`AgentHostStore.prepareWorkflowCheckpointTextInput` 将 resume_choice 转为 typed entity selection；`applyTypedEntitySelection` 推进 choose_job；`applyCareerWorkflowFacadeTaskProjection` 接收 facade waiting 状态；终态事件分支依 terminalWaiting 保存 activeTurn 和 Host turnStatus 为 waiting_for_user。`workflowUserInputCheckpoint` 从 TaskState 派生检查点，不另建状态机。`AgentWorkspace` 通过 useSyncExternalStore 订阅 Host/Runtime，检查点优先投影等待；`agentRunPresentation` 保持 waiting_for_user 与 running 区别。当前 Run 以 careerAgentSessionId/turnId 绑定；旧 Turn handle 不覆盖新 Turn 的投影。

## 修复及验证

生产代码零改动。两条旧 E2E 用真实页面可见状态替换旧忙碌断言，并增加持久化 Session/Turn/Run/Checkpoint、正式业务表不变、准确 Run 数、返回/刷新及无残留 Loading 断言。新增 2 个参数化单测：Host 等待用户时，Hermes running/completed 均保持等待；真正 running 仍可 Stop。

- 原始冻结复现：1 失败，退出 1，保留。
- 中间诊断 `.tmp/comp011-reconciled-e2e.log`：发现资产页没有顶部 status、原 helper 键错误；未盲目延长 timeout。
- `.tmp/comp011-final-e2e.log`：暴露新合法回答 Run 应为 2，以及 PDF 尚未发送的旧假设；未把两者改造成生产行为。
- 最终 `.tmp/comp011-contract-e2e.log`：上述两条完整场景 2/2 PASS，18.0s，退出 0。之后仅精简 console 摘要（不打印业务内容）与恢复原 LF，执行逻辑未变。
- 相关 Unit/Integration：`comp01WorkspaceInteraction.test.tsx core02SessionCheckpoint.test.ts p45c5-codex-agent-interaction-rebase.test.ts agentTailoringContextResolution.test.ts hermesTerminalReconciliation.test.ts`，5 文件 58 PASS，退出 0；日志 `.tmp/comp011-unit-final.log`。
- 修改前及最终 `pnpm typecheck`：退出 0；`pnpm lint` 全库退出 0；`git diff --check` 退出 0。
- 无生产构建边界变化，复用 COMP-01 build，未重跑 build、全历史 Playwright、长延迟门禁或视觉矩阵。

扩展检查中，未修改的 `p44e-long-run-workflow.test.ts` 有 1 个历史失败：SSE mock 未返回有效 run_status，实际多出 `progress {reconciliation: status_unavailable}`，精确数组旧断言失败；同次其余 51 项通过，退出 1，见 `.tmp/comp011-unit.log`。该 transport/test 在本轮和起始 HEAD 内容相同；不删除断言、不纳入本轮无关修复。它不使已通过的 W5 定向场景失效，但全库全绿仍不可宣称。

## 通用上游授权只读审计

锁定 `scripts/hermes-runtime-lock.json`：Hermes 0.19.0 / `eb52760564dbba2e5971fa54bd67384e281cd3b8`，patch `careeradapt-api-toolsets-selection-amd-efficiency-v4`。实际读取已有 bundled runtime 的 runtime-manifest 与 source，身份相同；没有根据上游最新版推断能力，也未重新构建 bundle。

- bundled `gateway/platforms/api_server.py` 的 `_approval_notify` 发出 `approval.request`，含 run_id、脱敏 command、choices；Run 变 waiting_for_approval。`_handle_run_approval` 接受 once/session/always/deny，通过 approval session key 调用 resolve_gateway_approval；无活动请求返回 409，成功恢复 running / approval.responded。触发源包括危险命令授权和 MCP elicitation（`tools/mcp_tool.py`）。
- CareerAdapt transport 映射 approval.request；API route 的 run_approval 代理 POST `/v1/runs/{id}/approval`；Runtime.approve 仅向用户布尔决定映射 once/deny。Runtime 收到请求后退出当前事件迭代；Provider 的 confirmation 分支 approve 后使用 reattachRunId 继续同 Run。
- Host 把 approval_required 映射为现有 pendingConfirmation 卡片；这是接口链路存在的静态证据，不是通用授权交互认证。对危险命令/elicitation 的文案、身份绑定、允许的 choices、拒绝、刷新与续跑尚未实测，不宣称可普遍安全适配。
- 生产 `HermesCareerToolCatalog.HERMES_PRODUCTION_TOOL_PROFILE` 仅职业 workflow facades + context/profile/resume/job 读取。CareerToolGateway workflow facade confirmationPolicy=none，职业写入走自己的用户业务 Confirmation/MCP pending-write；CareerAdapt MCP 服务没有 elicitation/create 请求路径，也没有危险 shell 工具。默认 Companion toolsets 为 skills/careeradapt。显式 developer/Power 或额外 MCP/完整工具集不在此结论范围，保留其能力与未认证风险。

**结论：NOT_APPLICABLE（仅当前生产职业工作流）。通用授权实际交互 UNVERIFIED。** 业务 Confirmation 已由 COMP-01 I/M 证据验证，不等同于上游通用授权。未添加假按钮、未模拟成功。后续若单独验收 Power/完整工具集，需真实 approval.request→允许/拒绝→同 Run 继续→刷新恢复的独立门禁，并验证卡片准确呈现命令/来源/可用决定；本轮不实施。

## W5 逐项结论

| 子项 | 状态 | 证据 |
| --- | --- | --- |
| J1 新建会话 | PASS（复用） | COMP-01 normal/new-task/browser |
| J2 文件上传 | PASS（复用+补验） | COMP-01 附件持久化/真实 M；本轮明确待发送状态 |
| J3 执行/流式 | PASS（复用） | COMP-01 真实 Hermes A/G/M/I；本轮 running/waiting 投影单测 |
| J4 询问/选择 | PASS（补验） | 本轮来源回答→同 Session choose_job；等待状态与刷新 |
| J5 业务确认/续跑 | PASS（复用+补验） | COMP-01 I/M 正式写入与 PDF；本轮来源回答合法新 Turn、无重复 Run/写入 |
| J6 Stop/Cancel | PASS（复用） | COMP-01 short delayed，取消迟到隔离/无 spinner |
| J7 编辑/分支 | PASS（复用） | COMP-01 edit/regenerate/history/隔离 |
| J8 刷新恢复 | PASS（补验+复用） | 本轮等待岗位刷新保持；COMP-01 同 Run reattach |
| J9 Artifact/PDF | PASS（复用） | COMP-01 真实 M 正式 PDF/产物面板；本轮保留面板行为 |
| J10 响应式/主题 | PASS（复用） | COMP-01 8 组合与真实 1024 overlay；无 UI 改动 |
| 通用上游授权 | NOT_APPLICABLE | 当前职业工具无触发路径；实际交互 UNVERIFIED |

W5 的旧模拟流程阻塞已消除，可在上述范围关闭。OPEN：通用授权实际交互认证；历史 SSE fixture 单测；真实 Provider 时延/全历史回归/180 秒长测不属本轮认证。未自动进入 COMP-02/SQ1/性能/OCR/安装包或其他阶段。

## Git 交付

单独提交并普通推送 competition/5.1.8；最终提交身份由 Git/本地 plan4/history4 和交付回复记录（文档不内嵌自身 commit hash）。main 与其他工作区不动。停止等待用户审阅。
