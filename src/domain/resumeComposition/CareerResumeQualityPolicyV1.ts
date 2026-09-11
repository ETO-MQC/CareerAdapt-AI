/**
 * Competition-demo quality contract for career resumes.
 * This is a review/writing policy, not a new source of facts or a replacement
 * for Fact Guard.
 */
import { findTechnicalTerms } from "./ResumeSkillTaxonomy";

export const CareerResumeQualityPolicyV1 = {
  id: "career-resume-quality-v1",
  principles: [
    "accomplishment_first",
    "truth_relevance_evidence_clarity_concision_polish",
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
    "Priority: truth/provenance/maturity/ownership > role relevance > specific evidence > clarity/scanability > concision > polish. Lower priorities never override higher ones.",
    "Clear action is the baseline; add method when useful and known, evidence when known, metrics only when supported. Never force STAR/XYZ/AMR or a character limit; keep a long single causal chain together.",
    "Prioritize the employer's likely pain point and the target objective, while keeping every statement interview-defensible from the supplied evidence.",
    "Give real experience and demonstrated work priority over generic skills, filler summary language, and decorative keywords.",
    "Metrics, scale, ownership, outcomes, and technical methods require direct or confirmed evidence; Fact Guard remains authoritative.",
    "Use evidence in this order: direct target experience, related resume experience, confirmed profile fact, then explicit user declaration; a job description never proves a fact.",
    "Preserve the source's participation, assistance, cooperation, ownership, independence, and leadership level; never upgrade a verb to make a match look stronger.",
    "Use demonstrated experience for experience claims; use bounded language such as familiar with, basic use, or learning for less mature capability evidence.",
    "Prefer the candidate's concrete nouns and verbs over mechanical phrases such as 'based on the job description', repeated 'through...to achieve...', empty adjectives, or keyword lists.",
    "Summary is optional: omit by default unless compact positioning materially adds information not obvious from the other sections. Missing Summary, metric, formula, or a multi-page resume is never a defect.",
    "Skills are a compact index; Work/Projects are proof. Redis in Skills plus a Redis cache mechanism in a project is legitimate. Compress repeated long catalogs, not evidence-backed capabilities.",
    "Review preserve-first: KEEP_STRONG (zero rewrite), TIGHTEN, REWRITE, VERIFY, DEDUPLICATE, REMOVE_CANDIDATE. No synonym rewrite without material gain and no silent deletion.",
    "Verified metric > verified scale/range > verified qualitative outcome > no outcome. User-origin precision lacking provenance needs VERIFY; unsupported generated precision is blocked, never invented or silently removed.",
    "Genericity depends on task/object, action, mechanism, scope and evidence together. Words such as 提升、优化、高效、稳定、赋能、用户体验 are not a blacklist.",
    "Under an explicit page target or overflow, trim generic/redundant Summary, repeated catalogs, low-relevance old bullets, generic low-evidence lines, then duplicated detail. Preserve high-relevance, evidenced, differentiating content before cosmetic brevity.",
    "Keep technical nouns and methods specific, but do not concatenate keywords, parrot requirement wording, repeat a sentence, or force a rewrite when the original is already fit."
  ] as const,
  reviewerWarnings: {
    genericSummary: "resume_quality.summary_generic",
    repeatedContent: "resume_quality.repeated_content",
    mechanicalWording: "resume_quality.mechanical_ai_wording",
    emptyAdjective: "resume_quality.empty_adjective",
    genericity: "resume_quality.genericity_boilerplate",
    catalog: "resume_quality.tech_stack_redundancy",
    atomicity: "resume_quality.bullet_atomicity"
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
  if (summary && bullets.some((bullet) => bullet.replace(/[\s\p{P}]+/gu, "") === summary.replace(/[\s\p{P}]+/gu, ""))) {
    warnings.push(CareerResumeQualityPolicyV1.reviewerWarnings.repeatedContent);
  }
  const mechanicalCount = bullets.filter((bullet) => /^(?:基于|围绕|通过|结合).*(?:实现|完成|提升|优化)/u.test(bullet) && !hasEvidenceSignal(bullet)).length;
  if (mechanicalCount >= 2 || bullets.some((bullet) => /(?:根据岗位需求|赋能业务|打造闭环|沉淀能力|抓手)/u.test(bullet) && !hasEvidenceSignal(bullet))) {
    warnings.push(CareerResumeQualityPolicyV1.reviewerWarnings.mechanicalWording);
  }
  if (bullets.some((bullet) => /^(?:具备|拥有|熟悉|掌握|具有).{0,36}(?:能力|素养|经验|意识)[。；;]?$/u.test(bullet) && !hasEvidenceSignal(bullet))) {
    warnings.push(CareerResumeQualityPolicyV1.reviewerWarnings.emptyAdjective);
  }
  for (const bullet of bullets) {
    const quality = assessResumeBullet(bullet);
    if (quality.genericity) warnings.push(CareerResumeQualityPolicyV1.reviewerWarnings.genericity);
    if (quality.catalog) warnings.push(CareerResumeQualityPolicyV1.reviewerWarnings.catalog);
    if (quality.independentAchievements) warnings.push(CareerResumeQualityPolicyV1.reviewerWarnings.atomicity);
  }
  return [...new Set(warnings)];
}

function hasEvidenceSignal(value: string) {
  return assessResumeBullet(value).specific;
}

/** [INFERENCE] Conservative local signals, not a general semantic classifier.
 * An absent optional dimension never independently creates a defect. */
export function assessResumeBullet(text: string, target?: string) {
  const action = /负责|参与|协助|完成|实现|设计|开发|构建|搭建|优化|分析|清洗|组织|维护|主导|配置|封装|built|designed|implemented|developed/iu.test(text);
  const mechanism = /(?:使用|基于|采用|通过|结合|配置|封装).+(?:缓存|状态|接口|检索|解析|重排|评测|组件|渲染|热备|检查|演练|测试|模型|数据|流程|[A-Za-z][\w+#.-]*)|\b(?:using|via|with)\b.+/iu.test(text);
  const context = /订单|会话|文档|查询|召回|传感器|样本|合同|患者|课堂|客户|招聘|志愿者|交易|支付|模块|段落|故障|离线|缓存|state|retrieval|cache|module|query/iu.test(text);
  const evidence = /验证|演练|测试|评测|交付|上线|产出|发布|实测|validated|tested|delivered/iu.test(text);
  const object = text.match(/(?:负责|参与|协助|完成|设计|开发|构建|搭建|组织|维护|配置|封装)([^，。,；;\n]{4,})/u)?.[1];
  // A named task can be specific in any profession; it need not name a tool.
  const concreteObject = Boolean(object && !/^(?:系统|平台|业务|任务|工作|相关|整体|项目|功能|能力|体验|优化|开发|建设|提升|效果|显著|的|了|与|和)+$/u.test(object));
  const specific = action && (mechanism || context || evidence || concreteObject);
  const catalog = !mechanism && (findTechnicalTerms(text).length >= 8 || text.split(/[、,，·|]/u).filter((part) => part.trim()).length >= 8);
  const genericity = !specific && /提升|优化|高效|稳定|赋能|用户体验|能力|经验|显著|excellent|improved/iu.test(text);
  const independentAchievements = text.split(/[；;\n]/u).slice(1).some((part) => /^(?:另外|此外|另行|同时还|独立地|另外还)/u.test(part.trim()) && /组织|开发|设计|完成|负责|构建/u.test(part));
  const evaluationGap = resumeRolePreference(target)?.family === "ai"
    && /降低幻觉|减少幻觉|提升准确率|提高准确率/u.test(text) && !/评测|评估|测试|实测|验证|数据集|bad.case/iu.test(text);
  const contributionGap = resumeRolePreference(target)?.family === "ai" && !action && /Agent|RAG|LangGraph|MCP/iu.test(text);
  return { action, mechanism, context, evidence, specific, catalog, genericity, independentAchievements, evaluationGap, contributionGap };
}

// Single static role resolver. Corpus confidence describes evidence scope, not
// a required keyword list. No role identity or preference is persisted.
const rolePreferences = [
  { family: "product", confidence: "provisional", target: /产品|解决方案|product|solution/iu, evidence: /需求|决策|验收|交付|采纳|用户研究/iu, emphasis: "弱偏好：问题、决策、交付与采纳证据。" },
  { family: "ai", confidence: "high", target: /\b(?:AI|LLM|Agent|RAG)\b|人工智能|大模型/iu, evidence: /检索|重排|评测|召回|编排|路由|幻觉|token|RAG|Agent|HITL|LoRA/iu, emphasis: "AI 应用：有证据的路由/状态/工具调用/HITL/记忆，解析分块/embedding/混合检索/重排/查询改写，prompt/SFT/LoRA/结构化输出/guard/fallback，API/Redis/streaming/容器/可观测性，有效评测/faithfulness/延迟/QPS/token成本/bad-case闭环及运营规模。问题→本人机制→评测或运营证据；目录不能代替贡献，降低幻觉/提升准确率需要评测依据。" },
  { family: "backend", confidence: "medium", target: /后端|服务端|backend|back-end|platform engineer/iu, evidence: /服务|API|接口|事务|并发|缓存|数据库|消息队列|Redis|MQ/iu, emphasis: "后端：服务/模块职责、API/数据、事务/并发、缓存/MQ/DB、性能与可靠性；按相关性重排，不删除已有 AI 事实。" },
  { family: "frontend", confidence: "medium", target: /前端|全栈|移动端|frontend|front-end|full.?stack|mobile/iu, evidence: /页面|组件|状态管理|渲染|交互|数据流|复用/iu, emphasis: "前端：交付的产品/模块、组件/状态、数据流、复用、交互/渲染性能。" },
  { family: "infra", confidence: "medium", target: /运维|基础设施|云平台|DevOps|SRE|infrastructure|cloud/iu, evidence: /部署|监控|热备|恢复|故障|容量|告警|自动化|CI\/CD/iu, emphasis: "基础设施：部署、监控、HA/恢复、自动化、事故与容量；保留实际运维责任边界。" },
  { family: "data", confidence: "provisional", target: /数据分析|数据科学|data|analytics/iu, evidence: /分析|验证|模型|决策/iu, emphasis: "弱偏好：问题、分析方法、验证与决策证据。" },
  { family: "growth", confidence: "provisional", target: /增长|内容运营|growth|content operations/iu, evidence: /实验|渠道|转化|内容|复盘/iu, emphasis: "弱偏好：渠道、实验和已验证的转化证据。" }
] as const;

export function resumeRolePreference(target = "") {
  // Unsupported professions take precedence over incidental AI/tool modifiers.
  if (/行政|政府|财务|金融|法务|法律|医疗|医生|学术|设计师|销售|人力|招聘专员|finance|legal|medical|academic|designer|sales|\bHR\b/iu.test(target)) return undefined;
  return rolePreferences.find((preference) => preference.target.test(target));
}

export function resumeRoleEvidencePreference(target: string | undefined, text: string) {
  const preference = resumeRolePreference(target);
  return preference && assessResumeBullet(text).specific && preference.evidence.test(text)
    ? preference.confidence === "provisional" ? 0.15 : 1
    : 0;
}

export function resumeRoleInstructions(target?: string) {
  const preference = resumeRolePreference(target);
  return preference
    ? `[INFERENCE from CORPUS/HELD-OUT; ${preference.confidence}] ${preference.emphasis} 仅在真实性、成熟度、证据及相关性合格之后用于偏好；不要求关键词，不补造类别或事实。`
    : "未校准或无明确岗位：仅使用通用真实性、相关性、证据与清晰度规则，不套用 AI 岗位模板。";
}
