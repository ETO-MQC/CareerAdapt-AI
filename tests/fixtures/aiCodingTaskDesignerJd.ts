export const AI_CODING_TASK_DESIGNER_JD = `Vibe Coding
关联项目
【Code】General coding
职责内容
使用真实 vibe coding 工作流，持续测试 Cursor、Claude Code、Codex、Windsurf 等主流 coding agent 在真实开发任务中的能力边界。

主动发现并复现当前 frontier coding agent 仍然无法稳定完成的场景，包括但不限于：

多步骤开发任务；
长流程代码修改；
真实环境配置与调试；
bug 定位与修复；
创造性功能开发；
跨文件、跨模块、跨上下文的复杂任务。
将真实失败场景标准化为高质量任务包，明确写出：

任务背景；
任务目标；
输入与约束；
ground-truth；
判分逻辑；
可自动执行的 verifier。
设计能够识别 agent reward hacking 行为的测试与判据，例如：

假装完成任务；
修改测试用例；
绕过约束；
只做表面改动；
输出无法实际运行的代码；
在复杂任务中提前放弃或偷懒。
控制任务难度，使题目稳定落在当前 agent 能力边界附近：既不能是所有模型都轻松完成的简单题，也不能是定义不清、无法验证、纯噪声的任务。

与内部 coding、评测、训练专家协作，迭代任务设计，验证任务是否具备真实训练信号和区分度。

持续跟踪主流 AI coding 产品的能力变化，沉淀不同 agent 在真实开发场景中的优势、短板和典型失败模式。

参与要求
岗位要求
满足以下任一条件即可：

Cursor Pro、Claude Code Max、Codex、Windsurf 等 coding agent 产品的连续重度用户，能够提供真实使用记录。
独立 ship 过至少 1 个可访问、可运行的 vibe coding 产品、工具或线上项目。
GitHub 活跃用户，在多个 200+ stars 的开源项目中有核心贡献或高质量贡献记录。
能够清晰描述至少 1 个真实开发场景下 coding agent 的能力不足，并提供可复现的 badcase、环境说明或操作路径。

优先考虑
具备以下任一条件者优先：

独立上线过 vibe coding 项目，并获得真实用户、真实收入或真实使用反馈。
熟悉 Cursor、Claude Code、Codex、Windsurf 等多个 coding agent，并能比较它们在不同任务中的能力差异。
有较强的代码阅读、调试、工程化和问题拆解能力。
有构造测试用例、写 verifier、做自动化评测或 benchmark 的经验。
计算机相关专业背景，或有较丰富的实际 coding 经历。
对 agent reward hacking、模型评测、RL 训练数据、AI coding benchmark 等方向有兴趣或实践经验。

候选人需提供的验证材料
根据自身情况提供以下材料：

Cursor usage dashboard：包括月 request 数、使用过的模型等截图。
Claude Code、ChatGPT、Codex、Windsurf 等产品的订阅档位与 billing history，需能证明连续使用记录。
账号注册时间或连续使用历史，证明不是临时注册或短期突击使用。
GitHub 主页、贡献记录、核心 PR、开源项目链接或 deployed 项目链接。
至少 1 个真实 coding agent badcase，需包括：
使用的 agent；
任务目标；
失败表现；
复现方式；
你认为模型失败的关键原因。
近期最常用的 coding agent 产品，以及你对不同产品的实际使用体感。

我们希望你是这样的人
你可能不是传统意义上的“标准工程师”，但你一定是一个真正把 AI coding agent 用深、用狠、用出问题的人。

你知道什么时候 agent 看起来完成了，其实没有完成；你知道什么任务表面简单，实际会让模型在长上下文、多文件依赖或真实环境里崩掉；你也知道怎么把这些失败变成可验证、可复现、可训练的高质量任务。

如果你已经把 vibe coding 当成日常开发方式，并且能把自己的真实经验转化成系统性的任务设计能力，这个岗位会非常适合你。`;
