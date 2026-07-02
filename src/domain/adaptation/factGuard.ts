import {
  FactGuardAiReviewSchema,
  FactGuardResultSchema,
  type FactGuardAiReview,
  type FactGuardFinding,
  type FactGuardResult,
  type MatchEvidenceRef,
  type RiskLevel
} from "@/domain/schemas";
import { evidenceRefKey } from "@/domain/match/matcher";

export const FACT_GUARD_VERSION = "fact-guard-rule.v1";

const TOOL_OR_SKILL_WORDS = [
  "SQL",
  "Python",
  "Excel",
  "Tableau",
  "Power BI",
  "Stata",
  "SPSS",
  "R",
  "Java",
  "JavaScript",
  "TypeScript",
  "React",
  "Next.js",
  "数据分析",
  "机器学习",
  "建模",
  "可视化",
  "运营",
  "增长",
  "外贸",
  "跨境",
  "调研",
  "用户研究",
  "项目管理"
];

const NEW_OUTCOME_WORDS = ["提升", "增长", "降低", "优化", "转化", "留存", "交付", "落地", "获奖", "排名"];
const OWNER_WORDS = ["负责", "主导", "带领", "统筹", "独立"];
const PARTICIPATION_WORDS = ["参与", "协助", "配合", "支持", "跟随"];
const ASSIST_WORDS = ["协助", "配合", "支持"];
const INDEPENDENT_WORDS = ["独立完成", "独立负责", "独立推进"];
const BASIC_WORDS = ["了解", "接触", "基础", "学习"];
const PROFICIENT_WORDS = ["熟练", "精通", "擅长"];
const TEAM_WORDS = ["团队", "小组", "项目组", "课题组", "我们"];
const PERSONAL_WORDS = ["我负责", "本人负责", "独立", "个人"];

export function runRuleFactGuard(input: {
  originalText: string;
  checkedText: string;
  usedEvidenceRefs: MatchEvidenceRef[];
  now?: string;
}): FactGuardResult {
  const now = input.now ?? new Date().toISOString();
  const evidenceText = input.usedEvidenceRefs.map((ref) => `${ref.factText} ${ref.factQuote}`).join(" ");
  const findings: FactGuardFinding[] = [];

  findings.push(...detectNewNumbers(input.originalText, input.checkedText, evidenceText));
  findings.push(...detectNewEntities(input.originalText, input.checkedText, evidenceText));
  findings.push(...detectNewToolsOrSkills(input.originalText, input.checkedText, evidenceText));
  findings.push(...detectNewOutcomes(input.originalText, input.checkedText, evidenceText));
  findings.push(...detectResponsibilityUpgrades(input.originalText, input.checkedText, evidenceText));

  const merged = dedupeFindings(findings).map((finding) => attachEvidenceRef(finding, input.usedEvidenceRefs));
  const blocked = merged.some((finding) => !finding.allowed && finding.severity === "high");
  const needsEdit = merged.some((finding) => !finding.allowed);
  const riskLevel = blocked ? "high" : needsEdit ? "medium" : "low";

  return FactGuardResultSchema.parse({
    status: blocked ? "blocked_high_risk" : needsEdit ? "needs_edit" : "pass",
    ruleFindings: merged,
    riskLevel,
    allowedEvidenceRefs: input.usedEvidenceRefs,
    checkedText: input.checkedText,
    checkedAt: now,
    guardVersion: FACT_GUARD_VERSION
  });
}

export function mergeAiFactGuardReview(input: {
  ruleResult: FactGuardResult;
  aiReview?: FactGuardAiReview;
  aiFailed?: boolean;
  now?: string;
}): FactGuardResult {
  const parsedAi = input.aiReview ? FactGuardAiReviewSchema.parse(input.aiReview) : undefined;
  if (input.aiFailed || !parsedAi) {
    return FactGuardResultSchema.parse({
      ...input.ruleResult,
      status: input.ruleResult.status === "pass" ? "ai_failed_rule_kept" : input.ruleResult.status,
      checkedAt: input.now ?? input.ruleResult.checkedAt
    });
  }

  const allFindings = dedupeFindings([...input.ruleResult.ruleFindings, ...parsedAi.findings]);
  const blocked = input.ruleResult.status === "blocked_high_risk" || parsedAi.status === "blocked_high_risk";
  const needsEdit = blocked || input.ruleResult.status === "needs_edit" || parsedAi.status === "needs_edit";
  const riskLevel = maxRisk(input.ruleResult.riskLevel, parsedAi.riskLevel);

  return FactGuardResultSchema.parse({
    ...input.ruleResult,
    status: blocked ? "blocked_high_risk" : needsEdit ? "needs_edit" : "pass",
    ruleFindings: allFindings,
    aiReview: parsedAi,
    riskLevel,
    checkedAt: input.now ?? new Date().toISOString()
  });
}

function detectNewNumbers(originalText: string, checkedText: string, evidenceText: string): FactGuardFinding[] {
  const numberPattern = /(?:\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*(?:人|次|个|项|年|月|天|周|万|千|小时|份|页)|[一二三四五六七八九十百千万]+(?:个|项|人|次|年|月|天|周)?)/g;
  return findNewMatches(numberPattern, originalText, checkedText).map((text) =>
    buildFinding({
      type: "new_number",
      text,
      severity: "high",
      allowed: includesLoose(evidenceText, text),
      message: "新增数字必须来自已确认事实证据。"
    })
  );
}

function detectNewEntities(originalText: string, checkedText: string, evidenceText: string): FactGuardFinding[] {
  const pattern = /[\u4e00-\u9fa5A-Za-z0-9]{2,}(?:大学|学院|学校|公司|集团|组织|协会|社团|部门|岗位|实习生|专员|经理|工程师)/g;
  return findNewMatches(pattern, originalText, checkedText).map((text) => {
    const type = text.includes("大学") || text.includes("学院") || text.includes("学校")
      ? "new_school"
      : text.includes("公司") || text.includes("集团")
        ? "new_company"
        : text.includes("岗位") || text.includes("实习生") || text.includes("专员") || text.includes("经理") || text.includes("工程师")
          ? "new_role"
          : "new_org";
    return buildFinding({
      type,
      text,
      severity: "high",
      allowed: includesLoose(evidenceText, text),
      message: "新增学校、组织、公司或岗位必须来自已确认事实证据。"
    });
  });
}

function detectNewToolsOrSkills(originalText: string, checkedText: string, evidenceText: string): FactGuardFinding[] {
  return TOOL_OR_SKILL_WORDS
    .filter((word) => includesLoose(checkedText, word) && !includesLoose(originalText, word))
    .map((text) =>
      buildFinding({
        type: /SQL|Python|Excel|Tableau|Power BI|Stata|SPSS|React|Next\.js|TypeScript|JavaScript|Java|R/i.test(text) ? "new_tool" : "new_skill",
        text,
        severity: "high",
        allowed: includesLoose(evidenceText, text),
        message: "新增工具或技能必须来自已确认事实证据。"
      })
    );
}

function detectNewOutcomes(originalText: string, checkedText: string, evidenceText: string): FactGuardFinding[] {
  return NEW_OUTCOME_WORDS
    .filter((word) => includesLoose(checkedText, word) && !includesLoose(originalText, word) && !includesLoose(evidenceText, word))
    .map((text) =>
      buildFinding({
        type: text.includes("获奖") || text.includes("排名") ? "new_award" : "new_outcome",
        text,
        severity: "medium",
        allowed: false,
        message: "新增成果、奖项或结果表述需要证据支持。"
      })
    );
}

function detectResponsibilityUpgrades(originalText: string, checkedText: string, evidenceText: string): FactGuardFinding[] {
  const findings: FactGuardFinding[] = [];
  if (hasAny(originalText, PARTICIPATION_WORDS) && hasAny(checkedText, OWNER_WORDS) && !hasAny(evidenceText, OWNER_WORDS)) {
    findings.push(buildFinding({
      type: "participation_to_owner",
      text: "参与/协助 -> 负责/主导",
      severity: "high",
      allowed: false,
      message: "不能把参与或协助升级为负责、主导或统筹。"
    }));
  }
  if (hasAny(originalText, ASSIST_WORDS) && hasAny(checkedText, INDEPENDENT_WORDS) && !hasAny(evidenceText, INDEPENDENT_WORDS)) {
    findings.push(buildFinding({
      type: "assist_to_independent",
      text: "协助 -> 独立完成",
      severity: "high",
      allowed: false,
      message: "不能把协助升级为独立完成。"
    }));
  }
  if (hasAny(originalText, BASIC_WORDS) && hasAny(checkedText, PROFICIENT_WORDS) && !hasAny(evidenceText, PROFICIENT_WORDS)) {
    findings.push(buildFinding({
      type: "know_to_proficient",
      text: "了解/基础 -> 熟练/精通",
      severity: "high",
      allowed: false,
      message: "不能把了解、接触或基础升级为熟练、精通。"
    }));
  }
  if (hasAny(originalText, TEAM_WORDS) && hasAny(checkedText, PERSONAL_WORDS) && !hasAny(evidenceText, PERSONAL_WORDS)) {
    findings.push(buildFinding({
      type: "team_to_individual",
      text: "团队成果 -> 个人成果",
      severity: "high",
      allowed: false,
      message: "不能把团队成果直接表述为个人成果。"
    }));
  }
  return findings;
}

function findNewMatches(pattern: RegExp, originalText: string, checkedText: string) {
  const original = new Set((originalText.match(pattern) ?? []).map(normalizeToken));
  return Array.from(new Set((checkedText.match(pattern) ?? [])))
    .filter((match) => !original.has(normalizeToken(match)));
}

function buildFinding(input: {
  type: FactGuardFinding["type"];
  text: string;
  severity: RiskLevel;
  allowed: boolean;
  message: string;
}): FactGuardFinding {
  return {
    type: input.type,
    text: input.text,
    severity: input.allowed ? "low" : input.severity,
    allowed: input.allowed,
    message: input.allowed ? "该新增表述可在 usedEvidenceRefs 中找到依据。" : input.message
  };
}

function attachEvidenceRef(finding: FactGuardFinding, refs: MatchEvidenceRef[]) {
  if (!finding.allowed) {
    return finding;
  }
  const found = refs.find((ref) => includesLoose(`${ref.factText} ${ref.factQuote}`, finding.text));
  return found ? { ...finding, evidenceRefKey: evidenceRefKey(found) } : finding;
}

function dedupeFindings(findings: FactGuardFinding[]) {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.type}:${normalizeToken(finding.text)}:${finding.allowed}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const order: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
  return order[a] >= order[b] ? a : b;
}

function hasAny(text: string, words: string[]) {
  return words.some((word) => includesLoose(text, word));
}

function includesLoose(text: string, token: string) {
  return normalizeToken(text).includes(normalizeToken(token));
}

function normalizeToken(text: string) {
  return text.toLowerCase().replace(/\s+/g, "");
}
