# V4-P0 交接记录（Provider Health 已完成，V4-P0 未完成）

- 建立日期：2026-10-06
- 对应计划：`docs/architecture/v4-plan.md` §11 V4-P0（审计：Hermes 权限与安全边界）
- 状态：**进行中。Provider Health 子任务已完成；V4-P0 整体尚未完成，不得进入 V4-P1。**

---

## 1. 本轮基线

| 项 | 值 |
| --- | --- |
| Git 基线 | `1b94b0a` `feat(v4p0): secure provider credentials and formalise the config restart fallback` |
| 工作区 | 提交后 clean |
| Hermes 锁定版本 | `0.19.0`，commit `eb52760564dbba2e5971fa54bd67384e281cd3b8` |
| careerAdapt 补丁 | `careeradapt-api-toolsets-v1`，patchHash `9282462307b1…` |
| Python | `3.11.13` |
| 锁定来源 | `scripts/hermes-runtime-lock.json` + `.electron-build/hermes-runtime-v4/runtime-manifest.json`（两者一致） |

**运行时默认值与本机配置的差异（设计如此，非缺陷）**：`runtime-manifest.json` 的 `providerBaseUrl` / `model` 仍是 `token-plan-cn.xiaomimimo.com` / `mimo-v2.5-pro`，而本机 `.env.local` 指向另一 provider。`electron/main.js:114-115` 只在 `AI_BASE_URL` / `AI_MODEL` **未设置**时才采用 manifest 默认值，因此 env 优先。记录此项以免后续把 manifest 值误当作当前生效配置。

---

## 2. Provider Health：已完成

| 验收项 | 证据 |
| --- | --- |
| 真实链路跑通 | `PROVIDER_SMOKE_REPORT {"provider":"runtime","model":"configured-model","httpStatus":[200],"elapsedMs":10245,"outcome":"assistant_reply_received"}`，`renderer → Next → Hermes gateway → provider` 返回正确回复 |
| 凭据链路 | `credentialSource=server_env`、`credentialConfigured=true`、`providerStatus=ready` |
| `/api/model/info` 404 | gateway 不提供该端点；`nativeModelConfigSupported` 为非真，apply 走重启回退，已由 `tests/unit/v4p0NativeConfigFallback.test.ts` 固化 |
| config.yaml 无明文密钥 | 结构性保证：`ensureManagedHermesConfig` 只写固定字段白名单，`key_env` 只写环境变量**名**；两种 binding 分支均写真实文件断言 |
| API key 不落 localStorage / header | `writeAiSettings` 结构性丢弃 `apiKey`；旧明文一次性擦除；header 编解码均不含凭据 |
| 完整门禁 | typecheck 0、lint 0、193 files / 1338 tests、build 0、`git diff --check` 0 |
| 新增测试 | 22 项（store 7、storage/header 7、route 契约 3、404 回退 5） |

一次失败已归因且不计入本轮：先前 `stealth/space-bunny-alpha` 已从 provider 下架（`/models` 200、464 个模型、0 匹配），属 provider 侧变更，与本轮改动无关。

---

## 3. V4-P0 剩余审计：结论

### 3.1 已核实为「符合」

| 审计项 | 结论与证据 |
| --- | --- |
| Git 基线与最新修复点 | 见 §1 |
| Hermes 运行时版本 | `0.19.0`，lock 与 manifest 一致 |
| renderer 不接触 `API_SERVER_KEY` | 该键仅出现在 Electron main 与 Node route；renderer、IPC 返回值、API 响应体中均无。`runtimeControlKeyFingerprint` 只写 stderr，且需 `CAREERADAPT_RUNTIME_AUTH_DIAGNOSTICS=true` |
| `safeControlReason` | `main.js:588-591` 只取 `error.code`，白名单字符 + 120 截断，从不转发 message |
| Dexie 唯一写入路径 | 单例 `careerAdaptDb` 仅被 `WorkspaceRepository` 引用；Next/MCP 进程零 Dexie 访问；23 张表、schema v10 |
| 未新增 Dexie 表 | `crawlSources`/`jobListings`/`jobSnapshots`/`crawlRuns`/`applicationDrafts` 均不存在 |
| `ResumeDocument` 只派生 | 唯一产出 `mapBranchToResumeDocument`，无 `resumeDocuments` 表 |
| Hermes 不默认抢跑 | `rendererReady` 门禁在 `hermesSupervisor.js:177/214`；仅在 renderer MCP READY 后启动 |
| Chromium 不常驻 | 唯一启动点是 PDF 导出 `pdfGenerator.ts:203`，按需 |

### 3.2 未完成 / 未达标（阻塞 V4-P0 退出）

**A. `API key 不落 renderer` 尚未真正满足 —— 两处泄漏面**

这两项使我在交付说明中给出的「API key 不落 renderer」结论**过强**，此处更正。

- **A1（中）凭据的未加盐 SHA-256 指纹被送往 renderer。**
  `electron/hermesCompanion.js:632-639` 的 `hermesConfigurationFingerprint` 把 `apiKey` 一起哈希，产出完整 64 位十六进制。该值经 `runtimeConfigSnapshot()`（`hermesSupervisor.js:388-389` 的 `activeFingerprint`/`desiredFingerprint`）和 `providerDiagnostic.configFingerprint` 到达 renderer。它是无盐派生值，不应作为「安全」暴露。

- **A2（中）Hermes 子进程 stdout/stderr 未脱敏即进入 renderer。**
  `captureLine`（`hermesCompanion.js:850-854`）直接 `String(line)` 入数组，不做脱敏；对比 `writeLog` 走 `createLogWriter` → `redact`。这些原始行经 `createStartupFailure` 的 `lastStdoutLines`/`lastStderrLines` 进入 `handle.startupFailure`，再由 `hermesSupervisor.js:1060,1076` publish 给 renderer。若子进程在启动错误中回显密钥，即为无脱敏传输通道。另存在类型/运行时不一致：renderer 侧 `hermesControl.ts:265` 声明为 `string`，main 可能推送对象。

**B. Browser Domain Host 尚未存在，但已被当作既存能力使用（中）**
`browserCareerDomainHostConnected` 只是 `mcp.connected` 的别名（`health/route.ts:241`、`runtimeStatus.ts:115`），却参与 `hermesSupervisor.js:1245` 的 `careerMcpReady` 门禁、readiness 判定，并在 UI 以「Browser Career Domain Host」展示（`AgentWorkspaceLayout.tsx:254`）。Electron main 不启动任何浏览器、无 CDP 能力；`electron/` 下无 `playwright`/`patchright`/`puppeteer`。属命名与语义超前于实现。

**C. MCP 路由无鉴权（中）**
`src/app/api/agent/mcp/route.ts:76-130` 无密钥、无 loopback/Origin 校验，而 `v4-plan.md:351` 声称「loopback + auth」。Hermes 通过 managed `config.yaml`（`hermesCompanion.js:293-308`）无凭据接入。目前仅靠工具层 binding/confirmation 兜底。

**D. 生产路由依赖测试运行器（中）**
`src/services/export/pdfGenerator.ts:1` 在生产 API 路由中 `import { chromium } from "@playwright/test"`，而该包在 `devDependencies`（`package.json:58`）。与 `v4-plan.md:316-317`「不把测试运行器作为生产运行时」冲突。

**E. 其他（低）**
- OCR sidecar 随应用启动常驻，且有 5 秒重试定时器，无用户退出开关（`main.js:222-282,334-336`）。
- 单写入路径缺少仓库级守卫测试（`agentContracts.test.ts:86-91` 只覆盖 turn 路由）。
- `/api/agent/runtime/hermes/health` 接收但不校验入站 `Authorization`。
- Hermes 在每次启动后仍会自动拉起；READY 是时序门而非用户同意门。

### 3.3 尚待完成的审计项
- 实际 toolset/tool 清单（需运行态探测 `/v1/toolsets`、`/v1/skills`、`/v1/capabilities`）
- API server / MCP / plugin / cron / browser CDP 逐项运行态验证
- 来源政策 Schema、pending confirmation 字段集、untrusted external content 边界复核
- Patchright 是否随包提供

---

## 4. 后续小修（不混入已提交的凭据提交）

1. `src/services/agent/hermesControl.ts:682`、`:699` 与 `src/components/agent/workspace/AgentWorkspaceLayout.tsx:162`、`:164`、`:182`：应用进行中状态仍显示「正在应用模型…」，未对齐本轮设置页改为「正在重启 AI Agent…」。属文案一致性，不影响行为。

---

## 5. V4-P1 准入判定

**当前：不满足。** `v4-plan.md:1102-1111` 的退出条件中，至少两项未达标：

- 「API key 不落 renderer」→ A1/A2 未修复，**不满足**；
- 「至少一次真实使用」→ 已满足（§2）；
- 「typecheck 通过」「相关 Hermes contract tests 通过」「git diff --check 通过」→ 已满足；
- 「没有无来源的事实入库」「没有新增 Dexie 表」「没有新增默认常驻进程」→ 本轮未改动，暂无新增事实；OCR 常驻为既存项，已在 E 中记录待决。

因此**不进入 V4-P1**。修复 A1、A2 并补齐 §3.3 审计后重新判定。

---

## 6. 修复顺序建议

1. A2（启动输出脱敏）—— 通道性质，最高优先，且有 `redact` 可复用。
2. A1（凭据指纹）—— 改为对凭据做不可逆占位或排除 apiKey 参与哈希，保持 fingerprint 变更检测语义。
3. C（MCP 路由鉴权）—— 补 loopback + 与 `control/route.ts` 一致的校验。
4. D（PDF 导出依赖）—— 生产运行时不得依赖 devDependency 测试运行器。
5. B（Browser Domain Host 命名）—— 需先决定是改名还是实现，属计划层决策。
6. §3.3 运行态审计。