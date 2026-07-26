import type { AgentUiAction, AgentWorkflowControl } from "../contracts/agentActions";

export type AgentRoutedIntent =
  | { kind: "workflow_control"; confidence: "high"; action: AgentWorkflowControl; label: string }
  | { kind: "ui_action"; confidence: "high"; action: AgentUiAction; label: string }
  | { kind: "llm"; confidence: "low" };

type RouteContext = {
  activeWorkflowId?: string;
};

const WORKFLOWS = {
  jobIngestion: "job_ingestion",
  tailorExisting: "tailor_existing_resume"
} as const;

export function routeAgentIntent(input: string, context: RouteContext = {}): AgentRoutedIntent {
  const raw = input.trim().toLowerCase();
  if (/打开.*(岗位|职位).*(表单|窗口|录入框)|open.*job.*(form|dialog)/i.test(raw)) {
    return ui("打开岗位录入表单", { type: "open_job_import_dialog" });
  }
  // Typed job-ingestion intent belongs to AgentKernel. Only explicit requests
  // for the structured form are UI actions.
  if (/(录入|导入|新增|添加|粘贴).*(岗位|职位)/.test(raw)) {
    return { kind: "llm", confidence: "low" };
  }
  const text = normalize(input);
  if (!text) return { kind: "llm", confidence: "low" };

  if (matches(text, ["取消", "确认取消", "不用了", "结束任务", "停止当前任务", "cancel"])) {
    return workflow("取消任务", { type: "cancel_workflow", workflowId: context.activeWorkflowId || WORKFLOWS.jobIngestion });
  }
  if (matches(text, ["暂停", "先暂停", "pause"])) {
    return workflow("暂停任务", { type: "pause_workflow", workflowId: context.activeWorkflowId || WORKFLOWS.tailorExisting });
  }
  if (matches(text, ["继续", "恢复", "接着来", "resume"])) {
    return workflow("继续任务", { type: "resume_workflow", workflowId: context.activeWorkflowId || WORKFLOWS.tailorExisting });
  }
  if (matches(text, ["返回", "上一步", "回退", "go back"])) {
    return workflow("返回上一步", { type: "go_back", workflowId: context.activeWorkflowId || WORKFLOWS.tailorExisting });
  }

  if (matches(text, ["选择简历", "选简历", "打开简历选择", "resume picker"])) {
    return ui("选择简历", { type: "open_resume_picker" });
  }
  if (matches(text, ["打开资料库", "打开个人资料库", "进入资料库", "进入个人资料库", "浏览资料库", "浏览个人资料库", "去资料库", "profile browser"])) {
    return ui("打开资料库", { type: "open_profile_browser" });
  }
  if (matches(text, ["打开工具", "工具", "工具箱", "工具面板", "tool palette"])) {
    return ui("打开工具", { type: "open_tool_palette" });
  }
  // Natural-language domain intent is always interpreted by AgentHost/Kernel.
  // Typed UI controls above remain deterministic; they never own a business turn.
  return { kind: "llm", confidence: "low" };
}

function workflow(label: string, action: AgentWorkflowControl): AgentRoutedIntent {
  return { kind: "workflow_control", confidence: "high", action, label };
}

function ui(label: string, action: AgentUiAction): AgentRoutedIntent {
  return { kind: "ui_action", confidence: "high", action, label };
}

function normalize(input: string) {
  return input.trim().toLowerCase().replace(/\s+/g, "");
}

function matches(text: string, phrases: string[]) {
  return phrases.some((phrase) => text.includes(phrase.toLowerCase().replace(/\s+/g, "")));
}
