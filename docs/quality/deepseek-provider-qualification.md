# P5.2.2-F DeepSeek 本地资格记录

状态：**进行中；不得据此宣布完整业务资格或 ROADSHOW_READY**。真实 API 与确定性 Provider 的证据分开记录，测试内容为匿名合成数据。

## 本地启动

`.env.local` 被 Git 忽略，DeepSeek 使用独立的 `CAREERADAPT_DEEPSEEK_*` 变量；原 Provider 与 MiMo 配置保留。先运行 `pnpm hermes:prepare:dev`，再运行 `pnpm dev:deepseek`，在 `http://127.0.0.1:3210` 使用。该 origin 的 IndexedDB 与原入口、MiMo 入口隔离，演示资料须在 3210 重新准备；端口占用时启动直接报错。恢复其他入口可分别运行 `pnpm dev` 或 `pnpm dev:mimo`。独立入口已重启并再次识别 DeepSeek；未切换全局默认模型。

适配器针对精确官方主机和 `deepseek-flash` 保留 assistant `reasoning_content` 以支持思考模式下的工具续轮，强制工具选择使用非思考模式；思考状态在 Host 和事件总线只保留通用进度，不作为最终回答。Profile/JD 等结构化任务选择非思考模式；其他任务不强制统一模式。锁定 Hermes 自身具备 DeepSeek 工具续轮协议，本轮未改 Hermes Runtime。

## 真实 Provider 证据

| 检查 | 结果 |
| --- | --- |
| `/models` | 200，包含 `deepseek-flash`，约 385 ms |
| 中文对话 | 200，约 1.16 秒；短请求，非完整业务性能承诺 |
| JSON object | 200，约 0.95 秒，可解析；官方接口不据此宣称支持 JSON Schema |
| Tool calling | auto 双工具、参数、工具结果及思考模式续轮通过；指定工具的非思考请求通过 |
| SSE | 短中文请求首帧约 145 ms、首个可见回答约 882 ms、完成约 916 ms；另通过真实适配器流式工具调用和续轮 |
| 确认资料与新 Session | 正式首页、真实 Hermes、Gateway 和 IndexedDB：创建人物、经历候选编辑、确认写入、新 Session 调用网关回读通过，55.6 秒 |
| JD / Job Fit / Tailoring | 真实 UI 岗位保存和要求解析可见；独立短测使用内置演示资料，从正式 UI 建立通用简历，在新任务通过真实 DeepSeek 调用 `career.workflow.job_fit`，断言岗位、简历、Revision 和要求与证据，39.1 秒通过。Tailoring 真实模型完整验收未完成 |

真实适配器双工具/结构化短测 2 项通过，另一个真实流式工具续轮定向测试通过。五文件 53 项单测覆盖适配器、思考状态脱敏、Host 和凭据边界。真实首页测试的截图和 trace 为浏览器证据，并不等价于完整 Golden Journey。

| 对照 | 原 Provider | MiMo-V2.6-Flash | DeepSeek Flash |
| --- | --- | --- | --- |
| 相同输入的六项业务资格 | 未取得完整本地活动配置，未完成 | 未完成；详细结果见 [MiMo 记录](mimo-provider-qualification.md) | 未完成同条件六项对照；Profile 和独立 Job Fit 真实 UI 短测通过 |
| 速度 | 未取得可比数据 | 首页 Hermes 第一轮约 161.9 秒；经历结构化请求约 60 秒超时 | 短 SSE 首可见回答约 882 ms；首页 Profile 链 55.6 秒，独立 Job Fit 39.1 秒 |
| 演示建议 | 保留原配置，尚无可比业务结果 | 目前不推荐作为演示默认 | 可继续作为真实业务测试候选，完整路演链未验收 |

上述时长对应不同请求和上下文，并非同条件基准，不能据此得出量化模型排名。

首次真实首页到岗位短链退出 1：产品已保存岗位且展示 Python 或 SQL 要求，但测试把 JD 原文标记当作职位标题，因此等待错误字段超时。现场保留在 `.tmp/roadshow-targeted-1795093448402/`；按真实保存字段修正定位后另行执行一次，不把第一次记为通过。

第二次退出 1：已保存岗位并通过选择卡生成 Career Impact 报告，测试在报告动作刚触发后立即发送 Job Fit 请求，最终请求文字仍留在输入框、未出现在对话中。该现场不能证明是模型、Host 还是输入时序问题；不得把 Career Impact 当成 Job Fit 成功。证据 `.tmp/roadshow-targeted-1795093622678/`。两次长链不再重复，随后独立已有演示资料的 Job Fit 短测通过；不能代替从新人物贯穿到 PDF 的完整旅程。

扩展该短测检查后续对话时，第一次重跑在匹配前收到桥接 503：上一独立浏览器上下文结束时仍有运行持有桥接。现有测试明确要求失联的执行所有权只能由原持有方释放，不为测试取消此隔离；现场 `.tmp/roadshow-targeted-1795094175134/`。该次没有验证后续对话，需在干净服务和真实运行终态下继续验证。

干净服务重跑扩展短测：Job Fit 状态、岗位/简历/版本绑定及证据面板再次通过，但之后 20 秒内发送按钮仍不可用，“好”与“第一个”没有得到验证，退出 1。证据 `.tmp/roadshow-targeted-1795094526258/`；Trace 中对应 Hermes `run_status` 在等待期间持续报告 `running`，所以按钮禁用与运行状态一致；为什么该运行尚未结束仍待诊断，不能据此断言 Host 终态错误或模型失败。

真实定向工作区短测首次退出 1：产品实际创建岗位分支，并对项目缺失证据提出问题；测试未处理澄清步骤而直接等待建议。现场 `.tmp/roadshow-targeted-1795095004119/`；没有凭空补充事实，后续按“没有更多可确认信息”继续独立验证。

第二次退出 1：模型再次正常提出澄清，但这次使用“有／没有”按钮而非文本输入，测试只识别了文本形式，未继续执行。现场 `.tmp/roadshow-targeted-1795096017355/`；按两次限制停止该长短链重跑。两次均不能证明定向建议、审核或版本保存通过，也不能把澄清判定为产品失败。

用户随后明确授权复验。修正后的真实 DeepSeek 定向短测退出 0（35.2 秒）：处理澄清后生成可供核对的建议，生成本身未新增 Revision、未修改通用简历或岗位分支；继续扩展验证最终确认和保存，尚未以本次短测宣称完整路演链通过。

扩展审核暴露并修复了一个真实交互竞争：最后一个澄清回答既安排自动继续，又允许手动继续，两次并发生成的结果可能覆盖复选状态。现合并续写入口并取消多余计时器，使用刚确认的计划；生成中暂停建议选择，复选事件即时捕获状态，文本否定按现有答案分类处理。真实 DeepSeek 定向测试随后通过（47.9 秒）：澄清、取消其他建议、确认一项并创建一个新岗位 Revision，旧 Revision 和通用简历保持不变。相关定向服务 37 项通过。另一次为加入 PDF 检查重新运行时，模型生成的候选均被 Fact Guard 标记不可直接使用，测试的可用建议假设不成立，退出 1；不能把该次记为 PDF 通过，也未降低事实校验。

官方资料：[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)、[Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/)、[多轮对话](https://api-docs.deepseek.com/guides/multi_round_chat/)。


2026-11-20 续验：真实 DeepSeek 独立 Job Fit 后“好”“第一个”续接通过（55.5 秒）；真实 DeepSeek 定向澄清、建议选择与创建一个岗位 Revision 通过（47.9 秒）。确定性首页贯穿退出 0（85.1 秒，报告 `.tmp/core02-integration-1795111279982-playwright.json`）：候选忽略后重新打开、编辑及确认，通用简历、岗位保存、Career Impact、Job Fit、岗位 Revision、真实 PDF 和新 Session 正式网关读取资料/岗位/最新简历。该贯穿只确认一项定向修改，不证明同一次首页旅程中多项建议的采用、编辑、忽略；H4B2.1-B 多项审核既有证据使用预置实体，不能冒充本次首页全链。原 Provider 与 MiMo/DeepSeek 同条件六项对照仍未完成；状态保持 NOT_YET_ROADSHOW_READY。
