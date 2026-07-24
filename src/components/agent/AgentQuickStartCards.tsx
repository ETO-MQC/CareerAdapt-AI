import {
  BriefcaseBusiness,
  FileCheck2,
  FileInput,
  Library,
  Sparkles,
  UserRoundSearch
} from "lucide-react";
import type { AgentQuickActionId } from "@/agent/contracts/agentQuickAction";

const items: ReadonlyArray<{
  id: AgentQuickActionId;
  title: string;
  description: string;
  icon: typeof Sparkles;
}> = [
  {
    id: "build_profile_from_scratch",
    title: "从零整理我的经历",
    description: "通过简短访谈，把真实经历整理成可复用资料。",
    icon: UserRoundSearch
  },
  {
    id: "import_existing_resume",
    title: "导入现有简历",
    description: "上传文件，提取内容并逐项核对来源。",
    icon: FileInput
  },
  {
    id: "tailor_resume_to_job",
    title: "生成岗位定制简历",
    description: "选择现有简历与岗位，生成安全的定制版本。",
    icon: Sparkles
  },
  {
    id: "build_resume_from_profile",
    title: "从资料库组装简历",
    description: "从已确认资料中选择经历，组织一份目标简历。",
    icon: Library
  },
  {
    id: "analyze_job_fit",
    title: "分析岗位匹配度",
    description: "核对岗位要求、证据覆盖和需要补充的内容。",
    icon: BriefcaseBusiness
  },
  {
    id: "repair_and_export_resume",
    title: "修复和导出简历",
    description: "检查结构、排版与事实风险，准备导出。",
    icon: FileCheck2
  }
];

export function AgentQuickStartCards({
  onSelect
}: {
  onSelect(id: AgentQuickActionId): void;
}) {
  return (
    <div className="agent-quick-grid">
      {items.map(({ icon: Icon, ...item }) => (
        <button
          key={item.id}
          className="agent-quick-card"
          type="button"
          onClick={() => onSelect(item.id)}
        >
          <span className="agent-quick-icon"><Icon aria-hidden="true" /></span>
          <span className="agent-quick-title">{item.title}</span>
          <span>{item.description}</span>
        </button>
      ))}
    </div>
  );
}
