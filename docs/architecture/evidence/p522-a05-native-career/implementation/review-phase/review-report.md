# P5.2.2-A-05 — Native Career Tool Integration & Reliability Qualification

日期：2026-11-06（Asia/Shanghai）。**D3 BLOCKED / NOT QUALIFIED，架构审核分支交付；不是 D3 完成报告。** 未提交、未推送，不进入 D4。

## 结果

完成当前源码/历史证据复核、锁定保护验证、禁用后旧闭包的受控复现、31 项 A04 回归和架构选型。尚未接通真实 Native Career Tool 链路；没有启动 Electron、没有 Provider 请求、没有实际 Profile handler ledger。

附件 A2 要求：若可靠授权/数据访问需要 Main/Preload/Core 改动，先交独立 ADR 等待审核。推荐方案新增 Main/Preload 授权控制桥，因此在实施前停止。设计见 [ADR A05-01](p5.2.2-a05-native-career-authority-adr.md)。这是对所选方案的审核门禁，不是断言所有 synthetic RPC 都不可能在现有扩展面实现。

## 基线与当前事实

fetch 成功，main/HEAD/origin/main=`91461b7611229fe43424b86721bbb00f8e46ad68`，起始干净；A04 已提交，纠正历史记录当时的“尚未提交”。八 worktree 只读登记保留。本轮保护 2559 tracked 文件、97 份历史锁定源码及所有既有 delivery manifest 原件；具体 SHA 见 baseline 与 final-protection-verification。

Runtime 0.19.0，Hermes SHA `eb52760564dbba2e5971fa54bd67384e281cd3b8`；Desktop package 0.17.0。13 份本轮重点锁定文件另记 SHA；69 份项目引用材料已读取、记录当前 SHA。没有将历史文件名或旧完成记录当作新验收。

## 执行架构与边界

Desktop `PluginContext.register` 注册 UI contribution；真正模型工具应使用 Python `PluginContext.register_tool`。锁定 Python dispatcher/middleware 已提供 Session/Tool Call/Turn 上下文，无需自行发明 Host API，也无需重新引入已退役 NativeCareerAgentRuntime。

A04 ProfileReadAdapter 使用现有 Gateway/Registry 类、严格 Schema、前后授权检查；尚无实际 Host composition root。它的完整依赖包含 Gateway → AgentAttachmentStore → WorkspaceRepository → Dexie。将整个 Adapter bundle 直接放进 Plugin 会违反要求。推荐应用侧窄 RPC：Plugin 只有传输，Domain/Repository 留在应用侧；目前只是设计，**Dexie 隔离尚未实现、未取得分发资格**。

现有 `poc/host-transport/plugin_api.py` 只调用 `fake_service.py`；其固定 fixture scope/epoch 与 operation status notFound 不构成生产授权、资料查询或 durable ledger。未修改/更名该 fixture，也未创建第二套 Gateway 或数据库。

## 禁用边界的本轮复现

命令：`node scripts/p522-a05-boundary-audit.mjs --baseline --probe`，退出 0。

完整转译当前锁定 `plugin.ts`/`plugins-store.ts`，使用真实 createPluginContext、publishPlugin、setPluginEnabled 函数体。nanostores、contribution registry、storage/i18n 及 transport 显式替身；transport 发往真实隔离 loopback HTTP。第一次请求成功 → 禁用 → contribution disposer 一次、inventory disabled → 原 rest closure 第二次请求仍成功到达。

这是 **CURRENT_LOCKED_FUNCTIONS_VM_WITH_REAL_LOOPBACK_HTTP_NOT_ELECTRON** 证据，表明既有禁用操作没有后端 grant 撤销。不是“实际 Career 后端撤权测试失败”，因为 Career 后端链还未接；更不是已证明某个新 broker 无法补足。历史 A03 的缺口本轮得到函数级再现。源码警告 FULL app authority 继续有效。

独立控制面推荐与替代方案、安全影响、兼容性、回滚、在途撤权线性化、UNKNOWN ledger 和后续影响均在 ADR。需要审核的是这份具体方案，而非批准一个未定义的“大范围重构”。

## 资格矩阵

| 项目 | 本轮结论 |
|---|---|
| Hermes 0.19.0 版本锁定 | PASS（源码版本/SHA/97项保护） |
| Career Tool 注册 | NOT VERIFIED（仅确认正式注册 API） |
| Profile Adapter 接入 | BLOCKED（未实施） |
| Dexie 依赖隔离 | BLOCKED（应用侧桥接方案待实施） |
| Native Tool Call / Tool Result 关联 | NOT VERIFIED |
| Streaming | NOT VERIFIED |
| Stop 各阶段/迟到结果 | NOT VERIFIED |
| History reload/restart 不重执行 | NOT VERIFIED |
| Session A/B Native 隔离 | NOT VERIFIED；A04合成回归通过 |
| Plugin Disable 后端撤权 | BLOCKED；既有闭包缺口函数级复现 |
| Executed Server + Lost ACK | NOT VERIFIED |
| UNKNOWN 不重发 | NOT VERIFIED（本轮无Native请求，不以0次请求作为资格） |
| Handler Ledger | NOT VERIFIED（没有执行，不伪造空 ledger PASS） |
| optIn=false 默认模式 | NOT VERIFIED（未变更不等于运行验收） |
| 生产 Trusted Authority | BLOCKED，Synthetic issuer不升级为生产 |
| 生产 Profile Read | BLOCKED，等待 D3及D4 |
| 生产 Profile Write / Trusted Confirmation | BLOCKED |

## 历史证据复用

| 来源 | 保留的证据 | 不能外推的资格 |
|---|---|---|
| A02-01 / 01R | Backend READY、历史API/L2 UNKNOWN证据；原PARTIAL/Provider限制 | 本轮Streaming/Stop、Career业务exactly-once |
| A02-02 | 历史真实L3工具dispatcher、tool_call_id及第二次tool role请求 | Career工具/原生L4完整生命周期 |
| A02-03 | 历史附件接收/文本链及失败 | 本轮不重跑附件，不覆盖其PARTIAL |
| A02-04 | 历史真实Session reload/restart、UNKNOWN投影恢复 | 工具实际执行后丢ACK、真实工具历史不重执 |
| A02-05 | 历史成果创建/下载/更新/隔离/重启 | CareerAdapter与原子业务操作ledger |
| A04 | D1/D2合成读/分页/授权接口回归 | 生产issuer、真实Native Host接入 |

Historical PASS、Current Round PASS、Synthetic PASS 和 Real Electron PASS 分列；本轮 **Real Electron PASS 为零项**。

## 业务能力后续接入清单

完整逐项源码、工具名、facade、Adapter、读写/确认、现有测试与缺口在 [business-capability-inventory.json](evidence/p522-a05-native-career/business-capability-inventory.json)。仅盘点，不实施 D5/D6/D7。Profile get/search 留在 D3/D4；Resume/Job/Career Intelligence 读分析为 D5；可信确认与正式写入为 D6；完整编排为 D7。创建持久化 draft/session、review 标志或导出 artifact 不误标成纯读。

## 验证和限制

- `pnpm typecheck`：退出0。
- 定向 A04 两文件：31 tests 通过，退出0；本轮仅证明既有合成路径仍成立。
- 锁定模块旧闭包复现：退出0，观察到缺口。
- changed-files ESLint、JSON/链接、保护哈希、`git diff --check`：最终结果见 test-results/final-protection-verification。

没有产品源码变更，未跑 build/Native TS/UI/全历史Playwright；不是以这些未运行结果宣称通过。没有真实 Profile/Home 读取、API密钥读取、Provider、生产写入、依赖/Schema/表/FactGuard/ClaimSafety变更，没有文件删除或破坏性Git。只新增审计脚本、报告/证据，并维护本地交接。

## 下一步

审核 ADR A05-01 推荐方案 B 后，仅继续 D3：实现受控合成桥接和严格两个工具，先本地传输与故障注入，再取真实 Electron Native Call/结果/Streaming/Stop/History/撤权/Executed+LostACK/A-B/default隔离证据。未通过前不开展 D4。不得将本报告写成“A05通过”。
