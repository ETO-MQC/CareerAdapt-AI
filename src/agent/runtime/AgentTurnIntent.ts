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

export type TurnTaskMutation = "preserve" | "continue" | "recover" | "replace";
export type TurnToolScope = "none" | "profile_read" | "domain";

export type TurnIntentDecision = {
  intent: TurnIntent;
  confidence: "high";
  taskMutation: TurnTaskMutation;
  toolScope: TurnToolScope;
  profileIntakeTurnKind?: ProfileIntakeTurnKind;
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

  const profileIntakeTurnKind = input.taskState?.workflowId === "guided_profile_intake"
    ? classifyProfileIntakeTurn({
        text,
        stage: input.taskState.stage,
        activeQuestionId: stringValue(input.taskState.knownSlots.activeQuestionId),
        activeQuestionLabel: stringValue(objectValue(input.taskState.knownSlots.intakeActiveQuestion).candidateLabel),
        expectedAnswerDimension: expectedProfileIntakeAnswerDimension(input.taskState)
      })
    : undefined;

  if (profileIntakeTurnKind === "profile_state_question") {
    return decision("casual_side_turn", "preserve", "profile_read", profileIntakeTurnKind);
  }
  if (profileIntakeTurnKind === "correction") {
    return hasExplicitCorrectionReplacement(text)
      ? decision("clarification_answer", "continue", "domain", profileIntakeTurnKind)
      : decision("casual_side_turn", "preserve", "none", profileIntakeTurnKind);
  }
  if (profileIntakeTurnKind === "interview_control") {
    const toolScope = /^(?:确认|完成整理并保存(?:到)?(?:个人)?资料库?|导入资料库|保存为经历档案|写入资料库)[。！!]?$/u.test(text)
      ? "domain"
      : "none";
    return decision("task_control", "preserve", toolScope, profileIntakeTurnKind);
  }
  if (
    profileIntakeTurnKind === "career_narrative"
    || profileIntakeTurnKind === "follow_up_answer"
  ) {
    return decision("clarification_answer", "continue", "domain", profileIntakeTurnKind);
  }

  if (input.references?.length) {
    return decision("reference_followup", "preserve", referenceToolScope(text), profileIntakeTurnKind);
  }
  if (/^(继续|继续刚才的?|按刚才(的)?方案继续|继续上次|重试刚才|恢复刚才)/i.test(text)) {
    return decision("continue_current_task", terminal ? "recover" : "continue", "domain", profileIntakeTurnKind);
  }
  if (/^(暂停|停止|取消|恢复任务|重新开始任务|重试)$/i.test(text)) {
    return decision("task_control", "preserve", "none", profileIntakeTurnKind);
  }
  if (
    CASUAL_EXACT.has(compact)
    || /^(你(还)?能|你可以).*(做什么|联网|连接外网|支持什么|有哪些能力)$/i.test(text)
    || /^(你好|您好|谢谢|感谢)[呀啊哦嘛吗吧！!。.]?$/i.test(text)
  ) {
    return decision("casual_side_turn", "preserve", "none", profileIntakeTurnKind);
  }
  if (
    /^(你能|可以).*(读取|查看|访问).*(资料库|个人资料)/i.test(text)
    || /^(?:我的)?(?:名字|姓名)(?:是|叫)?什么(?:来着)?[？?]?$/i.test(text)
    || /^我是谁[？?]?$/i.test(text)
    || /^(?:你应该|请|以后)?怎么称呼我[？?]?$/i.test(text)
    || /(?:资料库|个人资料).*(?:已经)?(?:切换|改名|重命名).*(?:重新)?读取|(?:已经)?(?:切换|改名|重命名|改成).*(?:请)?(?:重新)?读取.*(?:资料库|个人资料)|(?:当前|活动)资料库.*(?:确认|写入目标)/i.test(text)
  ) {
    return decision("casual_side_turn", "preserve", "profile_read", profileIntakeTurnKind);
  }
  if (
    /^(?:刚才|为什么|为何).*(?:暂时)?没有新进展.*(?:原因|怎么回事|为什么)?[？?]?$/i.test(text)
    || /^(?:我)?(?:应该|需要|还要)(?:补充|提供)(?:什么|哪些).*(?:信息|资料)?[？?]?$/i.test(text)
  ) {
    return decision("casual_side_turn", "preserve", "none", profileIntakeTurnKind);
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
      ...decision("new_domain_task", preserveApplicationRoot ? "continue" : "replace", "domain", profileIntakeTurnKind),
      newTask: task
    };
  }
  if (input.taskState?.completionStatus === "waiting_for_user") {
    return decision("clarification_answer", "continue", "domain", profileIntakeTurnKind);
  }
  return decision("new_domain_task", terminal ? "replace" : "continue", "domain", profileIntakeTurnKind);
}

export function classifyProfileIntakeTurn(input: {
  text: string;
  stage?: string;
  activeQuestionId?: string;
  activeQuestionLabel?: string;
  expectedAnswerDimension?: string;
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
  if (
    input.activeQuestionId
    && input.stage === "collect_experience"
    && input.expectedAnswerDimension
    && grounded
    && !looksLikeNewAssetNarrative(text, input.activeQuestionLabel)
  ) {
    return "follow_up_answer";
  }
  if (grounded) return "career_narrative";
  if (CASUAL_EXACT.has(text.toLowerCase().replace(/[\s？?！!。,.，]/g, ""))) return "casual_side_turn";
  return "unknown";
}

function looksLikeNewAssetNarrative(text: string, activeQuestionLabel?: string) {
  if (activeQuestionLabel && text.includes(activeQuestionLabel)) return false;
  if (/\r?\n/u.test(text) || text.length > 140) return true;
  if (/^(?:在|于|参加|获得|开发|担任|就读|曾在)\s*/u.test(text)) return true;
  if (/(?:项目|公司|实验室|社团|课程|竞赛|研究|平台|学校|岗位|奖项|活动)/u.test(text)
    && !/(?:这个|该|这项|这段)\s*(?:项目|经历|工作)/u.test(text)) return true;
  return /(?:^|[。！？!\n])\s*(?:在|于|参加|获得|开发|负责|担任|就读|曾在).{1,80}(?:项目|公司|实验室|社团|课程|竞赛|研究|平台|学校|岗位|奖项|活动)/u.test(text);
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
  profileIntakeTurnKind?: ProfileIntakeTurnKind
): TurnIntentDecision {
  return { intent, confidence: "high", taskMutation, toolScope, profileIntakeTurnKind };
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
