# B01 业务能力映射（28项）

产品实现状态与Native资格分开。所有行的Native接入仍受D3/D4阻塞；测试结果以本轮test-results.json为准。

| ID | 业务 | 能力 | 分类 | 实际行为 |
|---|---|---|---|---|
| B01-C01 | Profile | get | 已有实现 | Repository Profile查询→canonical投影；A04 scoped纯查询另行隔离；普通查询仍可初始化迁移。 |
| B01-C02 | Profile | search_facts | 已有实现 | canonical事实词项筛选；不是语义全量证明；未命中不能等同无经历。 |
| B01-C03 | Profile | intake | 已有实现 | 来源轮次→语义候选/草稿，未确认候选不直接入正式事实。 |
| B01-C04 | Profile | reconciliation | 已有实现 | 现有合并计划与逐项resolve，保留冲突和来源。 |
| B01-C05 | Profile | confirmed commit | 已有实现 | 产品确认后Repository版本检查/提交，Native可信授权仍未开放。 |
| B01-C06 | Resume | list | 已有实现 | Repository按Profile/生命周期枚举；列表存在不等于可导出。 |
| B01-C07 | Resume | get | 已有实现 | 读取ResumeBranch v2及来源版本，内容模型仍为Schema v2。 |
| B01-C08 | Resume | revision | 已有实现 | 持久化Revision snapshot与previousRevisionId；CAS拒绝过期写。 |
| B01-C09 | Resume | branch | 已有实现 | Route A保留Profile snapshot，Route B保留sourceBranch/sourceRevision；不覆盖通用简历。 |
| B01-C10 | Resume | preview | 已有实现 | 派生RenderModel/A4；由既有export/renderer覆盖，没有单独preview工具。 |
| B01-C11 | Resume | export | 已有实现 | snapshot→既有HTML/Chromium PDF及coverage检查；本轮真实PDF验收待闭合。 |
| B01-C12 | Job | list | 已有实现 | Repository正式Job枚举，与候选listing区分。 |
| B01-C13 | Job | get | 已有实现 | 原始JD、要求、graph及updatedAt持久化读取。 |
| B01-C14 | Job | JD parsing | 已有实现 | analyzeJobCommand/JobWorkflow→SourceSpan语义图→核对→Repository提交；空输入有显式错误。 |
| B01-C15 | Job | requirement graph | 被其他能力覆盖 | parse的结构化图，非额外LLM工具；保留关系组与原文范围。 |
| B01-C16 | Job | job analysis | 被其他能力覆盖 | 统一CareerIntelligence/JobFit分析，非岗位事实写入用户Profile。 |
| B01-C17 | Career Intelligence | profile/job context | 已有实现 | retrieveCareerContext只投影可确认候选事实与来源；未知/风险事实不伪装为已确认。 |
| B01-C18 | Career Intelligence | requirement matching | 已有实现 | CandidateEvidenceMatrix将Requirement ID/SourceSpan映射fact/source/evidence unit。 |
| B01-C19 | Career Intelligence | capability coverage | 被其他能力覆盖 | 由同一CareerIntelligence报告派生，不建立第二套评分器。 |
| B01-C20 | Career Intelligence | match scoring | 被其他能力覆盖 | 规则版本、岗位/资料/简历版本绑定；unknown与mismatch区分，不改阈值。 |
| B01-C21 | Career Intelligence | evidence explanation | 被其他能力覆盖 | 同一矩阵rationale、confidence、unresolvedAmbiguity和来源引用。 |
| B01-C22 | Tailoring | create session | 已有实现 | createTailoringSessionCommand从明确Profile/Branch/Job产生Session与任务输入。 |
| B01-C23 | Tailoring | question plan | 已有实现 | 冻结QuestionPlan、单activeQuestionId、mode预算与硬上限5；不另造访谈。 |
| B01-C24 | Tailoring | answer question | 已有实现 | 回答receipt/plan revision推进；旧回答改动使生成的Diff/reviews失效。 |
| B01-C25 | Tailoring | generate diff | 已有实现 | target/evidence约束生成→局部校验→统一Diff；并非整份简历反复生成。 |
| B01-C26 | Tailoring | review diff | 已有实现 | accept/edit/reject写入review ledger；selectedDiffs运输字段不是应用权威。 |
| B01-C27 | Tailoring | preview | 已有实现 | review ledger→局部事实/原值/禁词检查→派生preview，无正式简历写入。 |
| B01-C28 | Tailoring | confirmed apply | 部分实现 | 产品确认→原子derive/apply→Revision+operation→回读→artifact receipt；本轮补请求指纹。全链浏览器和Native可信确认分别验收，不能混用。 |
