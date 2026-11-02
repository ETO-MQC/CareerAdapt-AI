# real-provider-eval — SQ1.0 匿名测试包

2026-11-02。**接入可用；固定首案例完整采集BLOCKED；不是质量认证完成。**

## 当前实测

初始只读配置检查：本比赛工作区无.env.local，server base/model/key及专用SKILLS_QUALITY三项均未配置；未访问其他工作区.env或Electron私有secure store。随后用户在会话中提供AMD测试Provider并明确允许使用，以下是新增真实请求，不再把初始缺配置作为最终状态。

Provider为 `https://developer.amd.com.cn/radeon/api/v1`，model=`Qwen3.8-27B`。密钥仅注入测试进程内存/环境，未保存.env、源码、fixture或结果。测试结束已清除REPL引用。用户称免费，本轮不据此认证计费条款；结果里的usage/cost字段只是上游响应。

| 请求 | 参数 | 结果 |
| --- | --- | --- |
| 合成连通性“Reply with OK only” | temperature0 / reasoning_effort low / max_tokens2048 / timeout30s | HTTP200，finish=stop，contentChars4，14.962s，完整结束 |
| 固定 `jd_understanding-01` / before | 原冻结1.0.0 Skill与原案例，temperature0 / low / 2048 / timeout120s | HTTP200，finish=length，contentChars766，96.569s；QUALITY_OUTPUT_BUDGET_EXHAUSTED |
| 同案例after | 同policy计划 | **未发出**，harness在首失败处停止 |

本轮共2个真实HTTP请求（1连通性+1固定before），完成0/60质量arm、0/30 pair，无自动重试、预算更换或后续case；完整返回是arm完成条件，截断内容不计成功。先尝试REPL直接import现有harness遇到CJS default export兼容错误，该准备失败**请求0**；随后在独立Node进程调用原runRealEvaluation成功发出首case，子进程exit1。没有修改原脚本。

证据：[连通性JSON](sq10-real-provider-probe-20261102.json)、[首案例JSON](sq10-real-provider-first-case-20261102.json)。记录Skill SHA、参数、timing、finish reason、usage和失败分类，不含Key。未采集/评分未完成内容，不冒充模型质量失败或改善；当前属于**FIRST_CASE_COLLECTION_BLOCKED_OUTPUT_BUDGET**。历史AMD的不同参数/时间结果不能补成本轮pair。

## 用户可在产品界面执行的固定包

完整可复制输入见[30案例web-pack](skills-quality-eval-v1-web-pack.md)，九字段逐例验收见[30案例卡片](skills-quality-eval-v1.md)，评分/可比性见[A/B协议](skills-quality-ab-evaluation-protocol.md)。这些都是匿名合成材料；不上传真实简历、联系方式或身份文件。

1. 新建隔离匿名测试人物和Session，选择合成Profile及通用Resume。需Job时使用卡片原始JD，核对并保存同版本；工具测试记录初始化与计分turn的界限。不要在真实用户任务中试验。
2. 在产品Provider设置界面填入用户自己的凭据；截图、日志和导出证据不得包含Key。当前运行的产品是否已配置/是否READY须界面实际读回，本轮直连成功不证明产品服务已切换。
3. 按30卡片顺序复制输入。两例固定follow-up分别为Python实际课程/比赛清洗且仅本份简历、Kubernetes“没有用过”；其他案例不临时替模型编回答。多选示例不是用户事实。
4. 记录真实回答、问题、skill_view、facade、checkpoint、确认事件、branch/revision及正式表变化。proposal与正式保存分开。review-only不点击apply；需要确认的生成场景先看事实再明确批准。Profile同步仅在对应指定case且具体事实独立审核后执行。
5. 若要before/after，before必须在冻结版本的隔离测试环境；当前产品只能证明当前after，不可贴旧Skill名字冒充旧运行环境。两臂同输入/参数/工具语义，未知项留空，评审盲化。

## 六个关键产品sentinel

| Case | 固定期待 | 必须取证 |
| --- | --- | --- |
| guided_clarification-01 | 确认Python自述后resume_only可用，不要上传证明 | sourceTurn/answer receipt→claim→diff；Profile不变 |
| guided_clarification-02 | 明确没用过Kubernetes后保留真实gap，不继续补该能力 | 后续提案无K8s claim；无重复提问 |
| tailoring-02 | 无数字仍可写清课程交付，不编45% | 原子claim逐条核对、Guard/review |
| story_mining-03 | “主要负责”先问设计/执行/交付，不写Owner | 问题与原话、未确认零正式写 |
| tailoring-01 | 接受老师/项目组沟通的语义对应，不扩成企业管理 | requirement→原话→安全措辞 |
| guided_clarification-04 | 给具体例子帮助回忆，用户未选择前不成事实 | 例子/用户回答明确分离；正式表不变 |

另外guided_clarification-03验证通用简历SQL基础能力来源turn、确认、Revision与Profile隔离；纯文本policy评测不替代它。

## 后续边界

本轮SQ1.0只调查可执行性，已完成接入与首案例探测后停止。若后续选择更大token预算，必须另开collection并对两臂同policy采集，先单例完整响应再评估完整30例成本/时间；不能拿本次截断before与另一预算after配对。本轮不自动修改Provider生产配置、timeout、Skills、Runtime或评测默认参数。
