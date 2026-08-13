/**
 * Competition-demo quality contract for career resumes.
 * This is a review/writing policy, not a new source of facts or a replacement
 * for Fact Guard.
 */
export const CareerResumeQualityPolicyV1 = {
  id: "career-resume-quality-v1",
  principles: [
    "accomplishment_first",
    "context_goal_action_method_result_verification_reflection",
    "employer_pain_point_relevance",
    "objective_and_interview_defensible",
    "experience_priority_over_filler",
    "evidence_over_decoration"
  ] as const,
  writerInstructions: [
    "Lead with an accomplishment, decision, or concrete contribution whenever the confirmed evidence supports one; do not fill space with personality adjectives.",
    "Prefer the sequence Context → Goal → Action → Method → Result/Verification → Reflection, but omit unsupported stages rather than inventing them.",
    "Prioritize the employer's likely pain point and the target objective, while keeping every statement interview-defensible from the supplied evidence.",
    "Give real experience and demonstrated work priority over generic skills, filler summary language, and decorative keywords.",
    "Metrics, scale, ownership, outcomes, and technical methods require direct or confirmed evidence; Fact Guard remains authoritative."
  ] as const,
  reviewerWarnings: {
    genericSummary: "resume_quality.summary_generic",
    repeatedContent: "resume_quality.repeated_content"
  }
} as const;

const genericSummaryPatterns = [
  /具备良好的(?:沟通|学习|责任|团队|抗压)(?:能力|意识)/u,
  /积极主动|责任心强|学习能力强|热爱技术|对(?:人工智能|AI|大模型)充满热情/u,
  /专注于(?:AI|人工智能|大模型).*(?:应用|方向).*(?:具备|拥有).*(?:能力|经验)/iu,
  /本科在读.*(?:熟悉|掌握).*(?:技术|工具).*(?:能力|素养)/u
];

export function careerResumeQualityWarnings(input: { summary?: string; bullets?: string[] }) {
  const warnings: string[] = [];
  const summary = input.summary?.trim();
  if (summary && genericSummaryPatterns.some((pattern) => pattern.test(summary)) && !hasEvidenceSignal(summary)) {
    warnings.push(CareerResumeQualityPolicyV1.reviewerWarnings.genericSummary);
  }
  const bullets = (input.bullets ?? []).map((bullet) => bullet.trim()).filter(Boolean);
  const normalized = new Map<string, number>();
  for (const bullet of bullets) {
    const key = bullet.toLocaleLowerCase().replace(/[\s，。；：、,.!！?？]+/gu, "");
    normalized.set(key, (normalized.get(key) ?? 0) + 1);
  }
  if ([...normalized.values()].some((count) => count > 1)) {
    warnings.push(CareerResumeQualityPolicyV1.reviewerWarnings.repeatedContent);
  }
  return [...new Set(warnings)];
}

function hasEvidenceSignal(value: string) {
  return /(?:负责|完成|搭建|设计|实现|优化|验证|评估|交付|结果|提升|降低|项目|实习|研究|通过|产出|使用\s*[A-Za-z][\w+#.-]*)/iu.test(value);
}
