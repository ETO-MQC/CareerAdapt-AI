import type {
  BranchContentItem,
  JobDescription,
  RequirementBlockMatch,
  RequirementBlockMatchLevel,
  RequirementMatch,
  ResumeDiagnosticAction,
  ResumeDiagnosticCategory,
  ResumeDiagnosticEvidence,
  ResumeDiagnosticIssue,
  ResumeDiagnosticSeverity,
  ResumeDiagnosticSnapshot,
  ResumePagePolicy,
  ResumePaginationPlan,
  ResumePresentationConfig,
  ResumeRenderModel,
  ResumeRenderSectionType,
  TemplateId
} from "@/domain/schemas";
import { ResumeDiagnosticSnapshotSchema } from "@/domain/schemas";
import { defaultResumeRenderSectionOrder } from "@/domain/resumeFields/catalog";
import type { ResumePaginationMeasurement } from "@/services/export/pagination";
import { stableHashText } from "@/services/security/text";

export const RESUME_DIAGNOSTICS_ENGINE_VERSION = "resume-diagnostics.v1";
export const RESUME_DIAGNOSTICS_RULESET_VERSION = "g5b-deterministic-rules.v1";

export type ResumeDiagnosticTemplateInfo = {
  id: TemplateId;
  version: number;
  category: "ats" | "technical" | "business" | "modern";
  layout: "single-column" | "two-column";
  atsLevel: "high" | "medium" | "visual";
  suitableRoles: string[];
  tags: string[];
  capabilities: {
    supportsDensity: boolean;
    supportsBodyScale: boolean;
    supportsHeadingScale: boolean;
    supportsLineHeight: boolean;
    supportsSectionGap: boolean;
    supportsItemGap: boolean;
    supportsTwoPages: boolean;
    supportsSectionPageBreaks: boolean;
    supportsSectionTitleVisibility: boolean;
  };
};

export type ResumeDiagnosticsInput = {
  branchId: string;
  branchRevision: number;
  currentRevisionId: string;
  branchContentItems: BranchContentItem[];
  renderModel: ResumeRenderModel;
  presentationConfig: ResumePresentationConfig;
  template: ResumeDiagnosticTemplateInfo;
  job?: JobDescription;
  requirementMatches?: RequirementMatch[];
  requirementBlockMatches?: RequirementBlockMatch[];
  requirementsHash?: string;
  paginationPlan?: ResumePaginationPlan;
  paginationMeasurement?: ResumePaginationMeasurement;
  ignoredIssueKeys?: string[];
  now?: string;
};

type IssueDraft = Omit<
  ResumeDiagnosticIssue,
  | "id"
  | "issueKey"
  | "branchId"
  | "basedOnBranchRevision"
  | "basedOnRevisionId"
  | "basedOnPresentationRevision"
  | "requirementsHash"
  | "paginationHash"
  | "templateId"
  | "status"
  | "createdAt"
>;

const SECTION_ORDER: ResumeRenderSectionType[] = [...defaultResumeRenderSectionOrder];
const REQUIRED_PRIORITIES = new Set(["must", "high", "important"]);
const PREFERRED_PRIORITIES = new Set(["nice_to_have", "medium", "low"]);
const MATCH_RANK: Record<RequirementBlockMatchLevel, number> = {
  strong: 5,
  partial: 4,
  weak: 3,
  needs_confirmation: 2,
  none: 1
};

export function runResumeDiagnostics(input: ResumeDiagnosticsInput): ResumeDiagnosticSnapshot {
  const now = input.now ?? new Date().toISOString();
  const requirementsHash = input.requirementsHash ?? hashRequirements(input.job, input.requirementMatches ?? []);
  const paginationHash = input.paginationPlan?.paginationHash;
  const ignoredIssueKeys = new Set(input.ignoredIssueKeys ?? []);
  const issueDrafts = [
    ...requirementCoverageIssues(input),
    ...contentIssues(input),
    ...layoutIssues(input),
    ...paginationIssues(input),
    ...atsStructureIssues(input),
    ...templateFitIssues(input)
  ];

  const issues = uniqueIssues(issueDrafts).map((issue) => {
    const issueKey = createIssueKey(input, issue);
    const id = `diag-${stableHashText(issueKey).slice(0, 24)}`;
    return {
      ...issue,
      id,
      issueKey,
      branchId: input.branchId,
      basedOnBranchRevision: input.branchRevision,
      basedOnRevisionId: input.currentRevisionId,
      basedOnPresentationRevision: input.presentationConfig.presentationRevision,
      requirementsHash,
      paginationHash,
      templateId: input.presentationConfig.templateId,
      status: ignoredIssueKeys.has(issueKey) || ignoredIssueKeys.has(id) ? "ignored" : "open",
      createdAt: now
    } satisfies ResumeDiagnosticIssue;
  });

  const summary = buildSummary(input, issues);
  const snapshotWithoutHash = {
    schemaVersion: "resume-diagnostics-v1" as const,
    branchId: input.branchId,
    branchRevision: input.branchRevision,
    currentRevisionId: input.currentRevisionId,
    presentationRevision: input.presentationConfig.presentationRevision,
    templateId: input.presentationConfig.templateId,
    pagePolicy: input.presentationConfig.pagination.pagePolicy,
    paginationHash,
    requirementsHash,
    diagnosticsEngineVersion: RESUME_DIAGNOSTICS_ENGINE_VERSION,
    rulesetVersion: RESUME_DIAGNOSTICS_RULESET_VERSION,
    templateRegistryVersion: `${input.template.id}@${input.template.version}`,
    generatedAt: now
  };
  const snapshotKey = stableHashText(stableStringify(snapshotWithoutHash));
  const diagnosticHash = stableHashText(stableStringify({
    snapshotKey,
    issues: issues.map((issue) => ({
      issueKey: issue.issueKey,
      severity: issue.severity,
      code: issue.code,
      status: issue.status
    }))
  }));

  return ResumeDiagnosticSnapshotSchema.parse({
    ...snapshotWithoutHash,
    snapshotKey,
    diagnosticHash,
    issues,
    summary
  });
}

export function isResumeDiagnosticSnapshotStale(input: {
  snapshot?: ResumeDiagnosticSnapshot;
  branchRevision?: number;
  currentRevisionId?: string;
  presentationRevision?: number;
  templateId?: TemplateId;
  pagePolicy?: ResumePagePolicy;
  paginationHash?: string;
  requirementsHash?: string;
}) {
  const snapshot = input.snapshot;
  if (!snapshot) {
    return false;
  }
  return snapshot.branchRevision !== input.branchRevision
    || snapshot.currentRevisionId !== input.currentRevisionId
    || snapshot.presentationRevision !== input.presentationRevision
    || snapshot.templateId !== input.templateId
    || snapshot.pagePolicy !== input.pagePolicy
    || snapshot.paginationHash !== input.paginationHash
    || snapshot.requirementsHash !== input.requirementsHash
    || snapshot.diagnosticsEngineVersion !== RESUME_DIAGNOSTICS_ENGINE_VERSION;
}

function requirementCoverageIssues(input: ResumeDiagnosticsInput): IssueDraft[] {
  if (!input.job) {
    return [issue({
      category: "requirement_coverage",
      severity: "info",
      code: "NO_JOB_CONTEXT",
      title: "当前分支没有目标岗位",
      description: "通用简历可以诊断内容和排版；岗位覆盖诊断需要先选择或派生目标岗位。",
      evidence: evidence("requirement", "岗位上下文", "无目标岗位"),
      actions: [action("open_job_suggestion", "打开岗位优化入口", false)]
    })];
  }

  if (input.job.requirements.length === 0) {
    return [issue({
      category: "requirement_coverage",
      severity: "warning",
      code: "NO_REQUIREMENTS",
      title: "目标岗位没有可诊断的要求",
      description: "当前 JobDescription 未包含岗位要求，无法判断覆盖情况。",
      evidence: evidence("requirement", "岗位", `${input.job.company} / ${input.job.title}`),
      actions: [action("open_job_suggestion", "重新创建或刷新岗位要求", false)]
    })];
  }

  if ((input.requirementMatches ?? []).some((match) => match.isStale)) {
    return [issue({
      category: "requirement_coverage",
      severity: "warning",
      code: "STALE_REQUIREMENT_MATCH",
      title: "岗位匹配结果已过期",
      description: "RequirementMatch 标记为 stale，覆盖诊断需要重新运行岗位映射后再作为依据。",
      evidence: evidence("requirement", "stale matches", input.requirementMatches?.filter((match) => match.isStale).length ?? 0),
      actions: [action("open_job_suggestion", "跳转到岗位映射", false)]
    })];
  }

  const result: IssueDraft[] = [];
  for (const requirement of input.job.requirements) {
    const matches = matchesForRequirement(input, requirement.id);
    const best = bestMatch(matches);
    const required = isRequiredRequirement(requirement);
    const preferred = isPreferredRequirement(requirement);
    const matchedItemIds = uniqueStrings(matches.map((match) => match.contentItemId).filter((id): id is string => Boolean(id)));
    const evidenceCount = uniqueStrings(matches.flatMap((match) => match.evidenceFactIds)).length;
    const requirementLabel = requirement.description.slice(0, 100);

    if (!best || best.matchLevel === "none") {
      result.push(issue({
        category: required ? "requirement_coverage" : "fact_gap",
        severity: "warning",
        code: required ? "REQUIRED_REQUIREMENT_NOT_COVERED" : "PREFERRED_REQUIREMENT_NOT_COVERED",
        title: required ? "必备岗位要求尚未覆盖" : "加分岗位要求尚未覆盖",
        description: required
          ? "当前简历没有找到能定位到区块的事实证据来覆盖该必备要求。"
          : "当前简历没有找到能定位到区块的事实证据来覆盖该加分要求。",
        requirementIds: [requirement.id],
        evidence: [
          ...evidence("requirement", "岗位要求", requirementLabel, requirement.id),
          ...evidence("requirement", "优先级", requirement.priority)
        ],
        actions: [action("open_fact_gap", "补充或确认事实", false, { requirementId: requirement.id })]
      }));
    }

    if (required && best.matchLevel === "weak") {
      result.push(issue({
        category: "requirement_coverage",
        severity: "warning",
        code: "REQUIRED_REQUIREMENT_WEAK_MATCH",
        title: "必备岗位要求只有弱覆盖",
        description: "该要求只有 weak 匹配，建议在不新增虚假事实的前提下补充证据或优化相关区块表达。",
        requirementIds: [requirement.id],
        contentItemIds: matchedItemIds,
        evidence: [
          ...evidence("requirement", "岗位要求", requirementLabel, requirement.id),
          ...evidence("requirement", "最佳匹配", best.matchLevel),
          ...evidence("requirement", "证据数", evidenceCount)
        ],
        actions: [
          action("open_job_suggestion", "查看 G5a 区块建议", false, { requirementId: requirement.id }),
          action("open_fact_gap", "补充事实依据", false, { requirementId: requirement.id })
        ]
      }));
    }

    if (best.matchLevel === "needs_confirmation" || evidenceCount === 0) {
      result.push(issue({
        category: "fact_gap",
        severity: required ? "warning" : "info",
        code: "REQUIREMENT_FACT_GAP",
        title: "岗位要求缺少事实依据",
        description: "当前资料未找到可支持该要求的事实证据，诊断不会把关键词相似当作已覆盖。",
        requirementIds: [requirement.id],
        contentItemIds: matchedItemIds,
        evidence: [
          ...evidence("requirement", "岗位要求", requirementLabel, requirement.id),
          ...evidence("requirement", "事实证据数", evidenceCount)
        ],
        actions: [action("open_fact_gap", "补充或确认事实", false, { requirementId: requirement.id })]
      }));
    }

    if ((best.matchLevel === "strong" || best.matchLevel === "partial") && best.evidenceRefs.length === 0) {
      result.push(issue({
        category: "requirement_coverage",
        severity: "warning",
        code: "STRONG_MATCH_WITHOUT_LOCALIZED_EVIDENCE",
        title: "覆盖结果缺少可定位证据",
        description: "该要求看起来已覆盖，但当前匹配没有可定位的 evidenceRefs，建议重新运行映射或检查事实引用。",
        requirementIds: [requirement.id],
        contentItemIds: matchedItemIds,
        evidence: [
          ...evidence("requirement", "最佳匹配", best.matchLevel),
          ...evidence("requirement", "evidenceRefs", best.evidenceRefs.length)
        ],
        actions: [action("open_job_suggestion", "重新生成映射", false, { requirementId: requirement.id })]
      }));
    }

    const hiddenIds = matchedItemIds.filter((itemId) => isPresentationHidden(input, itemId));
    if (matchedItemIds.length > 0 && hiddenIds.length === matchedItemIds.length) {
      result.push(issue({
        category: "ats_structure",
        severity: required ? "warning" : "info",
        code: "REQUIREMENT_ONLY_HIDDEN_EVIDENCE",
        title: "岗位要求的唯一证据已被展示隐藏",
        description: "当前要求关联的区块没有进入展示层，导出 PDF 中可能看不到这条证据。",
        requirementIds: [requirement.id],
        contentItemIds: hiddenIds,
        evidence: [
          ...evidence("presentation", "隐藏证据区块", hiddenIds.length),
          ...evidence("requirement", "岗位要求", requirementLabel, requirement.id)
        ],
        actions: hiddenIds.map((itemId) => action("show_block", "恢复显示相关区块", true, { contentItemId: itemId }))
      }));
    }

    const firstPage = matchedItemIds.map((itemId) => pageNumberForBlock(input.paginationPlan, itemId)).filter((value): value is number => Boolean(value)).sort()[0];
    if (required && firstPage && firstPage > 1) {
      result.push(issue({
        category: "requirement_coverage",
        severity: "info",
        code: "KEY_REQUIREMENT_LOW_POSITION",
        title: "关键要求证据位置较靠后",
        description: "必备要求的首个可见证据位于第二页或更后，建议检查是否需要前置相关区块。",
        requirementIds: [requirement.id],
        contentItemIds: matchedItemIds,
        evidence: evidence("pagination", "首个证据页码", firstPage),
        actions: matchedItemIds.slice(0, 1).map((itemId) => action("move_block_up", "上移相关区块", true, { contentItemId: itemId }))
      }));
    }

    if (preferred && best.matchLevel === "weak") {
      result.push(issue({
        category: "requirement_coverage",
        severity: "info",
        code: "PREFERRED_REQUIREMENT_WEAK_MATCH",
        title: "加分项覆盖较弱",
        description: "该加分项目前只有弱证据；如果它对岗位很重要，建议在事实充足时补强。",
        requirementIds: [requirement.id],
        contentItemIds: matchedItemIds,
        evidence: evidence("requirement", "匹配等级", best.matchLevel),
        actions: [action("open_job_suggestion", "查看岗位建议", false, { requirementId: requirement.id })]
      }));
    }
  }

  result.push(...concentratedRequirementIssues(input));
  return result;
}

function contentIssues(input: ResumeDiagnosticsInput): IssueDraft[] {
  const result: IssueDraft[] = [];
  const measurementsById = new Map((input.paginationMeasurement?.blocks ?? []).map((block) => [block.sourceItemId, block]));
  const visibleItems = input.branchContentItems.filter((item) => item.visible && !input.presentationConfig.hiddenItemIds.includes(item.id));
  const requirementMatchedIds = new Set(input.requirementBlockMatches?.map((match) => match.contentItemId).filter((id): id is string => Boolean(id)) ?? []);

  for (const item of input.branchContentItems) {
    const trimmed = item.text.trim();
    const measurement = measurementsById.get(item.id);
    const heightRatio = measurement && input.paginationMeasurement
      ? measurement.height / Math.max(1, input.paginationMeasurement.clientHeight)
      : 0;

    if (!trimmed) {
      result.push(issue({
        category: "content_density",
        severity: "critical",
        code: "EMPTY_CONTENT_ITEM",
        title: "存在空内容区块",
        description: "正式简历区块不应为空，请编辑正文或隐藏该区块。",
        contentItemIds: [item.id],
        sectionType: sectionTypeForItem(item),
        evidence: evidence("content", "文本长度", 0, item.id),
        actions: [
          action("open_content_editor", "编辑正文", false, { contentItemId: item.id }),
          action("hide_block", "隐藏区块", true, { contentItemId: item.id })
        ]
      }));
      continue;
    }

    if (item.itemType !== "skill" && item.itemType !== "certificate" && trimmed.length < 18) {
      result.push(issue({
        category: "content_density",
        severity: "info",
        code: "CONTENT_ITEM_TOO_SHORT",
        title: "区块内容偏短",
        description: "该区块信息量较少，可能缺少角色、对象、动作或结果说明。",
        contentItemIds: [item.id],
        sectionType: sectionTypeForItem(item),
        evidence: [
          ...evidence("content", "字符数", trimmed.length, item.id),
          ...evidence("measurement", "页面高度占比", round(heightRatio), item.id)
        ],
        actions: [action("open_content_editor", "编辑正文", false, { contentItemId: item.id })]
      }));
    }

    if (trimmed.length > 260 || heightRatio > 0.36 || input.paginationPlan?.oversizedBlockIds.includes(item.id)) {
      result.push(issue({
        category: "content_density",
        severity: input.paginationPlan?.oversizedBlockIds.includes(item.id) ? "critical" : "warning",
        code: "CONTENT_ITEM_TOO_LONG",
        title: "区块内容偏长",
        description: "该区块占用页面空间较多，建议跳转正文编辑或使用 G5a 生成压缩建议；诊断不会自动压缩正文。",
        contentItemIds: [item.id],
        sectionType: sectionTypeForItem(item),
        evidence: [
          ...evidence("content", "字符数", trimmed.length, item.id),
          ...evidence("measurement", "页面高度占比", round(heightRatio), item.id)
        ],
        actions: [
          action("open_content_editor", "编辑正文", false, { contentItemId: item.id }),
          action("open_job_suggestion", "生成压缩建议", false, { contentItemId: item.id })
        ]
      }));
    }

    if (!requirementMatchedIds.has(item.id) && item.itemType !== "summary" && (trimmed.length > 180 || heightRatio > 0.22)) {
      result.push(issue({
        category: "content_relevance",
        severity: "info",
        code: "LOW_RELEVANCE_CONTENT_TAKES_SPACE",
        title: "低相关内容占用较多空间",
        description: "该区块没有被当前岗位要求映射命中，但占用页面空间较多。可以考虑隐藏，或先编辑正文确认是否仍有价值。",
        contentItemIds: [item.id],
        sectionType: sectionTypeForItem(item),
        evidence: [
          ...evidence("content", "是否命中岗位要求", false, item.id),
          ...evidence("measurement", "页面高度占比", round(heightRatio), item.id)
        ],
        actions: [
          action("hide_block", "隐藏该区块", true, { contentItemId: item.id }),
          action("open_content_editor", "编辑正文", false, { contentItemId: item.id })
        ]
      }));
    }
  }

  for (const sectionType of SECTION_ORDER) {
    const blocks = input.renderModel.sections.find((section) => section.type === sectionType)?.blocks ?? [];
    if (sectionType !== "certificates" && blocks.length === 0) {
      result.push(issue({
        category: "section_structure",
        severity: sectionType === "experience" ? "warning" : "info",
        code: "SECTION_MISSING",
        title: "关键 Section 缺失",
        description: `${sectionLabel(sectionType)} 当前没有可展示内容。`,
        sectionType,
        evidence: evidence("content", "可展示条目数", 0),
        actions: [action("open_content_editor", "回到正文编辑", false, { sectionType })]
      }));
    }
    if (blocks.length > 8) {
      result.push(issue({
        category: "section_structure",
        severity: "warning",
        code: "SECTION_TOO_MANY_ITEMS",
        title: "Section 条目过多",
        description: "同一 Section 的条目数量较多，阅读时会显得拥挤，建议检查是否需要合并、前置或隐藏低相关内容。",
        sectionType,
        contentItemIds: blocks.map((block) => block.sourceItemId),
        evidence: evidence("content", "Section 条目数", blocks.length),
        actions: [action("set_item_gap", "调大条目间距", true, { itemGap: "normal" })]
      }));
    }
  }

  result.push(...contactIssues(input));
  result.push(...duplicateTextIssues(visibleItems));
  return result;
}

function layoutIssues(input: ResumeDiagnosticsInput): IssueDraft[] {
  const result: IssueDraft[] = [];
  const style = input.presentationConfig;
  const plan = input.paginationPlan;
  const measurement = input.paginationMeasurement;

  if (style.typography.bodyTextScale === "small") {
    result.push(issue({
      category: "readability",
      severity: "warning",
      code: "BODY_TEXT_TOO_SMALL",
      title: "正文字号偏小",
      description: "小字号会提升信息密度，但可能影响阅读和文本抽取后的人工审阅体验。",
      evidence: evidence("presentation", "正文字号", style.typography.bodyTextScale),
      actions: [action("set_body_scale", "调为标准字号", true, { bodyTextScale: "normal" })]
    }));
  }

  if (style.typography.bodyTextScale === "small" && style.typography.lineHeight === "tight") {
    result.push(issue({
      category: "readability",
      severity: "warning",
      code: "SMALL_AND_TIGHT_READABILITY_RISK",
      title: "小字号与紧行距同时使用",
      description: "当前组合会显著提高密度，建议至少恢复标准行距或标准字号。",
      evidence: [
        ...evidence("presentation", "正文字号", style.typography.bodyTextScale),
        ...evidence("presentation", "行距", style.typography.lineHeight)
      ],
      actions: [
        action("set_line_height", "调为标准行距", true, { lineHeight: "normal" }),
        action("set_body_scale", "调为标准字号", true, { bodyTextScale: "normal" })
      ]
    }));
  }

  if (style.typography.titleTextScale === "small" && style.typography.bodyTextScale !== "small") {
    result.push(issue({
      category: "readability",
      severity: "info",
      code: "TITLE_HIERARCHY_WEAK",
      title: "标题层级不够明显",
      description: "Section 标题字号偏小，可能降低快速扫读效率。",
      evidence: evidence("presentation", "标题字号", style.typography.titleTextScale),
      actions: [action("set_body_scale", "保持正文并调整标题", true, { titleTextScale: "normal" })]
    }));
  }

  if (style.spacing.sectionGap === "tight") {
    result.push(issue({
      category: "spacing",
      severity: "info",
      code: "SECTION_GAP_TIGHT",
      title: "Section 间距偏紧",
      description: "Section 间距偏紧时，栏目边界会不够清晰；如果页数允许，可调回标准。",
      evidence: evidence("presentation", "Section 间距", style.spacing.sectionGap),
      actions: [action("set_section_gap", "调为标准 Section 间距", true, { sectionGap: "normal" })]
    }));
  }

  if (style.spacing.itemGap === "tight") {
    result.push(issue({
      category: "spacing",
      severity: "info",
      code: "ITEM_GAP_TIGHT",
      title: "条目间距偏紧",
      description: "条目间距偏紧可能让相邻经历难以区分。",
      evidence: evidence("presentation", "条目间距", style.spacing.itemGap),
      actions: [action("set_item_gap", "调为标准条目间距", true, { itemGap: "normal" })]
    }));
  }

  const hiddenTitles = SECTION_ORDER.filter((section) => style.sectionStyleOverrides[section]?.showTitle === false);
  if (hiddenTitles.length >= 2) {
    result.push(issue({
      category: "section_structure",
      severity: "warning",
      code: "MANY_SECTION_TITLES_HIDDEN",
      title: "多个 Section 标题被隐藏",
      description: "隐藏过多栏目标题会降低结构可读性，也会增加 ATS 结构识别风险。",
      sectionType: hiddenTitles[0],
      evidence: evidence("presentation", "隐藏标题数量", hiddenTitles.length),
      actions: [action("open_content_editor", "检查 Section 标题显示", false)]
    }));
  }

  if (plan && style.theme.density === "spacious" && plan.actualPageCount > 1) {
    result.push(issue({
      category: "spacing",
      severity: "warning",
      code: "SPACIOUS_DENSITY_WITH_PAGE_PRESSURE",
      title: "内容较多但使用宽松密度",
      description: "当前页数压力较高，宽松密度可能导致不必要分页。",
      evidence: [
        ...evidence("presentation", "页面密度", style.theme.density),
        ...evidence("pagination", "实际页数", plan.actualPageCount)
      ],
      actions: [action("set_density", "改为紧凑密度", true, { density: "compact" })]
    }));
  }

  if (measurement && style.theme.density === "compact" && measurement.clientHeight - measurement.scrollHeight > 260) {
    result.push(issue({
      category: "spacing",
      severity: "info",
      code: "COMPACT_DENSITY_WITH_SPARSE_CONTENT",
      title: "内容稀疏但使用紧凑密度",
      description: "页面留白充足时，过度紧凑会降低成品感。",
      evidence: [
        ...evidence("presentation", "页面密度", style.theme.density),
        ...evidence("measurement", "剩余高度 px", Math.round(measurement.clientHeight - measurement.scrollHeight))
      ],
      actions: [action("set_density", "改为均衡密度", true, { density: "balanced" })]
    }));
  }

  const overflowBlocks = (measurement?.blocks ?? []).filter((block) => block.horizontalOverflow);
  for (const block of overflowBlocks) {
    result.push(issue({
      category: "readability",
      severity: "warning",
      code: "HORIZONTAL_TEXT_OVERFLOW",
      title: "存在水平溢出文本",
      description: "长邮箱、URL 或英文串可能被裁切，建议编辑正文换行或调整模板。",
      sectionType: block.sectionType as "summary" | "experience" | "skills" | "certificates" | undefined,
      contentItemIds: [block.sourceItemId],
      evidence: evidence("measurement", "水平溢出", true, block.sourceItemId),
      actions: [
        action("open_content_editor", "编辑正文", false, { contentItemId: block.sourceItemId }),
        action("switch_template", "切换为单栏 ATS 模板", true, { templateId: "ats-minimal" })
      ]
    }));
  }

  if (input.template.layout === "two-column") {
    const imbalance = twoColumnImbalance(input);
    if (imbalance > 0.62) {
      result.push(issue({
        category: "spacing",
        severity: "info",
        code: "TWO_COLUMN_IMBALANCE",
        title: "双栏内容分布不均衡",
        description: "双栏模板中侧栏与主栏信息量差异较大，可能造成视觉空洞。",
        evidence: evidence("measurement", "栏位失衡指数", round(imbalance)),
        actions: [action("switch_template", "尝试单栏模板", true, { templateId: "classic-technical" })]
      }));
    }
  }

  return result;
}

function paginationIssues(input: ResumeDiagnosticsInput): IssueDraft[] {
  const plan = input.paginationPlan;
  if (!plan) {
    return [issue({
      category: "pagination",
      severity: "critical",
      code: "PAGINATION_UNAVAILABLE",
      title: "分页计划不可用",
      description: "诊断无法读取当前 PaginationPlan，请等待预览测量完成后重新诊断。",
      evidence: evidence("pagination", "分页计划", false)
    })];
  }

  const result: IssueDraft[] = [];
  if (plan.status === "measurement_failed") {
    result.push(issue({
      category: "pagination",
      severity: "critical",
      code: "PAGINATION_MEASUREMENT_FAILED",
      title: "分页测量失败",
      description: "当前 DOM 测量失败，正式导出会被阻断。",
      evidence: evidence("pagination", "分页状态", plan.status)
    }));
  }

  if (plan.actualPageCount > plan.maximumPageCount) {
    result.push(issue({
      category: "pagination",
      severity: "warning",
      code: "EXCEEDS_RECOMMENDED_PAGE_COUNT",
      title: "简历超过 4 页建议",
      description: "内容会完整保留在预览和 PDF 中；建议复核是否能精简到 1—2 页。",
      evidence: [
        ...evidence("pagination", "页面策略", plan.pagePolicy),
        ...evidence("pagination", "实际页数", plan.actualPageCount)
      ],
      actions: [
        action("set_density", "改为紧凑密度", true, { density: "compact" })
      ]
    }));
  }

  if (plan.status === "near_one_page_limit") {
    result.push(issue({
      category: "pagination",
      severity: "info",
      code: "PAGE_HEIGHT_NEAR_LIMIT",
      title: "页面高度接近临界值",
      description: "当前页面接近一页高度上限，少量字体或浏览器差异可能触发换页。",
      evidence: evidence("pagination", "剩余高度 px", Math.round(plan.measurement.remainingPx)),
      actions: [action("set_density", "改为紧凑密度", true, { density: "compact" })]
    }));
  }

  const secondPage = plan.pages.find((page) => page.pageNumber === 2);
  if (plan.actualPageCount === 2 && secondPage) {
    const totalBlocks = plan.pages.reduce((sum, page) => sum + page.blockIds.length, 0);
    if (secondPage.blockIds.length === 0) {
      result.push(issue({
        category: "pagination",
        severity: "critical",
        code: "BLANK_SECOND_PAGE",
        title: "存在空白第二页",
        description: "分页计划包含第二页但没有正文区块，通常由异常断页或测量失败引起。",
        evidence: evidence("pagination", "第二页区块数", 0)
      }));
    } else if (secondPage.blockIds.length <= Math.max(1, Math.floor(totalBlocks * 0.2))) {
      result.push(issue({
        category: "pagination",
        severity: "warning",
        code: "SPARSE_SECOND_PAGE",
        title: "第二页内容过少",
        description: "第二页只包含少量内容，可能影响简历完成度和阅读节奏。",
        contentItemIds: secondPage.blockIds,
        evidence: [
          ...evidence("pagination", "第二页区块数", secondPage.blockIds.length),
          ...evidence("pagination", "总区块数", totalBlocks)
        ],
        actions: [
          action("set_density", "改为紧凑密度", true, { density: "compact" }),
          action("set_section_gap", "收紧 Section 间距", true, { sectionGap: "tight" })
        ]
      }));
    }
  }

  for (const itemId of uniqueStrings([...plan.overflowBlockIds, ...plan.oversizedBlockIds])) {
    result.push(issue({
      category: "pagination",
      severity: plan.oversizedBlockIds.includes(itemId) ? "critical" : "warning",
      code: plan.oversizedBlockIds.includes(itemId) ? "OVERSIZED_BLOCK" : "BLOCK_CROSSES_PAGE_BOUNDARY",
      title: plan.oversizedBlockIds.includes(itemId) ? "单个区块超过页面高度" : "区块跨越分页边界",
      description: "该区块在当前模板和样式下分页表现不理想，需要编辑正文或调整展示配置。",
      contentItemIds: [itemId],
      sectionType: sectionTypeForContentId(input, itemId),
      evidence: evidence("pagination", "分页区块", itemId, itemId),
      actions: [
        action("open_content_editor", "编辑正文", false, { contentItemId: itemId }),
        action("set_line_height", "调为紧凑行距", true, { lineHeight: "tight" })
      ]
    }));
  }

  if (plan.forcedBreakBeforeSections.length > 0 && plan.actualPageCount > 1 && plan.measurement.remainingPx > 220) {
    result.push(issue({
      category: "pagination",
      severity: "warning",
      code: "FORCED_BREAK_CAUSES_WHITESPACE",
      title: "强制 Section 断页造成异常留白",
      description: "当前手动断页后仍有较多空白，建议取消不必要的断页提示。",
      sectionType: plan.forcedBreakBeforeSections[0] as "summary" | "experience" | "skills" | "certificates" | undefined,
      evidence: [
        ...evidence("pagination", "强制断页 Section", plan.forcedBreakBeforeSections.join(", ")),
        ...evidence("pagination", "剩余高度 px", Math.round(plan.measurement.remainingPx))
      ],
      actions: plan.forcedBreakBeforeSections.map((sectionType) =>
        action("cancel_section_break", "取消 Section 断页", true, { sectionType })
      )
    }));
  }

  return result;
}

function atsStructureIssues(input: ResumeDiagnosticsInput): IssueDraft[] {
  const result: IssueDraft[] = [];
  const template = input.template;
  if (template.layout === "two-column") {
    result.push(issue({
      category: "ats_structure",
      severity: template.atsLevel === "high" ? "info" : "warning",
      code: "TWO_COLUMN_ATS_STRUCTURE_RISK",
      title: "双栏结构存在阅读顺序风险",
      description: "双栏模板可能让部分系统或人工快速浏览时出现阅读顺序不一致。本诊断只提示结构风险，不代表第三方 ATS 认证结果。",
      evidence: [
        ...evidence("template_metadata", "模板布局", template.layout),
        ...evidence("template_metadata", "内部 ATS 结构等级", template.atsLevel)
      ],
      actions: [action("switch_template", "切换为 ATS 极简单栏", true, { templateId: "ats-minimal" })]
    }));
  }

  if (input.template.atsLevel === "high") {
    result.push(issue({
      category: "ats_structure",
      severity: "info",
      code: "TEXT_PDF_STRUCTURE_FRIENDLY",
      title: "当前导出路径为文本型 PDF 结构",
      description: "产品导出路径保留真实文本和 A4 页面结构；这不是第三方 ATS 通过承诺。",
      evidence: [
        ...evidence("template_metadata", "内部 ATS 结构等级", input.template.atsLevel),
        ...evidence("content", "可展示文本区块", input.renderModel.safety.visibleItemCount)
      ]
    }));
  }

  if (!hasContact(input, "email") && !hasContact(input, "phone")) {
    result.push(issue({
      category: "contact_completeness",
      severity: "warning",
      code: "CONTACT_TEXT_MISSING_FOR_ATS",
      title: "联系方式文本缺失",
      description: "PDF 中没有可识别的邮箱或电话文本，可能影响人工和系统联系信息读取。",
      evidence: evidence("content", "联系方式数量", input.renderModel.candidate.contacts.length),
      actions: [action("open_content_editor", "补充联系方式", false)]
    }));
  }

  if (input.presentationConfig.typography.bodyTextScale === "small") {
    result.push(issue({
      category: "ats_structure",
      severity: "info",
      code: "SMALL_FONT_ATS_STRUCTURE_RISK",
      title: "小字号可能增加结构读取风险",
      description: "小字号不会等同于 ATS 失败，但可能影响导出文本的人工审阅体验。",
      evidence: evidence("presentation", "正文字号", input.presentationConfig.typography.bodyTextScale),
      actions: [action("set_body_scale", "调为标准字号", true, { bodyTextScale: "normal" })]
    }));
  }

  const hiddenStrong = (input.requirementBlockMatches ?? []).filter((match) =>
    match.matchLevel === "strong"
    && match.contentItemId
    && isPresentationHidden(input, match.contentItemId)
  );
  if (hiddenStrong.length > 0) {
    result.push(issue({
      category: "ats_structure",
      severity: "warning",
      code: "HIDDEN_STRONG_MATCH_ATS_RISK",
      title: "强匹配证据未进入 PDF 展示",
      description: "某些强匹配证据被展示隐藏，导出的文本 PDF 不会包含这些区块。",
      requirementIds: uniqueStrings(hiddenStrong.map((match) => match.requirementId)),
      contentItemIds: uniqueStrings(hiddenStrong.map((match) => match.contentItemId).filter((id): id is string => Boolean(id))),
      evidence: evidence("presentation", "隐藏强匹配数", hiddenStrong.length),
      actions: uniqueStrings(hiddenStrong.map((match) => match.contentItemId).filter((id): id is string => Boolean(id)))
        .map((contentItemId) => action("show_block", "恢复显示强匹配区块", true, { contentItemId }))
    }));
  }

  return result;
}

function templateFitIssues(input: ResumeDiagnosticsInput): IssueDraft[] {
  const result: IssueDraft[] = [];
  const recommended = recommendTemplate(input);
  if (recommended && recommended !== input.template.id) {
    result.push(issue({
      category: "template_fit",
      severity: "info",
      code: "TEMPLATE_ROLE_FIT_RECOMMENDATION",
      title: "存在更贴近岗位的模板选择",
      description: templateRecommendationReason(input, recommended),
      evidence: [
        ...evidence("template_metadata", "当前模板", input.template.id),
        ...evidence("template_metadata", "推荐模板", recommended)
      ],
      actions: [action("switch_template", "应用推荐模板", true, { templateId: recommended })]
    }));
  }

  const caps = input.template.capabilities;
  const unsupported: string[] = [];
  if (!caps.supportsDensity && input.presentationConfig.theme.density !== "balanced") {
    unsupported.push("density");
  }
  if (!caps.supportsSectionPageBreaks && input.presentationConfig.pagination.pageBreakBeforeSections.length > 0) {
    unsupported.push("section_page_break");
  }
  if (unsupported.length > 0) {
    result.push(issue({
      category: "template_fit",
      severity: "warning",
      code: "UNSUPPORTED_TEMPLATE_CAPABILITY",
      title: "当前配置不符合模板能力",
      description: "当前展示配置使用了模板未声明支持的能力，建议恢复默认或切换模板。",
      evidence: evidence("template_metadata", "不支持能力", unsupported.join(", ")),
      actions: [action("switch_template", "切换为通用单栏模板", true, { templateId: "classic-technical" })]
    }));
  }

  if (input.paginationPlan && input.template.layout === "two-column" && input.paginationPlan.actualPageCount === 2) {
    result.push(issue({
      category: "template_fit",
      severity: "info",
      code: "TWO_COLUMN_TWO_PAGE_REVIEW",
      title: "双栏模板需要复核两页展示",
      description: "双栏模板进入两页时，建议复核侧栏和主栏在第二页的阅读顺序与留白。",
      evidence: [
        ...evidence("template_metadata", "模板布局", input.template.layout),
        ...evidence("pagination", "实际页数", input.paginationPlan.actualPageCount)
      ],
      actions: [action("switch_template", "尝试 ATS 极简单栏", true, { templateId: "ats-minimal" })]
    }));
  }

  return result;
}

function buildSummary(input: ResumeDiagnosticsInput, issues: ResumeDiagnosticIssue[]): ResumeDiagnosticSnapshot["summary"] {
  const openIssues = issues.filter((issue) => issue.status === "open");
  const coverage = requirementCoverageSummary(input);
  const paginationBlocked = input.paginationPlan?.status === "measurement_failed"
    || !input.paginationPlan;
  const exportHardBlockReasons = [
    !input.currentRevisionId ? "no_current_revision" : undefined,
    paginationBlocked ? "page_limit_or_measurement" : undefined
  ].filter((value): value is string => Boolean(value));

  return {
    total: issues.length,
    critical: openIssues.filter((issue) => issue.severity === "critical").length,
    warning: openIssues.filter((issue) => issue.severity === "warning").length,
    info: openIssues.filter((issue) => issue.severity === "info").length,
    open: openIssues.length,
    ignored: issues.filter((issue) => issue.status === "ignored").length,
    requirementCoverage: coverage,
    page: {
      pagePolicy: input.presentationConfig.pagination.pagePolicy,
      actualPageCount: input.paginationPlan?.actualPageCount ?? 0,
      requestedMaxPages: input.paginationPlan?.requestedMaxPages ?? 4,
      paginationBlocked
    },
    atsStructureStatus: atsStructureStatus(input, openIssues),
    exportHardBlocked: exportHardBlockReasons.length > 0,
    exportHardBlockReasons
  };
}

function contactIssues(input: ResumeDiagnosticsInput): IssueDraft[] {
  const contacts = input.renderModel.candidate.contacts;
  const issues: IssueDraft[] = [];
  if (!hasContact(input, "email")) {
    issues.push(issue({
      category: "contact_completeness",
      severity: "warning",
      code: "EMAIL_MISSING",
      title: "邮箱缺失",
      description: "当前可展示联系方式中没有可识别邮箱。",
      evidence: evidence("content", "联系方式", contacts.join(" / ") || "无"),
      actions: [action("open_content_editor", "编辑基础信息", false)]
    }));
  }
  if (!hasContact(input, "phone")) {
    issues.push(issue({
      category: "contact_completeness",
      severity: "info",
      code: "PHONE_MISSING",
      title: "电话缺失",
      description: "当前可展示联系方式中没有可识别电话。",
      evidence: evidence("content", "联系方式", contacts.join(" / ") || "无"),
      actions: [action("open_content_editor", "编辑基础信息", false)]
    }));
  }
  const invalidEmail = contacts.find((contact) => contact.includes("@") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.trim()));
  if (invalidEmail) {
    issues.push(issue({
      category: "contact_completeness",
      severity: "warning",
      code: "EMAIL_FORMAT_SUSPICIOUS",
      title: "邮箱格式可疑",
      description: "联系方式中存在像邮箱但格式不完整的文本。",
      evidence: evidence("content", "可疑邮箱", invalidEmail)
    }));
  }
  return issues;
}

function duplicateTextIssues(items: BranchContentItem[]): IssueDraft[] {
  const sentenceMap = new Map<string, string[]>();
  for (const item of items) {
    for (const sentence of splitSentences(item.text)) {
      if (sentence.length < 12) {
        continue;
      }
      const key = normalize(sentence);
      sentenceMap.set(key, [...(sentenceMap.get(key) ?? []), item.id]);
    }
  }
  return Array.from(sentenceMap.entries())
    .filter(([, ids]) => uniqueStrings(ids).length > 1)
    .slice(0, 3)
    .map(([sentence, ids]) => issue({
      category: "content_density",
      severity: "info",
      code: "DUPLICATE_CONTENT",
      title: "存在重复表述",
      description: "多个区块包含高度相似句子，可能造成信息冗余。",
      contentItemIds: uniqueStrings(ids),
      evidence: evidence("content", "重复片段", sentence.slice(0, 80)),
      actions: [action("open_content_editor", "编辑重复正文", false, { contentItemId: ids[0] })]
    }));
}

function concentratedRequirementIssues(input: ResumeDiagnosticsInput): IssueDraft[] {
  const matchesByItem = new Map<string, RequirementBlockMatch[]>();
  for (const match of input.requirementBlockMatches ?? []) {
    if (!match.contentItemId || match.matchLevel === "none") {
      continue;
    }
    matchesByItem.set(match.contentItemId, [...(matchesByItem.get(match.contentItemId) ?? []), match]);
  }
  return Array.from(matchesByItem.entries()).flatMap(([contentItemId, matches]) => {
    const uniqueRequirementIds = uniqueStrings(matches.map((match) => match.requirementId));
    const measurement = input.paginationMeasurement?.blocks.find((block) => block.sourceItemId === contentItemId);
    const heightRatio = measurement && input.paginationMeasurement
      ? measurement.height / Math.max(1, input.paginationMeasurement.clientHeight)
      : 0;
    const item = input.branchContentItems.find((candidate) => candidate.id === contentItemId);
    if (uniqueRequirementIds.length < 3 || (!item || (item.text.length < 220 && heightRatio < 0.28))) {
      return [];
    }
    return [issue({
      category: "content_density",
      severity: "warning",
      code: "MANY_REQUIREMENTS_IN_LONG_BLOCK",
      title: "多个关键要求集中在同一长区块",
      description: "多个岗位要求依赖同一较长区块，建议检查是否需要拆分、前置或精简表达。",
      requirementIds: uniqueRequirementIds,
      contentItemIds: [contentItemId],
      sectionType: sectionTypeForItem(item),
      evidence: [
        ...evidence("requirement", "关联要求数", uniqueRequirementIds.length),
        ...evidence("measurement", "页面高度占比", round(heightRatio), contentItemId)
      ],
      actions: [
        action("open_job_suggestion", "生成区块建议", false, { contentItemId }),
        action("open_content_editor", "编辑正文", false, { contentItemId })
      ]
    })];
  });
}

function requirementCoverageSummary(input: ResumeDiagnosticsInput) {
  const requirements = input.job?.requirements ?? [];
  const summary = {
    totalRequirements: requirements.length,
    covered: 0,
    partial: 0,
    weak: 0,
    uncovered: 0,
    factGaps: 0
  };
  for (const requirement of requirements) {
    const best = bestMatch(matchesForRequirement(input, requirement.id));
    if (!best || best.matchLevel === "none") {
      summary.uncovered += 1;
      summary.factGaps += 1;
    } else if (best.matchLevel === "strong") {
      summary.covered += 1;
    } else if (best.matchLevel === "partial") {
      summary.partial += 1;
    } else if (best.matchLevel === "weak") {
      summary.weak += 1;
    } else {
      summary.factGaps += 1;
    }
    if (best && best.evidenceFactIds.length === 0) {
      summary.factGaps += 1;
    }
  }
  return summary;
}

function atsStructureStatus(input: ResumeDiagnosticsInput, openIssues: ResumeDiagnosticIssue[]) {
  if (!input.paginationPlan) {
    return "unknown" as const;
  }
  if (openIssues.some((issue) => issue.category === "ats_structure" && issue.severity === "critical")) {
    return "clear_risk" as const;
  }
  if (openIssues.some((issue) => issue.category === "ats_structure" && issue.severity === "warning")) {
    return "minor_risk" as const;
  }
  if (input.template.atsLevel === "high") {
    return "structure_friendly" as const;
  }
  return "unknown" as const;
}

function recommendTemplate(input: ResumeDiagnosticsInput): TemplateId | undefined {
  const text = `${input.job?.title ?? ""} ${input.job?.rawText ?? ""} ${(input.job?.requirements ?? []).map((req) => req.description).join(" ")}`.toLowerCase();
  const wantsAts = input.presentationConfig.typography.bodyTextScale === "small"
    || input.template.layout === "two-column"
    || input.branchContentItems.length > 8;
  if (/sql|python|data|数据|技术|研发|工程|算法|研究/.test(text)) {
    return input.paginationPlan && input.paginationPlan.actualPageCount > 1 ? "ats-minimal" : "classic-technical";
  }
  if (/咨询|金融|投资|商务|供应链|外贸|finance|consult/.test(text)) {
    return "business-consulting";
  }
  if (/运营|产品|项目管理|增长|用户/.test(text)) {
    return wantsAts ? "ats-minimal" : "modern-operations";
  }
  if (wantsAts) {
    return "ats-minimal";
  }
  return undefined;
}

function templateRecommendationReason(input: ResumeDiagnosticsInput, recommended: TemplateId) {
  if (recommended === "ats-minimal") {
    return "当前内容密度或结构风险较高，可考虑使用 ATS 极简单栏模板以减少复杂结构。";
  }
  if (recommended === "classic-technical") {
    return "目标岗位偏技术、数据或研究方向，稳重技术模板更突出项目与技能证据。";
  }
  if (recommended === "business-consulting") {
    return "目标岗位偏商务、金融或咨询方向，商务咨询模板更强调正式表达和量化成果。";
  }
  return "目标岗位偏产品、运营或综合方向，现代运营模板更适合展示综合能力。";
}

function twoColumnImbalance(input: ResumeDiagnosticsInput) {
  const textLengthBySection = new Map(input.renderModel.sections.map((section) => [
    section.type,
    section.blocks.reduce((sum, block) => sum + block.text.length, 0)
  ]));
  const sidebar = (textLengthBySection.get("summary") ?? 0) + (textLengthBySection.get("skills") ?? 0) + (textLengthBySection.get("certificates") ?? 0);
  const main = textLengthBySection.get("experience") ?? 0;
  const total = Math.max(1, sidebar + main);
  return Math.abs(sidebar - main) / total;
}

function matchesForRequirement(input: ResumeDiagnosticsInput, requirementId: string) {
  return (input.requirementBlockMatches ?? []).filter((match) => match.requirementId === requirementId);
}

function bestMatch(matches: RequirementBlockMatch[]) {
  return [...matches].sort((a, b) => MATCH_RANK[b.matchLevel] - MATCH_RANK[a.matchLevel])[0];
}

function isRequiredRequirement(requirement: JobDescription["requirements"][number]) {
  return requirement.hardConstraint
    || REQUIRED_PRIORITIES.has(requirement.priority)
    || requirement.category === "required_skill"
    || requirement.category === "must_have"
    || requirement.category === "core_skill";
}

function isPreferredRequirement(requirement: JobDescription["requirements"][number]) {
  return PREFERRED_PRIORITIES.has(requirement.priority)
    || requirement.category === "preferred_skill"
    || requirement.category === "nice_to_have";
}

function isPresentationHidden(input: ResumeDiagnosticsInput, itemId: string) {
  const item = input.branchContentItems.find((candidate) => candidate.id === itemId);
  return !item?.visible || input.presentationConfig.hiddenItemIds.includes(itemId);
}

function pageNumberForBlock(plan: ResumePaginationPlan | undefined, itemId: string) {
  return plan?.pages.find((page) => page.blockIds.includes(itemId))?.pageNumber;
}

function sectionTypeForContentId(input: ResumeDiagnosticsInput, itemId: string): ResumeRenderSectionType | undefined {
  const item = input.branchContentItems.find((candidate) => candidate.id === itemId);
  return item ? sectionTypeForItem(item) : undefined;
}

function sectionTypeForItem(item: BranchContentItem): ResumeRenderSectionType {
  if (item.itemType === "summary") {
    return "summary";
  }
  if (item.itemType === "skill") {
    return "skills";
  }
  if (item.itemType === "certificate") {
    return "certificates";
  }
  return "experience";
}

function hasContact(input: ResumeDiagnosticsInput, type: "email" | "phone") {
  const contacts = input.renderModel.candidate.contacts;
  if (type === "email") {
    return contacts.some((contact) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.trim()));
  }
  return contacts.some((contact) => /(?:\+?\d[\d\s-]{6,}\d|1[3-9]\d{9})/.test(contact.replace(/[()]/g, "")));
}

function issue(input: {
  category: ResumeDiagnosticCategory;
  severity: ResumeDiagnosticSeverity;
  code: string;
  title: string;
  description: string;
  requirementIds?: string[];
  sectionType?: ResumeRenderSectionType;
  contentItemIds?: string[];
  evidence?: ResumeDiagnosticEvidence[];
  actions?: ResumeDiagnosticAction[];
}): IssueDraft {
  return {
    category: input.category,
    severity: input.severity,
    code: input.code,
    title: input.title,
    description: input.description,
    requirementIds: input.requirementIds ?? [],
    sectionType: input.sectionType,
    contentItemIds: input.contentItemIds ?? [],
    evidence: input.evidence ?? [],
    recommendedActions: input.actions ?? []
  };
}

function evidence(
  type: ResumeDiagnosticEvidence["type"],
  label: string,
  value: string | number | boolean,
  sourceId?: string
): ResumeDiagnosticEvidence[] {
  return [{ type, label, value, sourceId }];
}

function action(
  kind: ResumeDiagnosticAction["kind"],
  label: string,
  safeAutoApply: boolean,
  payload?: unknown
): ResumeDiagnosticAction {
  return {
    id: `action-${stableHashText(stableStringify({ kind, label, payload })).slice(0, 18)}`,
    kind,
    label,
    safeAutoApply,
    payload
  };
}

function uniqueIssues(issues: IssueDraft[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = stableStringify({
      category: issue.category,
      code: issue.code,
      requirementIds: issue.requirementIds,
      sectionType: issue.sectionType,
      contentItemIds: issue.contentItemIds
    });
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function createIssueKey(input: ResumeDiagnosticsInput, issue: IssueDraft) {
  return stableStringify({
    branchId: input.branchId,
    templateId: input.presentationConfig.templateId,
    category: issue.category,
    code: issue.code,
    requirementIds: [...issue.requirementIds].sort(),
    sectionType: issue.sectionType,
    contentItemIds: [...issue.contentItemIds].sort(),
    engineVersion: RESUME_DIAGNOSTICS_ENGINE_VERSION
  });
}

function hashRequirements(job: JobDescription | undefined, matches: RequirementMatch[]) {
  if (!job) {
    return undefined;
  }
  return stableHashText(stableStringify({
    jobId: job.id,
    updatedAt: job.updatedAt,
    requirements: job.requirements.map((requirement) => ({
      id: requirement.id,
      category: requirement.category,
      priority: requirement.priority,
      hardConstraint: requirement.hardConstraint,
      description: requirement.description,
      keywords: requirement.keywords
    })),
    matches: matches.map((match) => ({
      id: match.id,
      requirementId: match.requirementId,
      matcherVersion: match.matcherVersion,
      candidateSetHash: match.candidateSetHash,
      isStale: match.isStale
    }))
  }));
}

function splitSentences(text: string) {
  return text.split(/[。.!?！？；;\n]/).map((part) => part.trim()).filter(Boolean);
}

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, "");
}

function sectionLabel(type: ResumeRenderSectionType) {
  if (type === "summary") {
    return "岗位概览";
  }
  if (type === "skills") {
    return "技能";
  }
  if (type === "certificates") {
    return "证书";
  }
  return "项目与经历";
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}
