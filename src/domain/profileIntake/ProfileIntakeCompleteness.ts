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
  | "evidence";

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

  const priority: Array<[CareerAssetDimension, string, number]> = [
    ["action", `在“${displayIdentity(item)}”中，你本人完成的最重要的一项工作是什么？`, 5],
    ["result", `这项工作最后产生了什么可验证的结果或交付物？`, 4],
    ["tools_methods", `你完成这项工作时，明确使用了什么方法或工具？`, 3],
    ["challenge", `过程中最关键的问题是什么，你是如何处理的？`, 2],
    ["scope", `如果方便，这项工作的必要规模大约是什么？`, 1],
    ["collaboration", `你与他人协作时，自己的职责边界是什么？`, 1]
  ];
  const missing = priority.map(([dimension]) => dimension).filter((dimension) => !present.has(dimension));
  const next = priority.find(([dimension]) => !present.has(dimension));
  return {
    present: [...present],
    missing,
    nextQuestion: next?.[1],
    utility: priority.reduce((sum, [dimension, , weight]) => sum + (present.has(dimension) ? weight : 0), 0)
  };
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
