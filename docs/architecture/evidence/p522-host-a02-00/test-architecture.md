# A-02 隔离测试架构（设计，未实施）

2026-11-04。没有启动本方案的环境，没有连接或测试Provider。本文是后续阶段可实现的操作契约；`p522-host-a02-0N.mjs`均是计划文件名，当前不可直接运行。

## 准备与执行顺序

1. 每阶段先获用户独立选择；核对main/HEAD/origin、锁定Hermes commit及原补丁SHA。检查当前变化，禁止覆盖用户成果。
2. 确认Provider endpoint/model、stream/tools/vision声明、请求上限/费用上限、辅助视觉目标及允许外传合成数据。没有密钥不阻塞L0/L1设计，但不得进行L4。
3. harness创建`.artifacts/p522-host-a02-<stage>-<run>/{home,userData,workspace,logs}`；HERMES_HOME与Electron userData显式指定，cwd为该workspace。所有数据合成；不复制原用户配置、插件、history或DB。
4. 环境allowlist仅保留启动所需PATH/SystemRoot/TEMP/本run路径和明确授权凭据；禁止继承未声明API keys、代理、MCP、fallback/auxiliary Provider。凭据不作为命令行参数，不写Git，不输出完整env。
5. 核对原native插件发现与工具allowlist；隔离echo测试工具通过PluginContext.register_tool装载。禁止项目插件自动发现；核实bundled/entry-point插件也不能引入职业工具或网络副作用。不能安全隔离即停止工具阶段。
6. Renderer复用`p522-host-a01-renderer.mjs`的精确锚点逻辑，但实现新输出目录参数/独立包装，避免覆写A-01R证据。原启动命令`node scripts/p522-host-a01-renderer.mjs --careeradapt`实际存在，但会将部分证据写回旧目录，**本次审计不执行，也不作为后续直接写证据的最终命令**。不带开关的默认Shell另起独立run。
7. 新runner复用A-01R真实Electron launch路径、独立home/userData和finally close，所有UI动作用正常locator/原生文件或clipboard入口；不通过DOM或store注入伪造模型/附件结果。只读观察store可用于诊断，不能充当用户操作证据。
8. L1/L2先测未知ACK、timeout/断连不重发、晚到事件、切Session、错误复位；未通过不得用有副作用工具进行L4。
9. L3真实Electron → L4真实Provider → L5故障恢复；每个测试单独记录完整退出码。功能不支持记N/A/FAIL/BLOCKED及原因，不能静默跳过后算总PASS。
10. 结束正常关闭本run Electron、Gateway、fixture和dev server，只操作已记录本run PID；关闭秘密输入。保留证据与合成目录。若独立凭据文件存在，一次删除一个明确路径文件；目录批量清理由用户手动执行，禁止递归删除。

## 拟定命令与既有命令

后续实现后分别运行（本轮均未执行、脚本尚未建立）：

```powershell
node scripts/p522-host-a02-01.mjs
node scripts/p522-host-a02-02.mjs
node scripts/p522-host-a02-03.mjs
node scripts/p522-host-a02-04.mjs
node scripts/p522-host-a02-05.mjs
```

runner必须预检锁定commit、传输授权配置与secret presence；缺失时退出非0并报告BLOCKED，不能自动探测用户凭据。应支持`--shell=careeradapt|native`、`--run-dir=<explicit>`、`--provider-config=<secret-free>`、`--case=<single>`等拟定参数；具体CLI在实现阶段定稿，本轮不伪造其存在。凭据由环境/交互秘密输入提供。

已有原生确定性测试可在后续获授权的阶段定向运行，需从Hermes Desktop目录执行：

```powershell
npm run test:ui -- src/app/session/hooks/use-message-stream/stream-flush.test.tsx src/app/session/hooks/use-prompt-actions/index.test.tsx
npm run test:ui -- src/app/chat/composer/hooks/use-composer-draft.test.tsx src/app/chat/composer/attachments.test.tsx
```

Python测试从锁定Hermes根目录、使用其已有虚拟环境解释器运行，先核实pytest可用，不新装依赖：

```powershell
python -m pytest tests/tui_gateway/test_custom_provider_session_persistence.py tests/tui_gateway/test_finalize_session_persist.py tests/tui_gateway/test_failed_turn_retention.py
```

这里`python`仅代表激活后的锁定环境解释器，不保证系统python具有相同依赖。这些测试路径已核实，存在不等于本轮通过。新增对应测试命令要随阶段交付补全。若产品代码有改动，按AGENTS运行changed-files lint、typecheck、相关单测/E2E及必要build；纯本轮文档不执行代码门禁。

## 每run证据与请求唯一性

输出：run-manifest（锁、补丁hash、环境allowlist名称、非秘密Provider配置摘要、数据边界）、cases.json、request-ledger.json、events.jsonl、sanitized-runtime.log、screenshots、recovery-comparison.json、test-results.json、delivery-manifest.json。

ledger记录run/case、synthetic stored/runtime Session ID、RPC request id、Provider request correlation（若服务不暴露则写UNKNOWN）、tool_call_id、发送次数/handler次数、delta序号/长度/hash、时间点、结束原因。RPC id不是持久幂等key；没有Provider请求ID时以受控代理或安全Provider日志佐证，无法证明则UNKNOWN，禁止拿最终UI条数代替服务端执行次数。

故障fixture是L2：只控制本run网络，注入ACK丢失、提交已收后断连、provider流中断与晚到消息；不替换真实模型意图的L4。可选loopback观测代理仅在测试链中透明转发并在内存去敏，禁止记录授权头、cookies、完整base64/用户数据；若代理改变流语义，直连结果需另列。实际Provider可见性不足则不签发请求唯一性PASS。

输入与事件分开：事件`message.start`、RPC ACK或Gateway ready都不是首token。主时钟使用单调时间；不同进程原始时钟分别记，不能直接相减。截图只保留合成内容且密钥表单关闭。

## 指标与用例预算

- 01：正常10个短轮、双击/连续提交、A流/B切换、Stop、401/限流/网络失败、未知ACK各有界case；预算在授权配置中设max requests/cost，辅助/标题请求也统计。
- 流：至少3非空delta、两次完成前paint；TTFT/总耗时p50/p95报告不伪设通用模型速度门槛。Stop UI≤500ms、ACK目标≤2s、settled目标≤5s；后观察10s无继续文本/新工具，超标诚实失败。
- 02：六环节至少一完整真实工具轮；固定schema/result，失败和取消各一，跨Session与history读取handler次数不增加。
- 03：Files/Folder/Images/paste/URL/snippet/drop分别列A～E；多附件、空/坏/不可读/大文件、取消、重试与切Session；大文件用实际限制前后各一，记录RSS峰值和响应。
- 04：草稿/已提交/结束/运行中四类；Renderer刷新、正常app重启、Backend中断分别列。恢复只读查询，不自动重发未知执行结果。
- 05：同Session多引用及去重、跨Session相同路径、缺失/失败/运行中引用、重启和单个合成Session删除；原生无Task状态必须明确记录。

每case设定独立timeout；同一长测试连续两次超时立即停止并保存两次证据，不无限重跑。阶段通过不触发下阶段。真实Provider不能用本地stub、UI图标或Gateway ready替代。所有N/A仅限能力映射，不降低用户要求。
