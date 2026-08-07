import type { ResumeItemV2, ResumeSectionTypeV2 } from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";

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
  utility: number;
};

export type ProfileIntakeInterviewQuestion = {
  questionId: string;
  candidateId: string;
  sectionType: ResumeSectionTypeV2;
  dimension: CareerAssetDimension | "section_progression";
  question: string;
  status: "pending" | "answered" | "skipped";
  sourceRevision: number;
};

export type ProfileIntakeInterviewPlan = {
  planVersion: 2;
  status: "awaiting_follow_up" | "ready_to_finish";
  sourceRevision: number;
  coveredSections: ResumeSectionTypeV2[];
  activeQuestion?: {
    candidateId: string;
    dimension: CareerAssetDimension;
    question: string;
    status: "pending" | "answered" | "skipped";
  };
  suggestedNextSections: Array<ResumeSectionTypeV2 | "finish">;
  // Kept as compatibility projections for persisted sessions and older UI.
  suggestedNextSection?: ResumeSectionTypeV2;
  activeQuestionId?: string;
  answeredQuestionIds: string[];
  skippedQuestionIds: string[];
  questions: ProfileIntakeInterviewQuestion[];
  followUpCounts?: Record<string, number>;
};

/**
 * Deterministic utility rules decide whether a gap deserves interruption.
 * They do not turn every dimension into a required field.
 */
export function assessCareerAssetCompleteness(item: ResumeItemV2): CareerAssetCompleteness {
  const text = itemText(item);
  const present = new Set<CareerAssetDimension>(["evidence"]);
  if (displayIdentity(item)) present.add("identity");
  if ("startDate" in item && (item.startDate || item.endDate || item.current) || item.sectionType === "awards" && item.awardedAt) present.add("time");
  if ("role" in item && item.role || "authorRole" in item && item.authorRole) present.add("role");
  if (/(?:开发|分析|设计|组织|协调|撰写|研究|维护|运营|支持|处理|完成|协助|参与|built|developed|analy[sz]ed|managed|supported)/iu.test(text)) present.add("action");
  if ("tools" in item && item.tools.length || "methods" in item && item.methods.length) present.add("tools_methods");
  if (/(?:问题|困难|挑战|故障|错误|瓶颈|排查|解决|challenge|issue|problem)/iu.test(text)) present.add("challenge");
  if (/(?:\d|多名|团队|跨部门|用户|客户|页面|数据|records?|users?|team)/iu.test(text)) present.add("scope");
  if ("outcomes" in item && item.outcomes.length || /(?:获得|完成|交付|改善|恢复|通过|上线|节省|提升|result|delivered|improved|reduced)/iu.test(text)) present.add("result");
  if (/(?:协作|配合|团队|部门|导师|同学|客户|stakeholder|team|collaborat)/iu.test(text)) present.add("collaboration");

  const priority = sectionPriority(item, present);
  const missing = priority.map(([dimension]) => dimension).filter((dimension) => !present.has(dimension));
  const next = priority.find(([dimension]) => !present.has(dimension));
  return {
    present: [...present],
    missing,
    nextQuestion: next?.[1],
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
  options: { followUpCounts?: Record<string, number>; maxFollowUpsPerAsset?: number } = {}
) {
  return highestValueFollowUpDetail(items, options)?.question;
}

export function createProfileIntakeInterviewPlan(
  items: ResumeItemV2[],
  sourceRevision: number,
  options: { followUpCounts?: Record<string, number>; maxFollowUpsPerAsset?: number } = {}
): ProfileIntakeInterviewPlan {
  const coveredSections = [...new Set(items.map((item) => item.sectionType))];
  const nextSections = (["internship", "project", "campus", "skills", "awards", "certificates"] as const)
    .filter((section) => !coveredSections.includes(section));
  const nextSection = nextSections[0];
  const candidate = items[0];
  if (!candidate) {
    return {
      planVersion: 2,
      status: "ready_to_finish",
      sourceRevision,
      coveredSections,
      suggestedNextSections: ["finish"],
      answeredQuestionIds: [],
      skippedQuestionIds: [],
      questions: [],
      followUpCounts: options.followUpCounts ?? {}
    };
  }
  const detail = highestValueFollowUpDetail(items, options);
  const question = detail ? {
    questionId: `profile-intake-detail-${stableHashText(`${detail.item.id}:${detail.dimension}`).slice(0, 12)}`,
    candidateId: detail.item.id,
    sectionType: detail.item.sectionType,
    dimension: detail.dimension,
    question: detail.question,
    status: "pending" as const,
    sourceRevision
  } : undefined;
  return {
    planVersion: 2,
    status: question ? "awaiting_follow_up" : "ready_to_finish",
    sourceRevision,
    coveredSections,
    activeQuestion: question ? {
      candidateId: question.candidateId,
      dimension: question.dimension as CareerAssetDimension,
      question: question.question,
      status: question.status
    } : undefined,
    suggestedNextSections: [...nextSections, "finish"],
    suggestedNextSection: nextSection,
    activeQuestionId: question?.questionId,
    answeredQuestionIds: [],
    skippedQuestionIds: [],
    questions: question ? [question] : [],
    followUpCounts: options.followUpCounts ?? {}
  };
}

export function highestValueFollowUpDetail(
  items: ResumeItemV2[],
  options: { followUpCounts?: Record<string, number>; maxFollowUpsPerAsset?: number } = {}
) {
  const maxFollowUpsPerAsset = options.maxFollowUpsPerAsset ?? 2;
  return items
    .map((item) => ({ item, assessment: assessCareerAssetCompleteness(item) }))
    .filter(({ item, assessment }) => {
      if (!assessment.nextQuestion || !isHighValueFollowUp(assessment.missing[0])) return false;
      const count = options.followUpCounts?.[item.id] ?? 0;
      const identityRepair = assessment.missing[0] === "identity" && count < maxFollowUpsPerAsset + 1;
      return count < maxFollowUpsPerAsset || identityRepair;
    })
    // `utility` is the documented coverage score: a larger value means more
    // useful evidence is already present.  The same descending selector is
    // shared by the short and detailed APIs so they cannot disagree.
    .sort((left, right) => right.assessment.utility - left.assessment.utility || left.item.id.localeCompare(right.item.id))
    .map(({ item, assessment }) => assessment.nextQuestion
      ? { item, dimension: assessment.missing[0] ?? "evidence", question: assessment.nextQuestion }
      : undefined)
    .find(Boolean);
}

function isHighValueFollowUp(dimension: CareerAssetDimension | undefined) {
  return Boolean(dimension && ![
    "coursework_honors",
    "scope",
    "collaboration",
    "publication",
    "credential_status",
    "test_score"
  ].includes(dimension));
}

function itemText(item: ResumeItemV2) {
  return Object.values(item as unknown as Record<string, unknown>)
    .flatMap((value): string[] => Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : typeof value === "string" ? [value] : [])
    .join(" ");
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
