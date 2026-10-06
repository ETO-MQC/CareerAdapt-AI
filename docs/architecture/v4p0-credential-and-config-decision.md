# V4-P0 补充：定向验证结论、前端凭据阻塞项与 C 路径决策

- 状态：待确认（本文件补充 `v4p0-blocker-fix-plan.md` 的 C 部分与新增安全阻塞项）
- 建立日期：2026-10-05
- 关联提交：`b65a254`（REAL_SMOKE_PASS smoke 用例）、`579273b`（初版方案）

---

## 1. 定向验证结论：重启回退路径**正常工作**

按要求补了定向测试 `tests/unit/v4p0NativeConfigFallback.test.ts`（4 项，全部通过；相关既有测试 34 项无回归）。测试以生产事实为前提：gateway 对 `/api/model/info`、`/api/model/set`、`/api/providers/validate` 一律返回 404，而 `/v1/capabilities`、`/v1/skills`、`/v1/toolsets`、`/api/model/options` 返回 200。

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| `/api/model/info` 返回 404 | ✅ 确认 | 测试断言 `supportedEndpoints` 恰为四项且不含 `/api/model/info`；实测探测确实发出（`modelInfoCount = 1`） |
| discoverCapabilities 将 nativeModelConfigSupported 置为非真 | ✅ 确认 | `capabilities.features.nativeModelConfig` 缺席；`getConfig().runtimeConfigWritable = true` |
| updateConfig 走 applyConfigurationWithLifecycleRestart | ✅ 确认 | `/api/model/set` 调用次数为 **0**，但 companion 被重启（`startCount` 递增） |
| 新 provider/model 经重启后生效 | ✅ 确认 | 重启传入的环境含新 `AI_MODEL` 与新 `AI_BASE_URL`；health 回读同步更新 |
| runtimeConfig applyStatus=applied、verified=true | ✅ 确认 | `applyStatus: "applied"`、`verified: true` |
| config.yaml 不写入原始 API Key | ✅ 确认（**结构性保证**，非偶然） | 见下方 1.1 |

### 1.1 config.yaml 不可能包含原始 Key（结构性保证）

这一点比初版方案描述的更强，不是"当前恰好没写"，而是**写入路径上不存在可容纳密钥的字段**：

- `ensureManagedHermesConfig()`（`electron/hermesCompanion.js:281`）写入的 managed block 是一份**固定字段白名单**（`:309-332`）：`model.default`、`model.provider`、`base_url`、`custom_providers.key_env`、`platform_toolsets`、`mcp_servers`、`gateway`。其中没有任何 `api_key` 类字段。
- `:290` 的 `genericApiKey` 只用于解析出 `binding.credentialEnvName`，**其值不进入 YAML**。
- `:321` 写的是 `key_env: ${binding.credentialEnvName}` —— 只是环境变量**名称**。
- `:311-312` 还显式写入两行注释：`Do not put API keys in this file.` 与 `The provider key is injected into Hermes as <ENV>; the value is never stored here.`
- 密钥的真实去向是**子进程环境变量**：`prepareHermesEnvironment()` 在 `:206` 显式清空 `AI_API_KEY: ""`，再把密钥写入 provider 专属变量（`:207-209` `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `HERMES_CUSTOM_CAREERADAPT_API_KEY`）。
- 实测本机真实文件 `%APPDATA%/careeradapt-ai/hermes/config.yaml`：只有注释里的环境变量名，无任何密钥值。

测试用两种 binding 分支各写一次真实文件并断言不含密钥：known provider（OpenRouter，按 hostname 识别，见 `hermesProviderBinding.js:16`）与 custom provider。

**附带发现（与本任务无关，但影响设置页诊断）**：`resolveHermesProviderBinding` 按 **hostname** 判定 OpenRouter，不看 provider 字符串。若用户在设置页填 `provider=openrouter` 但 `baseUrl=https://provider.example/v1`，会**静默降级**为 `custom:careeradapt`，并使用 `HERMES_CUSTOM_CAREERADAPT_API_KEY`。这与历史"配置绑定漂移"现象一致，建议在设置页对组合做提示，但不属本轮范围。

**额外发现（比初版方案更精确）**：回退有**两道**防线，而非一道。

1. `/api/model/info` 探测返回 404 → `nativeModelConfigSupported` 非真 → 直接走重启回退；
2. 即使未来某个构建暴露了 `/api/model/info`，`applyNativeModelConfiguration` 内部的 `validateProviderCredential`（`/api/providers/validate`，同样 404）会抛出 `hermes_provider_validation_endpoint_missing`，被 `:610-618` 捕获后**再次降级**到同一条重启回退。该场景已单独用一例固化。

结论：**"保存并应用"功能是通的，不需要新增任何 Hermes gateway 配置 API。**

---

## 2. C 路径决策

按你的判据：

- **保留并正式固化现有重启回退路径**，不新增 Hermes gateway 配置 API；
- **不选择路径 2**，不为消除 404 而 patch bundled Hermes；
- 路径 1 也不需要 —— 因为回退路径已经验证可用。

据此，`v4p0-blocker-fix-plan.md` 的 C 部分收敛为「固化 + 补测试 + 补文档」，具体为：

| 实施项 | 内容 | 状态 |
| --- | --- | --- |
| C-1 | 保留 `applyConfigurationWithLifecycleRestart` 为唯一应用路径 | 不改代码 |
| C-2 | 用本次 4 项测试固化 404 探测、回退、生效、校验与凭据不落盘 | **已完成**（`v4p0NativeConfigFallback.test.ts`） |
| C-3 | 在 `electron/hermesSupervisor.js` 的 `capabilitiesWithModelConfig()` 注释中写明：native端点在 gateway 不存在是预期状态，回退是正常路径而非降级事故 | 待确认 |
| C-4 | 设置页对"保存并应用"的文案与预期对齐（当前可能暗示热切换） | 待确认 |
| C-5 | 删除或改造 `electron/hermesModelConfigClient.js` 中永不成功的调用分支（`readEnv`、`/api/env`、`/api/providers/custom-endpoints`），避免未来误接 | **建议做**，需你确认 |

C-5 的理由：这些分支在当前 gateway 下 100% 不可达，保留只会误导后续维护者以为运行时配置能力可用。但删除属于行为变更，需你确认。

---

## 3. 新增安全阻塞项：API Key 由前端持有并持久化

### 3.1 已核实的事实

| 环节 | 位置 | 事实 |
| --- | --- | --- |
| 存储介质 | `src/services/storage/aiSettings.ts:51` | `localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))`，`apiKey` 为**明文**字段 |
| 读取 | 同文件 `:26`、`:34` | 启动时从 localStorage 读回 `apiKey` |
| 传出 | 同文件 `:76-78` | `encodeAiSettingsForHeader` = `btoa(encodeURIComponent(JSON.stringify(settings)))` ——**base64 编码，不是加密** |
| 发送方 | `src/ai/client.ts:66`、`src/services/agent/hermesControl.ts:928` 与 `:1001` | 每次请求带 `x-ai-config` 头，内含 API Key |
| 接收方 | `src/app/api/ai/test/route.ts:20`、`src/app/api/ai/structured/route.ts:69`、`src/app/api/agent/runtime/hermes/control/route.ts:53` | 服务端解码后使用 |
| 界面入口 | 设置页保存成功后持久化 | 用户可把 Key 存进浏览器 localStorage |

这**直接违反**方案 C.3.2「renderer 不得直接持有或提交 provider 原始 Key」，也违反 `AGENTS.md` §3「不将 API 密钥写入前端、源码或仓库」。

### 3.2 实际风险

1. **XSS 即等于凭据泄露** —— 任何 renderer 侧的脚本注入都能读走明文 Key；
2. **base64 不是保护** —— `x-ai-config` 出现在请求头，任何日志/抓包/代理都会记录可直接解码的 Key；
3. **范围超出本机** —— localStorage 属于浏览器配置目录，与应用自己的 `userData` 凭据管理（Hermes 侧 `OPENROUTER_API_KEY` 环境变量注入）割裂，用户以为"存在主进程"，实际"存在浏览器"；
4. **与 Hermes 路径不一致** —— 走 Hermes 时 Key 由 Electron 主进程注入环境变量（`hermesCompanion.js:206` 显式清空 `AI_API_KEY` 后按映射注入）；走 Next route 时才用前端传来的。两套凭据来源、两套生命周期。

### 3.3 最小修复方案

**目标**：renderer 永不持有原始 Key；凭据只有两个合法来源 —— 应用进程环境变量，或用户在主进程侧显式设置。

**S-1 停止持久化 Key**

`writeAiSettings`（`:51`）当前把整个 `settings` 直接 `JSON.stringify` 落盘，`apiKey` 是明文字段。改为：写出前把 `apiKey` 置空，只保留 `apiKeyConfigured: boolean`；读取时（`:34`）发现旧结构含 `apiKey` 则**一次性擦除**并提示用户重新配置，避免明文 Key 长期残留。`hasCustomAiSettings`（`:69`）对 `apiKey.length > 0` 的判断需相应改为基于 `apiKeyConfigured`。

**S-2 停止经 header 传 Key**

`encodeAiSettingsForHeader` 改为只编码 `provider`、`baseUrl`、`model` 三个非敏感字段，永不包含凭据。三个接收方（`/api/ai/test`、`/api/ai/structured`、`hermes/control`）相应改为：凭据只从服务端环境读取；若请求带着凭据字段则**明确拒绝**并返回可诊断错误码，而不是静默忽略。

**S-3 设置页改为"由主进程管理"**

注意现有 `AiSettings` 已带 `credentialAction?: "unchanged" | "replace" | "clear"`（`aiSettings.ts:9`），且 `readAiSettings`/`decodeAiSettingsFromHeader` 都实现了它（`:37-39`、`:92-94`），注释明确写着「Blank keys are normally left unchanged; the UI uses clear explicitly」。也就是说**清空/替换的语义已经存在**，S-3 应复用它而不是另造机制：

- 设置页的 API Key 输入框改为只显示当前凭据的**来源与是否已配置**（取自 `getConfig()` 已有的 `apiKeyConfigured` / `credentialSource`），不回显明文；
- 「更换 Key」引导用户改应用环境配置，或走主进程写入通道；「清除」沿用现有 `credentialAction: "clear"`；
- 保留 `credentialAction` 字段本身，避免破坏 `/api/ai/test` 等既有分支对 `unchanged` 的判断。

**S-4 清理既有泄露面**

- 检查 `src/ai/client.ts:66` 与 `hermesControl.ts:928/1001` 在 S-2 后不再携带凭据；
- 增加单测：`x-ai-config` 头在任何代码路径下都不包含 `apiKey`；
- 增加单测：`localStorage` 写入的设置对象不含 `apiKey` 字段。

**S-5 边界**

- 不新增依赖；
- 不改变 Hermes 侧的凭据注入机制（已满足：Key 只在主进程内存与子进程环境变量中）；
- 不把 Key 写入任何被跟踪文件；
- 与 `AGENTS.md` §3「不将 API 密钥写入前端」一致，属于**移除**既有违规而非新增限制。

### 3.4 验收

- 单测断言 `encodeAiSettingsForHeader` 输出不含 `apiKey`；
- 单测断言 `writeAiSettings` 后 localStorage 中无 `apiKey`；
- 三个接收方对携带凭据的 header 返回明确错误码；
- 设置页不再回传明文 Key；
- `pnpm typecheck` / 全量 lint / 全量测试 / `pnpm build` / `git diff --check` 均退出码 0；
- 端到端：改用环境变量配置凭据后，真实 provider smoke 仍通过（复用 `tests/e2e/v4p0-provider-smoke.spec.ts`）。

---

## 4. A、B 的决定（按你的指示保持不变）

| 项 | 决定 |
| --- | --- |
| 旧目录 `careeradapt-ai-electron-shell` | 迁移并保留时间戳备份 |
| 权威定位文件 | 采用与产品名解耦的稳定位置 `%APPDATA%/CareerAdapt/hermes-home.json` |
| 凭据缺失快速失败 | **本轮只做 CareerAdapt 侧（B2.1）** |
| Hermes runtime 的 `no-key-required` | 另行处理，本轮不改 bundled runtime |

---

## 5. 待确认

1. **C-5** 是否执行：删除或改造 `hermesModelConfigClient.js` 中永不成功的调用分支（`readEnv`、`/api/env`、`/api/providers/custom-endpoints`）。
2. **C-3 / C-4** 是否执行：补注释固化"回退是正常路径"，以及修正设置页文案。
3. **S-1~S-5** 的顺序建议为 S-2 → S-1 → S-3 → S-4（先断传输，再断持久化，再改界面）。是否同意该顺序。
4. 本文件确认后，我更新 `v4p0-blocker-fix-plan.md` 的 C 部分并把新增安全阻塞项并入，然后按 A → B2.1 → S → 定向 contract test 的顺序实施。在定向 contract test 全绿前不开始 V4-P1。
