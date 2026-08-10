import type { ResumeItemV2, ResumeSectionTypeV2 } from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";
import type { ProfileIntakeQuestionAnswer } from "./ProfileIntakeQuestionAnswer";
import type { CareerAssetInterviewState, CareerInformationNeedPriorityFactors } from "@/domain/careerInteraction/CareerInteractionPlan";

export type CareerAssetDimension =
  | "identity"
  | "time"
  | "role"
  | "action"
  | "tools_methods"
  | "challenge"
  | "scope"
  | "result"
  | "collaboration"
  | "evidence"
  | "degree"
  | "major"
  | "coursework_honors"
  | "method"
  | "sample_scope"
  | "publication"
  | "issuer"
  | "level_rank"
  | "proficiency"
  | "applied_evidence"
  | "credential_status"
  | "test_score"
  | "author_role"
  | "publisher"
  | "patent_identity"
  | "portfolio_output";

export type CareerAssetCompleteness = {
  present: CareerAssetDimension[];
  missing: CareerAssetDimension[];
  nextQuestion?: string;
  readiness: number;
  informationGain: number;
  priorityFactors: CareerInformationNeedPriorityFactors;
  utility: number;
};

export type ProfileIntakeInterviewQuestion = {
  questionId: string;
  candidateId: string;
  candidateLabel?: string;
  sectionType: ResumeSectionTypeV2;
  dimension: CareerAssetDimension | "section_progression";
  question: string;
  status: "pending" | "answered" | "skipped";
  sourceRevision: number;
  questionRevision?: number;
};

export type ProfileIntakeInterviewPlan = {
  planVersion: 3;
  status: "awaiting_follow_up" | "ready_to_finish";
  sourceRevision: number;
  coveredSections: ResumeSectionTypeV2[];
  activeQuestion?: {
    questionId?: string;
    candidateId: string;
    candidateLabel?: string;
    sectionType?: ResumeSectionTypeV2;
    dimension: CareerAssetDimension;
    question: string;
    status: "pending" | "answered" | "skipped";
    questionRevision?: number;
  };
  suggestedNextSections: Array<ResumeSectionTypeV2 | "finish">;
  // Kept as compatibility projections for persisted sessions and older UI.
  suggestedNextSection?: ResumeSectionTypeV2;
  activeQuestionId?: string;
  answeredQuestionIds: string[];
  skippedQuestionIds: string[];
  questions: ProfileIntakeInterviewQuestion[];
  followUpCounts?: Record<string, number>;
  questionAnswers?: ProfileIntakeQuestionAnswer[];
  careerAssetState: CareerAssetInterviewState[];
  coverageBoard: Array<{
    group: "education" | "work_internship" | "projects" | "research" | "campus_volunteer" | "skills" | "awards_certificates" | "languages" | "other";
    status: "covered" | "high_value_gap" | "intentionally_skipped" | "not_present";
    assetCount: number;
  }>;
};

/**
 * Deterministic information-gain rules decide whether a gap deserves interruption.
 * They do not turn every dimension into a required field.
 */
export function assessCareerAssetCompleteness(item: ResumeItemV2, sourceEvidence: string[] = []): CareerAssetCompleteness {
  const text = itemText(item, sourceEvidence);
  const present = new Set<CareerAssetDimension>(["evidence"]);
  if (displayIdentity(item)) present.add("identity");
  if ("startDate" in item && (item.startDate || item.endDate || item.current) || item.sectionType === "awards" && item.awardedAt) present.add("time");
  if ("role" in item && item.role || "authorRole" in item && item.authorRole) present.add("role");
  if (/(?:开发|分析|设计|组织|协调|撰写|研究|维护|运营|支持|处理|完成|协助|参与|built|developed|analy[sz]ed|managed|supported)/iu.test(text)) present.add("action");
  if (
    ("tools" in item && item.tools.length)
    || ("methods" in item && item.methods.length)
    || /(?:使用|通过|采用|工具|方法|框架|架构|仿真|模拟|PlatformIO|Arduino|C\+\+|Python|TypeScript|JavaScript|SQL|Git|Docker|React)/iu.test(text)
  ) present.add("tools_methods");
  if (/(?:问题|困难|挑战|故障|错误|瓶颈|排查|解决|challenge|issue|problem)/iu.test(text)) present.add("challenge");
  if (/(?:\d|多名|团队|跨部门|用户|客户|页面|数据|records?|users?|team)/iu.test(text)) present.add("scope");
  if ("outcomes" in item && item.outcomes.length || /(?:获得|完成|交付|改善|恢复|通过|上线|节省|提升|result|delivered|improved|reduced)/iu.test(text)) present.add("result");
  if (/(?:协作|配合|团队|部门|导师|同学|客户|stakeholder|team|collaborat)/iu.test(text)) present.add("collaboration");

  const priority = sectionPriority(item, present);
  const missing = priority.map(([dimension]) => dimension).filter((dimension) => !present.has(dimension));
  const next = priority.find(([dimension]) => !present.has(dimension));
  const readiness = careerReadinessForAsset(item, [...present]);
  const nextDimension = next?.[0];
  const priorityFactors = informationGainFactors(item, nextDimension, readiness, sourceEvidence);
  const informationGain = informationGainScore(priorityFactors, nextDimension);
  return {
    present: [...present],
    missing,
    nextQuestion: next ? naturalCareerQuestion(item, next[0]) : undefined,
    readiness,
    informationGain,
    priorityFactors,
    utility: priority.reduce((sum, [dimension, , weight]) => sum + (present.has(dimension) ? weight : 0), 0)
  };
}

function sectionPriority(
  item: ResumeItemV2,
  present: Set<CareerAssetDimension>
): Array<[CareerAssetDimension, string, number]> {
  const identity = displayIdentity(item);
  const identityLabel = identity ?? "这段经历";
  if (item.sectionType === "education") {
    if (item.degree) present.add("degree");
    if (item.major) present.add("major");
    if (item.courses.length || item.honors.length) present.add("coursework_honors");
    return [
      ...missingIdentityQuestion(item, identity),
      ["degree", `在“${identityLabel}”取得或正在攻读的学位是什么？`, 5],
      ["major", `这段教育经历的专业是什么？`, 4],
      ["time", `这段教育经历的入学和毕业时间是什么？`, 3],
      ["coursework_honors", `如有与求职方向高度相关的课程或荣誉，最值得补充哪一项？`, 1]
    ];
  }
  if (item.sectionType === "research") {
    if (item.methods.length) present.add("method");
    if (item.samples) present.add("sample_scope");
    if (item.publication || item.publicationStatus) present.add("publication");
    return [
      ...missingIdentityQuestion(item, identity),
      ["role", `在“${identityLabel}”研究中，你本人承担的具体角色是什么？`, 5],
      ["method", `这项研究使用了什么明确的方法？`, 4],
      ["sample_scope", `如能准确说明，这项研究的样本或范围是什么？`, 2],
      ["result", `这项研究形成了什么结果、结论或交付物？`, 3],
      ["publication", `这项研究是否形成论文、投稿或其他公开成果？`, 1]
    ];
  }
  if (item.sectionType === "awards") {
    if (item.issuer) present.add("issuer");
    if (item.level || item.rank) present.add("level_rank");
    return [
      ...missingIdentityQuestion(item, identity),
      ["issuer", `“${identityLabel}”由哪个机构颁发？`, 4],
      ["level_rank", `这个奖项的级别或名次是什么？`, 3],
      ["time", `这个奖项是在什么时候获得的？`, 2]
    ];
  }
  if (item.sectionType === "skills") {
    if (item.level) present.add("proficiency");
    if (item.description && /(?:用于|完成|开发|分析|制作|项目|工作|used|built|analy)/iu.test(item.description)) {
      present.add("applied_evidence");
    }
    return [
      ...missingIdentityQuestion(item, identity),
      ["proficiency", `你能如实支持的“${identityLabel}”熟练程度是什么？`, 3],
      ["applied_evidence", `你曾在什么具体任务或项目中使用“${identityLabel}”？`, 5]
    ];
  }
  if (item.sectionType === "certificates") {
    if (item.issuer) present.add("issuer");
    if (item.credentialId || item.status) present.add("credential_status");
    if (item.issuedAt) present.add("time");
    return [
      ...missingIdentityQuestion(item, identity),
      ["issuer", `“${identityLabel}”由哪个机构颁发？`, 4],
      ["time", `这张证书是什么时候取得的？`, 3],
      ["credential_status", `如有必要，这张证书的凭证编号或当前状态是什么？`, 1]
    ];
  }
  if (item.sectionType === "languages") {
    if (item.level) present.add("proficiency");
    if (item.testName || item.score) present.add("test_score");
    return [
      ...missingIdentityQuestion(item, identity),
      ["proficiency", `你能如实支持的“${identityLabel}”语言水平是什么？`, 5],
      ["test_score", `如有语言考试，这门语言的考试名称和成绩是什么？`, 2]
    ];
  }
  if (item.sectionType === "publications") {
    if (item.authorRole) present.add("author_role");
    if (item.publisher) present.add("publisher");
    if (item.publishedAt) present.add("time");
    return [
      ...missingIdentityQuestion(item, identity),
      ["author_role", `你在“${identityLabel}”中的作者角色是什么？`, 5],
      ["publisher", `“${identityLabel}”由哪个期刊、会议或平台发表？`, 3],
      ["time", `“${identityLabel}”是在什么时候发表的？`, 2]
    ];
  }
  if (item.sectionType === "patents") {
    if (item.patentNumber || item.status) present.add("patent_identity");
    if (item.filedAt || item.grantedAt) present.add("time");
    if (item.inventors.length) present.add("role");
    return [
      ...missingIdentityQuestion(item, identity),
      ["role", `你在“${identityLabel}”中的发明人或贡献角色是什么？`, 5],
      ["patent_identity", `如有，专利号和当前状态是什么？`, 3],
      ["time", `如能确认，这项专利的申请或授权日期是什么？`, 2]
    ];
  }
  if (item.sectionType === "portfolio") {
    if (item.url || item.description || item.highlights.length) present.add("portfolio_output");
    return [
      ...missingIdentityQuestion(item, identity),
      ["role", `你在“${identityLabel}”中承担什么角色？`, 5],
      ["tools_methods", `制作“${identityLabel}”时使用了什么工具？`, 3],
      ["portfolio_output", `“${identityLabel}”最终产出了什么，是否有可公开链接？`, 4]
    ];
  }
  return [
    ...missingIdentityQuestion(item, identity),
    ["action", `在“${identityLabel}”中，你本人完成的最重要的一项工作是什么？`, 5],
    ["result", `这项工作最后产生了什么可验证的结果或交付物？`, 4],
    ["tools_methods", `你完成这项工作时，明确使用了什么方法或工具？`, 3],
    ["challenge", `过程中最关键的问题是什么，你是如何处理的？`, 2],
    ["scope", `如果方便，这项工作的必要规模大约是什么？`, 1],
    ["collaboration", `你与他人协作时，自己的职责边界是什么？`, 1]
  ];
}

export function highestValueFollowUp(
  items: ResumeItemV2[],
  options: ProfileIntakeCompletenessOptions = {}
) {
  return highestValueFollowUpDetail(items, options)?.question;
}

export function createProfileIntakeInterviewPlan(
  items: ResumeItemV2[],
  sourceRevision: number,
  options: ProfileIntakeCompletenessOptions = {}
): ProfileIntakeInterviewPlan {
  const coveredSections = [...new Set(items.map((item) => item.sectionType))];
  const nextSections = (["internship", "project", "campus", "skills", "awards", "certificates"] as const)
    .filter((section) => !coveredSections.includes(section));
  const nextSection = nextSections[0];
  const candidate = items[0];
  const answeredQuestionIds = (options.questionAnswers ?? [])
    .filter((answer) => answer.status === "answered")
    .map((answer) => answer.questionId);
  const skippedQuestionIds = (options.questionAnswers ?? [])
    .filter((answer) => answer.status === "skipped")
    .map((answer) => answer.questionId);
  if (!candidate) {
    return {
      planVersion: 3,
      status: "ready_to_finish",
      sourceRevision,
      coveredSections,
      suggestedNextSections: ["finish"],
      answeredQuestionIds,
      skippedQuestionIds,
      questions: [],
      followUpCounts: options.followUpCounts ?? {},
      questionAnswers: options.questionAnswers ?? []
      , careerAssetState: [],
      coverageBoard: buildCoverageBoard(items, options)
    };
  }
  const detail = highestValueFollowUpDetail(items, options);
  const question = detail ? {
    questionId: `profile-intake-detail-${stableHashText(`${detail.item.id}:${detail.dimension}`).slice(0, 12)}`,
    candidateId: detail.item.id,
    candidateLabel: displayIdentity(detail.item) ?? `待补充${detail.item.sectionType}经历`,
    sectionType: detail.item.sectionType,
    dimension: detail.dimension,
    question: detail.question,
    status: "pending" as const,
    sourceRevision,
    questionRevision: sourceRevision
  } : undefined;
  return {
    planVersion: 3,
    status: question ? "awaiting_follow_up" : "ready_to_finish",
    sourceRevision,
    coveredSections,
    activeQuestion: question ? {
      questionId: question.questionId,
      candidateId: question.candidateId,
      candidateLabel: (detail ? displayIdentity(detail.item) : undefined) ?? `待补充${question.sectionType}经历`,
      sectionType: question.sectionType,
      dimension: question.dimension as CareerAssetDimension,
      question: question.question,
      status: question.status,
      questionRevision: question.questionRevision
    } : undefined,
    suggestedNextSections: [...nextSections, "finish"],
    suggestedNextSection: nextSection,
    activeQuestionId: question?.questionId,
    answeredQuestionIds,
    skippedQuestionIds,
    questions: question ? [question] : [],
    followUpCounts: options.followUpCounts ?? {},
    questionAnswers: options.questionAnswers ?? []
    , careerAssetState: buildCareerAssetState(items, options),
    coverageBoard: buildCoverageBoard(items, options)
  };
}

export function highestValueFollowUpDetail(
  items: ResumeItemV2[],
  options: ProfileIntakeCompletenessOptions = {}
) {
  const maxFollowUpsPerAsset = options.maxFollowUpsPerAsset ?? 2;
  const answeredKeys = new Set((options.questionAnswers ?? [])
    .filter((answer) => answer.status === "answered" || answer.status === "skipped")
    .map((answer) => `${answer.candidateId}::${answer.dimension}`));
  return items
    .map((item) => ({
      item,
      assessment: assessCareerAssetCompleteness(item, options.sourceEvidenceByCandidate?.[item.id] ?? [])
    }))
    .filter(({ item, assessment }) => {
      if (!assessment.nextQuestion || !isHighValueFollowUp(assessment.missing[0])) return false;
      if (answeredKeys.has(`${item.id}::${assessment.missing[0]}`)) return false;
      const count = options.followUpCounts?.[item.id] ?? 0;
      const identityRepair = assessment.missing[0] === "identity" && count < maxFollowUpsPerAsset + 1;
      return count < maxFollowUpsPerAsset || identityRepair;
    })
    // Rank by expected information gain, not by how many canonical fields are
    // already covered.  This lets a substantial project outrank low-value
    // metadata while still allowing a nearly complete asset to require zero
    // questions.
    .sort((left, right) => right.assessment.informationGain - left.assessment.informationGain || left.item.id.localeCompare(right.item.id))
    .map(({ item, assessment }) => assessment.nextQuestion
      ? { item, dimension: assessment.missing[0] ?? "evidence", question: assessment.nextQuestion, informationGain: assessment.informationGain }
      : undefined)
    .find(Boolean);
}

function isHighValueFollowUp(dimension: CareerAssetDimension | undefined) {
  return Boolean(dimension && ![
    "challenge",
    "coursework_honors",
    "scope",
    "collaboration",
    "publication",
    "credential_status",
    "test_score"
  ].includes(dimension));
}

export type ProfileIntakeCompletenessOptions = {
  followUpCounts?: Record<string, number>;
  maxFollowUpsPerAsset?: number;
  questionAnswers?: ProfileIntakeQuestionAnswer[];
  sourceEvidenceByCandidate?: Record<string, string[]>;
  skippedSections?: ResumeSectionTypeV2[];
};

function buildCareerAssetState(
  items: ResumeItemV2[],
  options: ProfileIntakeCompletenessOptions
): CareerAssetInterviewState[] {
  const answersByCandidate = new Map<string, { answered: string[]; skipped: string[] }>();
  for (const answer of options.questionAnswers ?? []) {
    const entry = answersByCandidate.get(answer.candidateId) ?? { answered: [], skipped: [] };
    const target = answer.status === "answered" ? entry.answered : entry.skipped;
    if (!target.includes(answer.dimension)) target.push(answer.dimension);
    answersByCandidate.set(answer.candidateId, entry);
  }
  const budget = options.maxFollowUpsPerAsset ?? 2;
  return items.map((item) => {
    const assessment = assessCareerAssetCompleteness(item, options.sourceEvidenceByCandidate?.[item.id] ?? []);
    const answerState = answersByCandidate.get(item.id) ?? { answered: [], skipped: [] };
    const highValueGaps = assessment.missing.filter((dimension) =>
      isHighValueFollowUp(dimension)
      && !answerState.answered.includes(dimension)
      && !answerState.skipped.includes(dimension)
    );
    const questionCount = options.followUpCounts?.[item.id] ?? 0;
    const identity = displayIdentity(item) ?? `待补充${item.sectionType}经历`;
    const interviewStatus = highValueGaps.length === 0
      ? answerState.skipped.length > 0 && assessment.readiness < 0.9 ? "skipped" as const : "ready" as const
      : questionCount > 0 ? "enriching" as const : "discovered" as const;
    return {
      candidateId: item.id,
      identity,
      sectionType: item.sectionType,
      readiness: assessment.readiness,
      questionBudget: Math.max(0, budget - questionCount),
      answeredDimensions: answerState.answered,
      skippedDimensions: answerState.skipped,
      highValueGaps,
      interviewStatus
    };
  });
}

function buildCoverageBoard(items: ResumeItemV2[], options: ProfileIntakeCompletenessOptions): ProfileIntakeInterviewPlan["coverageBoard"] {
  const groups: Array<[ProfileIntakeInterviewPlan["coverageBoard"][number]["group"], ResumeSectionTypeV2[]]> = [
    ["education", ["education"]],
    ["work_internship", ["work", "internship"]],
    ["projects", ["project", "portfolio"]],
    ["research", ["research", "publications", "patents"]],
    ["campus_volunteer", ["campus", "volunteer"]],
    ["skills", ["skills"]],
    ["awards_certificates", ["awards", "certificates"]],
    ["languages", ["languages"]],
    ["other", ["other", "custom"]]
  ];
  const skipped = new Set(options.skippedSections ?? []);
  return groups.map(([group, sections]) => {
    const assets = items.filter((item) => sections.includes(item.sectionType));
    const hasHighValueGap = assets.some((item) => {
      const assessment = assessCareerAssetCompleteness(item, options.sourceEvidenceByCandidate?.[item.id] ?? []);
      return isHighValueFollowUp(assessment.missing[0]);
    });
    return {
      group,
      status: assets.length
        ? hasHighValueGap ? "high_value_gap" as const : "covered" as const
        : sections.some((section) => skipped.has(section)) ? "intentionally_skipped" as const : "not_present" as const,
      assetCount: assets.length
    };
  });
}

/** Section semantics are intentionally different: an award is not a project,
 * and education does not need a project-style challenge/result interview. */
export function careerReadinessForAsset(item: ResumeItemV2, present: CareerAssetDimension[]) {
  const dimensions = new Set(present);
  const requiredBySection: Partial<Record<ResumeSectionTypeV2, CareerAssetDimension[]>> = {
    education: ["identity", "degree", "major", "time"],
    project: ["identity", "action", "tools_methods", "result"],
    research: ["identity", "role", "method", "result"],
    campus: ["identity", "role", "action", "result"],
    volunteer: ["identity", "role", "action", "result"],
    work: ["identity", "role", "action", "result"],
    internship: ["identity", "role", "action", "result"],
    awards: ["identity", "issuer", "level_rank", "time"],
    skills: ["identity", "applied_evidence"],
    languages: ["identity", "proficiency"],
    certificates: ["identity", "issuer", "time"],
    publications: ["identity", "author_role", "publisher", "time"],
    patents: ["identity", "role", "patent_identity", "time"],
    portfolio: ["identity", "role", "tools_methods", "portfolio_output"]
  };
  const required = requiredBySection[item.sectionType] ?? ["identity", "action", "result"];
  if (!required.length) return 0;
  return Number((required.filter((dimension) => dimensions.has(dimension)).length / required.length).toFixed(2));
}

function assetImportance(item: ResumeItemV2) {
  return {
    education: 0.58,
    project: 1,
    research: 0.96,
    campus: 0.82,
    volunteer: 0.7,
    work: 1,
    internship: 1,
    awards: 0.66,
    skills: 0.52,
    languages: 0.42,
    certificates: 0.45,
    publications: 0.82,
    patents: 0.84,
    portfolio: 0.88,
    other: 0.5,
    custom: 0.5,
    summary: 0.35
  }[item.sectionType] ?? 0.5;
}

function expectedArtifactImpact(item: ResumeItemV2, dimension: CareerAssetDimension | undefined) {
  if (!dimension) return 0;
  const highImpact = new Set<CareerAssetDimension>([
    "identity", "role", "action", "tools_methods", "method", "result", "applied_evidence", "portfolio_output"
  ]);
  const sectionBoost = ["project", "research", "work", "internship", "campus", "portfolio"].includes(item.sectionType) ? 0.1 : 0;
  return Math.min(1, (highImpact.has(dimension) ? 0.85 : 0.5) + sectionBoost);
}

function missingDimensionWeight(item: ResumeItemV2, dimension: CareerAssetDimension | undefined) {
  if (!dimension) return 0;
  const weights: Partial<Record<CareerAssetDimension, number>> = {
    identity: 1,
    role: 0.92,
    action: 0.95,
    tools_methods: 0.84,
    method: 0.84,
    result: 0.96,
    applied_evidence: 0.9,
    portfolio_output: 0.88,
    issuer: 0.62,
    level_rank: 0.6,
    time: 0.5,
    degree: 0.55,
    major: 0.5,
    proficiency: 0.56
  };
  const sectionModifier = ["project", "research", "work", "internship", "campus"].includes(item.sectionType) ? 1 : 0.9;
  return Math.min(1, (weights[dimension] ?? 0.42) * sectionModifier);
}

function userEmphasis(sourceEvidence: string[]) {
  return sourceEvidence.some((value) => /(?:重要|关键|最有代表性|最满意|主导|核心|重点|proud|key|main)/iu.test(value)) ? 1 : 0;
}

function recencyForItem(item: ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  const value = [record.endDate, record.awardedAt, record.publishedAt, record.grantedAt, record.createdAt]
    .find((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()));
  if (!value) return 0.5;
  const year = Number(value.match(/20\d{2}/u)?.[0] ?? 0);
  if (!year) return 0.5;
  return Math.max(0, Math.min(1, (year - 2015) / 12));
}

function informationGainFactors(
  item: ResumeItemV2,
  dimension: CareerAssetDimension | undefined,
  readiness: number,
  sourceEvidence: string[]
): CareerAssetCompleteness["priorityFactors"] {
  return {
    missingDimensionWeight: missingDimensionWeight(item, dimension),
    careerAssetImportance: assetImportance(item),
    expectedArtifactImpact: expectedArtifactImpact(item, dimension),
    currentReadinessGap: Number(Math.max(0, 1 - readiness).toFixed(3)),
    userEmphasis: userEmphasis(sourceEvidence),
    recency: recencyForItem(item),
    // Profile Intake is deliberately job-agnostic.  Job-specific workflows
    // may supply their own need and set this value outside this module.
    jobRelevance: 0,
    alreadyAskedPenalty: 0,
    lowValueOptionalPenalty: dimension && ["challenge", "scope", "collaboration", "coursework_honors", "publication", "credential_status", "test_score"].includes(dimension) ? 0.85 : 0
  };
}

function informationGainScore(
  factors: CareerAssetCompleteness["priorityFactors"],
  dimension: CareerAssetDimension | undefined
) {
  if (!dimension || !isHighValueFollowUp(dimension)) return 0;
  const score = factors.missingDimensionWeight * 0.25
    + factors.careerAssetImportance * 0.25
    + factors.expectedArtifactImpact * 0.25
    + factors.currentReadinessGap * 0.15
    + factors.userEmphasis * 0.05
    + factors.recency * 0.05
    - factors.lowValueOptionalPenalty * 0.2;
  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
}

function naturalCareerQuestion(item: ResumeItemV2, dimension: CareerAssetDimension) {
  const label = displayIdentity(item) ?? "这段经历";
  const prefix = `关于“${label}”，`;
  const questions: Partial<Record<CareerAssetDimension, string>> = {
    identity: `我先确认一下，“${label}”这个名称是否准确？如果不准确，请告诉我你希望在简历里使用的正式名称。`,
    role: `${prefix}你本人承担的具体角色是什么？`,
    action: `${prefix}当时你亲自完成的最关键一步是什么？`,
    tools_methods: `${prefix}你实际用到的最重要工具或方法是什么？挑一两项就好。`,
    method: `${prefix}你采用了什么具体方法来完成这项工作？`,
    result: `${prefix}最后做到什么程度，形成了什么可验证的结果或交付物？`,
    applied_evidence: `${prefix}你曾在哪项具体任务中实际使用这项技能？`,
    issuer: `${prefix}由哪个学校、机构或平台颁发？`,
    level_rank: `${prefix}获得的级别或名次是什么？`,
    time: `${prefix}大约发生在什么时候？`,
    degree: `${prefix}取得或正在攻读的学位是什么？`,
    major: `${prefix}所学专业是什么？`,
    proficiency: item.sectionType === "languages"
      ? `${prefix}你能如实支持的语言水平是什么？`
      : `${prefix}你能如实支持的熟练程度是什么？`,
    patent_identity: `${prefix}专利号或当前状态是什么？`,
    portfolio_output: `${prefix}最终产出了什么，是否有可以公开的链接？`,
    author_role: `${prefix}你在其中承担的作者或研究角色是什么？`,
    publisher: `${prefix}由哪个期刊、会议或平台发表？`
  };
  return questions[dimension] ?? `${prefix}还有哪一项事实最能帮助我准确呈现它？`;
}

function itemText(item: ResumeItemV2, sourceEvidence: string[] = []) {
  return Object.values(item as unknown as Record<string, unknown>)
    .flatMap((value): string[] => Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : typeof value === "string" ? [value] : [])
    .join(" ")
    + (sourceEvidence.length ? ` ${sourceEvidence.join(" ")}` : "");
}

function displayIdentity(item: ResumeItemV2) {
  if (item.sectionType === "education") return item.school ?? item.major;
  if (item.sectionType === "skills") return item.name;
  if (item.sectionType === "languages") return item.language;
  if (["work", "internship", "campus", "volunteer"].includes(item.sectionType)) return "organization" in item ? item.organization : undefined;
  if (["awards", "certificates"].includes(item.sectionType)) return "name" in item ? item.name : undefined;
  if ("title" in item) return item.title;
  return undefined;
}

function missingIdentityQuestion(item: ResumeItemV2, identity: string | undefined): Array<[CareerAssetDimension, string, number]> {
  if (identity) return [];
  const labels: Partial<Record<ResumeSectionTypeV2, string>> = {
    education: "学校名称",
    work: "公司或组织名称",
    internship: "实习公司或组织名称",
    project: "项目名称",
    research: "研究题目",
    campus: "校园组织或活动名称",
    volunteer: "志愿项目名称",
    awards: "奖项名称",
    skills: "技能名称",
    certificates: "证书名称",
    languages: "语言名称",
    publications: "论文或出版物名称",
    patents: "专利名称",
    portfolio: "作品名称",
    other: "经历名称",
    custom: "经历名称"
  };
  return [["identity", `请先补充这段${labels[item.sectionType] ?? "经历"}，不要用你的角色代替名称。`, 7]];
}
