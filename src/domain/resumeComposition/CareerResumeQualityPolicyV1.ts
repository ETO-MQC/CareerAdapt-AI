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
    "evidence_over_decoration",
    "direct_evidence_over_similarity",
    "ownership_preservation",
    "technical_specificity_without_keyword_stuffing",
    "maturity_aware_claim_language",
    "natural_narration_without_ai_boilerplate",
    "no_change_needed_is_valid"
  ] as const,
  writerInstructions: [
    "Lead with an accomplishment, decision, or concrete contribution whenever the confirmed evidence supports one; do not fill space with personality adjectives.",
    "Prefer the sequence Context → Goal → Action → Method → Result/Verification → Reflection, but omit unsupported stages rather than inventing them.",
    "Prioritize the employer's likely pain point and the target objective, while keeping every statement interview-defensible from the supplied evidence.",
    "Give real experience and demonstrated work priority over generic skills, filler summary language, and decorative keywords.",
    "Metrics, scale, ownership, outcomes, and technical methods require direct or confirmed evidence; Fact Guard remains authoritative.",
    "Use evidence in this order: direct target experience, related resume experience, confirmed profile fact, then explicit user declaration; a job description never proves a fact.",
    "Preserve the source's participation, assistance, cooperation, ownership, independence, and leadership level; never upgrade a verb to make a match look stronger.",
    "Use demonstrated experience for experience claims; use bounded language such as familiar with, basic use, or learning for less mature capability evidence.",
    "Prefer the candidate's concrete nouns and verbs over mechanical phrases such as 'based on the job description', repeated 'through...to achieve...', empty adjectives, or keyword lists.",
    "Summary may synthesize verified experience once; project/work/internship should carry concrete methods and verification; skills may support experience but cannot introduce a capability.",
    "Keep technical nouns and methods specific, but do not concatenate keywords, parrot requirement wording, repeat a sentence, or force a rewrite when the original is already fit."
  ] as const,
  reviewerWarnings: {
    genericSummary: "resume_quality.summary_generic",
    repeatedContent: "resume_quality.repeated_content",
    mechanicalWording: "resume_quality.mechanical_ai_wording",
    emptyAdjective: "resume_quality.empty_adjective"
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
  const mechanicalCount = bullets.filter((bullet) => /^(?:基于|围绕|通过|结合).{0,60}(?:实现|完成|提升|优化)/u.test(bullet)).length;
  if (mechanicalCount >= 2 || bullets.some((bullet) => /(?:根据岗位需求|赋能业务|打造闭环|沉淀能力|抓手)/u.test(bullet) && !hasEvidenceSignal(bullet))) {
    warnings.push(CareerResumeQualityPolicyV1.reviewerWarnings.mechanicalWording);
  }
  if (bullets.some((bullet) => /^(?:具备|拥有|熟悉|掌握|具有).{0,36}(?:能力|素养|经验|意识)[。；;]?$/u.test(bullet))) {
    warnings.push(CareerResumeQualityPolicyV1.reviewerWarnings.emptyAdjective);
  }
  return [...new Set(warnings)];
}

function hasEvidenceSignal(value: string) {
  return /(?:负责|完成|搭建|设计|实现|优化|验证|评估|交付|结果|提升|降低|项目|实习|研究|通过|产出|使用\s*[A-Za-z][\w+#.-]*)/iu.test(value);
}
