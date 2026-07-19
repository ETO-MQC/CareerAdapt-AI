import type { JdAnalyzerOutput, JobRequirementNodeV2 } from "@/domain/schemas";
import { analyzeJobDescriptionV2 } from "@/domain/jobOptimization/v2/analyze";

/** Compatibility adapter: deterministic V2 parsing, persisted through the existing draft contract. */
export function createManualJdOutput(rawText: string, title: string, company: string): JdAnalyzerOutput {
  const now = new Date().toISOString();
  const graph = analyzeJobDescriptionV2({ rawText, now });
  const first = graph.nodes[0]?.sourceSpan ?? graph.unclassifiedSourceSpans[0] ?? { start: 0, end: Math.min(rawText.length, 120), text: rawText.slice(0, 120) };
  const sourceField = (value: string, reason: string) => ({ value, sourceQuote: first.text || value, sourceSpan: first.text ? first : undefined, confidenceLevel: "medium" as const, confidenceReason: reason, needsConfirmation: false });
  return {
    title: sourceField(title, "岗位名称来自用户填写。"),
    company: sourceField(company, "公司名称来自用户填写。"),
    requirements: graph.nodes.map((node) => ({
      id: node.id, category: legacyCategory(node), description: node.statement,
      priority: node.priority === "must" ? "must" : node.priority === "nice_to_have" ? "nice_to_have" : node.priority === "uncertain" ? "uncertain" : "high",
      hardConstraint: node.hardConstraint, sourceQuote: node.sourceSpan.text, sourceSpan: node.sourceSpan,
      keywords: node.exactKeywords, confidenceLevel: node.confidence >= 0.8 ? "high" : node.confidence >= 0.6 ? "medium" : "low",
      confidenceReason: `由确定性 V2 解析器按${kindLabel(node.kind)}识别；保留 JD 原文位置。`,
      needsConfirmation: node.needsConfirmation, confirmedByUser: !node.needsConfirmation, createdAt: now, updatedAt: now
    })),
    riskNotes: graph.unclassifiedSourceSpans.map((span) => `未分类来源（未丢弃）：${span.text}`)
  };
}

function legacyCategory(node: JobRequirementNodeV2) {
  const map = {
    responsibility: "responsibility", hard_constraint: "must_have", core_competency: "core_skill",
    tool_or_technology: "tool", experience_depth: "experience", education: "education", language: "language",
    soft_skill: "soft_skill", domain_knowledge: "core_skill", preferred: "nice_to_have", risk_or_uncertain: "risk_or_uncertain"
  } as const;
  return map[node.kind];
}
function kindLabel(kind: JobRequirementNodeV2["kind"]) {
  const labels: Record<JobRequirementNodeV2["kind"], string> = { responsibility: "岗位职责", hard_constraint: "硬性条件", core_competency: "核心能力", tool_or_technology: "工具或技术", experience_depth: "经验年限", education: "学历", language: "语言", soft_skill: "软技能", domain_knowledge: "领域知识", preferred: "加分项", risk_or_uncertain: "不确定要求" };
  return labels[kind];
}
