# Hermes Provider 配置与 readiness 链路审计（2026-11-10）

状态：根因已定位、离线观察复现；生产代码和用户运行配置未修复。起点 HEAD `4bf3e40` / `competition/5.1.8`，保留已有 UX 未提交成果和用户修改的 next.config.ts。不重启或停止用户 Next/Hermes，不改密钥，不提交/推送/打包。

## 结论

当前不是“Provider 值根本没传入”导致的单一问题，而是以下链路叠加：

1. Web Supervisor 默认查找 `.electron-build/hermes-runtime-v4`，该目录当前不存在；开发模式允许外部 Hermes，因此实际进程从 `%LOCALAPPDATA%/hermes/hermes-agent` 加载源码，未使用项目补丁 bundle。
2. 用户目录安装与项目锁都是 Hermes 0.19.0 / `eb52760564dbba2e5971fa54bd67384e281cd3b8`，但前者没有 CareerAdapt 的 `/v1/toolsets` live MCP registry enrichment 补丁。版本号相同不等于运行能力相同。
3. 实际认证读取 `/v1/toolsets` 仅返回已启用 skills 的 3 个工具，没有 MCP 行。Next 生产暴露面有 14 项，不等于 Hermes 的枚举端点能够证明它们已可用。因此 readiness 保持 `hermes_tool_surface_sync_pending`。这并未证明 Hermes 内部完全没有加载 MCP，只说明当前官方端点无法满足项目校验契约；不能靠放宽门禁冒充 READY。
4. Provider 健康探测每次都请求 `/models`，无缓存或单飞。Supervisor 约每 750ms 再轮询一次，外加各请求耗时。失败快照明确显示 `/models` HTTP 429、credentialConfigured=true，却被 Next 标为 providerStatus=invalid；Supervisor 将 invalid 且非401/403归为 `configuration_required`，同步立即退出并宣告配置应用失败。
5. active 配置只有完整 READY 和读回验证通过后才提交。此次未达到，因此 desired 有地址/模型/凭证标志，但 active 不存在，UI 基于 active 展示“未确认/未配置”。它不是密钥不存在的直接证据。

## 实际证据

- Supervisor 留存失败：北京时间 **2026-11-10 01:54:18**，API=true、CareerMcp=true、toolSurface=false，Provider diagnostic `lastHttpStatus=429`、`safeErrorCode=provider_http_429`、`credentialConfigured=true`；最终 reason `configuration_required`。
- 本轮最初一次现有 `/health` 读取又得到 Provider HTTP 200 / ready，但 Supervisor 仍留存上一次 failed apply。这证明不能根据旧 failed 快照要求用户重填 Key，也不是当前持续401的证据。
- 同步从 01:53:43 持续至 01:54:18，约34秒，因429的配置错误分类提前退出。代码本身有60秒 deadline；没有证据表明这是无限无上限循环。若始终 Provider ready、工具未齐，应以 `hermes_tool_surface_sync_timeout` 结束。
- 运行进程 cwd 是当前项目；PYTHONPATH 来自用户安装，未设置 bundled mode。默认 bundle 目录不存在，唯一现有准备目录是 `hermes-runtime-rp011`，不是当前默认路径。
- 用户安装 API 源码 SHA256：`450458f704754da8abe1cbe2144068e22abd849edd7d974e6d461b8873ba0ceb`，无 live MCP enrichment。
- 已准备 bundle 对应 API 源码 SHA256：`832539ff6e36dcf49543d6afb6df1cbdc5ac57b0ab3404b7cd32f9ffef967f4e`，与其 manifest patch hash 一致，包含 live MCP enrichment；本轮未切换或启动它，不能宣称恢复通过。

脱敏机器证据：`docs/quality/hermes-provider-chain-audit-20261110/live-readback-redacted.json`。只导出允许字段、匹配布尔值、HTTP状态、源码哈希与安全timeline；不导出任何密钥值或完整环境。

## 四个怀疑点核对

| 怀疑 | 结果 |
|---|---|
| 值没有落盘到正确配置 | 当前实际 HERMES_HOME 的 config.yaml 已含目标模型、custom:careeradapt 和目标 Base URL；三者与实际子进程环境逐项相等。凭证已注入 `HERMES_CUSTOM_CAREERADAPT_API_KEY`。当前值可读成立，但不据此证明每次保存都走托管写入；外部启动分支与 bundled 分支有差异。 |
| free_tier_bootstrap 缓存 bug | 此次没有证据支持。明确出现的是应用自身 `/models` 429分类；当前 custom provider 文件与环境匹配且曾探测200。不根据上游传闻改缓存或认证逻辑。 |
| custom_providers 被写为 dict | 当前读取为 list，有 careeradapt 条目和 key_env，无内联 api_key；该怀疑不符合现状。项目结构合并器也明确拒绝非list。 |
| HERMES_* 覆盖文件 | 确有环境优先规则，但本轮实际模型/Provider/BaseURL全部与文件一致，无旧值覆盖证据。Key通过子进程环境注入是设计行为，不应写进 config.yaml 或仓库。 |

Web开发的凭证属于进程内配置，不等于 Electron safeStorage 持久化；不能为了修本故障把 Key 写到前端、源码或 YAML/.env。

## next.config.ts 的关联

用户将 `turbopack.root` 设置为项目父目录，该目录能够涵盖当前指向兄弟目录的 node_modules Junction，符合解决先前 Turbopack 文件系统根越界问题的用途。

这个选项约束打包器文件访问范围，不设置 Hermes 的 HERMES_HOME、HERMES_RUNTIME_ROOT 或 Provider配置。当前 cwd、实际配置目录和文件/环境匹配也没有出现路径错位。Web Supervisor及Companion使用显式 projectRoot/process.cwd 解析运行时路径，因此目前没有证据支持将其作为本次根因。重启开发服务可能暴露了原有默认 bundle 缺失，但这属于可能的触发时机，不能替代上述已验证根因。此次保留用户该文件，不直接回滚以免恢复旧构建错误。

## 代码断点

- `src/server/agent/webHermesSupervisor.ts`：默认 runtime-v4 路径，开发 requireBundledRuntime=false。
- `electron/hermesCompanion.js`：resolveBundledHermesRuntime 检查目录/manifest；resolveHermesLaunch 在 bundle不存在时走外部启动。prepareHermesEnvironment 的托管YAML写入在 bundled 分支，凭证注入到 child env。
- `scripts/prepare-hermes-runtime.mjs`：复制锁定源码并加入 `/v1/toolsets` live MCP enrichment；不能以同为0.19.0替代补丁校验。
- `src/app/api/agent/runtime/hermes/health/route.ts`：checkConfiguredProvider 每次 fetch /models；`response.ok ? ready : invalid` 把429/5xx和401混为同类。toolset有10秒缓存，Provider探测没有。
- `electron/hermesSupervisor.js`：healthReason 对 invalid 非认证错误回落 configuration_required；synchronizeCareerReadiness 遇配置原因提前退出；完整ready之前不commitActiveConfiguration。
- 另发现 Supervisor `REQUIRED_CAREER_FACADES=8`，实际当前必需列表为10项，0/8是陈旧展示分母；不是本次工具枚举失败的直接原因，后续应使用权威列表统一计数。

## 离线验证与现有检查

新增独立观察测试 `tests/manual/hermes-provider-chain-audit.test.ts`，不进入默认Unit集合。运行：

`pnpm exec vitest run --config .tmp/hermes-provider-audit.config.ts --reporter=default --reporter=json --outputFile=docs/quality/hermes-provider-chain-audit-20261110/offline-observations.json`

3/3退出0，含真实Next health route的429误分类、三次health→三次/models、Supervisor有界同步超时与随后429错误降级。观察通过表示缺陷已复现，不是修复PASS。配置明确覆盖include，不混跑整个默认集合。配置内容为原vitest配置加include仅该文件；alias/setup沿用原值。

`pnpm typecheck`、新增审计文件ESLint、`git diff --check`通过。

现有定向集合 `hermesSupervisor.test.ts` 全20项通过；`p511-r2-observability.test.ts` 26过1败：event stream错误封装测试期望首个next() reject，当前实现先yield progress/status_unavailable。该组在未修改任何生产代码时失败，非本轮引入，不扩大到SSE修复，不删断言或skip。纯诊断不重跑build/浏览器/全量门禁。

本轮一次现有Next health只读调用会由现有逻辑触发真实Provider `/models` 探测；没有调用聊天/completions或发送简历/岗位正文。后续全部离线mock与本地控制状态读取，未循环请求真实Provider。

## 建议最小修复顺序（尚未执行）

1. 准备/核验默认路径中的锁定CareerAdapt bundle，并让开发启动明确报告实际选中的runtime及补丁身份；配置了bundle但不存在时应给出明确诊断，不能继续假定外部0.19具有同等工具面契约。不修改用户安装来冒充bundle，不静默裁剪已开启的Power能力。
2. 将 `/models` 401/403、缺配置，与429、5xx、超时、接口不支持分开；429必须保留限流原因而非configuration_required。为健康探测提供按配置身份区分的有限缓存/并发合并，显式改Key/模型应失效。现有一次轮询一个真实Provider请求有放大流量的风险，但不能只凭429断定是RPM、配额还是共享上游负载。
3. 保留READY、确认和凭证边界，UI同时说明“目标配置已收到，但应用因工具同步/限流尚未完成”，避免active缺失被看成输入未保存；统一Facade数量。
4. 在隔离Home、独立端口与本地Scripted Provider验证配置→重启→实际MCP枚举→READY→唯一工具任务，再决定是否对用户当前运行服务执行受控重启。不重置用户Key、不清配置、不通过降低工具校验放行。

本轮只完成用户要求的链路检查和根因定位，不把建议写成已实现，也不宣称用户运行环境已恢复。
