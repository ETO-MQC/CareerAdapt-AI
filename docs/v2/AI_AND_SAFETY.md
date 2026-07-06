# AI And Safety

## 原则

V2继续使用明确AI任务，不做万能聊天机器人。AI建议不得直接保存正式文本；内容改写必须经过Fact Guard；排版建议不能改写事实；模板推荐不能创建事实。

## 任务矩阵

| 任务 | 输入白名单 | 输出Schema | 可读取 | 可写入 | 人工确认 | Fact Guard | 降级 |
|---|---|---|---|---|---|---|---|
| profile-builder | 脱敏简历文本/PDF清洗文本 | ProfileBuilderOutput | RawInput | ProfileImportDraft草稿 | 必须 | 提交事实前 | 手动分类 |
| jd-analyzer | JD文本 | JdAnalyzerOutput | RawInput | JobAnalysisDraft草稿 | 必须 | 不涉及事实 | 手动JD条目 |
| evidence-matcher | profile/job/候选事实 | EvidenceMatcherOutput | 已确认事实 | RequirementMatch评估 | 可人工覆盖 | 禁止新增事实 | 规则匹配 |
| resume-tailor | 有效match和事实引用 | ResumeTailorOutput | factRefs | AiSuggestion草稿 | 必须 | 建议后 | 规则建议/失败提示 |
| fact-guard | 原文/建议/事实证据 | FactGuardOutput | factRefs | guard review | 必须 | 核心任务 | 规则Fact Guard |
| layout-diagnoser | ResumeDocument布局指标 | LayoutDiagnosisOutput | 文档布局 | 诊断建议 | 用户确认 | 不改事实 | 规则overflow |
| template-recommender | 文档类型/JD/偏好 | TemplateRecommendationOutput | 文档元数据 | 推荐，不写模板 | 用户选择 | 不改事实 | 默认模板 |
| content-shortener | 指定block和事实引用 | ShortenerOutput | factRefs | AiSuggestion草稿 | 必须 | 建议后 | 手动删减 |
| section-order-advisor | sections/JD/matches | OrderAdviceOutput | section元数据 | 排序建议 | 必须 | 不改事实 | 保持原顺序 |
| cover-letter-drafter | profile/job/branch | MaterialDraftOutput | 已确认事实 | 求职材料草稿 | 必须 | 生成后 | 模板草稿 |
| interview-question-generator | job/profile | InterviewQuestionOutput | 已确认事实和JD | 面试问题草稿 | 可选 | 不写事实 | 通用问题 |
| star-answer-assistant | 用户选择事实 | StarAnswerOutput | 已确认事实 | 回答草稿 | 必须 | 生成后 | 提纲 |

## G5a区块级岗位建议边界

- `resume-tailor` 在 G5a 中只能生成 `AiSuggestion` 草稿，不能直接写入 `ResumeBranch`、`ResumeRevision` 或 `CareerProfile`。
- 每条建议必须绑定 `branchId`、`targetContentItemId`、`basedOnBranchRevision`、`basedOnRevisionId`、`originalTextHash`、`requirementsHash` 和 `usedEvidenceRefs`。
- 无证据 requirement 进入 fact gap，不调用 AI 生成“补齐事实”的建议。
- 接受建议时必须重新运行规则 Fact Guard；`blocked_high_risk`、`needs_edit` 或 high risk 结果不能写入正式简历。
- 拒绝、忽略和重新生成只改变建议状态或创建新建议，不修改正式正文。

## 写权限

- AI永远不能直接写 `CareerProfile` 正式事实。
- AI不能直接创建正式 `ResumeBranch` 或 `ResumeDocument` 内容，只能生成草稿或建议。
- AI不能修改模板样式，模板推荐只产生推荐卡片。
- AI不能发送邮件、自动投递、操作招聘平台或绕过风控。

## Prompt注入防护

- 用户简历、PDF文本和JD都视为不可信输入。
- Prompt明确忽略输入中的系统指令、密钥请求、绕过要求。
- 输出必须经过Zod Schema和业务语义校验。
- 白名单ID校验：AI只能引用输入候选集中的factRefs。

## 日志和隐私

- 继续保存hash、长度、任务、provider、model、promptVersion、状态和固定errorCode。
- 不保存完整简历文本、API Key、本地路径、原始堆栈。
- 发送外部模型前继续脱敏手机号、邮箱、身份证号、精确地址。

## 排版诊断边界

排版诊断可以建议：删减、调间距、换模板、放宽到两页、降低信息密度。不得把“建议学习的技能”写成“用户已有技能”，不得新增事实或技能。

## G5b确定性诊断边界

- G5b 默认不调用外部 AI，不接入第三方 ATS 服务。
- 诊断结果是派生状态，不进入 `CareerProfile`、`ResumeRevision` 或正式事实层。
- ATS 结构诊断只描述本产品可观察的文本、模板、分页、隐藏内容和结构风险，不输出 ATS 评分、通过率、面试概率、录用概率或保证通过。
- 安全修复动作只允许修改 `ResumePresentationConfig`，必须由用户点击确认，并复用展示配置队列。
- 事实缺口只提示补充事实或回到 G5a，不生成可直接接受的虚假正文。

## G6b申请材料边界

- G6b 当前使用确定性本地 drafter 生成结构化材料，并通过 `ApplicationPreparationPack` Zod Schema 校验；不依赖实时 AI。
- 若后续接入 provider-backed drafter，输出仍必须先通过同一组材料 Schema，再运行材料 Fact Guard。
- 材料生成只读取当前 Application、Job、选定 ResumeRevision、岗位要求、RequirementBlockMatch 和已确认事实证据。
- 材料 Fact Guard 复用现有 `runRuleFactGuard`，只把 confirmed `MatchEvidenceRef` 作为用户事实证据；JD requirement 不可作为用户事实。
- 公司名和岗位名可来自 `JobDescription`；目标公司业务、长期关注、内推关系、成果数字和技能水平不得编造。
- 材料包保存前拒绝 `pdfBlob`、API Key、prompt 字段和常见 `sk-...` 密钥形态。
- 生成邮件只是草稿，不调用 Gmail、不创建草稿、不发送。
- 生成、编辑、完成或标记不需要材料都不自动改变 Application 状态。

## 安全门槛

- `unsafeAllowed=0`。
- 高风险建议不可接受。
- 不允许批量静默覆盖。
- 接受/拒绝/编辑/撤销都要有操作记录。
- Provider失败必须保留用户现有内容。
