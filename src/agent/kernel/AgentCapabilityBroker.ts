import type { AgentSession } from "@/agent/contracts/agentSession";

export type AgentIntentClass =
  | "conversation"
  | "profile_identity"
  | "profile_search"
  | "resume"
  | "application_intent"
  | "job_ingestion"
  | "job"
  | "tailoring"
  | "export"
  | "session_memory"
  | "workflow";

const CAPABILITIES: Record<AgentIntentClass, string[]> = {
  conversation: [],
  profile_identity: ["get_active_profile", "get_profile"],
  profile_search: ["get_active_profile", "get_profile", "search_profile_facts"],
  resume: ["list_resumes", "get_resume", "get_resume_revision"],
  application_intent: ["list_jobs"],
  job_ingestion: ["parse_job_description", "commit_job"],
  job: ["list_jobs", "get_job"],
  tailoring: [
    "list_resumes", "get_resume", "list_jobs", "get_job", "get_active_profile",
    "get_profile", "analyze_job_fit", "create_tailoring_session",
    "answer_tailoring_question", "preview_tailoring_changes", "apply_tailoring_changes"
  ],
  export: ["get_resume", "get_resume_revision", "export_resume"],
  session_memory: ["get_agent_task_context", "search_agent_sessions"],
  workflow: []
};

const CASUAL_TURNS = new Set([
  "你好", "您好", "嗨", "hi", "hello", "hey", "谢谢", "感谢", "好的", "好", "再见", "拜拜"
]);

export class AgentCapabilityBroker {
  classify(userMessage: string): AgentIntentClass {
    const text = userMessage.trim();
    const compact = text.toLowerCase().replace(/\s+/g, "");
    if (text.startsWith("[AUTHORITATIVE_TOOL_OBSERVATION]") || text.startsWith("[USER_REJECTED_ACTION]")) {
      return "workflow";
    }
    if (!compact || CASUAL_TURNS.has(compact)) return "conversation";
    if (looksLikeJobDescription(text)) return "job_ingestion";
    if (hasAny(compact, ["历史对话", "以前聊", "上次任务", "会话", "session"])) return "session_memory";
    if (hasAny(compact, ["我的名字", "姓名", "名字是不是", "我是谁", "称呼", "叫我"])) return "profile_identity";
    if (hasAny(compact, ["资料库", "经历", "项目", "技能", "证书", "教育"])
      && (compact === "资料库" || hasAny(compact, ["我的", "我有", "丰富", "哪些", "查找", "搜索"]))) return "profile_search";
    if (hasAny(compact, ["应聘一个岗位", "申请一个岗位", "找一个岗位", "求职一个岗位"])) return "application_intent";
    if (hasAny(compact, ["录入岗位", "导入岗位", "新增岗位", "粘贴岗位", "职位描述", "jd"])) return "job_ingestion";
    if (hasAny(compact, ["定制简历", "优化简历", "匹配岗位", "岗位匹配", "tailor"])) return "tailoring";
    if (hasAny(compact, ["导出", "pdf"])) return "export";
    if (hasAny(compact, ["简历", "resume"])) return "resume";
    if (hasAny(compact, ["岗位", "职位", "工作机会"])) return "job";
    return "conversation";
  }

  allowedToolNames(input: {
    session: AgentSession;
    userMessage: string;
    workflowToolNames: string[];
  }) {
    const intent = this.classify(input.userMessage);
    if (intent === "workflow") return input.workflowToolNames;
    if (/确认|保存|提交|应用|同意|confirm|save|apply/i.test(input.userMessage) && input.workflowToolNames.length) {
      return input.workflowToolNames;
    }
    if (intent === "conversation" && !CASUAL_TURNS.has(input.userMessage.trim().toLowerCase().replace(/\s+/g, ""))) {
      return input.workflowToolNames;
    }
    const names = [...CAPABILITIES[intent]];
    if (intent === "profile_identity" && input.session.activeProfileId) {
      return names.filter((name) => name !== "get_active_profile");
    }
    return names;
  }
}

export function looksLikeJobDescription(text: string) {
  if (text.trim().length < 240) return false;
  const signals = [
    /职责|工作内容|responsibilit/i,
    /要求|任职资格|qualifications?|requirements?/i,
    /岗位|职位|job\s+description|招聘/i
  ];
  return signals.filter((pattern) => pattern.test(text)).length >= 2;
}

function hasAny(text: string, values: string[]) {
  return values.some((value) => text.includes(value));
}
