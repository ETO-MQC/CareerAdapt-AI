import type { AgentMessageReference, AgentTaskState } from "@/agent/contracts/agentSession";

export type TurnIntent =
  | "continue_current_task"
  | "new_domain_task"
  | "casual_side_turn"
  | "task_control"
  | "clarification_answer"
  | "reference_followup";

export type ProfileIntakeTurnKind =
  | "career_narrative"
  | "follow_up_answer"
  | "interview_control"
  | "profile_state_question"
  | "correction"
  | "casual_side_turn"
  | "unknown";

export type ActiveQuestionTurnKind =
  | "answer"
  | "reference_question"
  | "correction"
  | "skip"
  | "new_asset"
  | "workflow_control"
  | "casual";

export type ActiveQuestionContext = {
  questionId: string;
  candidateId: string;
  dimension: string;
  questionRevision: number;
  candidateLabel?: string;
  question?: string;
  existingStructuredItem?: unknown;
  sourceTurns?: ReadonlyArray<{
    turnId?: string;
    text: string;
    questionId?: string;
    candidateId?: string;
    dimension?: string;
  }>;
};

export type ActiveQuestionTurnResolution = {
  kind: ActiveQuestionTurnKind;
  activeQuestionId?: string;
  candidateId?: string;
  dimension?: string;
  questionRevision?: number;
  confidence: number;
  reason: string;
  resolvedBySourceTurnId?: string;
};

export type TurnTaskMutation = "preserve" | "continue" | "recover" | "replace";
export type TurnToolScope = "none" | "profile_read" | "domain";

export type TurnIntentDecision = {
  intent: TurnIntent;
  confidence: "high";
  taskMutation: TurnTaskMutation;
  toolScope: TurnToolScope;
  profileIntakeTurnKind?: ProfileIntakeTurnKind;
  activeQuestionResolution?: ActiveQuestionTurnResolution;
  newTask?: {
    goal: string;
    workflowId: string;
    stage: string;
  };
};

const CASUAL_EXACT = new Set([
  "你好", "您好", "嗨", "hi", "hello", "hey", "谢谢", "感谢", "好的", "好", "再见", "拜拜",
  "你能做什么", "你还能做什么", "你可以做什么", "你能联网吗", "你能连接外网吗"
]);

export function classifyTurnIntent(input: {
  text: string;
  references?: AgentMessageReference[];
  taskState?: AgentTaskState;
}): TurnIntentDecision {
  const text = input.text.trim();
  const compact = text.toLowerCase().replace(/[\s？?！!。,.，]/g, "");
  const terminal = input.taskState
    ? ["failed", "completed", "cancelled"].includes(input.taskState.completionStatus)
    : false;

  const activeQuestion = input.taskState?.workflowId === "guided_profile_intake"
    ? activeQuestionContext(input.taskState)
    : undefined;
  const activeQuestionResolution = activeQuestion
    ? resolveActiveQuestionTurn({ text, activeQuestion })
    : undefined;
  const profileIntakeTurnKind = input.taskState?.workflowId === "guided_profile_intake"
    ? classifyProfileIntakeTurn({
        text,
        stage: input.taskState.stage,
        activeQuestionId: activeQuestion?.questionId,
        activeQuestionLabel: activeQuestion?.candidateLabel,
        expectedAnswerDimension: activeQuestion?.dimension,
        activeQuestionResolution
      })
    : undefined;

  if (profileIntakeTurnKind === "profile_state_question") {
    return decision("casual_side_turn", "preserve", "profile_read", profileIntakeTurnKind, activeQuestionResolution);
  }
  if (profileIntakeTurnKind === "correction") {
    return hasExplicitCorrectionReplacement(text)
      ? decision("clarification_answer", "continue", "domain", profileIntakeTurnKind, activeQuestionResolution)
      : decision("casual_side_turn", "preserve", "none", profileIntakeTurnKind, activeQuestionResolution);
  }
  if (profileIntakeTurnKind === "interview_control") {
    const toolScope = /^(?:确认|完成整理并保存(?:到)?(?:个人)?资料库?|导入资料库|保存为经历档案|写入资料库)[。！!]?$/u.test(text)
      ? "domain"
      : "none";
    return decision("task_control", "preserve", toolScope, profileIntakeTurnKind, activeQuestionResolution);
  }
  if (
    profileIntakeTurnKind === "career_narrative"
    || profileIntakeTurnKind === "follow_up_answer"
  ) {
    return decision("clarification_answer", "continue", "domain", profileIntakeTurnKind, activeQuestionResolution);
  }

  if (input.references?.length) {
    return decision("reference_followup", "preserve", referenceToolScope(text), profileIntakeTurnKind, activeQuestionResolution);
  }
  if (/^(继续|继续刚才的?|按刚才(的)?方案继续|继续上次|重试刚才|恢复刚才)/i.test(text)) {
    return decision("continue_current_task", terminal ? "recover" : "continue", "domain", profileIntakeTurnKind, activeQuestionResolution);
  }
  if (/^(暂停|停止|取消|恢复任务|重新开始任务|重试)$/i.test(text)) {
    return decision("task_control", "preserve", "none", profileIntakeTurnKind, activeQuestionResolution);
  }
  if (
    CASUAL_EXACT.has(compact)
    || /^(你(还)?能|你可以).*(做什么|联网|连接外网|支持什么|有哪些能力)$/i.test(text)
    || /^(你好|您好|谢谢|感谢)[呀啊哦嘛吗吧！!。.]?$/i.test(text)
  ) {
    return decision("casual_side_turn", "preserve", "none", profileIntakeTurnKind, activeQuestionResolution);
  }
  if (
    /^(你能|可以).*(读取|查看|访问).*(资料库|个人资料)/i.test(text)
    || /^(?:我的)?(?:名字|姓名)(?:是|叫)?什么(?:来着)?[？?]?$/i.test(text)
    || /^我是谁[？?]?$/i.test(text)
    || /^(?:你应该|请|以后)?怎么称呼我[？?]?$/i.test(text)
    || /(?:资料库|个人资料).*(?:已经)?(?:切换|改名|重命名).*(?:重新)?读取|(?:已经)?(?:切换|改名|重命名|改成).*(?:请)?(?:重新)?读取.*(?:资料库|个人资料)|(?:当前|活动)资料库.*(?:确认|写入目标)/i.test(text)
  ) {
    return decision("casual_side_turn", "preserve", "profile_read", profileIntakeTurnKind, activeQuestionResolution);
  }
  if (
    /^(?:刚才|为什么|为何).*(?:暂时)?没有新进展.*(?:原因|怎么回事|为什么)?[？?]?$/i.test(text)
    || /^(?:我)?(?:应该|需要|还要)(?:补充|提供)(?:什么|哪些).*(?:信息|资料)?[？?]?$/i.test(text)
  ) {
    return decision("casual_side_turn", "preserve", "none", profileIntakeTurnKind, activeQuestionResolution);
  }
  if (
    /导入(一个|新的?|这个|该)?(岗位|职位)|重新.*(另一份|新的?).*简历|我想(申请|应聘|投)(这个|该)?(岗位|职位)|录入(一个|新的?|这个|该)?(岗位|职位)|上传.*简历|分析.*(JD|岗位描述|职位描述)|(深挖|丰富|梳理|挖掘).*(经历|项目)|从零.*(整理|梳理).*(经历|资料)|定制简历|岗位定制|匹配度|岗位.*匹配|匹配.*岗位/i.test(text)
    || isExplicitExportIntent(text)
    || looksLikeJobDescription(text)
  ) {
    const task = newDomainTask(text);
    const preserveApplicationRoot = task.goal === "ingest_job"
      && input.taskState?.rootGoal === "apply_to_job";
    return {
      ...decision("new_domain_task", preserveApplicationRoot ? "continue" : "replace", "domain", profileIntakeTurnKind, activeQuestionResolution),
      newTask: task
    };
  }
  if (input.taskState?.completionStatus === "waiting_for_user") {
    return decision("clarification_answer", "continue", "domain", profileIntakeTurnKind, activeQuestionResolution);
  }
  return decision("new_domain_task", terminal ? "replace" : "continue", "domain", profileIntakeTurnKind, activeQuestionResolution);
}

export function classifyProfileIntakeTurn(input: {
  text: string;
  stage?: string;
  activeQuestionId?: string;
  activeQuestionLabel?: string;
  expectedAnswerDimension?: string;
  activeQuestionResolution?: ActiveQuestionTurnResolution;
}): ProfileIntakeTurnKind {
  const text = input.text.trim();
  if (!text) return "unknown";

  if (
    /为什么|为何|怎么还|不是已经|回收站|删除|归档|你从哪里知道|当前资料库|这条对吗|这条不是|你怎么知道|还保留|还在吗|删掉了吗/i.test(text)
    && /[？?]|为什么|为何|怎么|哪里|是否|吗|呢|还/i.test(text)
  ) {
    return "profile_state_question";
  }
  if (isProfileIntakeDraftRequest(text) || isProfileIntakeReferenceQuestion(text, Boolean(input.activeQuestionId))) {
    return "profile_state_question";
  }
  if (/^(?:继续|完成整理|完成整理并保存|完成整理并保存到资料库|确认|导入资料库|保存为经历档案|写入资料库|先到这里|没有其他经历了|先不保存|仅保存|不保存|结束访谈|跳过|下一步|继续补充|继续添加|先看看|实习经历|项目经历|校园经历|技能或证书)$/i.test(text.replace(/[。！!？?\s]+$/g, ""))) {
    return "interview_control";
  }
  if (/^(?:不是|不对|并非|这条经历不属于我|这不是我的|应为|更正|纠正)/i.test(text) || /不是.+(是|应为)|不属于我/i.test(text)) {
    return "correction";
  }
  if (isInterrogativeOrProfileMeta(text)) return "profile_state_question";

  const grounded = hasGroundedCareerSignal(text);
  if (input.activeQuestionId && input.stage === "collect_experience" && input.expectedAnswerDimension) {
    const resolution = input.activeQuestionResolution ?? resolveActiveQuestionTurn({
      text,
      activeQuestion: {
        questionId: input.activeQuestionId,
        candidateId: "active-candidate",
        dimension: input.expectedAnswerDimension,
        questionRevision: 0,
        candidateLabel: input.activeQuestionLabel
      }
    });
    if (resolution.kind === "answer" || resolution.kind === "correction") return "follow_up_answer";
    if (resolution.kind === "new_asset") return "career_narrative";
    if (resolution.kind === "skip" || resolution.kind === "workflow_control") return "interview_control";
    if (resolution.kind === "reference_question" || resolution.kind === "casual") return "profile_state_question";
  }
  if (grounded) return "career_narrative";
  if (CASUAL_EXACT.has(text.toLowerCase().replace(/[\s？?！!。,.，]/g, ""))) return "casual_side_turn";
  return "unknown";
}

/**
 * The active question is conversational context, not a weak hint.  This
 * resolver must run before generic career-narrative heuristics so ordinary
 * answer openings such as “在…”, “使用…” and “就是…” cannot manufacture a
 * second Career Asset.
 */
export function resolveActiveQuestionTurn(input: {
  text: string;
  activeQuestion?: ActiveQuestionContext;
}): ActiveQuestionTurnResolution {
  const text = input.text.trim();
  const active = input.activeQuestion;
  const base = active
    ? {
        activeQuestionId: active.questionId,
        candidateId: active.candidateId,
        dimension: active.dimension,
        questionRevision: active.questionRevision
      }
    : {};
  if (!text) return { ...base, kind: "casual", confidence: 1, reason: "empty_turn" };

  const compact = text.replace(/[\s。！!？?，,、：:；;]+/gu, "");
  if (isProfileIntakeSkip(text)) {
    return { ...base, kind: "skip", confidence: 0.99, reason: "explicit_skip" };
  }
  if (isProfileIntakeWorkflowControl(text)) {
    return { ...base, kind: "workflow_control", confidence: 0.99, reason: "explicit_interview_control" };
  }
  if (isProfileIntakeCorrection(text)) {
    return { ...base, kind: "correction", confidence: 0.98, reason: "explicit_correction" };
  }
  if (!active) {
    if (CASUAL_EXACT.has(compact.toLowerCase()) || isProfileIntakeReferencePhrase(text)) {
      return { kind: "casual", confidence: 0.92, reason: "no_active_question" };
    }
    return {
      kind: looksLikeStrongNewAsset(text) ? "new_asset" : "casual",
      confidence: looksLikeStrongNewAsset(text) ? 0.9 : 0.55,
      reason: looksLikeStrongNewAsset(text) ? "strong_asset_identity" : "no_active_question_substantive_turn"
    };
  }
  if (isProfileIntakeReferenceQuestion(text, true) || isProfileIntakeReferencePhrase(text)) {
    const source = [...(active.sourceTurns ?? [])].reverse().find((turn) => turn.text.trim());
    const sourceSatisfiesDimension = source
      ? sourceAnswerSatisfiesDimension(active.dimension, source.text, active.existingStructuredItem)
      : false;
    return {
      ...base,
      kind: "reference_question",
      confidence: 0.98,
      reason: sourceSatisfiesDimension
        ? "previous_answer_satisfies_active_dimension"
        : "conversation_reference",
      ...(sourceSatisfiesDimension && source?.turnId ? { resolvedBySourceTurnId: source.turnId } : {})
    };
  }
  if (looksLikeStrongNewAsset(text, active.candidateLabel)) {
    return { ...base, kind: "new_asset", confidence: 0.96, reason: "strong_asset_identity" };
  }
  // A substantive declarative turn answers the active question by default.
  // Do not require the user to repeat the candidate label or use project/work
  // vocabulary; the dimension and question revision already bind the turn.
  if (isSubstantiveDeclarativeTurn(text)) {
    return { ...base, kind: "answer", confidence: 0.97, reason: "active_question_precedence" };
  }
  return { ...base, kind: "casual", confidence: 0.7, reason: "non_declarative_turn" };
}

function activeQuestionContext(taskState: AgentTaskState): ActiveQuestionContext | undefined {
  const plan = objectValue(taskState.knownSlots.intakeInterviewPlan);
  const active = objectValue(taskState.knownSlots.intakeActiveQuestion);
  const plannedActive = objectValue(plan.activeQuestion);
  const questionId = stringValue(taskState.knownSlots.activeQuestionId)
    ?? stringValue(active.questionId)
    ?? stringValue(plannedActive.questionId)
    ?? stringValue(plan.activeQuestionId);
  const candidateId = stringValue(active.candidateId) ?? stringValue(plannedActive.candidateId);
  const dimension = stringValue(active.dimension)
    ?? stringValue(plannedActive.dimension)
    ?? expectedProfileIntakeAnswerDimension(taskState);
  if (!questionId || !candidateId || !dimension) return undefined;
  const questionRevision = numberValue(active.questionRevision)
    ?? numberValue(active.sourceRevision)
    ?? numberValue(plannedActive.questionRevision)
    ?? numberValue(plan.sourceRevision)
    ?? 0;
  const latestSource = objectValue(taskState.knownSlots.latestIntakeSource);
  const sourceTurns = [latestSource]
    .filter((source) => typeof source.exactSourceQuote === "string")
    .map((source) => ({
      turnId: stringValue(source.turnId),
      text: String(source.exactSourceQuote),
      questionId: stringValue(source.intakeQuestionId),
      candidateId: stringValue(source.intakeCandidateId),
      dimension: stringValue(source.intakeDimension)
    }));
  return {
    questionId,
    candidateId,
    dimension,
    questionRevision,
    candidateLabel: stringValue(active.candidateLabel) ?? stringValue(plannedActive.candidateLabel),
    question: stringValue(active.question) ?? stringValue(plannedActive.question),
    existingStructuredItem: active.structuredItem ?? plannedActive.structuredItem,
    sourceTurns
  };
}

function isProfileIntakeSkip(text: string) {
  return /^(?:跳过|先跳过|暂时不知道|不清楚|记不清了|没有这方面信息|无可补充|不想回答)[。！!]?$/u.test(text.trim());
}

function isProfileIntakeWorkflowControl(text: string) {
  return /^(?:继续|继续补充|下一步|完成整理|完成整理并保存|先到这里|结束访谈|继续添加|继续补充其他经历)[。！!]?$/u.test(text.trim());
}

function isProfileIntakeCorrection(text: string) {
  return /^(?:不是|不对|并非|更正|纠正|这不是我的|应为)/u.test(text.trim())
    || /(?:不是.+(?:是|应为)|不属于我)/u.test(text);
}

function isProfileIntakeReferencePhrase(text: string) {
  return /^(?:我已经说了|我前面说过了|前面已经提过|刚才已经说过|上面有说|刚才那个回答里有)[。！!]?$/u.test(text.trim());
}

function isSubstantiveDeclarativeTurn(text: string) {
  if (/[？?]$/u.test(text)) return false;
  if (/^(?:好|好的|嗯|哦|谢谢|收到|明白了)$/u.test(text.replace(/[。！!\s]+$/gu, ""))) return false;
  return text.replace(/[\s，,。；;：:、]/gu, "").length >= 2;
}

function looksLikeStrongNewAsset(text: string, activeQuestionLabel?: string) {
  if (activeQuestionLabel && text.includes(activeQuestionLabel)) return false;
  if (/(?:另一个|另外一个|还有一个|还有一项|我还做过|我曾在|再补充一个)/u.test(text)
    && /(?:项目|公司|组织|学校|实验室|竞赛|比赛|奖项|岗位|课程|研究)/u.test(text)) return true;
  if (/^(?:在|于|参加|获得|就读|曾在)\s*/u.test(text)) {
    const identityPattern = /^(?:在|于|参加|获得|就读|曾在)\s*[^，。；;\n]{1,48}(?:项目|公司|组织|学校|实验室|竞赛|比赛|奖项|岗位|课程|研究|社团)/u;
    return identityPattern.test(text);
  }
  if (/^(?:开发|搭建|设计)\s*[^，。；;\n]{1,48}(?:平台|系统|产品|项目|实验室|课程|研究|作品)/u.test(text)) return true;
  return /(?:新项目|新公司|新岗位|新的学校|一项(?:竞赛|奖项)|另一个(?:项目|岗位|组织))/u.test(text);
}

function sourceAnswerSatisfiesDimension(dimension: string, sourceText: string, existingStructuredItem?: unknown) {
  const item = objectValue(existingStructuredItem);
  const serialized = `${sourceText} ${JSON.stringify(item)}`;
  if (["tools_methods", "method", "applied_evidence"].includes(dimension)) {
    return Boolean((Array.isArray(item.tools) && item.tools.length)
      || (Array.isArray(item.methods) && item.methods.length)
      || /(?:使用|通过|采用|框架|架构|工具|方法|仿真|模拟|PlatformIO|Arduino|C\+\+|Python|TypeScript|Java|JavaScript|SQL|Git|Docker|React)/iu.test(serialized));
  }
  if (["result", "portfolio_output", "publication"].includes(dimension)) {
    return /(?:完成|交付|验证|上线|产出|成果|结果|形成|编译|展示|论文|报告|demo|原型)/iu.test(serialized);
  }
  if (["action", "role", "author_role"].includes(dimension)) {
    return /(?:负责|完成|开发|设计|实现|组织|担任|承担|角色|协助|研究|分析)/iu.test(serialized);
  }
  if (dimension === "challenge") return /(?:问题|困难|挑战|故障|错误|瓶颈|排查|解决|无硬件|限制)/iu.test(serialized);
  if (dimension === "time") return /(?:19|20)\d{2}|\d{1,2}\s*月|入学|毕业|期间|当时/iu.test(serialized);
  return sourceText.trim().length >= 8;
}

function hasGroundedCareerSignal(text: string) {
  if (isShortGenericCareerTurn(text)) return false;
  return [
    /大学|学院|学校|本科|硕士|博士|专业|学位|入学|毕业|就读|教育/i,
    /公司|企业|组织|单位|雇主|实习|任职|担任|负责|岗位|职位|工作|入职|离职/i,
    /项目|课题|比赛|竞赛|活动|研究|开发|设计|搭建|实现|上线|产出|结果|成果/i,
    /技能|证书|认证|语言|奖项|获奖|掌握|熟悉|会用|精通/i,
    /\b(?:19|20)\d{2}\s*[年/-]|\d{4}\s*年|\d{1,2}\s*月|本科|硕士|博士/i
  ].some((pattern) => pattern.test(text));
}

/**
 * These are conversational controls, not evidence.  Keep the list exact so a
 * narrative such as “查看草稿后我又完成了一个项目” is still allowed to be
 * classified by the evidence path.
 */
export function isProfileIntakeDraftRequest(text: string) {
  const command = text.trim().replace(/[。！!？?\s]+$/gu, "");
  return /^(?:查看草稿|看看目前整理的内容|现在整理到哪了|你已经记下什么了|查看当前草稿|看看草稿)$/u.test(command);
}

/**
 * A short question that refers to the assistant's last prompt must never go
 * through semantic capture.  The active-question flag makes this conservative
 * for normal conversation while the generic-token branch protects an intake
 * session even if a legacy persisted state has lost the question id.
 */
export function isProfileIntakeReferenceQuestion(text: string, hasActiveQuestion = false) {
  const value = text.trim();
  if (!value || !/[？?]/u.test(value)) return false;
  const compact = value.replace(/[\s？?！!。,.，、：:；;"“”‘’]/gu, "");
  const short = value.length <= 32;
  const generic = /^(?:什么|哪个|哪一|哪项|哪条|哪段|什么是|什么意思|工作|项目|经历|岗位|内容|事情|问题|这个|那个|那项|刚才说的)(?:工作|项目|经历|岗位|内容|事情|问题|是什么|是哪一个|哪个|哪项|哪段)?$/u.test(compact);
  const conversationalReference = /^(?:你指的是|我刚才说的是|你说的是|刚才那个|刚才的|哪个|哪一|什么|什么意思|为什么问|为何问)/u.test(compact);
  return short && (generic || conversationalReference || hasActiveQuestion);
}

function isShortGenericCareerTurn(text: string) {
  const compact = text.trim().replace(/[\s。！!？?，,、：:；;]+$/gu, "").replace(/[\s]/gu, "");
  return compact.length <= 8 && /^(?:工作|项目|经历|岗位|职位|学校|教育|研究|活动|技能|证书|奖项|成果|结果)$/u.test(compact);
}

export function hasExplicitCorrectionReplacement(text: string) {
  return /(?:更正|纠正|改为|应为|不是.+(?:是|应为)|不属于我.+(?:是|应为))/i.test(text)
    && hasGroundedCareerSignal(text);
}

function isInterrogativeOrProfileMeta(text: string) {
  return /^(?:当前|活动)?(?:资料库|个人资料|档案).*(?:有什么|有哪些|还剩|内容|状态|经历)/i.test(text)
    || /^(?:这条|这个|那条).*(?:对吗|是不是|删除|回收|归档|哪里)/i.test(text)
    || /(?:资料库|个人资料).*(?:怎么|为什么|哪里|是否).*(?:知道|看到|返回|出现)/i.test(text);
}

function expectedProfileIntakeAnswerDimension(taskState: AgentTaskState) {
  const plan = objectValue(taskState.knownSlots.intakeInterviewPlan);
  const questions = Array.isArray(plan.questions) ? plan.questions : [];
  const activeQuestionId = stringValue(taskState.knownSlots.activeQuestionId);
  const question = questions.map(objectValue).find((item) => item.id === activeQuestionId);
  const activeQuestion = objectValue(plan.activeQuestion);
  return stringValue(activeQuestion.dimension ?? question?.expectedAnswerDimension ?? question?.answerType ?? question?.dimension);
}

function newDomainTask(text: string): NonNullable<TurnIntentDecision["newTask"]> {
  if (looksLikeJobDescription(text)) {
    return { goal: "ingest_job", workflowId: "job_ingestion", stage: "collect_job_description" };
  }
  if (isExplicitExportIntent(text)) {
    return { goal: "export_resume", workflowId: "repair_and_export_resume", stage: "select_resume" };
  }
  if (/从零.*(整理|梳理).*(经历|资料)|整理自己的真实经历/i.test(text)) {
    return { goal: "profile_intake", workflowId: "guided_profile_intake", stage: "resolve_profile_target" };
  }
  if (/匹配度|岗位.*匹配|匹配.*岗位/i.test(text)) {
    return { goal: "analyze_job_fit", workflowId: "analyze_job_fit", stage: "select_assets" };
  }
  if (/分析.*(JD|岗位描述|职位描述)|JD.*分析/i.test(text)) {
    return { goal: "ingest_job", workflowId: "job_ingestion", stage: "collect_job_description" };
  }
  if (/(深挖|丰富|梳理|挖掘).*(经历|项目)|(经历|项目).*(深挖|丰富|梳理|挖掘)/i.test(text)) {
    return { goal: "career_exploration", workflowId: "guided_profile_intake", stage: "collect_experience" };
  }
  if (/导入|录入/.test(text) && /岗位|职位/.test(text)) {
    return { goal: "ingest_job", workflowId: "job_ingestion", stage: "collect_job_description" };
  }
  if (/上传|导入/.test(text) && /简历/.test(text)) {
    return { goal: "import_resume", workflowId: "resume_import", stage: "select_source" };
  }
  if (/申请|应聘|想投/.test(text)) {
    return { goal: "apply_to_job", workflowId: "tailor_existing_resume", stage: "choose_resume_source" };
  }
  return { goal: "create_tailored_resume", workflowId: "tailor_existing_resume", stage: "choose_resume_source" };
}

function decision(
  intent: TurnIntent,
  taskMutation: TurnTaskMutation,
  toolScope: TurnToolScope,
  profileIntakeTurnKind?: ProfileIntakeTurnKind,
  activeQuestionResolution?: ActiveQuestionTurnResolution
): TurnIntentDecision {
  return { intent, confidence: "high", taskMutation, toolScope, profileIntakeTurnKind, activeQuestionResolution };
}

function referenceToolScope(text: string): TurnToolScope {
  return /我是谁|我的名字|姓名|怎么称呼我|读取.*资料库|查看.*资料库/i.test(text) ? "profile_read" : "none";
}

function isExplicitExportIntent(text: string) {
  return /^(?:请|帮我|麻烦)?(?:把|将)?(?:这份|当前|我的|该)?简历(?:导出|下载)(?:为|成)?\s*(?:PDF)?[。！!]?$/i.test(text.trim())
    || /^(?:请|帮我|麻烦)?导出(?:这份|当前|我的|该)?简历(?:为|成)?\s*(?:PDF)?[。！!]?$/i.test(text.trim())
    || /^(?:请|帮我|麻烦)?把(?:这份|当前|我的|该)?简历导出(?:为|成)?\s*PDF[。！!]?$/i.test(text.trim());
}

function looksLikeJobDescription(text: string) {
  return text.length >= 120
    && /岗位职责|职位描述|工作职责|职责描述/i.test(text)
    && /任职要求|职位要求|岗位要求|资格要求/i.test(text);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
