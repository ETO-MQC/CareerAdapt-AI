import type { TailorExistingResumeStep } from "@/agent/workflows/tailorExistingResumeWorkflow";

const milestones: Array<{ step: TailorExistingResumeStep; label: string }> = [
  { step: "select_resume", label: "选择简历" },
  { step: "collect_job", label: "收集岗位" },
  { step: "review_job", label: "核对岗位" },
  { step: "analyze_fit", label: "匹配分析" },
  { step: "preview_changes", label: "预览修改" },
  { step: "completed", label: "创建版本" }
];

export function AgentProgressTimeline({ currentStep }: { currentStep: TailorExistingResumeStep }) {
  const currentIndex = Math.max(0, milestones.findIndex((item) => item.step === currentStep));
  return (
    <ol className="agent-progress" aria-label="当前任务进度">
      {milestones.map((item, index) => (
        <li className={index < currentIndex ? "complete" : index === currentIndex ? "current" : ""} key={item.step}>
          <span aria-hidden="true">{index < currentIndex ? "✓" : index + 1}</span>
          <small>{item.label}</small>
        </li>
      ))}
    </ol>
  );
}
