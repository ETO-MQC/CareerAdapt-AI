import type { AgentOption, AgentUiAction } from "@/agent/contracts/agentActions";
import type { AgentQuickActionId } from "@/agent/contracts/agentQuickAction";
import { resolveWorkflowPrerequisites, type WorkflowPrerequisiteResolution } from "@/agent/workflows/workflowPrerequisiteResolver";

export const IMPORT_EXISTING_RESUME_RESPONSE =
  "支持 PDF、DOCX、JSON、Markdown 和 TXT。\n上传后会先在本地提取并脱敏，再进行结构识别。\n结果会按基本信息、教育、工作、项目、技能等栏目逐项核对，\n确认后才写入资料库。";

export type QuickActionWorkflowResolution = {
  handledLocally: true;
  assistantText: string;
  uiAction?: AgentUiAction;
  options?: AgentOption[];
  modelCalls: 0;
  profileReads: 0;
  resumeReads?: 0;
  jobReads: 0;
};

export type QuickActionPrerequisiteResolution = {
  handledLocally: true;
  assistantText: string;
  uiAction?: AgentUiAction;
  options: AgentOption[];
  modelCalls: 0;
  profileReads: 1;
  resumeReads: 1;
  jobReads: 1;
  prerequisite: WorkflowPrerequisiteResolution;
};

export function resolveQuickActionWorkflow(actionId: AgentQuickActionId): QuickActionWorkflowResolution | undefined {
  if (actionId !== "import_existing_resume") return undefined;
  return {
    handledLocally: true,
    assistantText: IMPORT_EXISTING_RESUME_RESPONSE,
    uiAction: { type: "open_resume_upload" },
    modelCalls: 0,
    profileReads: 0,
    resumeReads: 0,
    jobReads: 0
  };
}

export function resolveQuickActionPrerequisites(input: {
  actionId: AgentQuickActionId;
  workflowId: string;
  profiles?: unknown[];
  resumes?: unknown[];
  jobs?: unknown[];
}): QuickActionPrerequisiteResolution | undefined {
  if (input.actionId === "import_existing_resume" || input.actionId === "build_profile_from_scratch") return undefined;

  const prerequisite = resolveWorkflowPrerequisites({
    workflowId: input.workflowId,
    profiles: input.profiles,
    resumes: input.resumes,
    jobs: input.jobs
  });
  if (prerequisite.ready) return undefined;

  const options = prerequisiteOptions(prerequisite);
  return {
    handledLocally: true,
    assistantText: prerequisiteAssistantText(prerequisite),
    options,
    modelCalls: 0,
    profileReads: 1,
    resumeReads: 1,
    jobReads: 1,
    prerequisite
  };
}

function prerequisiteAssistantText(resolution: WorkflowPrerequisiteResolution) {
  const jobs = resolution.availableAlternatives
    .filter((asset) => asset.kind === "job")
    .map((asset) => asset.label);
  if (jobs.length && resolution.missing.includes("profile") && resolution.missing.includes("resume")) {
    return `已找到并保留岗位：${jobs.join("、")}。\n当前缺少个人资料库和可用简历；请选择导入简历或从零整理经历，完成后我会继续当前任务。`;
  }
  const missingLabel = resolution.missing.map((kind) => ({
    profile: "个人资料库",
    resume: "可用简历",
    job: "目标岗位"
  }[kind])).join("、");
  return `当前任务还缺少${missingLabel}。我已先读取现有资料，并准备好下一步，请选择一个具体操作。`;
}

function prerequisiteOptions(resolution: WorkflowPrerequisiteResolution): AgentOption[] {
  if (resolution.missing.includes("profile") && resolution.missing.includes("resume")) {
    return [
      {
        id: "quick-prerequisite-import-resume",
        label: "导入简历",
        action: { type: "open_resume_upload" }
      },
      {
        id: "quick-prerequisite-build-profile",
        label: "从零整理经历",
        action: { type: "start_workflow", workflowId: "guided_profile_intake" }
      }
    ];
  }
  if (resolution.missing.includes("profile")) {
    return [{
      id: "quick-prerequisite-profile",
      label: "选择个人资料库",
      action: { type: "open_profile_browser" }
    }];
  }
  if (resolution.missing.includes("resume")) {
    return [
      {
        id: "quick-prerequisite-upload-resume",
        label: "导入简历",
        action: { type: "open_resume_upload" }
      },
      {
        id: "quick-prerequisite-select-resume",
        label: "选择已有简历",
        action: { type: "open_resume_picker" }
      }
    ];
  }
  if (resolution.missing.includes("job")) {
    return [{
      id: "quick-prerequisite-import-job",
      label: "导入岗位",
      action: { type: "open_job_import_dialog" }
    }];
  }
  return [];
}
