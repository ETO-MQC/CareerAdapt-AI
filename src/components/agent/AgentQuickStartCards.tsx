type QuickStart = {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
};

const items: QuickStart[] = [
  { id: "tailor-existing", title: "已有简历适配目标岗位", description: "选择简历、解析岗位、核对差异并创建新版本。", enabled: true },
  { id: "from-profile", title: "从资料库生成岗位简历", description: "从已确认的资料中组织一份岗位简历。", enabled: true },
  { id: "import-resume", title: "导入并核对简历", description: "解析文件并逐项确认来源。", enabled: false },
  { id: "job-review", title: "岗位语义核对", description: "整理岗位要求与待确认项。", enabled: false },
  { id: "application-prep", title: "准备投递材料", description: "汇总岗位、简历和投递材料。", enabled: false },
  { id: "resume-review", title: "简历质量检查", description: "检查完整性、排版和事实风险。", enabled: false }
];

export function AgentQuickStartCards({ onSelect }: { onSelect(id: string): void }) {
  return (
    <section className="agent-quick-start" aria-labelledby="agent-quick-start-title">
      <div className="agent-section-heading">
        <div>
          <p className="eyebrow">快捷开始</p>
          <h2 id="agent-quick-start-title">你想先完成什么？</h2>
        </div>
      </div>
      <div className="agent-quick-grid">
        {items.map((item) => (
          <button
            key={item.id}
            className="agent-quick-card"
            type="button"
            disabled={!item.enabled}
            onClick={() => onSelect(item.id)}
          >
            <span className="agent-quick-title">{item.title}</span>
            <span>{item.description}</span>
            <small>{item.enabled ? "开始任务" : "即将开放"}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
