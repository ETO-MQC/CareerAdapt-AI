import { JobDescriptionSchema, type JobDescription } from "@/domain/schemas";

const DEMO_TIME = "2026-07-01T09:00:00.000Z";

function sourceSpan(text: string) {
  return {
    start: 0,
    end: text.length,
    text
  };
}

const dataAnalystRawText =
  "数据分析实习生：负责业务数据清洗、统计分析和周报支持；熟悉 Excel 或 Stata；具备清晰的数据表达能力，有统计建模经验优先。";

const tradeOperationRawText =
  "外贸/跨境运营实习生：协助整理商品和订单信息，跟进跨境业务流程；要求英语读写能力、沟通协作和执行力；了解外贸流程优先。";

export const demoJobDescriptions: JobDescription[] = [
  JobDescriptionSchema.parse({
    id: "job-data-analyst-intern",
    title: "数据分析实习生",
    company: "示例科技公司",
    industry: "互联网",
    location: "杭州",
    workType: "实习",
    rawText: dataAnalystRawText,
    source: "demo",
    parsedAt: DEMO_TIME,
    requirements: [
      {
        id: "req-data-cleaning",
        category: "responsibility",
        description: "负责业务数据清洗、统计分析和周报支持。",
        priority: "high",
        hardConstraint: false,
        sourceSpan: sourceSpan("负责业务数据清洗、统计分析和周报支持"),
        keywords: ["数据清洗", "统计分析", "周报"],
        confidence: 0.92,
        createdAt: DEMO_TIME,
        updatedAt: DEMO_TIME
      },
      {
        id: "req-data-tools",
        category: "core_skill",
        description: "熟悉 Excel 或 Stata。",
        priority: "high",
        hardConstraint: false,
        sourceSpan: sourceSpan("熟悉 Excel 或 Stata"),
        keywords: ["Excel", "Stata"],
        confidence: 0.95,
        createdAt: DEMO_TIME,
        updatedAt: DEMO_TIME
      }
    ],
    createdAt: DEMO_TIME,
    updatedAt: DEMO_TIME
  }),
  JobDescriptionSchema.parse({
    id: "job-trade-operation-intern",
    title: "外贸/跨境运营实习生",
    company: "示例跨境公司",
    industry: "跨境电商",
    location: "上海",
    workType: "实习",
    rawText: tradeOperationRawText,
    source: "demo",
    parsedAt: DEMO_TIME,
    requirements: [
      {
        id: "req-trade-process",
        category: "responsibility",
        description: "协助整理商品和订单信息，跟进跨境业务流程。",
        priority: "high",
        hardConstraint: false,
        sourceSpan: sourceSpan("协助整理商品和订单信息，跟进跨境业务流程"),
        keywords: ["信息整理", "跨境业务流程"],
        confidence: 0.9,
        createdAt: DEMO_TIME,
        updatedAt: DEMO_TIME
      },
      {
        id: "req-english-writing",
        category: "must_have",
        description: "具备英语读写能力、沟通协作和执行力。",
        priority: "high",
        hardConstraint: true,
        sourceSpan: sourceSpan("要求英语读写能力、沟通协作和执行力"),
        keywords: ["英语", "沟通", "执行力"],
        confidence: 0.94,
        createdAt: DEMO_TIME,
        updatedAt: DEMO_TIME
      }
    ],
    createdAt: DEMO_TIME,
    updatedAt: DEMO_TIME
  })
];
