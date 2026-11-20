# P5.2.2-F：MiMo Provider 资格记录

状态：**未完成资格验证；不切换默认 Provider**。测试数据均为匿名合成内容。密钥未写入仓库或报告。

本地候选配置位于 Git 忽略的 `.env.local`，使用独立的 `CAREERADAPT_MIMO_*` 名称；`pnpm dev:mimo` 为该进程选择 MiMo，`pnpm dev` 仍使用原有配置。候选入口使用不同本地端口、构建目录和 Hermes home，浏览器的 IndexedDB 因端口不同而隔离；首次启动和重启后健康信息均识别 MiMo，默认入口也可重新启动。本机环境中未发现完整的原 Provider 环境配置，不能据此断言 Electron 安全存储或浏览器设置为空，也不能完成同条件对照。

真实 MiMo 从正式首页进入人物选择和自然语言经历输入后，90 秒内没有出现候选审核。Hermes 记录第一轮请求的输入约 9,717 tokens、输出 64 tokens、耗时约 161.9 秒，随后才调用 `skill_view`；这一轮超过候选等待窗口，不能当作成功资格或断定最终业务结果。另一次正式结构化接口调用约 7.1 秒返回有效结构，但输入未包含岗位来源单元，输出为空，不能算 JD 提取通过。未反复重跑长链。MiMo 业务能力、延迟和稳定性仍不满足推荐演示默认模型的证据要求。

为隔离完整 Hermes 上下文，另以匿名短叙述直接调用现有 `profile-intake-semantic` 结构化接口：首个模型输出约 33 秒返回，整次接口在约 60 秒返回 HTTP 504 `provider_timeout`。该次没有形成通过 Schema 的候选，不能算经历录入资格通过；未重复轰炸。

| 检查 | 当前 Provider | MiMo-V2.6-Flash |
| --- | --- | --- |
| 模型目录 | 当前活动配置未取得，可比测试待完成 | `/models` 返回 200，包含目标模型 |
| 中文对话 | 待使用相同提示词实测 | 200，约 2.4 秒，正文和 reasoning 均存在 |
| 函数调用 | 待实测 | 单次 `get_profile` 调用被返回，约 1.3 秒；尚非 Career 工具全集测试 |
| JSON | 待实测 | JSON object 与严格 JSON Schema 均解析成功；schema 约 27.2 秒 |
| SSE | 待实测 | 简短响应成功，首帧及正文约 4.7 秒 |
| 读取已确认 Profile 并准确总结 | 待实测 | 尚未完成真实业务核对 |
| 自然语言经历 Candidate 与确认边界 | 待实测 | 首次走到确认和预览，暴露 company 丢失；修复后真实首页候选等待超时，短叙述结构化接口 504，不能判通过 |
| JD 要求及缺失信息 | 待实测 | 未完成来源单元齐全的业务验证 |
| 已保存岗位的 Job Fit 与证据 | 待实测 | 仅确定性 Provider 已验证，真实模型未完成 |
| Tailoring 的采用／编辑／忽略与多轮 | 待实测 | 仅确定性 Provider 有既往局部证据，真实模型未完成 |

原活动 Provider 与密钥未修改。现有设置使用单一活动凭据；使用独立入口测试 MiMo，不要在现有设置中覆盖原密钥。真实对照与最终 Golden Journey 尚未完成。

兼容适配器对 AMD 域名与精确 MiMo 模型设置 `max_tokens=4096`；结构化调用和 MiMo 文本流将 `finish_reason=length` 识别为截断，推理内容不会作为正文，工具流保留工具片段。该预算只影响本项目 OpenAI-compatible 适配器，不代表修改了 Hermes runtime 的生成参数。结构化公司别名仅在来源原文包含该公司时映射到 `organization`，仍须经现有核对与写入边界。

AMD 官方资料：[MiMo 模型说明](https://amd-aim.github.io/radeon-cloud-docs/models/mimo-v2-6-flash/)、[Chat Completions](https://amd-aim.github.io/radeon-cloud-docs/api/chat-completions/)、[限流](https://amd-aim.github.io/radeon-cloud-docs/api/rate-limits/)。文档指出 MiMo 始终思考且 reasoning token 计数可能为零，不能仅凭该计数判断思考消耗。

岗位匹配独立定向回归使用预置匿名资产和确定性 Provider：正式 AI 页面展示要求与证据，断言读取 Job 原文、需求图、Profile 绑定、Resume 和 Revision；原完整测试两次在匹配后发送“好”的续接断言超时，第二次已回复普通文本而非预期选项。两次测试均退出 1，不当作完整通过；后续短诊断和修复如下。

后续短诊断确认产物打开前后 next-action 均存在；输入框原本绕过 Host 直接启动模型。修复后，独立浏览器短测通过“好”→选项、“第一个”→岗位简历、Agent Stop 和刷新后会话恢复，并确认岗位、简历与版本绑定；另有 42 项 Repository/Host 集成测试通过，覆盖重复确认和旧 Revision 拒绝。浏览器仍使用预置资产和确定性 Provider，不能作为首页 Golden Journey 或真实模型资格。

随后使用确定性 Provider 从首页连续创建 Profile、通用简历并保存岗位。第二次运行中 UI 已展示匹配概览与要求/证据，网关回执绑定新 Profile、通用简历及其 Revision，但任务状态组合断言未通过。短单测证实完成的经历整理未提升为匹配工作流；现对绑定一致的回执完成提升，拒绝不同岗位。相关 42 项单测和预置资产浏览器短测通过；两次长测试均退出 1，不能当作完整首页链通过。

另一次工作台材料导入至 PDF 的确定性链，在修正测试 Provider 的当前 Profile 读取后创建了通用简历，但旧确认卡仍为 pending、原 Hermes Run 仍显示 running；15 秒终态断言失败。随后修复确认写入后的旧 Run 收尾，40 项 Host 单测通过；确定性浏览器短链验证 Run 到达真实终态、旧确认清除并成功发送下一条消息。原完整链仍是失败记录，该证据不是 MiMo 资格或首页完整旅程。
