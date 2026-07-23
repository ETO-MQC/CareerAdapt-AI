import {
  JobRequirementGraphV4Schema,
  JdSemanticAssignmentSchema,
  JdSemanticUnitSchema,
  type JdSemanticAssignment,
  type JdSemanticGroupRelation,
  type JdSemanticUnit,
  type JobGraphIssueV4,
  type JobRequirementGraphV3,
  type JobRequirementGraphV4,
  type RequirementNodeV3,
  type SourceSpan
} from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";

export const JOB_REQUIREMENT_ANALYZER_V4 = "jd-analyzer.semantic-ledger-v4.0";

type Section = JdSemanticUnit["provisional"]["section"];
type MutableUnit = Omit<JdSemanticUnit, "provisional" | "final"> & {
  provisional: JdSemanticUnit["provisional"];
  final?: JdSemanticUnit["final"];
};
type HierarchyFrame = {
  unitId: string;
  relation: JdSemanticGroupRelation;
  childDisposition: "requirement" | "requirement_detail";
  detailParentUnitId?: string;
  section: Section;
  childCount: number;
};

const SECTION_HEADINGS: Array<[RegExp, Section | "excluded"]> = [
  [/^(具体工作内容|职责内容|岗位职责|职位职责|工作职责|主要职责|职责描述|工作内容|岗位使命|role mission|responsibilities?)\s*[:：]?$/i, "responsibility"],
  [/^(参与要求|岗位要求|必备条件|硬性条件|任职要求|职位要求|任职资格|基本要求|申请要求|候选人要求|requirements?|qualifications?)\s*[:：]?$/i, "required"],
  [/^(优先考虑|加分项|优先条件|preferred|nice to have)\s*[:：]?$/i, "preferred"],
  [/^(候选人需提供的验证材料|验证材料|申请材料|verification materials?)\s*[:：]?$/i, "verification"],
  [/^(我们希望你是这样的人|候选人画像|人物画像|招聘画像|hiring profile)\s*[:：]?$/i, "role_profile"],
  [/^(公司介绍|关于我们|团队介绍|薪资福利|福利待遇|员工福利|company|about us|benefits?)\s*[:：]?$/i, "excluded"]
];
const METADATA = /^(关联项目|岗位标签|职位类别|岗位编号|招聘人数|工作地点|薪资范围|Vibe Coding|【[^】]+】(?:\s*[\w -]+)?)\s*[:：]?$/i;
const TOPIC_LIST_LEAD = /(?:包含|包括|分为|涉及).{0,12}(?:项目)?方向\s*[:：]\s*$/i;
const EXAMPLES_LEAD = /^(?:例如|比如)(?:[，,]\s*)?(?:让\s*AI)?\s*[:：]\s*$/i;
const DETAIL_WRAPPER_LEAD = /^(?:你需要重点看|重点看|主要看|需包括|需要包括|包括但不限于|包括|表现为)\s*[:：]\s*$/i;
const INLINE_DETAIL_LEAD = /(?:包括但不限于|例如|比如|重点看|需包括|需要包括|明确写出|表现为)\s*[:：]\s*$/i;
const ANY_OF_LEAD = /(?:满足|具备|符合).{0,10}(?:任一|任何一项|任意一项)(?:条件)?(?:即可|者优先)?\s*[:：]?\s*$/i;
const PREFERRED_ANY_OF_LEAD = /(?:任一|任何一项|任意一项).{0,8}(?:优先|加分)\s*[:：]?\s*$/i;
const ALL_OF_LEAD = /(?:同时满足|均需满足|全部满足).{0,8}(?:条件|要求)?\s*[:：]?\s*$/i;
const ROLE_CONTEXT = /^(?:你不需要|无需|本岗位不要求|主要目标是|岗位的核心使命是|你将帮助)/i;
const HIRING_GUIDANCE = /(?:建议|请在简历|简历中).{0,20}(?:明确|注明|写明|提供)/i;
const VERIFICATION_SIGNAL = /(?:截图|账单|dashboard|github|仓库|作品|badcase|验证材料|使用记录|订阅记录)/i;
const MUST = /必须|必备|至少|不少于|需具备|本科及以上|required|must|minimum/i;
const PREFERRED = /优先|加分|preferred|nice to have/i;
const SOFT = /沟通|协作|表达|逻辑判断|学习能力|责任心|团队合作|好奇心|自驱|communication|collaboration/i;
const EDUCATION = /本科|硕士|博士|学历|高校|专业/i;
const EXPERIENCE = /(\d+(?:\.\d+)?)\s*(?:年|years?)|经验/i;
const LANGUAGE = /英语|日语|法语|德语|cet[- ]?[46]|ielts|toefl/i;
const TECH_TERMS = [
  "AI Coding", "Coding Agent", "Vibe Coding", "AI Agent", "复杂多轮指令", "复杂任务规划", "模型评测",
  "输出质量评估", "逻辑缺陷识别", "任务拆解", "回答纠错", "搜索任务", "Prompt Engineering", "RAG",
  "Verifier", "Benchmark", "Badcase", "Cursor", "Claude Code", "Codex", "Windsurf", "Playwright", "Vitest",
  "Python", "FastAPI", "GitHub", "reward hacking", "long context", "multi-file"
];

export type ReconciledJdSemanticLedger = {
  units: JdSemanticUnit[];
  issues: JobGraphIssueV4[];
  status: "validated" | "needs_review";
};

export type JobGraphValidationV4 = {
  valid: boolean;
  status: "validated" | "needs_review";
  issues: JobGraphIssueV4[];
  metrics: {
    sourceCoverage: number;
    topLevelRequirements: number;
    details: number;
    contextGroups: number;
    verificationMaterials: number;
    hiringSignals: number;
    inventedReferences: number;
    parentCycles: number;
  };
};

export function createLexicalJdUnits(rawText: string): JdSemanticUnit[] {
  const lines = rawText.split(/\r?\n/);
  const blankBefore = new Array<number>(lines.length).fill(0);
  const blankAfter = new Array<number>(lines.length).fill(0);
  let blanks = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim()) blanks += 1;
    else {
      blankBefore[index] = blanks;
      blanks = 0;
    }
  }
  blanks = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].trim()) blanks += 1;
    else {
      blankAfter[index] = blanks;
      blanks = 0;
    }
  }

  const result: JdSemanticUnit[] = [];
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const rawStart = offset;
    const newlineLength = rawText.slice(offset + raw.length, offset + raw.length + 2) === "\r\n" ? 2 : index < lines.length - 1 ? 1 : 0;
    offset += raw.length + newlineLength;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const indentation = visualIndent(raw.slice(0, raw.search(/\S/)));
    const prefix = parsePrefix(trimmed, indentation);
    const text = prefix.text;
    const localStart = raw.indexOf(text);
    const start = rawStart + localStart;
    const sourceSpan = { start, end: start + text.length, text };
    const heading = headingSection(text);
    const punctuation = heading ? "heading"
      : /[:：]\s*$/.test(text) ? "colon_lead"
        : /[；;]\s*$/.test(text) ? "semicolon_item"
          : /[。！？.!?]\s*$/.test(text) ? "sentence"
            : "plain";
    result.push(JdSemanticUnitSchema.parse({
      id: `jd-unit-${stableHashText(`${start}:${text}`)}`,
      text,
      sourceSpan,
      lineNumber: index + 1,
      lexical: {
        indentation,
        numberingLevel: prefix.numberingLevel,
        numberingToken: prefix.numberingToken,
        bulletKind: prefix.bulletKind,
        punctuation,
        blankLinesBefore: blankBefore[index],
        blankLinesAfter: blankAfter[index]
      },
      provisional: { disposition: "unclassified", section: "unknown" }
    }));
  }
  return result;
}

export function buildProvisionalJdSemanticLedger(rawText: string): JdSemanticUnit[] {
  const units = createLexicalJdUnits(rawText).map((unit): MutableUnit => structuredClone(unit));
  let section: Section | "excluded" = "unknown";
  let frame: HierarchyFrame | undefined;
  let numberedParent: { unitId: string; level: number; section: Section } | undefined;
  let indentedParent: { unitId: string; indentation: number; section: Section } | undefined;
  let lastRequirementUnitId: string | undefined;

  for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
    const unit = units[unitIndex];
    const previousUnit = units[unitIndex - 1];
    const heading = headingSection(unit.text);
    if (heading) {
      section = heading;
      frame = undefined;
      numberedParent = undefined;
      indentedParent = undefined;
      lastRequirementUnitId = undefined;
      unit.provisional = {
        disposition: heading === "excluded" ? "excluded" : "heading",
        section: heading === "excluded" ? "unknown" : heading
      };
      continue;
    }

    if (section === "excluded") {
      unit.provisional = { disposition: "excluded", section: "unknown" };
      continue;
    }
    const currentSection: Section = section === "unknown" ? inferDefaultSection(unit.text) : section;
    if (section === "unknown") section = currentSection;

    if (METADATA.test(unit.text)) {
      unit.provisional = { disposition: "metadata", section: currentSection };
      continue;
    }
    if (currentSection === "role_profile") {
      unit.provisional = { disposition: "hiring_signal", section: currentSection };
      continue;
    }
    if (HIRING_GUIDANCE.test(unit.text)) {
      unit.provisional = { disposition: "hiring_signal", section: "role_profile" };
      continue;
    }

    const level = unit.lexical.numberingLevel;
    if (level && numberedParent && level <= numberedParent.level) {
      numberedParent = undefined;
      if (frame?.detailParentUnitId) frame = undefined;
    }
    if (indentedParent && unit.lexical.indentation <= indentedParent.indentation) indentedParent = undefined;
    if (frame?.childDisposition === "requirement_detail" && frame.childCount > 0 && shouldCloseDetailFrame(unit, previousUnit)) frame = undefined;

    if (TOPIC_LIST_LEAD.test(unit.text)) {
      unit.provisional = { disposition: "context", section: currentSection, groupRelation: "topic_list" };
      frame = { unitId: unit.id, relation: "topic_list", childDisposition: "requirement_detail", detailParentUnitId: unit.id, section: currentSection, childCount: 0 };
      numberedParent = undefined;
      continue;
    }

    const groupRelation = wrapperRelation(unit.text);
    if (groupRelation) {
      const detailWrapper = groupRelation === "all_of" && Boolean(lastRequirementUnitId);
      unit.provisional = {
        disposition: "group_wrapper",
        section: groupRelation === "preferred_any_of" ? "preferred" : currentSection,
        ...(detailWrapper ? { parentUnitId: lastRequirementUnitId } : {}),
        groupRelation
      };
      frame = {
        unitId: unit.id,
        relation: groupRelation,
        childDisposition: detailWrapper ? "requirement_detail" : "requirement",
        ...(detailWrapper ? { detailParentUnitId: lastRequirementUnitId } : {}),
        section: groupRelation === "preferred_any_of" ? "preferred" : currentSection,
        childCount: 0
      };
      if (!detailWrapper) numberedParent = undefined;
      continue;
    }

    if (EXAMPLES_LEAD.test(unit.text) || DETAIL_WRAPPER_LEAD.test(unit.text)) {
      const relation = EXAMPLES_LEAD.test(unit.text) ? "examples" : "all_of";
      unit.provisional = {
        disposition: "group_wrapper",
        section: currentSection,
        parentUnitId: lastRequirementUnitId,
        groupRelation: relation
      };
      frame = {
        unitId: unit.id,
        relation,
        childDisposition: "requirement_detail",
        detailParentUnitId: lastRequirementUnitId,
        section: currentSection,
        childCount: 0
      };
      continue;
    }

    if (currentSection === "verification") {
      const detailParent = frame?.detailParentUnitId;
      if (detailParent) {
        unit.provisional = { disposition: "requirement_detail", section: currentSection, parentUnitId: detailParent, groupRelation: frame?.relation };
        if (frame) frame.childCount += 1;
      } else {
        unit.provisional = { disposition: "verification_material", section: currentSection, ...(frame ? { parentUnitId: frame.unitId, groupRelation: frame.relation } : {}) };
        lastRequirementUnitId = unit.id;
        if (INLINE_DETAIL_LEAD.test(unit.text)) {
          frame = { unitId: unit.id, relation: "evidence_bundle", childDisposition: "requirement_detail", detailParentUnitId: unit.id, section: currentSection, childCount: 0 };
        }
      }
      continue;
    }

    if (ROLE_CONTEXT.test(unit.text)) {
      unit.provisional = { disposition: "context", section: currentSection };
      continue;
    }

    if (frame?.childDisposition === "requirement_detail" && frame.childCount > 0 && unit.lexical.blankLinesBefore > 0
      && !unit.lexical.numberingLevel && !unit.lexical.bulletKind && unit.lexical.punctuation !== "semicolon_item") {
      frame = undefined;
    }

    if (frame && shouldRemainInFrame(unit, frame, numberedParent)) {
      if (frame.childDisposition === "requirement") {
        unit.provisional = {
          disposition: "requirement",
          section: frame.section,
          parentUnitId: frame.unitId,
          groupRelation: frame.relation
        };
        lastRequirementUnitId = unit.id;
        frame.childCount += 1;
      } else if (frame.detailParentUnitId) {
        unit.provisional = {
          disposition: "requirement_detail",
          section: frame.section,
          parentUnitId: frame.detailParentUnitId,
          groupRelation: frame.relation
        };
        frame.childCount += 1;
      } else {
        unit.provisional = { disposition: "unclassified", section: frame.section };
      }
      continue;
    }

    if (numberedParent) {
      unit.provisional = { disposition: "requirement_detail", section: numberedParent.section, parentUnitId: numberedParent.unitId };
      continue;
    }
    if (indentedParent && unit.lexical.indentation > indentedParent.indentation) {
      unit.provisional = { disposition: "requirement_detail", section: indentedParent.section, parentUnitId: indentedParent.unitId };
      continue;
    }

    unit.provisional = {
      disposition: "requirement",
      section: currentSection
    };
    lastRequirementUnitId = unit.id;
    if (level) numberedParent = { unitId: unit.id, level, section: currentSection };
    if (unit.lexical.bulletKind) indentedParent = { unitId: unit.id, indentation: unit.lexical.indentation, section: currentSection };
    if (INLINE_DETAIL_LEAD.test(unit.text)) {
      frame = { unitId: unit.id, relation: /例如|比如/.test(unit.text) ? "examples" : "all_of", childDisposition: "requirement_detail", detailParentUnitId: unit.id, section: currentSection, childCount: 0 };
    } else if (unit.lexical.blankLinesAfter >= 2) {
      frame = undefined;
    }
  }

  return units.map((unit) => JdSemanticUnitSchema.parse(unit));
}

export function reconcileJdSemanticLedger(input: {
  rawText: string;
  provisionalUnits: JdSemanticUnit[];
  aiAssignments?: JdSemanticAssignment[];
}): ReconciledJdSemanticLedger {
  const unitById = new Map(input.provisionalUnits.map((unit) => [unit.id, unit]));
  const assignments = input.aiAssignments ?? [];
  const assignmentBuckets = new Map<string, JdSemanticAssignment[]>();
  const issues: JobGraphIssueV4[] = [];

  for (const rawAssignment of assignments) {
    const parsed = JdSemanticAssignmentSchema.safeParse(rawAssignment);
    if (!parsed.success) continue;
    const assignment = parsed.data;
    if (!unitById.has(assignment.sourceUnitId)) {
      issues.push(issue("invented_source_id", `AI 返回不存在的 Source Unit：${assignment.sourceUnitId}`, [assignment.sourceUnitId], "error"));
      continue;
    }
    assignmentBuckets.set(assignment.sourceUnitId, [...(assignmentBuckets.get(assignment.sourceUnitId) ?? []), assignment]);
  }

  if (assignments.length) {
    for (const unit of input.provisionalUnits) {
      const bucket = assignmentBuckets.get(unit.id) ?? [];
      if (!bucket.length) issues.push(issue("missing_assignment", `AI 遗漏 Source Unit：${unit.id}`, [unit.id]));
      if (bucket.length > 1) issues.push(issue("duplicate_assignment", `AI 重复返回 Source Unit：${unit.id}`, [unit.id], "error"));
    }
  }

  const units = input.provisionalUnits.map((unit): JdSemanticUnit => {
    const bucket = assignmentBuckets.get(unit.id) ?? [];
    const assignment = bucket.length === 1 ? bucket[0] : undefined;
    const base = inferFinal(unit);
    if (!assignment || assignment.verdict === "accept") return JdSemanticUnitSchema.parse({ ...unit, final: base });
    return JdSemanticUnitSchema.parse({
      ...unit,
      final: {
        ...base,
        ...(assignment.disposition ? { disposition: assignment.disposition } : {}),
        ...(assignment.section ? { section: assignment.section } : {}),
        ...(assignment.parentUnitId === null ? { parentUnitId: undefined } : assignment.parentUnitId ? { parentUnitId: assignment.parentUnitId } : {}),
        ...(assignment.groupRelation ? { groupRelation: assignment.groupRelation } : {}),
        ...(assignment.kind ? { kind: assignment.kind } : {}),
        ...(assignment.priority ? { priority: assignment.priority } : {}),
        ...(assignment.hardConstraint !== undefined ? { hardConstraint: assignment.hardConstraint } : {}),
        ...(assignment.normalizedIntent ? { normalizedIntent: assignment.normalizedIntent } : {}),
        ...(assignment.exactKeywords ? { exactKeywords: unique(assignment.exactKeywords) } : {}),
        ...(assignment.semanticAliases ? { semanticAliases: unique(assignment.semanticAliases) } : {}),
        confidence: assignment.confidence ?? base.confidence,
        ...(assignment.reason ? { reason: assignment.reason } : {})
      }
    });
  });

  const fallbackIds = validateParentsAndCycles(units, issues);
  const reconciled = units.map((unit) => fallbackIds.has(unit.id)
    ? JdSemanticUnitSchema.parse({ ...unit, final: { ...inferFinal(unit), confidence: Math.min(0.55, inferFinal(unit).confidence), reason: "AI 父子关系无效，已回退到本地语义。" } })
    : unit);

  for (const unit of reconciled) {
    if (input.rawText.slice(unit.sourceSpan.start, unit.sourceSpan.end) !== unit.text) {
      issues.push(issue("source_round_trip_failed", `SourceSpan 无法逐字回溯：${unit.id}`, [unit.id], "error"));
    }
    if ((unit.final?.confidence ?? 0) < 0.6 && unit.final?.disposition !== "excluded") {
      issues.push(issue("low_confidence_unit", `低置信语义单元需要复核：${unit.id}`, [unit.id]));
    }
  }

  return { units: reconciled, issues: dedupeIssues(issues), status: issues.length ? "needs_review" : "validated" };
}

export function compileJobRequirementGraphV4(input: {
  rawText: string;
  ledger: ReconciledJdSemanticLedger;
}): JobRequirementGraphV4 {
  const units = input.ledger.units;
  const requirements: RequirementNodeV3[] = [];
  const groups: JobRequirementGraphV3["groups"] = [];
  const verificationMaterials: JobRequirementGraphV3["verificationMaterials"] = [];
  const hiringSignals: JobRequirementGraphV3["roleProfile"]["hiringSignals"] = [];
  const contextGroups: JobRequirementGraphV4["contextGroups"] = [];
  const issues = [...input.ledger.issues];
  const requirementByUnitId = new Map<string, RequirementNodeV3>();
  const contextByUnitId = new Map<string, JobRequirementGraphV4["contextGroups"][number]>();
  const materialByUnitId = new Map<string, JobRequirementGraphV3["verificationMaterials"][number]>();

  for (const unit of units) {
    const semantic = unit.final ?? inferFinal(unit);
    if (semantic.disposition === "requirement") {
      const node = toRequirement(unit, semantic);
      requirements.push(node);
      requirementByUnitId.set(unit.id, node);
    } else if (semantic.disposition === "verification_material") {
      const material = toVerificationMaterial(unit);
      verificationMaterials.push(material);
      materialByUnitId.set(unit.id, material);
    } else if (semantic.disposition === "hiring_signal") {
      hiringSignals.push({
        id: `signal-v4-${stableHashText(unit.id)}`,
        statement: unit.text,
        normalizedIntent: normalizeIntent(unit.text),
        sourceSpan: unit.sourceSpan,
        confidence: semantic.confidence
      });
    } else if (semantic.disposition === "context") {
      const context = {
        id: `context-v4-${stableHashText(unit.id)}`,
        label: unit.text,
        relation: semantic.groupRelation === "topic_list" ? "topic_list" as const : semantic.groupRelation === "examples" ? "examples" as const : "all_of" as const,
        sourceUnitId: unit.id,
        sourceSpan: unit.sourceSpan,
        details: []
      };
      contextGroups.push(context);
      contextByUnitId.set(unit.id, context);
    } else if (semantic.disposition === "group_wrapper" && ["any_of", "preferred_any_of", "evidence_bundle"].includes(semantic.groupRelation ?? "")) {
      groups.push({
        id: `group-v4-${stableHashText(unit.id)}`,
        label: unit.text,
        relation: semantic.groupRelation as "any_of" | "preferred_any_of" | "evidence_bundle",
        ...(semantic.groupRelation === "any_of" ? { minimumSatisfied: 1 } : {}),
        requirementIds: [],
        sourceSpan: unit.sourceSpan
      });
    }
  }

  for (const unit of units) {
    const semantic = unit.final ?? inferFinal(unit);
    if (semantic.disposition === "requirement" && semantic.parentUnitId) {
      const group = groups.find((candidate) => candidate.id === `group-v4-${stableHashText(semantic.parentUnitId!)}`);
      const node = requirementByUnitId.get(unit.id);
      if (group && node) {
        group.requirementIds.push(node.id);
        node.parentGroupId = group.id;
      }
    }
    if (semantic.disposition === "group_wrapper" && semantic.parentUnitId && semantic.groupRelation === "all_of"
      && !DETAIL_WRAPPER_LEAD.test(unit.text)) {
      const parentRequirement = requirementByUnitId.get(semantic.parentUnitId);
      if (parentRequirement) {
        parentRequirement.details.push({
          id: `detail-v4-${stableHashText(unit.id)}`,
          type: "note",
          text: unit.text.replace(/[:：]$/, ""),
          sourceSpan: unit.sourceSpan,
          sourceUnitId: unit.id
        });
        parentRequirement.sourceSpans = uniqueSpans([...parentRequirement.sourceSpans, unit.sourceSpan]);
      }
    }
    if (semantic.disposition === "verification_material" && semantic.parentUnitId) {
      const group = groups.find((candidate) => candidate.id === `group-v4-${stableHashText(semantic.parentUnitId!)}`);
      const material = materialByUnitId.get(unit.id);
      if (group && material) group.requirementIds.push(material.id);
    }
    if (semantic.disposition !== "requirement_detail" || !semantic.parentUnitId) continue;
    const parentRequirement = requirementByUnitId.get(semantic.parentUnitId);
    if (parentRequirement) {
      parentRequirement.details.push({
        id: `detail-v4-${stableHashText(unit.id)}`,
        type: semantic.groupRelation === "examples" ? "example" : /约束|必须|需/.test(unit.text) ? "constraint" : "note",
        text: unit.text.replace(/[；。]$/, ""),
        sourceSpan: unit.sourceSpan,
        sourceUnitId: unit.id
      });
      parentRequirement.sourceSpans = uniqueSpans([...parentRequirement.sourceSpans, unit.sourceSpan]);
      continue;
    }
    const parentContext = contextByUnitId.get(semantic.parentUnitId);
    if (parentContext) {
      parentContext.details.push({
        id: `context-detail-v4-${stableHashText(unit.id)}`,
        text: unit.text.replace(/[；。]$/, ""),
        sourceUnitId: unit.id,
        sourceSpan: unit.sourceSpan
      });
      continue;
    }
    const parentMaterial = materialByUnitId.get(semantic.parentUnitId);
    if (parentMaterial) parentMaterial.requiredComponents = unique([...parentMaterial.requiredComponents, unit.text.replace(/[；。]$/, "")]);
  }

  for (const context of contextGroups) {
    const declared = declaredCount(context.label);
    if (declared !== undefined && declared !== context.details.length) {
      issues.push(issue(
        "source_inconsistency",
        `原文声明 ${declared} 项，但实际列出 ${context.details.length} 项；已保留全部来源项。`,
        [context.sourceUnitId, ...context.details.map((detail) => detail.sourceUnitId)]
      ));
    }
  }

  const meaningful = units.filter((unit) => (unit.final ?? inferFinal(unit)).disposition !== "excluded");
  const unclassified = meaningful.filter((unit) => (unit.final ?? inferFinal(unit)).disposition === "unclassified");
  const graphBase = {
    schemaVersion: "job-requirement-graph-v4" as const,
    roleProfile: {
      mission: requirements.find((requirement) => requirement.section === "responsibility")?.statement,
      hiringSignals
    },
    groups: groups.filter((group) => group.requirementIds.length),
    requirements,
    verificationMaterials,
    contextGroups,
    semanticUnits: units,
    issues: dedupeIssues(issues),
    needsReview: issues.length > 0 || unclassified.length > 0,
    sourceCoverage: {
      coveredSpans: units.map((unit) => unit.sourceSpan),
      unclassifiedSpans: unclassified.map((unit) => unit.sourceSpan),
      totalMeaningfulUnits: meaningful.length,
      assignedUnits: meaningful.length - unclassified.length,
      unassignedUnitIds: unclassified.map((unit) => unit.id),
      metadataUnitIds: units.filter((unit) => (unit.final ?? inferFinal(unit)).disposition === "metadata").map((unit) => unit.id),
      excludedUnitIds: units.filter((unit) => (unit.final ?? inferFinal(unit)).disposition === "excluded").map((unit) => unit.id),
      requirementUnitIds: units.filter((unit) => (unit.final ?? inferFinal(unit)).disposition === "requirement").map((unit) => unit.id),
      detailUnitIds: units.filter((unit) => (unit.final ?? inferFinal(unit)).disposition === "requirement_detail").map((unit) => unit.id),
      inventedReferenceCount: issues.filter((item) => item.code === "invented_source_id").length,
      coverageRatio: meaningful.length ? (meaningful.length - unclassified.length) / meaningful.length : 1
    },
    analyzerVersion: JOB_REQUIREMENT_ANALYZER_V4
  };
  return withGraphHash(graphBase);
}

export function analyzeJobDescriptionV4(input: {
  rawText: string;
  aiAssignments?: JdSemanticAssignment[];
}) {
  const provisionalUnits = buildProvisionalJdSemanticLedger(input.rawText);
  const ledger = reconcileJdSemanticLedger({ rawText: input.rawText, provisionalUnits, aiAssignments: input.aiAssignments });
  const graph = compileJobRequirementGraphV4({ rawText: input.rawText, ledger });
  return { provisionalUnits, ledger, graph, validation: validateJobRequirementGraphV4(graph, input.rawText) };
}

export function validateJobRequirementGraphV4(graph: JobRequirementGraphV4, rawText?: string): JobGraphValidationV4 {
  const parentCycles = findCycleIds(graph.semanticUnits).size;
  const referencedIds = new Set(graph.semanticUnits.map((unit) => unit.id));
  const inventedReferences = [
    ...graph.requirements.flatMap((requirement) => [requirement.sourceUnitId, ...requirement.details.map((detail) => detail.sourceUnitId)]),
    ...graph.verificationMaterials.map((material) => material.sourceUnitId),
    ...graph.contextGroups.flatMap((context) => [context.sourceUnitId, ...context.details.map((detail) => detail.sourceUnitId)])
  ].filter((id): id is string => typeof id === "string" && !referencedIds.has(id)).length;
  const issues = [...graph.issues];
  if (rawText) {
    for (const unit of graph.semanticUnits) {
      if (rawText.slice(unit.sourceSpan.start, unit.sourceSpan.end) !== unit.text) {
        issues.push(issue("source_round_trip_failed", `SourceSpan 无法逐字回溯：${unit.id}`, [unit.id], "error"));
      }
    }
  }
  if (parentCycles) issues.push(issue("parent_cycle", `检测到 ${parentCycles} 个循环父子节点。`, [], "error"));
  if (inventedReferences) issues.push(issue("invented_source_id", `图中包含 ${inventedReferences} 个无效来源引用。`, [], "error"));
  const metrics = {
    sourceCoverage: graph.sourceCoverage.coverageRatio,
    topLevelRequirements: graph.requirements.length,
    details: graph.requirements.reduce((total, requirement) => total + requirement.details.length, 0) + graph.contextGroups.reduce((total, context) => total + context.details.length, 0),
    contextGroups: graph.contextGroups.length,
    verificationMaterials: graph.verificationMaterials.length,
    hiringSignals: graph.roleProfile.hiringSignals.length,
    inventedReferences,
    parentCycles
  };
  const valid = !issues.some((item) => item.severity === "error") && graph.sourceCoverage.coverageRatio === 1;
  return { valid, status: issues.length || !valid ? "needs_review" : "validated", issues: dedupeIssues(issues), metrics };
}

export function adaptJobRequirementGraphV4ToV3(graph: JobRequirementGraphV4): JobRequirementGraphV3 {
  return {
    schemaVersion: "job-requirement-graph-v3",
    roleProfile: graph.roleProfile,
    groups: graph.groups,
    requirements: graph.requirements,
    verificationMaterials: graph.verificationMaterials,
    sourceUnits: graph.semanticUnits.map((unit) => {
      const semantic = unit.final ?? inferFinal(unit);
      return {
        id: unit.id,
        text: unit.text,
        sourceSpan: unit.sourceSpan,
        lineNumber: unit.lineNumber,
        indentation: unit.lexical.indentation,
        punctuation: unit.lexical.punctuation,
        disposition: semantic.disposition === "group_wrapper" ? "wrapper"
          : semantic.disposition === "context" ? "metadata"
            : semantic.disposition,
        parentUnitId: semantic.parentUnitId
      };
    }),
    sourceCoverage: graph.sourceCoverage,
    analyzerVersion: `${graph.analyzerVersion}.v3-adapter`,
    graphHash: graph.graphHash,
    semanticEnrichmentHash: graph.semanticEnrichmentHash
  };
}

function inferFinal(unit: JdSemanticUnit): NonNullable<JdSemanticUnit["final"]> {
  const provisional = unit.provisional;
  const requirement = provisional.disposition === "requirement";
  const preferred = provisional.section === "preferred" || provisional.groupRelation === "preferred_any_of";
  const hardConstraint = requirement && !preferred && (MUST.test(unit.text) || provisional.groupRelation === "any_of");
  return {
    ...provisional,
    ...(requirement ? {
      kind: inferKind(unit.text, provisional.section, preferred),
      priority: preferred ? "nice_to_have" : hardConstraint ? "must" : provisional.section === "responsibility" ? "high" : "medium",
      hardConstraint,
      normalizedIntent: normalizeIntent(unit.text),
      exactKeywords: extractKeywords(unit.text),
      semanticAliases: aliasesFor(unit.text)
    } : {}),
    confidence: provisional.disposition === "unclassified" ? 0.4 : 0.88
  };
}

function toRequirement(unit: JdSemanticUnit, semantic: NonNullable<JdSemanticUnit["final"]>): RequirementNodeV3 {
  const preferred = semantic.section === "preferred" || semantic.groupRelation === "preferred_any_of";
  const hardConstraint = semantic.hardConstraint ?? (!preferred && (MUST.test(unit.text) || semantic.groupRelation === "any_of"));
  return {
    id: `jrv4-${stableHashText(unit.id)}`,
    section: semantic.section,
    kind: semantic.kind ?? inferKind(unit.text, semantic.section, preferred),
    statement: unit.text,
    normalizedIntent: semantic.normalizedIntent ?? normalizeIntent(unit.text),
    priority: semantic.priority ?? (preferred ? "nice_to_have" : hardConstraint ? "must" : semantic.section === "responsibility" ? "high" : "medium"),
    hardConstraint,
    exactKeywords: unique(semantic.exactKeywords ?? extractKeywords(unit.text)),
    semanticAliases: unique(semantic.semanticAliases ?? aliasesFor(unit.text)),
    sourceUnitId: unit.id,
    details: [],
    sourceSpan: unit.sourceSpan,
    sourceSpans: [unit.sourceSpan],
    confidence: semantic.confidence,
    needsConfirmation: semantic.confidence < 0.6
  };
}

function toVerificationMaterial(unit: JdSemanticUnit): JobRequirementGraphV3["verificationMaterials"][number] {
  const normalized = normalize(unit.text);
  const kind = normalized.includes("dashboard") ? "usage_dashboard"
    : normalized.includes("billing") || normalized.includes("账单") || normalized.includes("订阅") ? "billing_history"
      : normalized.includes("github") || normalized.includes("仓库") ? "github"
        : normalized.includes("badcase") ? "badcase"
          : "other";
  return {
    id: `material-v4-${stableHashText(unit.id)}`,
    label: unit.text,
    kind,
    requiredComponents: [],
    sourceUnitId: unit.id,
    sourceSpan: unit.sourceSpan,
    confidence: unit.final?.confidence ?? 0.88,
    needsConfirmation: (unit.final?.confidence ?? 0.88) < 0.6
  };
}

function validateParentsAndCycles(units: JdSemanticUnit[], issues: JobGraphIssueV4[]) {
  const fallbackIds = new Set<string>();
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  for (const unit of units) {
    const semantic = unit.final ?? inferFinal(unit);
    if (!semantic.parentUnitId) continue;
    const parent = byId.get(semantic.parentUnitId);
    if (!parent || parent.id === unit.id) {
      fallbackIds.add(unit.id);
      issues.push(issue("invalid_parent", `无效父节点：${unit.id} -> ${semantic.parentUnitId}`, [unit.id, semantic.parentUnitId], "error"));
      continue;
    }
    if (semantic.disposition === "requirement_detail") {
      const parentDisposition = (parent.final ?? inferFinal(parent)).disposition;
      if (!["requirement", "context", "verification_material"].includes(parentDisposition)) {
        fallbackIds.add(unit.id);
        issues.push(issue("invalid_detail_parent", `Detail 父节点类型无效：${unit.id} -> ${parentDisposition}`, [unit.id, parent.id], "error"));
      }
    }
  }
  const cycles = findCycleIds(units);
  for (const id of cycles) fallbackIds.add(id);
  if (cycles.size) issues.push(issue("parent_cycle", `检测到循环父子关系：${[...cycles].join("、")}`, [...cycles], "error"));
  return fallbackIds;
}

function findCycleIds(units: JdSemanticUnit[]) {
  const parentById = new Map(units.map((unit) => [unit.id, (unit.final ?? inferFinal(unit)).parentUnitId]));
  const cycles = new Set<string>();
  for (const start of parentById.keys()) {
    const path: string[] = [];
    const seen = new Map<string, number>();
    let current: string | undefined = start;
    while (current && parentById.has(current)) {
      if (seen.has(current)) {
        for (const id of path.slice(seen.get(current))) cycles.add(id);
        break;
      }
      seen.set(current, path.length);
      path.push(current);
      current = parentById.get(current);
    }
  }
  return cycles;
}

function shouldRemainInFrame(unit: JdSemanticUnit, frame: HierarchyFrame, numberedParent?: { unitId: string; level: number }) {
  if (unit.lexical.blankLinesBefore >= 2 && !unit.lexical.numberingLevel && !unit.lexical.bulletKind) return false;
  if (frame.childDisposition === "requirement_detail" && numberedParent && unit.lexical.numberingLevel && unit.lexical.numberingLevel <= numberedParent.level) return false;
  return Boolean(unit.lexical.numberingLevel || unit.lexical.bulletKind || unit.lexical.indentation > 0 || unit.lexical.blankLinesBefore <= 1);
}

function shouldCloseDetailFrame(unit: JdSemanticUnit, previousUnit?: JdSemanticUnit) {
  if (INLINE_DETAIL_LEAD.test(unit.text)) return true;
  if (unit.lexical.blankLinesBefore > 0 && !unit.lexical.numberingLevel && !unit.lexical.bulletKind && unit.lexical.punctuation !== "semicolon_item") return true;
  return Boolean(
    previousUnit?.lexical.punctuation === "sentence"
    && !unit.lexical.numberingLevel
    && !unit.lexical.bulletKind
    && (unit.lexical.punctuation === "colon_lead" || unit.text.length >= 24)
  );
}

function headingSection(text: string): Section | "excluded" | undefined {
  const explicit = SECTION_HEADINGS.find(([pattern]) => pattern.test(text));
  if (explicit) return explicit[1];
  const normalized = text.replace(/[:：]\s*$/, "").trim();
  if (normalized.length > 18 || /[。！？!?]/.test(normalized)) return undefined;
  if (/^(职责|要求|资格|条件|材料|画像|工作内容|任职条件|加分条件|关于团队)$/i.test(normalized)) {
    if (/材料/.test(normalized)) return "verification";
    if (/画像/.test(normalized)) return "role_profile";
    if (/加分/.test(normalized)) return "preferred";
    if (/要求|资格|条件/.test(normalized)) return "required";
    return "responsibility";
  }
  return undefined;
}

function wrapperRelation(text: string): JdSemanticGroupRelation | undefined {
  if (PREFERRED_ANY_OF_LEAD.test(text)) return "preferred_any_of";
  if (ANY_OF_LEAD.test(text)) return "any_of";
  if (ALL_OF_LEAD.test(text)) return "all_of";
  if (/根据自身情况提供以下材料\s*[:：]?$/i.test(text)) return "evidence_bundle";
  return undefined;
}

function inferDefaultSection(text: string): Section {
  if (PREFERRED.test(text)) return "preferred";
  if (VERIFICATION_SIGNAL.test(text) && /提供|提交|附上|准备/.test(text)) return "verification";
  if (MUST.test(text) || EDUCATION.test(text)) return "required";
  return "responsibility";
}

function inferKind(text: string, section: Section, preferred: boolean): RequirementNodeV3["kind"] {
  if (preferred) return "preferred";
  if (EDUCATION.test(text)) return "education";
  if (LANGUAGE.test(text)) return "language";
  if (EXPERIENCE.test(text) && /\d/.test(text)) return "experience_depth";
  if (extractKeywords(text).length) return "tool_or_technology";
  if (SOFT.test(text)) return "soft_skill";
  if (section === "responsibility") return "responsibility";
  if (MUST.test(text)) return "hard_constraint";
  return section === "required" ? "core_competency" : "risk_or_uncertain";
}

function parsePrefix(trimmed: string, indentation: number) {
  const numbered = trimmed.match(/^((?:\(?\d+(?:\.\d+)*\)?[.)、）]?|[一二三四五六七八九十]+[、.）)]))\s*/);
  if (numbered) {
    const token = numbered[1];
    return {
      text: trimmed.slice(numbered[0].length).trim(),
      numberingToken: token,
      numberingLevel: Math.max(1, (token.match(/\./g)?.length ?? 0) + 1 + Math.floor(indentation / 4))
    };
  }
  const bullet = trimmed.match(/^([-*•·▪◦])\s*/);
  if (bullet) return { text: trimmed.slice(bullet[0].length).trim(), bulletKind: bullet[1] };
  return { text: trimmed };
}

function visualIndent(value: string) {
  return [...value].reduce((total, character) => total + (character === "\t" ? 4 : 1), 0);
}

function declaredCount(text: string) {
  const arabic = text.match(/(\d+)\s*(?:个|项|种)/);
  if (arabic) return Number(arabic[1]);
  const chinese = text.match(/([一二两三四五六七八九十])\s*(?:个|项|种)/);
  if (!chinese) return undefined;
  const values: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return values[chinese[1]];
}

function extractKeywords(text: string) {
  return unique(TECH_TERMS.filter((term) => normalize(text).includes(normalize(term))).sort((a, b) => b.length - a.length));
}

function aliasesFor(text: string) {
  const pairs: Array<[RegExp, string[]]> = [
    [/reward hacking/i, ["投机行为", "评测规避"]],
    [/badcase/i, ["失败案例", "反例"]],
    [/vibe coding/i, ["AI 辅助开发"]],
    [/模型评测|输出质量评估/i, ["AI 回答质量评估"]],
    [/任务拆解|复杂任务规划/i, ["多步骤规划"]]
  ];
  return unique(pairs.filter(([pattern]) => pattern.test(text)).flatMap(([, aliases]) => aliases));
}

function withGraphHash(base: Omit<JobRequirementGraphV4, "graphHash" | "semanticEnrichmentHash">): JobRequirementGraphV4 {
  const canonical = {
    units: base.semanticUnits.map((unit) => ({
      id: unit.id,
      span: unit.sourceSpan,
      final: unit.final
    })),
    requirements: base.requirements.map((requirement) => ({
      id: requirement.id,
      sourceUnitId: requirement.sourceUnitId,
      details: requirement.details.map((detail) => detail.sourceUnitId)
    })),
    groups: base.groups,
    contexts: base.contextGroups
  };
  return JobRequirementGraphV4Schema.parse({
    ...base,
    graphHash: stableHashText(stableJson(canonical)),
    semanticEnrichmentHash: stableHashText(stableJson(base.semanticUnits.map((unit) => unit.final)))
  });
}

function issue(code: JobGraphIssueV4["code"], message: string, sourceUnitIds: string[], severity: JobGraphIssueV4["severity"] = "warning"): JobGraphIssueV4 {
  return { code, message, sourceUnitIds: unique(sourceUnitIds), severity };
}

function dedupeIssues(items: JobGraphIssueV4[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.code}:${item.sourceUnitIds.join(",")}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueSpans(items: SourceSpan[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.start}:${item.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeIntent(value: string) {
  return normalize(value).replace(/[，。；、:：,.!?！？（）()]/g, " ").replace(/\s+/g, " ").trim();
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
