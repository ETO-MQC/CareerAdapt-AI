import {
  CareerProfileSchema,
  type CareerProfile,
  type FactCategory,
  type FactStatement
} from "@/domain/schemas";

const DEMO_TIME = "2026-07-01T09:00:00.000Z";

function demoFact(
  id: string,
  statement: string,
  category: FactCategory,
  sourceText: string,
  riskLevel: "low" | "medium" | "high" = "low"
): FactStatement {
  return {
    id,
    statement,
    category,
    provenance: [
      {
        sourceType: "demo",
        sourceId: "demo-profile-source",
        sourceText,
        confidence: 0.95,
        confirmedByUser: true,
        riskLevel,
        createdAt: DEMO_TIME
      }
    ],
    confirmedByUser: true,
    riskLevel,
    createdAt: DEMO_TIME,
    updatedAt: DEMO_TIME
  };
}

export const demoCareerProfile: CareerProfile = CareerProfileSchema.parse({
  id: "profile-demo-student",
  name: "陈同学",
  basics: {
    name: "陈同学",
    phone: "138****0000",
    email: "demo.student@example.com",
    location: "杭州",
    summary: "经济管理方向本科生，关注数据分析、AI应用和跨境业务流程。",
    links: []
  },
  preference: {
    targetRoles: ["数据分析实习", "外贸/跨境运营实习"],
    targetCities: ["杭州", "上海"],
    industries: ["互联网", "跨境电商", "咨询"]
  },
  version: 1,
  experiences: [
    {
      id: "exp-stat-modeling",
      type: "competition",
      organization: "统计建模竞赛项目",
      role: "数据分析成员",
      startDate: "2025-03",
      endDate: "2025-06",
      facts: [
        demoFact(
          "fact-stat-stata",
          "使用 Stata 清洗 31 个省级样本，并完成描述统计、相关分析与区域差异分析。",
          "experience",
          "统计建模：使用Stata清洗31个省级样本，完成描述统计、相关分析与区域差异分析。"
        )
      ],
      resumeDrafts: [
        {
          id: "draft-stat-default",
          targetRole: "数据分析实习",
          text: "使用 Stata 清洗 31 个省级样本，完成描述统计、相关分析与区域差异分析，形成论文与汇报材料。",
          factIds: ["fact-stat-stata"],
          createdAt: DEMO_TIME,
          updatedAt: DEMO_TIME
        }
      ],
      tags: ["Stata", "数据清洗", "统计分析"],
      evidenceIds: ["evidence-stat-report"],
      createdAt: DEMO_TIME,
      updatedAt: DEMO_TIME
    },
    {
      id: "exp-ai-product",
      type: "project",
      organization: "AI 求职应用课程项目",
      role: "产品与验收协作",
      startDate: "2025-09",
      endDate: "2025-12",
      facts: [
        demoFact(
          "fact-ai-product",
          "参与 AI 应用项目的需求梳理、原型设计和功能验收。",
          "experience",
          "AI应用项目：参与需求梳理、原型设计和功能验收。"
        )
      ],
      resumeDrafts: [
        {
          id: "draft-ai-default",
          targetRole: "产品/运营实习",
          text: "参与 AI 应用项目需求梳理、原型设计和功能验收，协助将用户流程转化为可检查的功能清单。",
          factIds: ["fact-ai-product"],
          createdAt: DEMO_TIME,
          updatedAt: DEMO_TIME
        }
      ],
      tags: ["需求梳理", "原型设计", "功能验收"],
      evidenceIds: [],
      createdAt: DEMO_TIME,
      updatedAt: DEMO_TIME
    },
    {
      id: "exp-gov-internship",
      type: "internship",
      organization: "某政府部门",
      role: "综合事务实习生",
      startDate: "2025-07",
      endDate: "2025-08",
      facts: [
        demoFact(
          "fact-gov-record",
          "处理公文流转和热线记录，关注记录准确性与信息整理。",
          "experience",
          "政府部门实习：处理公文流转和市长热线记录。"
        )
      ],
      resumeDrafts: [
        {
          id: "draft-gov-default",
          targetRole: "综合运营实习",
          text: "协助处理公文流转与热线记录，保持信息记录准确、分类清晰。",
          factIds: ["fact-gov-record"],
          createdAt: DEMO_TIME,
          updatedAt: DEMO_TIME
        }
      ],
      tags: ["信息整理", "沟通记录"],
      evidenceIds: [],
      createdAt: DEMO_TIME,
      updatedAt: DEMO_TIME
    },
    {
      id: "exp-trade-learning",
      type: "other",
      organization: "外贸课程与语言学习",
      role: "学习者",
      startDate: "2024-09",
      endDate: "2026-06",
      facts: [
        demoFact(
          "fact-cet4",
          "CET-4 成绩 601，了解基础外贸业务流程。",
          "language",
          "英语与外贸学习：CET-4 601，了解外贸业务流程。"
        )
      ],
      resumeDrafts: [
        {
          id: "draft-trade-default",
          targetRole: "外贸/跨境运营实习",
          text: "CET-4 601，了解基础外贸业务流程，具备英文资料阅读和流程信息整理基础。",
          factIds: ["fact-cet4"],
          createdAt: DEMO_TIME,
          updatedAt: DEMO_TIME
        }
      ],
      tags: ["英语", "外贸流程", "信息整理"],
      evidenceIds: [],
      createdAt: DEMO_TIME,
      updatedAt: DEMO_TIME
    }
  ],
  skills: [
    {
      id: "skill-stata",
      name: "Stata",
      level: "familiar",
      evidenceIds: ["evidence-stat-report"],
      fact: demoFact("fact-skill-stata", "使用 Stata 完成数据清洗和统计分析。", "skill", "使用Stata清洗31个省级样本"),
      lastUsedAt: "2025-06",
      createdAt: DEMO_TIME,
      updatedAt: DEMO_TIME
    },
    {
      id: "skill-excel",
      name: "Excel",
      level: "familiar",
      evidenceIds: [],
      fact: demoFact("fact-skill-excel", "能使用 Excel 整理表格数据和基础分析结果。", "skill", "数据清洗、样本整理和分析交付物"),
      lastUsedAt: "2025-06",
      createdAt: DEMO_TIME,
      updatedAt: DEMO_TIME
    }
  ],
  certificates: [
    {
      id: "cert-cet4",
      name: "CET-4",
      issuer: "全国大学英语四、六级考试委员会",
      issuedAt: "2024-12",
      evidenceIds: [],
      fact: demoFact("fact-cert-cet4", "CET-4 成绩 601。", "certificate", "CET-4 601"),
      createdAt: DEMO_TIME,
      updatedAt: DEMO_TIME
    }
  ],
  evidences: [
    {
      id: "evidence-stat-report",
      type: "text",
      title: "统计建模项目说明",
      extractedText: "脱敏示例：使用 Stata 清洗 31 个省级样本并完成统计分析。",
      privacyLevel: "private",
      verifiedAt: DEMO_TIME,
      createdAt: DEMO_TIME,
      updatedAt: DEMO_TIME
    }
  ],
  unclassifiedBlocks: [],
  createdAt: DEMO_TIME,
  updatedAt: DEMO_TIME
});

export const demoProfileFacts = demoCareerProfile.experiences.flatMap((experience) => experience.facts);
