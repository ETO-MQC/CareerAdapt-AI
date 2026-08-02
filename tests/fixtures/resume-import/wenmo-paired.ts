export const wenmoPairedJsonFixture = {
  schemaVersion: 2,
  settings: { bulletStyle: "•", layoutDensity: "compact" },
  personalInfo: {
    name: "<strong>\u200B示例用户</strong>",
    phone: { value: "138001380000", visible: true },
    email: { value: "demo.user@example.com", visible: true },
    address: { value: "", visible: false },
    github: { value: "https://github.com/example-user", visible: true },
    website: { value: "", visible: false },
    linkedin: { value: "", visible: false },
    objective: { value: "开发工程师", visible: true },
    selfEvaluation: "我是生成式 AI 的重度使用者，也是 AI Coding 的持续实践者。",
    selfEvaluationVisible: true
  },
  sections: [
    {
      id: "education", type: "education", title: "教育背景", visible: true, entries: [{
        id: "education-1", title: "<strong>\u200B示例大学</strong>", subtitle: "<strong>计算机相关专业</strong>",
        extra: "<strong>本科</strong>", department: "&#8203;", date: "2024.09-2028.06", visible: true,
        bullets: [{ text: "", showBullet: true }, { text: "隐藏教育信息", showBullet: true, visible: false }]
      }]
    },
    {
      id: "internship", type: "experience", title: "实习经历", visible: true, entries: [
        entry("internship-1", "AI公司", "AI辅助文档与指令评估实践", "2024.09 - 2026.02", ["拆解需求并设计分层提示词", "逐条事实核对与逻辑审查"]),
        entry("internship-2", "外贸公司", "AI优化与审核设计师", "2026.02-至今", ["评估商品分析报告", "协助部署自动化框架"])
      ]
    },
    {
      id: "projects", type: "experience", title: "项目与研究经历", visible: true, entries: [
        entry("project-1", "示例任务系统", "全栈开发", "2026.02-至今", ["设计多轮指令框架", "实现任务数据模型"]),
        entry("project-2", "示例学习助手", "独立开发者", "2026.03 - 至今", ["修正模型幻觉问题", "搭建本地 RAG 流程"]),
        entry("project-3", "示例内容分析系统", "独立开发", "2026.02-至今", ["设计可信度评估提示词框架", "集成三种分析模式"])
      ]
    },
    {
      id: "skills", type: "skill", title: "技能与证书", visible: true, entries: [
        skill("skill-1", "AI 应用与工程化", "RAG 系统搭建与调优"),
        skill("skill-2", "模型质量与风控", "LLM 输出评估与逻辑缺陷识别"),
        skill("skill-3", "全栈开发与自动化", "Python / React / TypeScript"),
        skill("skill-4", "需求与文档", "复杂业务需求拆解与结构化表达")
      ]
    },
    { id: "hidden", type: "experience", title: "隐藏栏目", visible: false, entries: [entry("hidden-1", "不得出现", "不得出现", "2020-2021", ["不得出现"])] }
  ]
};

function entry(id: string, title: string, subtitle: string, date: string, bullets: string[]) {
  return { id, kind: "experience", title: `<strong>${title}</strong>`, subtitle: `<strong>${subtitle}</strong>`, date,
    department: "<br>", extra: "&#8203;", visible: true,
    bullets: [{ text: "", showBullet: true }, ...bullets.map((text) => ({ text: `• ${text}\r\n`, showBullet: true }))] };
}

function skill(id: string, title: string, description: string) {
  return { id, kind: "simple", title: `<strong>\u200B${title}</strong>`, description: `<span>${description}</span>`, visible: true };
}
