# API 429 与 Hermes 模型配置专项诊断

> 2026-10-28 更新：P5.1.0-R1 已实施两项本地修复，验收及限制见第 8 节。下方第 1～7 节保留首次诊断时的事实和状态；不将其中“未实施”理解为本次修复状态。

日期：2026-10-28（Asia/Shanghai）。范围：调查、定向实验与报告；没有修改产品代码、配置、凭据存储或简历数据，没有提交、推送或打包。

## 结论

本次实际复现的 429 来自给定远端 API：绕过 CareerAdapt/Hermes，使用用户提供的凭据发出一次与测速相同的 HTTP 请求，163 ms 返回 `process_concurrency_rate_limit_exceeded`。现有应用测速路由随后也返回相同错误。不能据此推断额度耗尽、用户点击过多，或其他软件的调用情况；并发限制的作用范围仍须服务商根据 trace ID 解释。

配置问题与 429 应分开处理。已在隔离目录使用当前 bundled Hermes 的真实 `save_config(load_config())` 复现 managed 注释标记丢失，随后 CareerAdapt 的仅模型更新函数抛出 `hermes_managed_model_config_missing`。生产 Supervisor 在这条失败路径不尝试受控重启，活动配置保留旧值，表单候选值仍可不同。尚未取得用户历史故障时的 config.yaml，因此不能断言当时一定由这次保存动作引起。

当前 localhost:3000 控制快照报告目标 AMD/Qwen 配置已经 `applied/verified`；测速返回的指纹与活动配置一致。本轮没有复现“当前已应用配置与此次测速配置不同”。

机器可读证据：[api429-hermes-evidence-20261028.json](api429-hermes-evidence-20261028.json)。JSON 时间为 UTC，下文时间均为北京时间。

## 1. 基线与证据范围

- HEAD 沿用 `9d7ccb0`；开始时已有 `tests/e2e/hermes-p46h-integration.spec.ts` 未提交修改，以及 P5.1 开发计划、基线审计报告两个未跟踪文件；全部保留。
- 当前锁定 Hermes 0.19.0、commit `eb52760564dbba2e5971fa54bd67384e281cd3b8`、补丁 `careeradapt-api-toolsets-v1`；以 lock、实际 runtime-manifest 和本机 source 为调查对象，没有套用上游最新能力。
- 本轮真实请求共两次：一次直连、一次调用已有 Next 测速路由。未调用真实 Hermes Agent 任务，未实施重启/保存配置、未向模型发送个人资料。
- 直连使用用户提供的凭据，仅驻留诊断进程内存；应用路由使用其现有服务端凭据，没有读回密钥，也没有独立证明两者凭据相等。活动配置与应用测速指纹相同，不等于证明它与用户提供的密钥相同。
- `.env.local` 的非秘密字段仍为另一个 Provider/model，而当前控制快照是 AMD/Qwen。文件配置与会话已应用配置可以不同；未改写 env 文件。

## 2. 配置应用链路（源码证据）

| 环节 | 实际行为与证据 |
|---|---|
| 表单/当前值 | `src/app/settings/page.tsx:91` 从 localStorage 初始化候选；`:775` 附近从 runtimeConfig.active 取得当前模型。二者不是同一数据源，编辑表单不立即应用。 |
| 保存与校验 | `page.tsx:557` 规范化草稿；调用 `validateAiRuntimeConfigDraft`；地址只校验 URL/协议，模型和鉴权最终依赖运行时。新密钥走 write-only credential 通道；无新密钥走 update_config。只有回执 applied 才写入不含密钥的表单配置。 |
| 凭据 | `hermesControl.ts:981` 起：Desktop 走 IPC、安全存储；本地 Web 走同源控制端点、服务端进程内存。`aiSettings.ts` 不持久化密钥，x-ai-config 仅携带非秘密候选字段。Web 服务进程退出后该会话密钥不保证保留。 |
| Web 控制 | `src/app/api/agent/runtime/hermes/control/route.ts:57` 起，set_credential 转换为 replace 配置意图，Supervisor 执行；成功判断要求 applied 且 verified。`webHermesSupervisor.ts` 用 globalThis 保存 Supervisor，Next 热加载不应随意重建进程所有者。 |
| 并发配置应用 | `electron/hermesSupervisor.js:555` 起用 configurationMutationPromise 合并进行中的 update，等待 lifecyclePromise。重复配置且 ready 为 no-op；运行期间提交另一份不同配置可能收到同一个进行中结果，应作为后续定向并发用例，不在本轮扩修。 |
| 仅切模型 | `hermesSupervisor.js:646` 要求进程为 owned、providerReady、provider/URL/key 相同且 model 不同。`:660` 写 managed YAML，读 `/api/model/options` 核对 provider/model，成功后提交活动指纹及 generation。当前 run 不被重启，下一次创建 agent 读取新模型。 |
| 地址/密钥变化 | `:742` 进入受控停止/启动与读回核验；失败时按 previous healthy configuration 回滚。`:1047` 更新本进程 Provider 环境。 |
| YAML 生成 | `electron/hermesCompanion.js:294` 写 config.yaml 的 managed block；包含 model.default/provider/base_url 和自定义 Provider 条目，凭据使用环境变量名称，不写入 YAML。 |
| 成功语义 | 当前 verified 主要是运行时配置/Provider 状态读回，不能当成一次真实模型生成成功，更不能保证没有 429。 |

### `hermes_managed_model_config_missing` 的确切条件

`electron/hermesCompanion.js:364` 读取 config.yaml 后要求：

1. `# BEGIN CAREERADAPT MANAGED CONFIG` 与 END 组成的匹配块必须恰好一个；
2. 该块内必须匹配顶层 `model:` 紧接两个空格缩进的非空 `default:`。

缺标记、重复块、default 丢失、键顺序/缩进变化都可能触发该代码。文件不存在则先抛 ENOENT，并非这个错误码。它是本地配置更新条件失败，与 Provider 429 不是同一个异常来源。

`applyModelWithoutRestart` catch 若尚未得到 restore 函数，会标记 failed；若已写入、读回失败则 restore 并标记 rolled_back。该路径直接返回，没有转入 `applyConfigurationWithLifecycleRestart`。因此不能用“测速成功”清除此错误，也不能把候选模型显示成已应用。

### 真实 bundled YAML 保存的隔离复现

临时目录生成 CareerAdapt managed 配置 → 更新模型成功 → 以 bundled Python/source 调用 `save_config(load_config())`（退出 0）→ managed 注释标记消失 → 调用原 `updateManagedHermesModel`，得到目标错误码。

源码对应：bundled `source/hermes_cli/config.py:7791/7897` 保存规范化字典；`source/utils.py:268/308` 用 YAML Dumper 整体序列化，无法保留 CareerAdapt 注释边界。配置缓存按 mtime_ns/size 失效（config.py:7412 起），本轮没有证明缓存失效是主因。保存丢注释这一兼容缺陷已复现；历史事故中哪个入口执行了保存仍待定位。

### 独立发现：Electron 凭据初始化分支缺陷

`electron/main.js:30` 声明 providerCredentialStore，但全文件唯一初始化在 `:363`，位于 `if (reuseExistingDevelopmentServer)` 内。正常自建开发服务器/packaged server 分支跳过初始化及 stored credential 注入；`:475/479/507` 的 IPC 回调直接调用 describe/write/clear，缺少有效 store。

这是源码可证实的分支缺陷，可解释独立的 Desktop 密钥恢复/操作失败风险；本轮没有启动 Electron 或验证安装包，不能说已复现用户事故，也不能把它当作 Web 测速 429 的原因。不要仅添加可选链静默成功，应修正启动顺序并验证持久化。

## 3. 测速请求审计

链路：测速按钮 → `page.tsx:386` → `requestHermesProviderLatencyTest` → `hermesControl.ts:1042` → `POST /api/ai/test` + `x-ai-test-mode: latency` → `src/app/api/ai/test/route.ts:44` → `OpenAiCompatibleProvider.invoke` → fetch。

- 按钮仅 onClick，无表单 submit 调用；状态禁用按钮，ref 同步互斥连接测试/测速。隔离浏览器立即触发两次 click，捕获 **1 次**路由请求；错误仍显示，没有伪造成功。该实验拦截路由，真实 Provider 请求为 0。
- 测速无 `/models` 前置请求、无 Hermes run、无 tools、无应用级重试；Provider fetch wrapper 也不重试。静态链路每次调用为一次 completion fetch；未配置/新密钥未保存时可为零次。单页面互斥不是跨页、跨任务或跨软件的全局并发限制。
- 未显式设置 fetch redirect，生产 fetch 使用默认跟随策略；源码不能排除远端 3xx 导致多次网络往返。本次独立直连设 redirect=manual，直接返回 429，无重定向。
- 请求路径按 Base URL 去掉单个末尾斜杠后追加 `/chat/completions`。给定地址最终为 `https://developer.amd.com.cn/radeon/api/v1/chat/completions`，没有重复 `/v1` 或误用 `/responses`。
- 实际 model 为 `Qwen3.8-Flash-Next`。协议为 OpenAI Chat Completions；“OpenAI”不表示请求发往 OpenAI 官方域名，绑定会按 AMD host 归为 `custom:careeradapt`。
- body 为 system/user 两条极短 JSON 提示词，temperature=0.1，不发 stream/tools/reasoning 参数。`maxOutputChars:64` 只约束返回内容的本地解析，**不是上游 max_tokens**。不能据此称它为 64 token 请求；是否影响该服务商并发准入待验证。
- 超时是 request.signal 与 180 秒 timeout 合并；renderer fetch 没有单独设置取消控制器。失败分支没有 latencyMs，diagnostics 默认呈现 0，实际已耗时。本次 429 不是超时映射。
- 普通“测试连接”不同：DNS/TCP/TLS 后 GET /models；OpenRouter 额外 /key；不支持模型列表时可 fallback 一次 completion，不应将其请求数或结果与测速混用。
- `src/ai/client.ts` 的结构化任务重试与测速不共用调用入口；Hermes Agent 自身的 SDK/会话重试也不在这条测速链路中。

## 4. 真实运行证据

| 时间（北京时间） | 目标/模型 | 状态、耗时、次数 | 可用证据 |
|---|---|---|---|
| 10-28 02:09:33 | AMD `/radeon/api/v1/chat/completions`，Qwen3.8-Flash-Next，独立直连 | 429，163 ms；本地发起 1，重试 0 | Retry-After=1；server=nginx；x-trace-id=`ad752bf53b135a68dbec0c9b544b2b69`；最终 URL 同目标，无 3xx |
| 10-28 02:11:02 | 已有应用 `/api/ai/test` latency；解析到同一 AMD Base URL/model | 本地 HTTP 502，诊断上游 HTTP 429；355 ms；本地调用 1，无客户端重试 | code=provider_http_429；credentialPresent=true；来源 server_env；指纹与活动配置相同；生产路由不返回远端 headers/request ID |
| 10-28 02:11:55 | 控制快照 | ready，applied，verified=true，generation=2，restartPerformed=false | active/desired 均 AMD/Qwen，最后应用时间 10-28 01:29:55；快照不是本轮真实 Agent 对话证明 |

两次失败正文均为：

```json
{"detail":{"error":{"message":"Model API rate limit exceeded; please retry later","type":"rate_limit_error","code":"process_concurrency_rate_limit_exceeded"}}}
```

直连证明远端对这个请求返回并发限流错误；不能从 code 中确定它是账户、密钥、IP、网关进程还是共享资源池限制，也不能证明请求在用户全部软件中的总并发为 1。未进行负载测试、自动重试或频繁探测。

历史日志 `.next/dev/logs/hermes-runtime.log:2921/2923/2925/2926`（2026-10-23 18:46:17～20）另有 AMD **DeepSeek-V4.1-Flash** 的 429，正文为 `model_concurrency_rate_limit_exceeded`，明确写模型并发上限 16；记录 attempt 1/3、2/3、3/3，即三次发起，不能把末行“3 retries”当成额外三次。本例是历史 Hermes Agent 请求，**不是此次 Qwen 测速**，不据此套用 Qwen 配额。

Next 历史日志只保留了三条 `ai_provider_connection_test_failed {}`，不能还原原测速的模型、头或请求 ID。没有找到可用于证实历史 managed 错误原因的 config.yaml 快照。

## 5. 已证实问题与待验证假设

| 分类 | 判断 |
|---|---|
| 源码 + 隔离运行证实 | Hermes 标准 YAML 保存会破坏 CareerAdapt managed 注释契约；此后模型热更新函数抛 missing；Supervisor 无受控恢复分支。 |
| 源码 + 运行证实 | 当前 429 文案将限流/免费额度耗尽并列，但响应仅证明 process concurrency；失败耗时丢失；headers/request ID 不保留；嵌套 detail.error 未结构化提取而直接显示 JSON 文本。 |
| 源码证实，运行未验收 | Desktop store 初始化只在复用服务分支，正常启动路径缺失。 |
| 真实远端证实 | 给定目标的一次独立请求和本次应用测速均返回并发相关 429。 |
| 本轮未复现 | 测速按钮双发；测速偷偷重试；本次已应用配置与测速指纹不同；429 被伪造成成功。 |
| 仍待验证 | 用户历史 missing 由何入口重写 config；跨软件共享并发/其他任务占用；服务商限制维度；其他软件请求参数/时间窗口差异；用户历史 UI 是否为未保存候选、失败后旧值或旧进程/旧 release。 |

不能把“其他软件能用”视为无效反馈；需要同时间窗口、相同目标/model/鉴权来源、stream 与 token 参数一致的脱敏对照。当前证据不足以把全部问题归于本软件或全部归于服务商。

## 6. 最小修复方案（仅建议，本轮未实施）

1. **配置契约恢复**：在仅切模型路径识别明确的 managed 结构缺失，转入现有受控配置重建/重启并继续核验与回滚；不得用模糊正则覆盖未知用户字段。若有 active run，沿用维护延迟/停止确认协议，不静默中断任务。正常热更新仍保留。更长期改用结构化配置职责需要单独授权，不在本轮重构。
2. **当前/候选说明**：保留 active 与 draft 分离，明确测速测试的是候选；失败时继续显示已应用模型和失败原因，不用 draft 覆盖 active。需要同步表单时仅在用户未编辑状态执行。
3. **诊断保真**：在 Provider 边界提取 root.error/detail.error 的 code/type/message，白名单保存 Retry-After、限流头与 trace/request ID、最终脱敏 host/path、attemptCount/retryCount、失败耗时与配置应用状态。限制正文长度、去除凭据/查询秘密；不保存 Authorization、完整 headers 或密钥，不把原始上游正文无过滤持久化。文案以“远端返回 HTTP 429”起头，再展示实际原因。
4. **Desktop 凭据启动顺序**：在选择复用/自建服务器分支前初始化安全存储并恢复凭据，注入统一 Provider binding 后再启动 Next/Supervisor；验证已有安全存储不可用时显式报错。Web session_memory 继续明确标注生命周期，不私自持久化明文。
5. **本次并发 429**：不盲加重试或切模型。用 trace ID 交服务商确认并发作用域及是否有未释放占用；对比其他软件实际参数。只有证实本地并发来源后才增加对应范围的互斥/排队。

## 7. 验收测试与本轮验证

建议修复验收：

- 真实 bundled save_config 往返后仅切模型：应完成一次受控恢复，读回目标模型/指纹正确；用户 toolsets/MCP/其他字段保留；失败回滚；有运行时不能静默中断。
- 正常仅切模型不重启、旧 run 保持；新任务真实 Provider 请求携带新 model；地址/key 变化仅一次受控重启；已应用相同配置 no-op。
- 单击/快速连击测速：各页面状态互斥；未保存密钥发起零次；已保存候选恰好一次 completion，无隐式重试；不同 tab/Agent 同时调用单独计数，不错误宣称全局串行。
- 429 fixture 包含 detail.error、Retry-After 和 trace ID：保留状态/原因/耗时/次数，失败可见、不成功；502 本地封装与上游 429 清楚区分；恶意正文回显密钥仍脱敏。
- Desktop 自建 dev、复用 dev、packaged 三路径：store 初始化先于访问，保存→退出→重新启动仍有密钥、模型/URL 一致；Web 重启明确变为未配置而不伪造凭据状态。
- 其他软件与本应用做少量串行、同参数真实对照，记录时间、模型、trace ID，不上传个人资料，不自动重试形成额外并发。

本轮实际执行（取得完整退出码）：

- `pnpm exec vitest run tests/unit/aiConnectionTestP46e.test.ts tests/unit/p4.6d-ai-runtime-control-plane.test.tsx tests/unit/v4p0NativeConfigFallback.test.ts tests/unit/effectiveAiConfiguration.test.ts tests/unit/webDevelopmentCredentials.test.ts tests/unit/v4p0ProviderCredentialRoute.test.ts`：6 文件 **39/39**，退出 0。
- `pnpm typecheck`：退出 0。
- `node .tmp/api-config-audit.cjs`：最终退出 0，真实 bundled YAML 保存复现 missing、隔离 Playwright 快速双击只捕获 1 次路由请求。浏览器路由使用合成 429，不是一次真实 Provider 成功验收。最初脚本误用未安装的 playwright 导致 MODULE_NOT_FOUND，改为现有 playwright-core 后运行；未新增依赖。
- 独立直连与已有应用路由真实请求：均收到完整 429 错误证据；真实 Provider **未通过**，不能将模拟测试或 ready 状态作为解除 BLOCKED 的依据。
- `git diff --check`：退出 0；文档/JSON 回读、秘密扫描和最终状态检查见交接。仅诊断与文档，不运行生产构建或打包、不修改产品测试断言。

状态：调查已交付，修复未实施；真实 Provider 仍受此次并发 429 阻断。下一步由用户选择最小修复或服务商对照验证，不自动进入 P5.1.1。

## 8. P5.1.0-R1 修复与验收（2026-10-28）

### 范围与根因修复

仅修复配置生命周期和 Desktop 凭据初始化。HEAD `9d7ccb03ef3531accf063f5b9e3510806742da0e`；修改前 typecheck、4 文件 43 项相关测试退出 0。原有 A03 测试改动与四份未跟踪 P5.1/诊断文档保留。没有更换用户 Provider/模型；`Qwen3.8-27B` 仅为隔离模拟 Provider 的请求模型，未声称远端 AMD 已通过认证。未改 429 文案、重试、队列、并发限制、业务 Schema 或 Repository。

| 文件 | 本次职责 |
|---|---|
| `electron/mergeHermesConfig.py` | 使用已有 bundled PyYAML 解析/合并明确管理的 model 坐标、careeradapt Provider、必要 toolsets/MCP/runtime URL；保留其他模型参数、其他 Provider、用户 toolsets/MCP/gateway/未知字段。拒绝重复 YAML 键、异常结构，不使用整文件正则覆盖。 |
| `electron/hermesCompanion.js` | 现有配置启动时结构化合并、原子替换；只在热切换时修改两个目标模型标量，限定所在模型和 careeradapt Provider 区段，兼容 LF/CRLF；安全读取恢复后的配置坐标。Python 程序由 Node 从资源读取后通过 `-c` 执行，支持未来 ASAR 中的脚本读取，无新生产依赖。 |
| `electron/hermesSupervisor.js` | managed 结构缺失进入现有重启/核验/回滚生命周期；恢复前保留 `config.yaml.recovery-<随机标识>.bak` 私有原件；恢复失败恢复原始字节。恢复的 Provider/model 从运行时 model/options 读回，Base URL 从同一 owned child 的配置文件重新读回，活动指纹核对后才提交；不虚构 runtime API 已返回 Base URL。 |
| `electron/hermesModelConfigClient.js` | 仅在恢复前读取已有 `/health/detailed` 活动计数。普通健康快照缺 run ID，不能作为空闲证明；有活动工作返回 deferred，无法核验活动状态返回显式失败，均不重启。不是新增全局请求队列或限流。 |
| `electron/main.js` | 三条路径统一初始化安全存储，最终 API 地址默认值确定后恢复凭据，再启动服务、Supervisor 和 renderer；将恢复值注入实际 Provider binding，避免旧服务商环境变量或 manifest 默认地址遮蔽已存凭据。 |
| `electron/providerCredentialStore.js` | 区分不可用、未配置、读取/解密失败；密文存在但不可解密不再报告 configured=true，恢复失败抛安全错误码而非静默回退。沿用 safeStorage 加密，不新增明文持久化。 |
| `tests/unit/v4p0NativeConfigFallback.test.ts` | 真实 bundled save_config 往返、用户值守恒、标记缺失/重复、字段缺失、正常热切换、活动任务、启动/读回/Base URL 失败回滚、歧义 YAML、不明活动状态测试。 |
| `tests/unit/electronCredentialStartupR1.test.ts` | 执行实际 main.js 启动函数的三分支隔离测试，验证初始化顺序、恢复、Provider binding、IPC 安全状态及错误。依赖/服务为 VM 模拟，不能代替原生 Electron 验收。 |
| `tests/unit/v4p0ProviderCredentialStore.test.ts` | 将原“不可解密仍 configured”的断言加强为显式失败及 configured=false；保留加密/不泄漏断言。 |
| `tests/e2e/hermes-config-r1.spec.ts`、`playwright.hermes-r1.config.ts`、`scripts/hermes-integration.mjs` | R1 专用真实 bundled Hermes + Next + 浏览器集成入口；隔离端口/输出目录，记录实际模拟 Provider 的模型序列。 |
| `tests/support/fake-openai-compatible-provider.mjs`、`playwright.config.ts` | 模拟 Provider 记录 model 并支持测试延迟；普通 UI 集合排除需要专用运行环境的 R1 集成。 |
| `scripts/test-electron-credentials.cjs`、`tests/support/electron-credential-smoke.cjs` | 可重复的原生 Electron safeStorage 双进程保存/正常退出/恢复测试；使用隔离目录及合成凭据，不启动 Provider。 |

恢复合并保证 YAML **值/语义**守恒，不保证注释、键排序、引号或换行样式逐字不变；失败原件及备份逐字保留。仅 CareerAdapt 已明确管理的坐标和必要不变量被更新。已有用户启用的工具不会因默认模式切换被静默删除。

### 验收矩阵

| 项目 | 证据与状态 |
|---|---|
| 标准 managed 往返、真实 bundled save 后切模型 | 相关测试直接调用当前 bundle 的 `save_config(load_config())`；结构合并后 Provider/Base URL/model/活动指纹匹配；原热切换不重启。 |
| 缺/重复 managed 标记、缺 default/custom model | 定向单测覆盖受控恢复；重复实际 YAML 键显式失败，原文件不变。 |
| 用户配置保留 | 完整解析前后对比，仅改目标模型；覆盖额外模型参数/fallback、另一自定义 Provider、用户 toolsets/MCP、gateway 及未知字段。 |
| 恢复失败回滚 | 启动失败、运行时模型读回错误、磁盘 Base URL 错误均保留旧活动模型及指纹、恢复原文件；失败状态不显示候选为已应用。 |
| 活动任务保护 | 快照有 run 时先延迟；普通快照无 run ID 时另读实际详细活动计数；busy 延迟、不可核验失败；已有任务不被停止。普通热切换不走这项重启前检查。 |
| 地址/凭据变化 | 沿用原受控生命周期，相关既有测试继续运行；未新增自动重试。 |
| 三条 Desktop 启动路径顺序 | reuse/self/packaged 的 main.js VM 执行测试通过，初始化/恢复先于服务/Supervisor/IPC 使用；标为隔离证据。 |
| 实际 Electron 安全持久化 | Electron **43.2.0**、真实 safeStorage：合成凭据写入、正常退出、新进程读取，两次独立进程退出 0，source=secure_store，磁盘无明文。见 R1 证据 JSON。 |
| 真实产品 Desktop 窗口/重启闭环 | **BLOCKED**。自动化经历启动/IPC 页面等待超时；一次自建 dev 产品窗口最终到达 localhost 页面并通过真实 IPC 写入加密凭据，但配置 applyStatus=failed。后续测试进程被中断，重启出现 credential_store_read_failed，不能作为“正常退出后产品恢复通过”或据此认定正常重启失败。两次等待超时后停止此完整流程，不继续反复重跑。 |
| 实际复用外部 dev 服务 | **BLOCKED**。未到达原生完整流程中的此步骤；仅 VM 分支验证通过。外部 Next 进程内存不因 Electron 环境注入而被宣称同步；未改 Web 内存凭据生命周期。 |
| 正式 packaged 启动 | **BLOCKED**。本轮按要求未生成新安装包/免安装交付，不用旧 release 或 VM 结果替代新代码正式打包验收。 |

### 实际命令与记录

- 修改前：`pnpm typecheck` 退出 **0**；`pnpm exec vitest run tests/unit/v4p0NativeConfigFallback.test.ts tests/unit/hermesSupervisor.test.ts tests/unit/hermesCompanion.test.ts tests/unit/v4p0ProviderCredentialStore.test.ts tests/unit/webDevelopmentCredentials.test.ts` 退出 **0**，实际命中 4 文件 **43 项**（不存在的 Companion 测试路径未算通过）。
- 最终相关集合：`pnpm exec vitest run tests/unit/electronCredentialStartupR1.test.ts tests/unit/v4p0NativeConfigFallback.test.ts tests/unit/v4p0ProviderCredentialStore.test.ts tests/unit/hermesSupervisor.test.ts tests/unit/webDevelopmentCredentials.test.ts tests/unit/p46g-provider-binding.test.ts tests/unit/p47a-agent-capability-contract.test.ts tests/unit/v4p0ProviderCredentialRoute.test.ts`：8 文件 **79 项**，退出 **0**。
- 修改文件 ESLint：`pnpm exec eslint` 后接本节源码/测试/配置清单（不含 Python/Markdown）及 `--max-warnings=0`；已取得退出 **0**，最后检查见 R1 证据 JSON。Python AST 解析退出 **0**。
- 生产构建：PowerShell `$env:CAREERAD_NEXT_DIST_DIR='.tmp/r1-production-build-final'; pnpm build`，退出 **0**。首次默认输出构建与并行 `.next` 集成目录发生 ENOTEMPTY 冲突、退出 **1**；改用独立输出后通过，没有清目录规避错误。
- 真实 bundled 浏览器集成：最终 `node scripts/hermes-integration.mjs config-r1` 退出 **0**，1 项通过（51.1 秒）、3 次实际模拟 Provider 请求；模型序列为 `careeradapt-test → r1-hot-model → Qwen3.8-27B`，3 次鉴权均匹配。旧任务期间恢复返回 deferred/不重启；旧任务正常完成后，重试恢复 applied/verified。所有 Provider 请求均为隔离模拟，不是远端 AMD 成功证据。
- 原生安全存储：`node scripts/test-electron-credentials.cjs` 退出 **0**，内部实际 Electron write/read 两进程均 **0**。初版 fixture 用 app.exit 强退导致 Local State 未落盘，read 退出 **1**；改为 app.quit 正常退出后通过。未修改产品来掩盖这项测试前提。
- 完整 Desktop 自动化：`node .tmp/r1-electron-native.cjs` 未通过，最终退出 **1**；环境的 ELECTRON_RUN_AS_NODE 与 DevTools 窗口选择先后纠正，之后完整重启链仍阻断。原始临时日志不作为可分发证据，安全结果投影写入 R1 JSON。
- 过程还修复了新测试错误的 body.settings 传参（正式接口读取 x-ai-config）及 Windows CRLF 热更新回归；未删除断言/增加 skip/降低业务阈值。运行中直接热切换的扩展实验遇到 model/options 请求超时并回滚，停止重复该实验；这不等于普通空闲热切换验收失败，也不宣称运行中热切换在所有条件下必定成功。

本地修复和可执行定向验收按本节与 R1 JSON 交付；完整 Desktop/packaged 验收未通过部分保留 BLOCKED。最终 typecheck、diff、Git 状态及交接均在结束前回读核对；Next 自动生成的 tsconfig/next-env 改动按起始字节恢复，不纳入本轮。所有改动尚未提交、未推送、未打包交付；停止于 R1，等待下一阶段授权。

### 提交范围更新

2026-10-28 用户随后明确授权提交并推送本对话改动。本次纳入专项诊断、R1 修复、回归测试及脱敏证据共 19 个文件；保留未纳入的原有 A03 测试修改、P5.1 开发计划和基线审计报告。上文“未提交/推送”为修复验收当时状态；提交号与远程回读结果记录在本地 plan4/history4。Desktop BLOCKED 项保持，不打包、不进入后续阶段。

## 9. R1 Closure：产品级凭据持久化收尾诊断（部分通过，仍 BLOCKED）

2026-10-28，基线 `d8c31c34d00002cdbd1a81c60a58b577a783e4dd`。开始时仅原有 A03 测试修改和两份未跟踪 P5.1 文档；均保留。按用户限制执行一轮完整定向诊断、一次有明确假设的复验后停止，没有第三轮启动，没有修改生产源码或开始 R2，没有提交/推送/打包。

证据：[p5.1.0-r1-closure-evidence-20261028.json](p5.1.0-r1-closure-evidence-20261028.json)。保留两轮真实输出，不追溯把未采集状态补成通过。

### 沿实际调用链的结论

1. `providerCredentialStore.write()` 的 `ok` 只表示 safeStorage 写入；真实 `careeradapt:credentials:set` IPC 将此结果与独立的 `control.ok / receipt.applyStatus` 一起返回。二者不能混为一项成功。
2. `main.js` 在 Next/Supervisor/renderer 启动前调用现有安全恢复；`describe()` 区分不可用、未配置、不可解密。模型配置校验失败不会删除已保存密文。
3. Supervisor 保留 `rendererReady` 门禁。第一轮真实 IPC 写入已成功，但配置回执为 `failed / hermes_renderer_not_ready`，没有假报应用成功。这个错误不是 Provider 429，也不是凭据丢失的证据。
4. **已证实的测试缺陷**：本次初版 runner 使用 `page.waitForFunction(async () => …getHermesStatus()… === 'ready')`。当前 Playwright 1.61.1 的执行代码同步判断 `predicate()` 的返回值，Promise 为真值，随后可解析成 false 而结束等待。本机实际页面执行 `async () => false` 已验证未超时而返回 false。因此第一轮输出中 `rendererAndRuntimeReady=true` 是无效的测试自报状态，不能作为真实 READY 证据。原 R1 `.tmp` 窗口脚本根本没有等待真实 Runtime READY，存在同类提前操作问题；不能据此断言其历史每一次失败都具有完全相同原因。
5. 将等待改为 Node 端逐次 **await 实际 IPC 结果** 后，复验中的同一产品保存流程取得 `control.ok=true / applied / verified=true`。这支持“提前发 IPC 导致门禁拒绝”的定位，不需要修改产品来绕过门禁。

### 四个独立状态与实际验收

| 状态/场景 | 本轮真实结果 | 限制 |
|---|---|---|
| 凭据写入成功 | PASS：实际 Electron 43.2.0 产品窗口、真实 preload/IPC、safeStorage 可用；写入后 configured=true/source=secure_store；文件无明文测试 Key。 | 合成 Key、独立 userData。首次进程环境中预置同一合成 Key 以完成初始 READY；不是“所有环境凭据均为空”的首次配置验收。 |
| 模型配置应用成功 | PASS：实际等待 READY 后保存返回 applied/verified；随后故意提交无效 URL，回执为 failed/provider_base_url_invalid。 | 不把 store.ok=true 当作 control.ok=true。 |
| 实际模型请求成功 | PASS：产品 Next `/api/ai/test` latency 发出实际 HTTP 请求，模拟 Provider 记录鉴权匹配并返回 200；应用返回 ok=true、model=closure-model、credentialSource=secure_store。 | 这是模拟 Provider 的真实网络请求；不是 AMD 成功认证，也不是一次完整 Hermes Agent 工具任务。 |
| 配置失败后已存凭据仍在 | PASS：故意 URL 校验失败后，真实 describe IPC 仍返回 configured=true/source=secure_store。 | 保留失败状态，没有伪造成功。 |
| 保存后正常退出 | PASS：真实 window.close → 产品 window-all-closed/app.quit；首个复验进程退出码 0，Local State 落盘；未用 taskkill/app.exit 冒充正常退出。 | 正常退出本身不能单独证明下一进程恢复成功。 |
| 新进程恢复凭据 | **未独立验收完成**：正常退出后确实启动了新产品进程，进入 HTTP 页面并能够调用 getHermesStatus IPC；未出现被捕获的 credential_store_read_failed 启动错误。 | 执行版本在读取独立 describe 回执前等待 Hermes READY；最终停在 degraded，因而没有取得新的 describe/鉴权请求证明。不标记恢复 PASS，也不以 degraded 推断凭据恢复失败。 |
| 重启后不改 Key 切模型 | BLOCKED：未到达此步骤。 | 不以此前 R1 Web 集成或 VM 测试替代本次产品证据。 |
| 密文存在但不可解密的实际产品启动 | BLOCKED：未到达专用坏密文步骤。 | 修改前现有相关存储测试通过，但不是该原生产品场景的运行证据。 |
| 正式 packaged | BLOCKED：没有测试新打包产物。 | 不使用旧安装包或 VM 结果替代。 |

### 第二轮的具体阻塞与停止

新进程的实际 IPC 状态在 90 秒预算内保持 **degraded**，没有达到 ready。其 Hermes 日志记录了第二次 API Server health check passed；这只说明基础进程健康探测通过，不能代替 MCP/Provider/工具面整体 READY。

执行版本未保存最后 snapshot 的 `reasonCode/providerReady/careerMcpReady`，因此不能把阻塞进一步归因为密钥、Provider、MCP、旧进程或其他具体模块。没有新增 429 证据，也没有修改产品规避该状态。结束后核对没有残留的本轮 Electron 进程或这些进程的直属子进程。

对旧 `credential_store_read_failed`：本轮正常退出后的新启动没有复现被捕获的同名启动错误，但由于独立恢复回执缺失，尚不足以完全关闭该事项。之前中断测试进程、强退导致 Chromium 加密 Local State 未落盘仍是与历史证据一致的解释，不能在本轮将它升级为全部历史事故的已证实根因。

按照用户“两轮上限”停止，不第三次启动。下一步所需条件是单独授权一次围绕重启 degraded 的采集：IPC 页面可用后先记录 describe，独立记录 runtime snapshot/具体 reason 及 Provider/MCP 状态，不把采集本身依赖于 READY。

### 修改与验证

- **没有生产修复文件**：证实的提前调用问题在测试等待中；剩余运行时原因证据不足，不修改 `providerCredentialStore.js/main.js/HermesRuntime` 来迎合测试。
- 新增 `scripts/electron-credential-closure.cjs`：直接启动真实 Electron，通过 CDP 操作产品页面和真实 IPC；独立目录、合成 Key/Provider、真实请求、安全结果投影、正常关闭及跨进程序列。没有自动重试启动循环。
- 新增 `tests/support/electron-product-closure.cjs`：只设置独立 userData、抑制开发 DevTools/隐藏测试窗口并捕获启动错误对话框；加载实际 `electron/main.js`，没有 mock store、IPC、Next、Supervisor 或人工发送 READY。
- 两次实际命令均为 `node scripts/electron-credential-closure.cjs`，各自执行当时版本：第一轮退出 **1**（提前 READY 等待导致配置被拒）；第二轮退出 **1**（新进程 runtime degraded 超过预算）。原始两轮结果保留在 Closure JSON。失败没有改写为测试通过。
- 第二轮停止后，仅完善 runner 采集点：IPC 可用即记录 storage，保存最终 runtime reason，并给正常退出清理增加有限等待。这些新增采集字段**未再次原生运行验证**，不回填到本轮运行证据；下一轮只能由用户另行授权。
- 修改前 `pnpm typecheck` 退出 **0**；`pnpm exec vitest run tests/unit/electronCredentialStartupR1.test.ts tests/unit/v4p0ProviderCredentialStore.test.ts tests/unit/hermesSupervisor.test.ts tests/unit/v4p0NativeConfigFallback.test.ts` 4 文件 **50 项**、退出 **0**。
- 最终 `pnpm exec eslint scripts/electron-credential-closure.cjs tests/support/electron-product-closure.cjs --max-warnings=0`、`pnpm typecheck` 和 `git diff --check` 均退出 **0**。只新增诊断/测试与文档，未重跑生产构建或全量门禁。
- Next 自动修改的 tsconfig.json/next-env.d.ts 已按任务开始字节恢复；原有三项工作区成果保留。plan4/history4 已同步；最终 Git 状态见 Closure JSON。未自动提交、推送或打包，停止于 R1 Closure 的部分验收状态。

## 10. 最终单次定向采集与阶段交接（2026-10-28，情况 A）

基线与远程 main 均核对为 `e07c617fafad06202f68665ccac247f01d5f0f1f`。本轮是用户在历史两轮之后**另行明确授权的一次**定向采集；仅一次脚本调用，没有失败重跑、延长等待或重新执行完整 R1 门禁。

证据：[最终定向采集 JSON](p5.1.0-r1-closure-final-evidence-20261028.json)。历史 Closure 的 round1/round2 原始失败保留，新结果不回填旧轮次。

### 已验证：跨进程凭据恢复 PASS

同一独立 userData 下保存合成 Key，实际产品正常退出；新进程环境中的 AI_API_KEY/HERMES_CUSTOM_CAREERADAPT_API_KEY 为空。新进程 IPC 页面可用后，在任何 READY 等待之前，真实 preload IPC `describeProviderCredential()` 返回：

```json
{"available":true,"configured":true,"source":"secure_store"}
```

新进程未捕获 `credential_store_read_failed`，没有启动错误事件，两个产品进程均正常退出码 0。因此按用户给定情况 A，将**跨进程凭据恢复**子项标为通过。结合此前及本次首进程的加密写入、磁盘无明文、配置故意失败仍保留凭据的证据，当前没有证明需修复的凭据存储/恢复产品缺陷。

### 独立问题：Runtime Readiness OPEN（R2-RDY-01）

新进程最终真实 IPC 快照为：

| 字段 | 观测值 |
|---|---|
| overallState | degraded |
| reasonCode（原始 JSON 字段 reason） | hermes_companion_unreachable |
| providerReady | false |
| careerMcpReady | true |
| runtimeConfig.applyStatus | idle |

保留这项真实失败；没有修改 READY 门禁、产品状态或断言。原诊断脚本等待原定 90 秒预算后因 READY 断言失败，**进程退出 1**，不等于凭据恢复子项失败。原因码只能证明当前运行时被判断为不可达，不能进一步断言网络、控制鉴权、进程或服务商的具体根因，更不能当作 Key 丢失或额度不足。

### 未验证项与下一阶段边界

- 恢复后切模型的完整应用、恢复后的模型实际请求：脚本未到达，仍未验证，不宣称通过。
- 原生产品坏密文启动场景：未到达，不用旧单测代替。
- 正式 packaged：保持 BLOCKED，未使用旧安装包或 VM 模拟结果替代。
- 初始进程环境预置合成 Key 以建立 READY；这不是“全部环境凭据为空的首次配置”认证。本轮恢复结论只依据后续空 Key 环境新进程的真实 secure_store IPC 回执。
- 本轮模拟 Provider 请求不代表 AMD/其他真实 Provider 认证；没有实际远端 429 新测试。

用户已要求准备 P5.1.1/R2；交接见 [R2 准备文档](p5.1.1-r2-handoff-20261028.md)。R2 优先 Agent 错误诊断、工具反馈、配置状态可观测性及失败处理，沿用 Hermes/MCP。凭据恢复的剩余证据缺口已解除；独立 Readiness 问题不能无限期阻塞不依赖真实 READY 的 R2 工作。这里只准备交接，不实施 R2，不重写 Runtime，不增全局重试、队列或限流。

### 本轮修改与检查

`credentialAtIpc` 和 `lastRuntimeStatus` 已先于 READY 断言采集，但旧脚本要等清理结束才写文件。仅修改 `scripts/electron-credential-closure.cjs` 的**证据保存顺序**：原子检查点在取得 IPC/状态后、catch 后和清理前落盘；退出回调补存退出码，排除内存 Promise 字段。没有修改运行场景、等待预算、错误判定或生产代码。

实际唯一命令：PowerShell 设置 `CLOSURE_ROUND=1`、`CLOSURE_EVIDENCE_PATH=.tmp/r1-closure-final-e07c617.json` 后执行 `node scripts/electron-credential-closure.cjs`；退出 **1**（上述独立 READY 失败），证据完整保存。runner 内部旧 baseline 标签仍为 d8c31c3；最终证据外层 codeBaseline 是本轮实际核对的 e07c617，不把旧标签作为运行代码来源。

本轮只运行诊断脚本语法检查、修改脚本 ESLint、typecheck、JSON/引用/秘密扫描与 diff 检查；不重跑全量测试、构建或实际 Electron 诊断。Next 自动修改按起始字节恢复，原有 A03 修改及两份未跟踪文档逐个 SHA-256 核对保留。本轮进程清理结果及最终 Git 状态记录于最终 JSON。没有提交、推送或打包，完成采集与阶段准备后停止。
