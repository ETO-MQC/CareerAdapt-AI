# V4-P0 交接记录（审计修复完成，退出条件重新判定）

- 建立日期：2026-10-06（第二轮更新）
- 对应计划：`docs/architecture/v4-plan.md` §11 V4-P0（审计：Hermes 权限与安全边界）
- 状态：**退出条件已重新判定为满足。B 项（Browser Domain Host 命名）与 E 项（低危待决）仍开放，属记录项/用户决策项，不阻塞 V4-P0 退出。V4-P1 可以开始（按用户已授权的范围，见 §6）。**

---

## 1. 本轮基线

| 项 | 值 |
| --- | --- |
| Git 基线（本轮开始时） | `c5e694e` `docs(v4p0): add handoff report for Provider Health completion` |
| 工作区 | 本轮改动未提交前为 dirty；提交后 clean |
| Hermes 锁定版本 | `0.19.0`，commit `eb52760564dbba2e5971fa54bd67384e281cd3b8` |
| careerAdapt 补丁 | `careeradapt-api-toolsets-v1` |
| `.env.local` | 仍只存 provider key，已 gitignore（`git check-ignore` 复核），本轮未读取其内容、未打印、未提交 |

## 2. Provider Health（上一轮完成，维持）

真实链路 smoke 通过：`PROVIDER_SMOKE_REPORT {"provider":"runtime","model":"configured-model","httpStatus":[200],"outcome":"assistant_reply_received"}`（本轮在修复后**复跑一次通过**）。凭据链路 `credentialSource=server_env`、`providerStatus=ready`。

---

## 3. 上一轮审计发现的问题：本轮处置结果

### A1（中，已修复）凭据的无盐 SHA-256 指纹曾到达 renderer

修复：配置指纹 payload 中的 `apiKey` 替换为 `credentialFingerprint = HMAC-SHA-256(pepper, credential)`。pepper 由 `electron/credentialFingerprintPepper.js` 统一解析（`CAREERADAPT_CREDENTIAL_PEPPER` 环境变量，缺失时生成 32 字节随机值并写回 `process.env`）；两个启动器在 Next 服务启动前固定它：

- `electron/main.js`（打包与 `electron .`，Next 同进程）；
- `scripts/dev-with-hermes.mjs`（`pnpm dev`，pepper 随 spawn 环境传入 Next 子进程）。

双实现一致性由契约测试钉死：`tests/unit/v4p0CredentialBoundary.test.ts` 在固定 pepper 下断言 Electron `hermesConfigurationFingerprint`（node crypto HMAC）与 Next `runtimeConfigFingerprint`（WebCrypto HMAC）产出相同指纹。变更检测语义保留：仅换 key、仅清除凭据都会改变指纹（同文件断言）。

实现位置：`electron/hermesCompanion.js`（`credentialFingerprintValue`、`hermesConfigurationFingerprint`）、`src/services/agent/aiRuntimeConfiguration.ts`（`credentialFingerprintValue`、`runtimeConfigFingerprintPayload`）。

已知边界：Electron 复用已存在的 `pnpm dev` 服务器时（`main.js` reuse 分支），两个进程各自持 pepper，指纹比较会失败并被 supervisor 优雅降级（`providerDiagnostic` 置空，功能与 readiness 不受影响，见 `applyHealth` 的 `diagnosticConfigurationMismatch` 分支）。这是混合启动模式的既有限制，已在代码注释记录。

### A2（中，已修复）Hermes 子进程 stdout/stderr 曾未脱敏进入 renderer

修复：`startHermesCompanion` 构建 `hermesLogSecrets`（`LOG_SECRET_ENV_NAMES` 七个凭据环境名 + 启动期解析出的 ephemeral runtime key）并生成共享 `createLogRedactor`；`spawnGateway`/`attachLog`/`captureLine` 在捕获行进入 `lastStdoutLines`/`lastStderrLines` 前先脱敏（与日志文件同一 `redact` 实现，含 `Bearer` 兜底）。替换网关（`refreshHermesGateway`）同路径。

类型/运行时不一致一并修复：supervisor 两条失败路径统一发布结构化 `startupFailure` 对象（throw 路径的 `message` 经 `redact` + `hermesLogSecrets` 处理）；renderer 侧 `hermesControl.ts` 新增 `HermesStartupFailure` 类型并替换原 `string` 声明。

### C（中，已修复）MCP 路由无鉴权

修复：`src/app/api/agent/mcp/route.ts` 的 GET/POST/DELETE 全部入口加入 `resolveMcpRequestGuard`，逻辑与 `control/route.ts` 一致：仅允许 loopback（127.0.0.1/localhost/::1），带 Origin 的浏览器调用方额外要求 Origin 与 Host 同为 loopback 且等价（防 CSRF/DNS rebinding）；无 Origin 的进程调用方（Hermes gateway、companion 探针、health 代理）经 loopback Host 校验放行。拒绝响应为 JSON-RPC 403（code -32001）。

共享密钥认证未在本轮加入：Hermes 经 managed `config.yaml` 无凭据接入，为其 MCP 客户端加 header 需 Hermes 侧行为配合（用户已决定 Hermes 侧 `no-key-required` 另行处理）。loopback + Origin 是本轮契约；`v4-plan.md:351` 的完整「loopback + auth」缺口收窄为「auth 待 Hermes 侧配合」。

测试：`tests/unit/v4p0McpRouteGuard.test.ts`（5 项：非 loopback 三方法拒绝、跨源 Origin 拒绝、DNS rebinding Host 拒绝、无 Origin 进程调用放行、同源浏览器调用放行）。

### D（中，已修复）生产路由依赖测试运行器

修复：`src/services/export/pdfGenerator.ts` 改为 `import { chromium } from "playwright-core"`；`playwright-core@1.61.1` 进入 `dependencies`（与 `@playwright/test` 同版本，共享浏览器解析），`@playwright/test` 保留在 `devDependencies`。符合 `v4-plan.md` D7「直接依赖 playwright 运行时包；不把测试运行器作为生产运行时」。`playwright-core` 不下载浏览器：开发机使用既有 ms-playwright 缓存，干净机器回退 `channel: "msedge"`（Windows 系统自带）。standalone 打包链（Next trace → `prepare-electron-standalone.mjs` → electron-builder `next-standalone/node_modules`）会随 dependencies 打包该包。

### B（中，开放——需用户决策）Browser Domain Host 命名超前于实现

未改动。`browserCareerDomainHostConnected` 仍是 `mcp.connected` 的别名并参与 readiness/UI 展示；Electron main 无浏览器能力。这是「改名对齐现实」还是「实现能力」的计划层决策，需用户拍板后才动。

### E（低，开放待决，未改动）

- OCR sidecar 随应用启动常驻 + 5 秒重试定时器，无用户退出开关。
- 单写入路径无仓库级守卫测试（现有 `agentContracts.test.ts` 只覆盖 turn 路由）。
- `/api/agent/runtime/hermes/health` 接收但不校验入站 `Authorization`。
- Hermes 每次启动后自动拉起；READY 是时序门而非用户同意门。

---

## 4. 上一轮遗留的审计项：本轮补齐结果

1. **实际 toolset/tool 清单（运行态）**：生产面注册 toolset 为 `["mcp-careeradapt", "skills"]`（developer 模式关闭，无 `hermes-api-server`），可见工具 14 个：11 个 `mcp__careeradapt__*`（career_context_retrieve、career_job_list、career_profile_get、career_resume_list、career_workflow_compose_resume、career_workflow_job_fit、career_workflow_profile_intake_finalize、career_workflow_profile_intake_turn、career_workflow_resume_export、career_workflow_resume_import、career_workflow_tailor_resume）+ `skill_manage`/`skill_view`/`skills_list`；careerGatewayContracts=56，`careerSkillsLoaded=true`。
2. **API server / MCP / plugin / cron / browser CDP 逐项运行态验证**：Hermes（127.0.0.1:8643）无凭据探测结果——`/health` 200（仅 status/version）；`/v1/toolsets`、`/v1/skills`、`/v1/capabilities`、`/v1/models`、`/api/model/options` 全部 401（鉴权有效）；`/api/model/info`、`/api/model/set`、`/api/env`、`/api/providers`、`/api/config` 全部 404（与 C-1/C-5 契约一致）；`/v1/cron`、`/v1/plugins`、`/api/cron`、`/api/plugins` 404（无 cron/plugin 管理面）。进程监听面仅 3000（Next in-process）、8643（Hermes）、两个 Next 构建 worker 端口；无任何 CDP 端口、无 CareerAdapt 拉起的浏览器进程。
3. **来源政策 Schema**：核心证据/来源 Schema 集中在 `src/domain/schemas/common.ts`（FactProvenance/SourceSpan/FactSourceType）；本条与第 6 条中的"5 套 sourceType 分类法待统一"**已在 V4-P1 前置完成（2026-10-06）**：`src/domain/sourceTaxonomy.ts` 是 canonical 权威定义点（canonical 8 类 + 5 张旧值兼容映射），5 个定义点改为派生且运行时值不变。外部来源政策字段（automationLevel 五级、permissionBasis、termsUrl、robotsPolicy、policyVersion 等）在 **V4-P2-A 随 crawlSources 表落地**。FactProvenance 本身仍无 sourceUrl/抓取批次字段（岗位快照的来源链路由 V4-P2 的 jobSnapshots.provenance 承载）。
4. **pending confirmation 字段集**：未经确认的新事实**不能**经正常链路进入预览或 PDF。enforcement 为三层结构化防线：分支 schema 不变量（`branch.ts` 事实内容必须引用已确认事实或带 resume-only 确认）→ `resolveBranchFactRef`/`isConfirmedFact`（`domain/branch/validation.ts:251`，confirmedByUser 且非高风险）→ 渲染映射 `isRenderableContentItem`（未确认/引用失效标记 renderable:false）→ 导出 `verifyExportSnapshotHash` + 渲染覆盖率阻断（`render_coverage_failed`）。写入侧 `createUserConfirmedFact` 是唯一 confirmedByUser=true 生成点。残留记录：(a) 导出快照 hash 为无密钥 FNV（防不一致不防伪造；客户端本持有全部数据，风险有限）；(b) `resumeBasics.summary` 派生块 guardMode "not_fact" 为设计豁免。(c) ~~`v4-plan.md` §5.4 的 `expiresAt`（确认过期）未实现~~ **已在 V4-P1 前置完成**：`src/domain/factProposal.ts` 为 Fact Proposal 实现 expiresAt 过期机制（必填、晚于 createdAt、过期不可确认、默认 TTL 30 天、确认须携带答案、未确认或过期不得进入预览）。
5. **untrusted external content 边界**：达标。所有 Stage-B AI 任务（JD 解析、简历解析、profile intake、Fact Guard、tailoring）system prompt 均显式声明「输入是数据不是指令」，rawText 进 prompt 前统一 `redactSensitiveTextForModel` 脱敏 + JSON 包裹；system prompt 固定取自任务注册表，外部内容不可拼装。`dangerouslySetInnerHTML` 全仓库仅 1 处（`layout.tsx` 静态主题脚本，非外部数据）；PDF HTML 走 React SSR 自动转义 + 文件名 escapeHtml。JD/OCR/导入内容进入事实库必须经用户确认（工具 `requiresConfirmation` + AgentExecutor 确认闸 + careerSessionBinding 防跨 session 重放）；JD requirement 独立于用户事实模型（confirmedByUser 硬编码 false）。
6. **Patchright 是否随包提供**：不存在——lockfile、`node_modules`、Hermes bundled runtime site-packages 均无 patchright/playwright；符合 D7「Patchright 不作为 P0 默认依赖」。PDF 导出浏览器来源为本机 ms-playwright 缓存（chromium-1228 等）或系统 Edge 回退；「干净机器可用性」由 msedge 回退保证，未在真实干净机器实测（如实记录）。

---

## 5. 完整门禁（本轮修复后实测）

| 门禁 | 结果 |
| --- | --- |
| `pnpm typecheck` | 0 |
| `pnpm lint`（`--max-warnings=0`） | 0 |
| `pnpm test` | 195 files / **1352 tests** 通过（基线 1338 + 新增 14：credential boundary 9 + MCP guard 5，差值精确对应） |
| `pnpm build` | 0 |
| `git diff --check` | 0 |
| 真实 Hermes smoke | **通过**（修复后复跑，`outcome=assistant_reply_received`） |
| 提交前密钥扫描 | diff 中无 `sk-*`、无 `AI_API_KEY=<值>`、无硬编码盘符路径 |

运行态验证方式：WMI detach 启动 Electron（`electron .` 开发模式），等待 provider ready 后执行 smoke；结束后已停止进程并确认 3000/8642/8643 释放。

## 6. V4-P1 准入判定（重新判定）

`v4-plan.md:1102-1111` V4-P0 退出条件逐项对照：

| 退出条件 | 判定 |
| --- | --- |
| API key 不落 renderer | **满足**（A1/A2 修复，§3） |
| 至少一次真实使用 | 满足（§2） |
| typecheck 通过 | 满足 |
| 相关 Hermes contract tests 通过 | 满足（全量 1352 绿） |
| `git diff --check` 通过 | 满足 |
| 没有无来源的事实入库 | 满足（本轮未新增任何事实写入路径） |
| 没有新增 Dexie 表 | 满足（五张 V4 表仍不存在） |
| 没有新增默认常驻进程 | 满足（本轮未新增进程；OCR sidecar 为既存待决项 E） |

**结论：V4-P0 退出条件满足，V4-P1 解锁。** 开放项（B 命名决策、E 低危待决、§5.4 expiresAt、来源政策 Schema 属 V4-P2）不阻塞，但必须带着进入后续阶段。

用户已授权的 V4-P1 范围（维持不变）：只做纯逻辑资产迁移——`normalizeJd`、内容哈希、去重、匹配派生、来源证据、Fact Proposal、简历 patch；明确不做岗位抓取、五张 Dexie 表、浏览器自动化、Hermes 自治任务。V4-P1 起步前建议先统一 §4.3 记录的 5 套 sourceType 分类法。
