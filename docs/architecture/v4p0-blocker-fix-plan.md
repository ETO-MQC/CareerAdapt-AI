# V4-P0 阻塞项最小修复方案：配置根目录、凭据缺失快速失败、gateway API 合同

- 状态：待执行（方案待确认）
- 建立日期：2026-10-05
- 关联：V4-P0 Provider Health Smoke 结论 `REAL_SMOKE_PASS`
- 阻塞范围：以下三项完成并通过定向 contract test 前，不得开始 V4-P1

---

## 0. 诊断基线（本方案的事实依据）

### 0.1 Provider Health Smoke 结论

分类为 `REAL_SMOKE_PASS`。真实链路 `renderer → Next → Hermes gateway → provider` 返回正确回复，推理链路无 API 失败。分层证据：

| 层 | 结果 |
| --- | --- |
| 凭据本身 | 有效（`/models` 200、`chat/completions` 200 且有回复） |
| Next → provider | 健康探针 `provider_status=200`；`/api/ai/test` latency 模式 `ok=true` |
| Hermes → provider | 日志 `Vision auto-detect: using main provider openrouter (<model>)`，模型解析正确 |
| MCP | 协议 `2025-06-18` 协商成功，注册 11 个 CareerAdapt 工具 |
| 控制面 401 | 与 provider 无关；是 Hermes 对 `/api/sessions`、`/api/model/options` 的 `API_SERVER_KEY` 鉴权 |

### 0.2 历史 401 的真实成因

不是凭据失效，而是**配置绑定漂移**叠加**凭据缺失静默回退**：

1. 磁盘上的 Hermes `config.yaml` 与当前 `.env.local` 的 provider/model 不一致，Hermes 一直按旧绑定运行；
2. 绑定漂移后 `key_env` 指向的环境变量解析不到值；
3. Hermes 侧 `runtime_provider.py:1133` 在拿不到 key 时使用字面量 `no-key-required` 发请求，**不报错**，必然 401。

### 0.3 三个并存的配置根目录

`hermesHome` 取自 `electron/main.js:109` 的 `app.getPath("userData") + "/hermes"`，而 `userData` 目录名由 `app.getName()` 决定：

| 运行形态 | `app.getName()` 来源 | 实际目录 |
| --- | --- | --- |
| 开发（`electron .`） | `package.json` 的 `name` = `careeradapt-ai` | `%APPDATA%/careeradapt-ai/hermes` |
| 打包后 | `electron-builder.yml` 的 `productName` = 职就AI | `%APPDATA%/职就AI/hermes` |
| 历史遗留 | 两者均不匹配 | `%APPDATA%/careeradapt-ai-electron-shell/hermes` |

当前没有任何代码对这三者做迁移、校验或告警。诊断过程中我曾因查错目录而得出错误结论，这正是该缺陷的实际危害。

---

## A. 配置根目录统一

### A.1 目标

确定唯一权威 Hermes 配置根目录，并让另外两个目录要么被显式迁移，要么在启动时显式告警，**禁止静默选择错误配置**。

### A.2 实施项

**A2.1 单一权威目录常量**

在 `electron/main.js` 侧引入显式常量，例如 `resolveHermesHomeDir(app)`，规则：

1. 若 `CAREERADAPT_HERMES_HOME` 已设置 → 直接使用（保留现有最高优先级）；
2. 否则使用 `app.getPath("userData")/hermes`，但**要求目录归属可判定**：应用启动时把权威目录记录到一个固定的、不随 `userData` 变化的定位文件（建议 `%APPDATA%/CareerAdapt/hermes-home.json`，`CareerAdapt` 为与产品名无关的稳定目录）；
3. 首次运行时写入该定位文件，后续一律以它为准，避免 `name`/`productName` 差异导致目录漂移。

**A2.2 旧目录显式处理**

启动时扫描已知的遗留目录（当前至少 `careeradapt-ai-electron-shell`）：

- 若该目录存在且权威目录不存在 → **迁移**：把 `config.yaml`、`auth.json`、`sessions/`、`logs/`、`skills/` 迁到权威目录，并在应用日志输出一次明确 INFO（只输出路径与文件数量，不输出凭据内容）；
- 若两者都存在且内容不一致 → **不静默选择**���输出显式 WARN，列出两个目录的 `config.yaml` 的 `model.provider`/`model.base_url`（不含凭据），要求用户确认或显式设置 `CAREERADAPT_HERMES_HOME`；在用户确认前，以权威目录为准继续运行，但必须留下可检索的告警记录；
- 若仅遗留目录存在且内容与当前环境变量推导的绑定一致 → 记录 INFO 后直接使用权威目录（等价于迁移）。

**A2.3 绑定一致性自检**

`ensureManagedHermesConfig`（`electron/hermesCompanion.js:281-347`）写入 managed block 后，立即回读并校验：

- `model.provider`、`model.base_url`、`model.default` 与本次解析出的 `binding`/`model` 一致；
- 不一致时抛错并以非零失败码结束 companion 启动，**不得**沿用旧值继续运行。

**A2.4 配置根目录必须有单一真源测试**

新增单元测试：给定 `app.getName()` 返回 `careeradapt-ai` 与 职就AI 两种情形，`resolveHermesHomeDir` 必须返回同一权威路径。

### A.3 验收

- 三目录场景各跑一次 companion 启动，日志出现且仅出现一次明确的迁移或告警记录；
- 故意让磁盘 `config.yaml` 与环境变量不一致时，companion 启动失败而非静默沿用旧值；
- 目录归属单元测试覆盖两种 `app.getName()`。

---

## B. 凭据缺失快速失败

### B.1 目标

凭据解析失败必须**显式报错**，禁止把 `no-key-required` 当通用回退值。

### B.2 实施项

**B2.1 在 CareerAdapt 侧先行拦截（不改 Hermes 源码）**

`electron/hermesProviderBinding.js` 的 `resolveHermesProviderBinding` 已在返回中带 `credentialConfigured`。把它提升为**启动前置条件**：

- `credentialConfigured === false` 且 provider 需要鉴权时，`prepareHermesEnvironment`（`hermesCompanion.js:167`）直接抛 `provider_credential_missing`，companion 以非零失败码退出；
- 错误信息只包含 provider 标签、期望的环境变量名与 base URL 的 host，**不含任何凭据内容**。

**B2.2 消除 Hermes 侧的静默回退**

`runtime_provider.py:1127-1134` 当前是：

```
"api_key": api_key or "no-key-required"
```

改为：解析不到 key 时抛 `ProviderCredentialMissing`，由 gateway 转换为 5xx 且 `safeErrorCode = provider_credential_missing`。仅当 provider 被显式声明为无需鉴权的本地端点（如 `ollama`、`lmstudio`、`ollama-cloud` 的本地模式）时才允许空 key。

该项需要改 bundled runtime 源码，因此必须走既有 patch 机制（`runtime-manifest.json` 的 `careerAdaptPatchVersion`），并在 `scripts/prepare-hermes-runtime.mjs` 中可重复应用，不允许手工改 `release/` 或 `.electron-build/` 产物。

**B2.3 日志与诊断脱敏**

- 沿用 `hermesCompanion.js:453-461`、`hermesSupervisor.js:323-329` 的既有脱敏名单，并扩展到 provider 请求错误体；
- 新增断言：任何日志路径都不得出现凭据值、`Authorization` 头值或完整环境变量转储。用一条单测遍历脱敏函数对含 `sk-`、`Bearer `、长十六进制串的输入进行验证。

### B.3 验收

- 清空 `AI_API_KEY` 启动应用：必须在 companion 启动阶段失败并给出 `provider_credential_missing`，**不得**出现 provider 401；
- Hermes 日志中不再出现 `has no resolvable api_key ... no-key-required`；
- 脱敏单测通过；
- 声明为本地无鉴权 provider 时，无 key 仍可正常启动。

---

## C. Hermes 控制面 API 合同

### C.1 现状（已核实）

`electron/hermesModelConfigClient.js` 调用 6 个端点，gateway 路由表（`gateway/platforms/api_server.py:1751` 起 `_http_route_table`）中：

| 客户端端点 | gateway 是否存在 | 替代 |
| --- | --- | --- |
| `/api/model/info` | **MISSING** | `GET /api/model/options` |
| `/api/model/set` | **MISSING** | 无直接替代；需 `POST /api/sessions/{id}/model`（会话级）或改由 CareerAdapt 直接管理 `config.yaml` |
| `/api/env` | **MISSING** | 无 |
| `/api/providers/custom-endpoints` | **MISSING** | 无 |
| `/api/providers/custom-endpoints/validate` | **MISSING** | 无 |
| `/api/providers/validate` | **MISSING** | 无 |

这四个端点只定义在 dashboard 的 `hermes_cli/web_server.py`，不在 gateway。当前 `hermesSupervisor.js:722-724` 靠 `hermes_provider_validation_endpoint_missing` 回退到重启路径，导致 `setProviderCredential`、`validateProviderCredential`、`setMainModel`、`upsertCustomProvider` 全部不可用，凭据只能靠环境变量 + `config.yaml` 落地 —— 直接放大了 A 与 B 的风险。

### C.2 两条可选路径（需你选定）

**路径 1：改客户端去调用 gateway 真实支持的接口（推荐）**

- `validateProviderCredential` → 改为 `GET /api/model/options` + 一次最小 `POST /v1/chat/completions`，据响应判定可用性；
- `setMainModel` → 改为由 CareerAdapt 直接写 managed config block（复用 `ensureManagedHermesConfig`），再 `POST /api/sessions/{id}/model` 或重启 companion 生效；
- `setProviderCredential` / `upsertCustomProvider` → 收敛为“写环境变量 + 写 managed config”，不再尝试调用不存在的端点；
- `readEnv` → 删除（无对应能力），改为从 CareerAdapt 侧配置读取。

优点：不改 Hermes 源码，风险最低，与 A/B 的修复方向一致。
缺点：失去运行时热切换 provider 的能力（当前本来就不可用）。

**路径 2：在 gateway 补齐这些端点**

按 `api_server.py` 现有 handler 风格新增 `/api/model/info`、`/api/model/set`、`/api/providers/*`，并同步 patch 机制。

优点：保留完整运行时管理能力。
缺点：改 bundled runtime，维护面变大；且必须自行保证与 Hermes 内部 provider 解析逻辑一致。

**我建议路径 1。** 理由：当前四个能力本就 100% 不可用（回退到重启），路径 1 用最小改动恢复等价能力，且不引入新的运行时维护面。

### C.3 无论选哪条路径都必须满足

1. 全部调用沿用 `API_SERVER_KEY` 鉴权 + loopback 边界，不得新增无鉴权入口；
2. renderer 不得直接持有或提交 provider 原始 Key。凭据只允许存在于 Electron 主进程内存与子进程环境变量中；任何返回给 renderer 的 payload 必须是不含凭据的诊断信息；
3. 响应不得返回原始凭据，`providerMessage` 走既有脱敏与截断；
4. 定向 contract test 至少覆盖：`setProviderCredential`、`validateProviderCredential`、`setMainModel` 三者的
   - 成功路径
   - 鉴权失败（缺 `API_SERVER_KEY` 或 key 不匹配）
   - 参数错误（缺 baseUrl/model、非法枚举）
   - provider 错误（上游非 2xx、模型不存在、超时）
5. 契约测试必须断言响应体中不出现凭据值。

### C.4 验收

- `electron/hermesSupervisor.js` 不再出现 `hermes_provider_validation_endpoint_missing` 回退；
- 三个方法的成功/鉴权失败/参数错误/provider 错误四类 contract test 全绿；
- contract test 断言无凭据泄漏；
- 端到端：修改 provider 配置后 companion 能按新绑定重启并通过真实 smoke（复用 `tests/e2e/v4p0-provider-smoke.spec.ts`）。

---

## D. 执行顺序与门禁

```
A（配置根目录统一）
  → B（凭据缺失快速失败）
    → C（控制面 API 合同，选定路径后实施）
      → 定向 contract test 全绿
        → 重新执行一次真实 provider smoke
          → 才允许开始 V4-P1
```

每一步独立提交，且必须满足：

- `pnpm typecheck` 退出码 0
- changed-files ESLint 退出码 0
- 相关单元/集成测试通过，用例数只增不减
- `pnpm build` 退出码 0
- `git diff --check` 无输出
- 不使用 skip、todo 或降低断言
- 不引入未经确认的生产依赖
- 不把 API Key 写入源码、仓库或前端

---

## E. 需要确认的事项

1. **C 选路径 1 还是路径 2**（我建议路径 1）。
2. **旧目录 `careeradapt-ai-electron-shell` 的处理策略**：迁移并保留备份，还是迁移后删除？我倾向迁移后保留一份带时间戳的备份，并在日志中给出备份路径。
3. **权威定位文件的位置**是否接受 `%APPDATA%/CareerAdapt/hermes-home.json`（与产品名解耦，避免再次因改名漂移）。
4. 是否同意把 B2.2（改 Hermes `no-key-required`）纳入本轮 —— 它需要 patch bundled runtime。若倾向零运行时改动，可只做 B2.1（CareerAdapt 侧拦截）并把 B2.2 单列为 Hermes 上游问题。
