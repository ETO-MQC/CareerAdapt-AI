# 交接报告：V4-P0 Provider Health 已完成，V4-P0 未完成，V4-P1 未开始

面向接手本项目的下一个 AI。阅读顺序：本文件 → `AGENTS.md` → `docs/architecture/v4-plan.md` §11 → `docs/architecture/v4p0-audit-status.md`。

---

## 0. 三十秒结论

- **已完成**：V4-P0 的 Provider Health 子任务（真实 Hermes smoke + 完整门禁全绿），以及 Hermes 凭据安全重构（S-0…S-4）与配置重启回退固化（C-1…C-5）。
- **未完成**：V4-P0 整体。审计发现 **2 个中危泄漏面**使退出条件「API key 不落 renderer」实际**未达标**，另有 4 项中低危问题与 4 类审计尚未做完。
- **禁止**：V4-P1 尚未开始，且在 A1/A2 修复并重判前**不得开始**。

---

## 1. 当前仓库状态

| 项 | 值 |
| --- | --- |
| 工作目录 | `E:\DEF\CareerAdapt AI` |
| HEAD | `695fdb1` `docs(v4p0): record Provider Health completion and open audit findings` |
| 工作区 | **clean**，无未跟踪文件 |
| 运行时进程 | electron 0；端口 3000 / 8643 均已关闭（本轮已按要求停止） |
| Hermes 锁定 | `0.19.0`，commit `eb52760564dbba2e5971fa54bd67384e281cd3b8`，补丁 `careeradapt-api-toolsets-v1` |
| 本机 provider | `.env.local`（已 gitignore、未跟踪），Base URL `https://discovery-api.intern-ai.org.cn/v1`，model `deepseek-v4-flash-0731`，API key 只存在于该文件，**禁止打印或提交** |

近期提交（新接手者重点看前两个）：

```
695fdb1 docs(v4p0): record Provider Health completion and open audit findings
1b94b0a feat(v4p0): secure provider credentials and formalise the config restart fallback
579273b docs: add V4-P0 blocker remediation plan
b65a254 test(e2e): add opt-in real provider smoke for V4-P0
a762d81 docs: close the V4 preflight gate and open V4-P0
```

权威状态文档：`docs/architecture/v4p0-audit-status.md`（本轮新增，已提交）。

---

## 2. 本轮之前的历史背景（只需知道结论）

- V4 前置修复 P-1A…P-1F 已全部完成并通过交接门禁（189 files / 1316 tests 全绿），V4-P0 已解锁。
- Provider 401 事件的根因已查清：不是凭据失效，而是 Hermes 配置绑定漂移 + Hermes 使用 `no-key-required` 静默回退。
- 用户已明确决定（保持不变）：
  - A：旧目录 `careeradapt-ai-electron-shell` 迁移并保留时间戳备份；接受稳定定位文件 `%APPDATA%/CareerAdapt/hermes-home.json`。
  - B：本轮只做 CareerAdapt 侧缺凭据快速失败（B2.1）；Hermes 自身 `no-key-required` 另行处理。

---

## 3. 本轮已完成的工作（按用户逐条指令）

### 3.1 C 系列：配置回退

| 指令 | 结果 |
| --- | --- |
| C-1 保留现有重启回退路径 | 未改逻辑。仅在 `electron/hermesSupervisor.js` 两处入口加注释，说明 gateway 不提供 `/api/model/*`、`/api/env`、`/api/providers/*`，因此重启是**正常路径**而非降级 |
| C-3 加注释 + 回退契约测试 | 新增 `tests/unit/v4p0NativeConfigFallback.test.ts`（5 项） |
| C-4 设置页文案明确重启 | `src/app/settings/page.tsx`：段首文案改为「保存后由 AI Agent 重启并应用新配置…」；按钮 `保存并应用` → `保存并重启应用`；进行中态新增 `正在重启 AI Agent…`。对应测试选择器已同步更新（`p4.6d-ai-runtime-control-plane.test.tsx`） |
| C-5 不删除，只标注 | `electron/hermesModelConfigClient.js` 类注释新增「OPTIONAL, NON-DEFAULT」+ 已服务/未服务端点表 + 明确「不得据此判断能力」。**未删除任何代码** |

### 3.2 S 系列：凭据安全（顺序 S-0 → S-1 → S-3 → S-2 → S-4）

> 注意：S-1 与 S-3 在实现上必须原子。若 S-1 先停止持久化而 S-3 未接上，用户将无法录入密钥——这正是用户指令第 8 条警告的破坏性场景。二者按逻辑顺序记录、一次提交。

| 指令 | 结果 |
| --- | --- |
| S-0 主进程安全通道 | 新增 `electron/providerCredentialStore.js`：`safeStorage` 加密，base64 密文落盘，chmod 600；**无明文降级**（不可用时显式失败）。新增 IPC `describe/set/clear` + preload + 类型。`describe()` 是唯一跨到 renderer 的形状，不含密钥 |
| S-1 aiSettings 不落明文 | `writeAiSettings` 结构性丢弃 `apiKey`（字段不写出，而非写空串）；`readAiSettings` 永不返回密钥，并**一次性擦除**旧版本遗留的明文 |
| S-3 设置页走主进程 | 设置页与首次运行向导（`src/app/setup/page.tsx`）改走安全通道；不回显密钥；web 模式返回 `available:false` 并只读服务端环境 |
| S-2 停 header 传输 | `encodeAiSettingsForHeader` 不再输出 `apiKey`；`decodeAiSettingsFromHeader` 丢弃旧客户端送来的密钥。**header 结构本身保留**，仅去凭据 |
| S-4 清理 + 契约测试 | 新增 `tests/unit/v4p0ProviderCredentialStore.test.ts`(7)、`tests/unit/v4p0CredentialTransport.test.ts`(7)、`tests/unit/v4p0ProviderCredentialRoute.test.ts`(3) |
| 覆盖范围（指令 7） | 已覆盖 `/api/ai/test`、`/api/ai/structured`、Hermes control、`aiSettings`、`src/ai/client.ts`、Electron 主进程通道 |
| 桌面优先 / Web 只读（指令 9） | `electron/main.js` 启动时从安全存储读回密钥写入 `process.env.AI_API_KEY`（并置 `CAREERADAPT_CREDENTIAL_SOURCE=secure_store`）。因 Next 路由与 Electron main **同进程**（`main.js:296` 用 `require(serverPath)`，非 `spawn`），安全存储对路由直接可见，无需跨进程同步 |

### 3.3 验证中自查出的 3 个真实缺陷（已修）

1. **`updateConfig({credentialAction:"replace"})` 不带 apiKey 会清空凭据** —— `applyProviderEnvironment` 会把缺失的键置空。改为从安全存储读出密钥显式传入。
2. **provider 二次解析导致凭据来源被误标** —— 把已解析的 configuration 传入 `new OpenAiCompatibleProvider(...)` 会被再次解析，`sources.credential` 误判为 `custom_header`，诊断信息说谎。已给 `OpenAiCompatibleProvider` 构造函数增加第二参数 `resolved?: EffectiveAiConfiguration`，两处路由改为单次解析。
3. **首次运行向导会静默丢弃密钥** —— 它仍写 localStorage。已改走安全通道。

另修正：测试曾用假绝对路径（硬编码盘符日志路径），已改为 `tmpdir()` 运行时解析（用户要求 diff 内无绝对路径）。

### 3.4 一次与本轮无关的失败（已归因）

真实 smoke 首次失败：`.env.local` 原有模型 `stealth/space-bunny-alpha` 已从 OpenRouter 下架（`/models` 返回 200、共 464 个模型、0 个 space-buddy 匹配），Hermes 收到**鉴权通过**的 404 `No endpoints found`。用户提供新 provider/model 后通过。该失败与凭据改动无关。

另：`deepseek-v4-flash-0731` 是推理模型，`max_tokens` 过小会返回空 content（实测 `reasoning_tokens=34`）。

### 3.5 完整门禁（Provider Health 完成时的实测）

| 门禁 | 结果 |
| --- | --- |
| `pnpm typecheck` | 0 |
| `pnpm lint`（`--max-warnings=0`） | 0 |
| `pnpm test` | 193 files / **1338 tests** 通过（基线 1316，新增 22 项，差值精确对应） |
| `pnpm build` | 0 |
| `git diff --check` | 0 |
| 真实 Hermes smoke | **通过** |

真实 smoke 报告（脱敏）：
```
PROVIDER_SMOKE_REPORT {"provider":"runtime","model":"configured-model","httpStatus":[200],"elapsedMs":10245,"outcome":"assistant_reply_received"}
```
链路：`renderer → Next → Hermes gateway → provider → back`。运行期 `credentialSource=server_env`、`credentialConfigured=true`、`providerStatus=ready`。

---

## 4. 本轮审计发现的未解决问题（这是 V4-P0 未完成的真正原因）

`docs/architecture/v4p0-audit-status.md` §3 有完整证据。以下为要点。

### A. 「API key 不落 renderer」实际未达标（中危，阻塞退出）

> 这修正了我先前给出的过强结论。必须如实继承。

- **A1 凭据的无盐 SHA-256 指纹被送到 renderer。**
  `electron/hermesCompanion.js:632-639` 的 `hermesConfigurationFingerprint` 把 `apiKey` 一并哈希，输出完整 64 位十六进制。经 `hermesSupervisor.js:388-389` 的 `activeFingerprint`/`desiredFingerprint`，以及 `providerDiagnostic.configFingerprint` 到达 renderer。
- **A2 Hermes 子进程 stdout/stderr 未脱敏即进入 renderer。**
  `captureLine`（`hermesCompanion.js:850-854`）直接 `String(line)`，不脱敏；对比 `writeLog` 走 `createLogWriter` → `redact`。这些行经 `createStartupFailure` 的 `lastStdoutLines/lastStderrLines` → `handle.startupFailure` → `hermesSupervisor.js:1060,1076` publish 给 renderer。若子进程在启动错误里回显密钥，即为无脱敏通道。
  附带：renderer 侧 `hermesControl.ts:265` 把 `startupFailure` 声明为 `string`，main 可能推送对象（类型/运行时不一致）。

### B. Browser Domain Host 尚不存在，却已按既存能力使用（中危）

`browserCareerDomainHostConnected` 只是 `mcp.connected` 的别名（`health/route.ts:241`、`runtimeStatus.ts:115`），却参与 `hermesSupervisor.js:1245` 的 `careerMcpReady` 门禁与 readiness 判定，并在 UI 以「Browser Career Domain Host」展示（`AgentWorkspaceLayout.tsx:254`）。Electron main 不启动任何浏览器、无 CDP；`electron/` 下无 playwright/patchright/puppeteer。

### C. MCP 路由无鉴权（中危）

`src/app/api/agent/mcp/route.ts:76-130` 无密钥、无 loopback/Origin 校验，而 `v4-plan.md:351` 声称「loopback + auth」。Hermes 经 managed `config.yaml`（`hermesCompanion.js:293-308`）无凭据接入。

### D. 生产路由依赖测试运行器（中危）

`src/services/export/pdfGenerator.ts:1` 在生产 API 路由里 `import { chromium } from "@playwright/test"`，而它在 `package.json:58` 的 `devDependencies`。与 `v4-plan.md:316-317` 冲突。

### E. 低危 / 待决

- OCR sidecar 随应用启动常驻 + 5 秒重试定时器，无用户退出开关（`main.js:222-282,334-336`）。
- 单写入路径无仓库级守卫测试（`agentContracts.test.ts:86-91` 仅覆盖 turn 路由）。
- `/api/agent/runtime/hermes/health` 接收但不校验入站 `Authorization`。
- Hermes 每次启动后仍自动拉起；READY 是时序门而非用户同意门。

### 已核实为「符合」（不必重查）

renderer 不接触 `API_SERVER_KEY`；`runtimeControlKeyFingerprint` 只写 stderr 且需显式开关；`safeControlReason` 只取 `error.code`；Dexie 单写入路径成立（单例仅被 `WorkspaceRepository` 引用，Next/MCP 零 Dexie 访问，23 表 / schema v10，5 张 V4 表不存在）；`ResumeDocument` 只派生；Hermes 有 `rendererReady` 门禁；Chromium 不常驻（仅 PDF 导出按需）。

---

## 5. 尚未完成的审计项（接手者的第一批活）

以下静态/运行态审计**未做**，其中运行态项需要先启动应用：

1. **实际 toolset/tool 清单** —— 需运行态探测 `/v1/toolsets`、`/v1/skills`、`/v1/capabilities`。
2. **API server / MCP / plugin / cron / browser CDP** 逐项运行态验证。
3. **来源政策 Schema** —— 现有 source/evidence/provenance 类型是否集中、是否与 `v4-plan.md` §1.3 / D5 / §5.4 一致。
4. **pending confirmation 字段集** —— 未确认事实能否进入预览或 PDF。
5. **untrusted external content 边界** —— 外部文本是否被标记后再进 prompt；是否有 `dangerouslySetInnerHTML`；外部内容能否改变系统规则或写入事实库。
6. **Patchright 是否随包提供** —— 是否存在、`electron-builder.yml` 是否打包、PDF 导出在干净机器上是否可用。

---

## 6. 后续小修（明确不混入已提交改动）

`src/services/agent/hermesControl.ts:682`、`:699` 与 `src/components/agent/workspace/AgentWorkspaceLayout.tsx:162`、`:164`、`:182`：进行中状态仍显示「正在应用模型…」，未对齐设置页的「正在重启 AI Agent…」。纯文案一致性，不影响行为。用户已同意单列。

---

## 7. 建议的接续顺序

1. **A2** 启动输出脱敏 —— 复用既有 `redact`（`hermesSupervisor.js` 的 `readSafeLogTail`/`redact`），风险最低、优先级最高。
2. **A1** 凭据指纹 —— 排除 `apiKey` 参与哈希，或改为对凭据做不可逆占位，同时保持「配置变更检测」语义不变。注意别把现有 fingerprint 相关测试改绿式放松。
3. **C** MCP 路由鉴权 —— 对齐 `control/route.ts:141-176` 的 loopback + Origin 校验。
4. **D** PDF 导出依赖 —— 生产运行时不得依赖 devDependency 测试运行器。
5. **B** Browser Domain Host 命名 —— 属计划层决策，需用户拍板（改名 vs 实现），不要擅自改。
6. 补完 §5 全部 6 项审计。
7. 补跑真实 smoke + 全量门禁，**重新判定 V4-P0 退出条件**；只有全部满足才进入 V4-P1。

---

## 8. V4-P1 范围（用户已明确授权，但当前被阻塞）

用户原话：进入 V4-P1 后**只实现纯逻辑资产迁移**：
`normalizeJd`、内容哈希、去重、匹配派生、来源证据、Fact Proposal、简历 patch。

**明确暂不做**：岗位抓取、五张 Dexie 表（`crawlSources`/`jobListings`/`jobSnapshots`/`crawlRuns`/`applicationDrafts`）、浏览器自动化、Hermes 自治任务。

对应 `v4-plan.md` §11 V4-P1 退出条件：纯逻辑无网络副作用、原子型 `sourceSpan` 映射稳定、不得影响 Job Optimization 用户可见替换、不得改 Fact Guard 阈值、未确认事实不得进入预览或 PDF、参考实现不落库、模型许可说明按 MIT 保留。

---

## 9. 操作纪律（务必遵守）

- `.env.local` 含真实 API key：**禁止打印、禁止提交、禁止写入任何被跟踪文件**。提交前用 `git check-ignore -v .env.local` 与 `git status` 复核。
- 提交前必须扫描 diff：**源码、测试、配置**中不得含 `sk-*`、`AI_API_KEY=<值>`、硬编码盘符绝对路径。本轮已因此修掉一处测试里的假日志路径。
  （本交接文档例外：§1 明确写出仓库根目录是接手者的必要信息；`%APPDATA%/...` 是可移植的环境变量引用，不含机器或用户标识。）
- 禁止用 skip / 删断言 / 降阈值让测试变绿。
- 不得删除既有功能规避失败；不得为消除 404 去 patch bundled Hermes。
- 不得恢复 Native runtime / Native planner / 本地执行 fallback。
- 五张 V4 表只在用户选择的对应阶段实现。
- Electron 进程在本机必须用 WMI detach 才能存活：
  `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine="<electron.exe> <repo>"; CurrentDirectory=<repo> }`
  （直接 `Start-Process` 会被工具的进程树清理杀掉；用完记得停掉并确认 3000/8643 已释放。）

---

## 10. 如何复跑真实 smoke

```powershell
# 1) 先启动应用（Electron 会同时拉起 Next 与 Hermes）
Invoke-CimMethod -ClassName Win32_Process -MethodName Create `
  -Arguments @{ CommandLine="`"<repo>\node_modules\electron\dist\electron.exe`" `"<repo>`""; CurrentDirectory="<repo>" }

# 2) 确认端口与凭据解析
#    L3000 / L8643 应 LISTEN；/api/agent/runtime/hermes/health 应为
#    providerStatus=ready, credentialSource=server_env, credentialConfigured=True

# 3) 跑 smoke
$env:PLAYWRIGHT_BASE_URL="http://127.0.0.1:3000"
$env:HERMES_RUNTIME_URL="http://127.0.0.1:8643"
$env:CAREERADAPT_PROVIDER_SMOKE="1"
pnpm exec playwright test tests/e2e/v4p0-provider-smoke.spec.ts --reporter=list
```

注意：同一时刻只能有一个 Electron 实例，多实例会争抢 runtime API key（日志里表现为 `startup blocked: no Hermes runtime API key is available`）。