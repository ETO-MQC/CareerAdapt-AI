import type { AgentMessageReference, AgentTaskState } from "@/agent/contracts/agentSession";

export type TurnIntent =
  | "continue_current_task"
  | "new_domain_task"
  | "casual_side_turn"
  | "task_control"
  | "clarification_answer"
  | "reference_followup";

export type TurnTaskMutation = "preserve" | "continue" | "recover" | "replace";
export type TurnToolScope = "none" | "profile_read" | "domain";

export type TurnIntentDecision = {
  intent: TurnIntent;
  confidence: "high";
  taskMutation: TurnTaskMutation;
  toolScope: TurnToolScope;
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

  if (input.references?.length) {
    return decision("reference_followup", "preserve", referenceToolScope(text));
  }
  if (/^(继续|继续刚才的?|按刚才(的)?方案继续|继续上次|重试刚才|恢复刚才)/i.test(text)) {
    return decision("continue_current_task", terminal ? "recover" : "continue", "domain");
  }
  if (/^(暂停|停止|取消|恢复任务|重新开始任务|重试)$/i.test(text)) {
    return decision("task_control", "preserve", "none");
  }
  if (
    CASUAL_EXACT.has(compact)
    || /^(你(还)?能|你可以).*(做什么|联网|连接外网|支持什么|有哪些能力)$/i.test(text)
    || /^(你好|您好|谢谢|感谢)[呀啊哦嘛吗吧！!。.]?$/i.test(text)
  ) {
    return decision("casual_side_turn", "preserve", "none");
  }
  if (/^(你能|可以).*(读取|查看|访问).*(资料库|个人资料)|^我是谁$/i.test(text)) {
    return decision("casual_side_turn", "preserve", "profile_read");
  }
  if (
    /导入(一个|新的?|这个|该)?(岗位|职位)|重新.*(另一份|新的?).*简历|我想(申请|应聘|投)(这个|该)?(岗位|职位)|录入(一个|新的?|这个|该)?(岗位|职位)|上传.*简历|分析.*(JD|岗位描述|职位描述)|(深挖|丰富|梳理|挖掘).*(经历|项目)|从零.*(整理|梳理).*(经历|资料)|定制简历|岗位定制/i.test(text)
    || isExplicitExportIntent(text)
    || looksLikeJobDescription(text)
  ) {
    const task = newDomainTask(text);
    const preserveApplicationRoot = task.goal === "ingest_job"
      && input.taskState?.rootGoal === "apply_to_job";
    return {
      ...decision("new_domain_task", preserveApplicationRoot ? "continue" : "replace", "domain"),
      newTask: task
    };
  }
  if (input.taskState?.completionStatus === "waiting_for_user") {
    return decision("clarification_answer", "continue", "domain");
  }
  return decision("new_domain_task", terminal ? "replace" : "continue", "domain");
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
  toolScope: TurnToolScope
): TurnIntentDecision {
  return { intent, confidence: "high", taskMutation, toolScope };
}

function referenceToolScope(text: string): TurnToolScope {
  return /我是谁|读取.*资料库|查看.*资料库/i.test(text) ? "profile_read" : "none";
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
