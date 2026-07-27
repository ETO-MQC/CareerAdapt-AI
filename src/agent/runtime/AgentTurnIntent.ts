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
    /导入(一个|新的?)?(岗位|职位)|重新.*(另一份|新的?).*简历|我想申请(这个|该)?职位|录入(一个|新的?)?(岗位|职位)|上传.*简历|分析.*(JD|岗位描述|职位描述)|(深挖|丰富|梳理|挖掘).*(经历|项目)/i.test(text)
  ) {
    return {
      ...decision("new_domain_task", "replace", "domain"),
      newTask: newDomainTask(text)
    };
  }
  if (input.taskState?.completionStatus === "waiting_for_user") {
    return decision("clarification_answer", "continue", "domain");
  }
  return decision("new_domain_task", terminal ? "replace" : "continue", "domain");
}

function newDomainTask(text: string): NonNullable<TurnIntentDecision["newTask"]> {
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
