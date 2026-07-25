import type { AgentUiAction, AgentWorkflowControl } from "../contracts/agentActions";

export type AgentRoutedIntent =
  | { kind: "workflow_control"; confidence: "high"; action: AgentWorkflowControl; label: string }
  | { kind: "ui_action"; confidence: "high"; action: AgentUiAction; label: string }
  | { kind: "llm"; confidence: "low" };

type RouteContext = {
  activeWorkflowId?: string;
};

const WORKFLOWS = {
  profileIntake: "guided_profile_intake",
  resumeImport: "resume_import",
  jobIngestion: "job_ingestion",
  buildFromProfile: "build_resume_from_profile",
  tailorExisting: "tailor_existing_resume",
  analyzeFit: "analyze_job_fit",
  repairExport: "repair_and_export_resume"
} as const;

export function routeAgentIntent(input: string, context: RouteContext = {}): AgentRoutedIntent {
  const text = normalize(input);
  if (!text) return { kind: "llm", confidence: "low" };

  if (matches(text, ["取消", "不用了", "结束任务", "停止当前任务", "cancel"])) {
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
  if (matches(text, ["打开资料库", "个人资料库", "资料库", "profile browser"])) {
    return ui("打开资料库", { type: "open_profile_browser" });
  }
  if (matches(text, ["打开工具", "工具", "工具箱", "工具面板", "tool palette"])) {
    return ui("打开工具", { type: "open_tool_palette" });
  }
  if (matches(text, ["打开岗位", "岗位列表", "查看岗位"])) {
    return ui("打开岗位", { type: "open_job_import_dialog" });
  }

  if (matches(text, ["录入岗位", "新增岗位", "导入岗位", "添加岗位", "粘贴岗位", "我要录入岗位"])) {
    return workflow("录入岗位", { type: "switch_workflow", workflowId: WORKFLOWS.jobIngestion, preserveCurrent: true });
  }
  if (matches(text, ["导入简历", "上传简历", "解析简历"])) {
    return workflow("导入简历", { type: "start_workflow", workflowId: WORKFLOWS.resumeImport });
  }
  if (matches(text, ["从资料库生成", "资料库组装", "组装简历", "从资料库组装简历"])) {
    return workflow("从资料库生成", { type: "start_workflow", workflowId: WORKFLOWS.buildFromProfile });
  }
  if (matches(text, ["优化已有简历", "定制简历", "改简历", "tailor"])) {
    return workflow("优化已有简历", { type: "start_workflow", workflowId: WORKFLOWS.tailorExisting });
  }
  if (matches(text, ["匹配度", "岗位匹配", "分析岗位", "fit"])) {
    return workflow("分析岗位匹配", { type: "start_workflow", workflowId: WORKFLOWS.analyzeFit });
  }
  if (matches(text, ["导出", "导出简历", "生成 pdf", "pdf"])) {
    return workflow("导出简历", { type: "start_workflow", workflowId: WORKFLOWS.repairExport });
  }

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

