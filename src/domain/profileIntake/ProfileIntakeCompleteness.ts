import type { ResumeItemV2 } from "@/domain/schemas";

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
  if (item.sectionType === "education") {
    if (item.degree) present.add("degree");
    if (item.major) present.add("major");
    if (item.courses.length || item.honors.length) present.add("coursework_honors");
    return [
      ["degree", `在“${identity}”取得或正在攻读的学位是什么？`, 5],
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
      ["role", `在“${identity}”研究中，你本人承担的具体角色是什么？`, 5],
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
      ["issuer", `“${identity}”由哪个机构颁发？`, 4],
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
      ["proficiency", `你能如实支持的“${identity}”熟练程度是什么？`, 3],
      ["applied_evidence", `你曾在什么具体任务或项目中使用“${identity}”？`, 5]
    ];
  }
  if (item.sectionType === "certificates") {
    if (item.issuer) present.add("issuer");
    if (item.credentialId || item.status) present.add("credential_status");
    if (item.issuedAt) present.add("time");
    return [
      ["issuer", `“${identity}”由哪个机构颁发？`, 4],
      ["time", `这张证书是什么时候取得的？`, 3],
      ["credential_status", `如有必要，这张证书的凭证编号或当前状态是什么？`, 1]
    ];
  }
  if (item.sectionType === "languages") {
    if (item.level) present.add("proficiency");
    if (item.testName || item.score) present.add("test_score");
    return [
      ["proficiency", `你能如实支持的“${identity}”语言水平是什么？`, 5],
      ["test_score", `如有语言考试，这门语言的考试名称和成绩是什么？`, 2]
    ];
  }
  if (item.sectionType === "publications") {
    if (item.authorRole) present.add("author_role");
    if (item.publisher) present.add("publisher");
    if (item.publishedAt) present.add("time");
    return [
      ["author_role", `你在“${identity}”中的作者角色是什么？`, 5],
      ["publisher", `“${identity}”由哪个期刊、会议或平台发表？`, 3],
      ["time", `“${identity}”是在什么时候发表的？`, 2]
    ];
  }
  if (item.sectionType === "patents") {
    if (item.patentNumber || item.status) present.add("patent_identity");
    if (item.filedAt || item.grantedAt) present.add("time");
    if (item.inventors.length) present.add("role");
    return [
      ["role", `你在“${identity}”中的发明人或贡献角色是什么？`, 5],
      ["patent_identity", `如有，专利号和当前状态是什么？`, 3],
      ["time", `如能确认，这项专利的申请或授权日期是什么？`, 2]
    ];
  }
  if (item.sectionType === "portfolio") {
    if (item.url || item.description || item.highlights.length) present.add("portfolio_output");
    return [
      ["role", `你在“${identity}”中承担什么角色？`, 5],
      ["tools_methods", `制作“${identity}”时使用了什么工具？`, 3],
      ["portfolio_output", `“${identity}”最终产出了什么，是否有可公开链接？`, 4]
    ];
  }
  return [
    ["action", `在“${identity}”中，你本人完成的最重要的一项工作是什么？`, 5],
    ["result", `这项工作最后产生了什么可验证的结果或交付物？`, 4],
    ["tools_methods", `你完成这项工作时，明确使用了什么方法或工具？`, 3],
    ["challenge", `过程中最关键的问题是什么，你是如何处理的？`, 2],
    ["scope", `如果方便，这项工作的必要规模大约是什么？`, 1],
    ["collaboration", `你与他人协作时，自己的职责边界是什么？`, 1]
  ];
}

export function highestValueFollowUp(items: ResumeItemV2[]) {
  return items
    .map((item) => ({ item, assessment: assessCareerAssetCompleteness(item) }))
    .filter(({ assessment }) => assessment.nextQuestion)
    .sort((left, right) => left.assessment.utility - right.assessment.utility)[0]
    ?.assessment.nextQuestion;
}

function itemText(item: ResumeItemV2) {
  return Object.values(item as unknown as Record<string, unknown>)
    .flatMap((value): string[] => Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : typeof value === "string" ? [value] : [])
    .join(" ");
}

function displayIdentity(item: ResumeItemV2) {
  if (item.sectionType === "education") return item.school ?? item.major ?? "这段教育经历";
  if (item.sectionType === "skills") return item.name;
  if (item.sectionType === "languages") return item.language;
  if ("title" in item && item.title) return item.title;
  if ("name" in item && item.name) return item.name;
  if ("role" in item && item.role) return item.role;
  return "这段经历";
}
