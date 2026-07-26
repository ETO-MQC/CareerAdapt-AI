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

export type AgentIntentRoute = {
  intent: AgentIntentClass;
  goal: string;
  confidence: number;
  relevantEntityTypes: Array<"profile" | "resume" | "job" | "application">;
  capabilityGroups: string[];
  possibleWorkflow?: string;
  needsClarification: boolean;
};

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
    "get_profile", "recommend_resume_source", "create_job_resume_from_profile", "analyze_job_fit", "create_tailoring_session",
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
  private readonly routeCache = new Map<string, AgentIntentRoute>();

  classify(userMessage: string): AgentIntentClass {
    return this.route(userMessage).intent;
  }

  route(userMessage: string, cacheKey = userMessage): AgentIntentRoute {
    const cached = this.routeCache.get(cacheKey);
    if (cached) return cached;
    const text = userMessage.trim();
    const compact = text.toLowerCase().replace(/\s+/g, "");
    let result: AgentIntentRoute;
    if (!compact || CASUAL_TURNS.has(compact)) result = route("conversation", "conversation", 1, [], []);
    else if (looksLikeJobDescription(text)) result = route("job_ingestion", "apply_to_job", 0.99, ["job"], ["job_ingestion"], "job_ingestion");
    else if (/这工作.*(合适|不错|可以).*(试试|申请|应聘)|想试试.*(工作|岗位)/i.test(text)) {
      result = route("application_intent", "apply_to_job", 0.92, ["job", "application"], ["job", "tailoring"], "tailor_existing_resume");
    } else if (/还是刚才(那个)?岗位|再做一版|再改一版/i.test(text)) {
      result = route("tailoring", "tailor_previous_job", 0.9, ["job", "resume"], ["tailoring"], "tailor_existing_resume");
    } else if (/到底有没有.*(经历|经验)|看看我.*(经历|经验)/i.test(text)) {
      result = route("profile_search", "search_profile_evidence", 0.93, ["profile"], ["profile"]);
    } else if (/想换工作.*不知道|不知道.*(做什么|找什么工作)|职业方向|职业探索/i.test(text)) {
      result = route("conversation", "career_exploration", 0.9, ["profile"], []);
    } else if (hasAny(compact, ["历史对话", "以前聊", "上次任务", "会话", "session"])) result = route("session_memory", "recall_session", 0.95, [], ["session_memory"]);
    else if (hasAny(compact, ["我的名字", "姓名", "名字是不是", "我是谁", "称呼", "叫我"])) result = route("profile_identity", "profile_identity", 0.96, ["profile"], ["profile"]);
    else if (hasAny(compact, ["资料库", "经历", "项目", "技能", "证书", "教育"])
      && (compact === "资料库" || hasAny(compact, ["我的", "我有", "丰富", "哪些", "查找", "搜索"]))) result = route("profile_search", "search_profile_evidence", 0.88, ["profile"], ["profile"]);
    else if (hasAny(compact, ["应聘一个岗位", "申请一个岗位", "找一个岗位", "求职一个岗位"])) result = route("application_intent", "apply_to_job", 0.98, ["job", "application"], ["job", "tailoring"], "tailor_existing_resume");
    else if (hasAny(compact, ["录入岗位", "导入岗位", "新增岗位", "粘贴岗位", "职位描述", "jd"])) result = route("job_ingestion", "ingest_job", 0.96, ["job"], ["job_ingestion"], "job_ingestion");
    else if (hasAny(compact, ["定制简历", "优化简历", "匹配岗位", "岗位匹配", "tailor"])) result = route("tailoring", "tailor_resume", 0.95, ["profile", "resume", "job"], ["tailoring"], "tailor_existing_resume");
    else if (hasAny(compact, ["导出", "pdf"])) result = route("export", "export_resume", 0.96, ["resume"], ["export"], "repair_and_export_resume");
    else if (hasAny(compact, ["简历", "resume"])) result = route("resume", "resume_task", 0.8, ["resume"], ["resume"]);
    else if (hasAny(compact, ["岗位", "职位", "工作机会"])) result = route("job", "job_lookup", 0.78, ["job"], ["job"]);
    else result = route("conversation", "conversation", 0.55, [], []);
    this.routeCache.set(cacheKey, result);
    return result;
  }

  allowedToolNames(input: {
    session: AgentSession;
    userMessage: string;
    workflowToolNames: string[];
  }) {
    if (["choose_resume_source", "create_profile_resume", "analyze_fit", "generate_plan", "clarify_unsupported_facts", "preview_changes", "confirm_apply", "quality_result"].includes(input.session.taskState?.stage ?? "")) {
      return CAPABILITIES.tailoring;
    }
    const intent = this.route(
      input.userMessage,
      `${input.session.id}:${input.session.activeTurn?.id ?? "pending"}:${input.userMessage}`
    ).intent;
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

function route(
  intent: AgentIntentClass,
  goal: string,
  confidence: number,
  relevantEntityTypes: AgentIntentRoute["relevantEntityTypes"],
  capabilityGroups: string[],
  possibleWorkflow?: string
): AgentIntentRoute {
  return {
    intent,
    goal,
    confidence,
    relevantEntityTypes,
    capabilityGroups,
    possibleWorkflow,
    needsClarification: confidence < 0.5
  };
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
