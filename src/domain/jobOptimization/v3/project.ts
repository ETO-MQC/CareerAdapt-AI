import type { JdAnalyzerOutput, JobRequirementGraphV3, JobRequirementGraphV4, RequirementNodeV3 } from "@/domain/schemas";

export function projectJobGraphV3ToAnalyzerOutput(input: {
  graph: JobRequirementGraphV3;
  title: string;
  company: string | null;
  now?: string;
}): JdAnalyzerOutput {
  return projectJobGraphToAnalyzerOutput(input);
}

export function projectJobGraphV4ToAnalyzerOutput(input: {
  graph: JobRequirementGraphV4;
  title: string;
  company: string | null;
  now?: string;
}): JdAnalyzerOutput {
  return projectJobGraphToAnalyzerOutput(input);
}

function projectJobGraphToAnalyzerOutput(input: {
  graph: JobRequirementGraphV3 | JobRequirementGraphV4;
  title: string;
  company: string | null;
  now?: string;
}): JdAnalyzerOutput {
  const now = input.now ?? new Date().toISOString();
  const field = (value: string) => {
    const span = input.graph.sourceCoverage.coveredSpans.find(span => span.text.includes(value));
    return span ? { value, sourceQuote: span.text, sourceSpan: span, confidenceLevel: "medium" as const,
      confidenceReason: "字段值可在引用原文中核对。", needsConfirmation: true } : undefined;
  };
  return {
    title: field(input.title),
    company: input.company ? field(input.company) : undefined,
    requirements: input.graph.requirements.map((node) => ({
      id: node.id,
      category: legacyCategory(node),
      description: node.statement,
      priority: node.priority,
      hardConstraint: node.hardConstraint,
      sourceQuote: node.sourceSpan.text,
      sourceSpan: node.sourceSpan,
      keywordLogic: node.keywordLogic,
      keywords: node.exactKeywords,
      confidenceLevel: node.confidence >= 0.8 ? "high" : node.confidence >= 0.6 ? "medium" : "low",
      confidenceReason: "确定性分段与 AI 语义结果已按原文位置对账。",
      needsConfirmation: node.needsConfirmation,
      confirmedByUser: !node.needsConfirmation,
      createdAt: now,
      updatedAt: now
    })),
    riskNotes: input.graph.sourceCoverage.unclassifiedSpans.map((span) => `未分类来源：${span.text}`)
  };
}

function legacyCategory(node: RequirementNodeV3) {
  const map = {
    responsibility: "responsibility", hard_constraint: "must_have", core_competency: "core_skill",
    tool_or_technology: "tool", experience_depth: "experience", education: "education", language: "language",
    soft_skill: "soft_skill", domain_knowledge: "core_skill", preferred: "nice_to_have", risk_or_uncertain: "risk_or_uncertain"
  } as const;
  return map[node.kind];
}
