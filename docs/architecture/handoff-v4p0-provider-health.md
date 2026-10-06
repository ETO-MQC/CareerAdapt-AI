# 交接报告：V4-P0 已退出，V4-P1 纯逻辑资产迁移已完成（2026-10-06 更新）

面向接手本项目的下一个 AI。阅读顺序：本文件 → `AGENTS.md` → `docs/architecture/v4-plan.md` §11 → `docs/architecture/v4p0-audit-status.md`。

---

## 0. 三十秒结论

- **V4-P0 已退出**：审计修复 A1/A2/C/D + §5 全部 6 项审计补齐 + 完整门禁全绿 + 真实 smoke 通过。
- **V4-P1 已完成（2026-10-06）**：两个前置（5 套 sourceType 统一为 `src/domain/sourceTaxonomy.ts` canonical 分类法 + Fact Proposal `expiresAt` 过期机制正式化）与六阶段纯逻辑资产（JD 标准化/哈希、三级去重、fit/hard gate/coverage 派生、投递转移+跟进节奏、Markdown 转义、简历 patch 结构、证据定位诊断）全部交付，测试 `203 files / 1434 tests` 全绿（基线只增不减）。详细记录见 `Plan3.md` 的「V4-P1 纯逻辑资产迁移」与 `history3.md` 同日条目。
- **仍开放（不阻塞）**：B 项 Browser Domain Host 命名超前于实现——用户已决定**本轮不处理**，但后续代码不得把 `mcp.connected` 别名当成真实浏览器能力，也不得据此启用浏览器自动化；E 项 4 条低危待决。
- **下一步**：V4-P2（五张表、Repository、候选岗位管道）**未获用户授权前不得开始**。JD 快照/去重/提议等纯逻辑资产的落库接入点在 V4-P2 实现。

---

## 1. 当前仓库状态

| 项 | 值 |
| --- | --- |
| 工作目录 | `E:\DEF\CareerAdapt AI` |
| 基线 | 本轮修复已提交（提交号见 `git log`，`feat(v4p0)` + `docs(v4p0)` 两笔） |
| 运行时进程 | 已全部停止；端口 3000 / 8642 / 8643 已释放 |
| Hermes 锁定 | `0.19.0`，commit `eb52760564dbba2e5971fa54bd67384e281cd3b8`，补丁 `careeradapt-api-toolsets-v1` |
| 本机 provider | `.env.local`（已 gitignore、未跟踪），**禁止打印或提交**；模型 `deepseek-v4-flash-0731` 为推理模型，`max_tokens` 过小会返回空 content |

---

## 2. 本轮完成的修复（证据见 v4p0-audit-status.md §3）

| 项 | 修复 |
| --- | --- |
| **A1** 凭据指纹 | 指纹 payload 中 `apiKey` → `credentialFingerprint = HMAC-SHA-256(pepper, credential)`；pepper 由新模块 `electron/credentialFingerprintPepper.js` 统一解析，`electron/main.js` 与 `scripts/dev-with-hermes.mjs` 在 Next 启动前固定进 env。跨实现一致性（node HMAC vs WebCrypto HMAC）与变更检测语义由 `tests/unit/v4p0CredentialBoundary.test.ts` 钉死 |
| **A2** 启动输出脱敏 | `captureLine` 捕获前经共享 `redact`（七个凭据环境名 + ephemeral runtime key + Bearer 兜底）；`startupFailure` 两条失败路径统一为结构化对象，renderer 新增 `HermesStartupFailure` 类型 |
| **C** MCP 鉴权 | `api/agent/mcp` GET/POST/DELETE 全入口 loopback + Origin 同源校验（对齐 `control/route.ts`）；进程调用方（Hermes/探针/health 代理）经 loopback Host 放行。共享密钥 auth 待 Hermes 侧配合（用户既定决策），测试 `v4p0McpRouteGuard.test.ts` |
| **D** PDF 依赖 | `pdfGenerator.ts` 改用 `playwright-core@1.61.1`（dependencies）；`@playwright/test` 留 devDependencies。干净机器回退 msedge channel |
| **文案** | 交接 §6 小修：`hermesControlStatusLabel`/`hermesControlFeedback` 按 `restarting_runtime` 区分「正在重启 AI Agent…」；workspace 状态条复用 statusLabel |

验证中自查出并修复的一个设计缺陷：companion 与 Next 路由各自持有独立随机 pepper 会导致生产指纹必然不一致（单测 pin 了 env 才相等，掩盖了该问题）。已通过启动器统一注入 `CAREERADAPT_CREDENTIAL_PEPPER` 解决；Electron 复用已存在的 dev 服务器时两侧仍各持 pepper，指纹比较优雅降级（仅 `providerDiagnostic` 置空，功能不受影响）。

## 3. §5 审计补齐结果（全部完成）

要点（细节与证据见 v4p0-audit-status.md §4）：

1. **Toolset 清单（运行态）**：生产面仅 `["mcp-careeradapt","skills"]`，14 个可见工具，无 `hermes-api-server`。
2. **端点矩阵（运行态）**：`/v1/*` 资源端点全部 401；`/api/model/info|set`、`/api/env`、`/api/providers`、`/api/config` 全部 404；无 cron/plugin 端点；无 CDP 端口；无 CareerAdapt 拉起的浏览器。
3. **来源政策 Schema**：核心在 `common.ts`；5 套 sourceType 分类法并存是 V4-P1 前的技术债；外部来源政策字段（automationLevel 等）为 V4-P2 范围，当前零命中（符合计划）。
4. **pending confirmation**：未确认事实不能进入预览/PDF（schema 不变量 → `isConfirmedFact` → renderable 过滤 → 导出 hash/覆盖率四层）；残留：导出 hash 无密钥、summary 块 not_fact 豁免、`expiresAt` 未实现。
5. **untrusted content**：达标。全部 Stage-B prompt 有「数据非指令」声明 + 脱敏 + JSON 包裹；`dangerouslySetInnerHTML` 仅 1 处静态主题脚本；写入链路全部需确认。
6. **Patchright**：不存在于任何依赖/运行时（符合 D7）。

## 4. 门禁（本轮实测）

typecheck 0；lint 0；**195 files / 1352 tests**（基线 1338 + 新增 14）；build 0；`git diff --check` 0；真实 smoke 修复后复跑通过；提交前 diff 密钥扫描无命中（`.env.local` 经 `git check-ignore` 复核）。

## 5. 下一步（按序）

1. **V4-P1**（已解锁）：只做纯逻辑资产迁移，范围严格按 §7。起步前先统一 5 套 sourceType 分类法（审计 §4.3）。
2. **B 项**：向用户确认 Browser Domain Host 是改名对齐现实还是按 V4-P3/P4 实现；未拍板前不改。
3. **E 项与残留**：OCR sidecar 退出开关、仓库级单写入守卫测试、health 路由入站 Authorization 校验、Hermes 用户同意门、§5.4 `expiresAt`——可按优先级穿插在后续阶段，不阻塞。
4. **V4-P2 起步时**：实现五张已批准表 + 来源政策 Schema（automationLevel 五级、permissionBasis、termsUrl 等，当前零命中）。

## 6. V4-P1 退出条件（v4-plan.md §11，交接备忘）

纯逻辑无网络副作用、原子型 `sourceSpan` 映射稳定、不得影响 Job Optimization 用户可见替换、不得改 Fact Guard 阈值、未确认事实不得进入预览或 PDF、参考实现不落库、模型许可说明按 MIT 保留。

## 7. 操作纪律（务必遵守，与上轮一致）

- `.env.local` 含真实 API key：禁止打印、禁止提交、禁止写入被跟踪文件；提交前 `git check-ignore -v .env.local` 与 `git status` 复核。
- 提交前扫描 diff：不得含 `sk-*`、`AI_API_KEY=<值>`、硬编码盘符绝对路径。
- 禁止 skip/删断言/降阈值变绿；不得删功能规避失败；不得 patch bundled Hermes。
- 不得恢复 Native runtime / Native planner / 本地执行 fallback。
- 五张 V4 表只在 V4-P2 实现。
- Electron 本机启动用 WMI detach（`Invoke-CimMethod Win32_Process Create`），`Start-Process` 会被进程树清理杀掉；用完停进程并确认 3000/8642/8643 释放。同一时刻只能有一个 Electron 实例。

## 8. 如何复跑真实 smoke

```powershell
# 1) 启动应用（Electron 同时拉起 Next 与 Hermes）
Invoke-CimMethod -ClassName Win32_Process -MethodName Create `
  -Arguments @{ CommandLine="`"<repo>\node_modules\electron\dist\electron.exe`" `"<repo>`""; CurrentDirectory="<repo>" }

# 2) 等待 /api/agent/runtime/hermes/health 的 providerStatus=ready（本轮实测 ~20s）
#    注意实际端口可能是 8642 或顺延的 8643，以 health 载荷的 runtimeUrl 为准

# 3) 跑 smoke
$env:PLAYWRIGHT_BASE_URL="http://127.0.0.1:3000"
$env:HERMES_RUNTIME_URL="http://127.0.0.1:8643"   # 以实际 runtimeUrl 为准
$env:CAREERADAPT_PROVIDER_SMOKE="1"
pnpm exec playwright test tests/e2e/v4p0-provider-smoke.spec.ts --reporter=list
```
