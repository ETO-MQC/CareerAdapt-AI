import { ResumeOptimizationPlanV2Schema, type CandidateEvidenceUnit, type JobCoverageReportV2, type JobRequirementGraphV2, type RequirementEvidenceMatrixV2, type ResumeBranch, type ResumeOptimizationPlanV2 } from "@/domain/schemas";
import { resolveBranchFactRefs } from "@/domain/branch/validation";
import type { CareerProfile } from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";

export function createResumeOptimizationPlan(input: {
  profile: CareerProfile; branch: ResumeBranch; jobId: string; graph: JobRequirementGraphV2;
  evidenceUnits: CandidateEvidenceUnit[]; matrix: RequirementEvidenceMatrixV2; coverage: JobCoverageReportV2; now?: string;
}): ResumeOptimizationPlanV2 {
  if (!input.branch.currentRevisionId) throw new Error("branch_current_revision_missing");
  const now = input.now ?? new Date().toISOString();
  const requirementsHash = stableHashText(JSON.stringify(input.graph.nodes.map((node) => [node.id, node.statement, node.sourceSpans])));
  const unitById = new Map(input.evidenceUnits.map((unit) => [unit.id, unit]));
  const requirementById = new Map(input.graph.nodes.map((node) => [node.id, node]));
  const itemGroups = new Map<string, { unitIds: Set<string>; requirementIds: Set<string>; bestLevel: string }>();
  for (const evaluation of input.matrix.evaluations) {
    if (!["direct", "strong_transferable", "partial"].includes(evaluation.matchLevel)) continue;
    for (const unitId of evaluation.evidenceUnitIds) {
      const unit = unitById.get(unitId); if (!unit) continue;
      const group = itemGroups.get(unit.itemId) ?? { unitIds: new Set(), requirementIds: new Set(), bestLevel: evaluation.matchLevel };
      group.unitIds.add(unitId); group.requirementIds.add(evaluation.requirementId);
      if (evaluation.matchLevel === "direct") group.bestLevel = "direct";
      itemGroups.set(unit.itemId, group);
    }
  }
  const actions: ResumeOptimizationPlanV2["actions"] = [];
  const rankedGroups = [...itemGroups.entries()].sort(([, left], [, right]) => right.requirementIds.size - left.requirementIds.size);
  rankedGroups.slice(0, 6).forEach(([itemId, group], index) => {
    const units = [...group.unitIds].map((id) => unitById.get(id)!).filter(Boolean);
    const requirementIds = [...group.requirementIds];
    const target = units.find((unit) => unit.fieldPath.startsWith("highlights.")) ?? units[0];
    const actionType = index < 2 && group.bestLevel === "direct" ? "prioritize_item" : target.fieldPath.startsWith("highlights.") ? "rewrite_highlight" : "no_change";
    actions.push({
      id: `plan-action-${stableHashText(`${itemId}:${actionType}:${requirementIds.join(",")}`)}`,
      type: actionType, targetItemId: itemId, targetFieldPath: target.fieldPath,
      requirementIds, evidenceUnitIds: units.map((unit) => unit.id), evidenceRefs: uniqueRefs(units.flatMap((unit) => resolveBranchFactRefs(input.profile, unit.factRefs))),
      currentText: target.text,
      proposedIntent: actionType === "prioritize_item" ? "将这段已确认经历前置，优先呈现与岗位核心要求直接相关的证据。" : actionType === "rewrite_highlight" ? "在不新增事实和数字的前提下，先写任务与结果，再使用岗位可理解的准确术语。" : "保持当前事实表述，避免为追求表面匹配而改写。",
      reason: `该内容可支持 ${requirementIds.length} 条岗位要求；${group.bestLevel === "direct" ? "包含直接事实证据" : "仅按可迁移或部分证据使用"}。`,
      expectedImpact: actionType === "prioritize_item" ? "core_match" : actionType === "rewrite_highlight" ? "clarity" : "risk_reduction",
      riskLevel: group.bestLevel === "direct" ? "low" : "medium", status: "proposed"
    });
  });
  const hardGapIds = input.matrix.evaluations.filter((evaluation) => {
    const requirement = requirementById.get(evaluation.requirementId);
    return requirement?.hardConstraint && ["none", "weak", "needs_confirmation", "partial"].includes(evaluation.matchLevel);
  }).map((evaluation) => evaluation.requirementId);
  const factGapIds = [...new Set([...input.coverage.uncoveredRequirementIds, ...input.coverage.confirmationRequirementIds, ...hardGapIds])];
  const factGaps = factGapIds.map((requirementId) => {
    const requirement = requirementById.get(requirementId)!;
    return { requirementId, question: `你是否有可核实的经历或证据能够支持：“${requirement.statement}”？`, reason: requirement.hardConstraint ? "这是必备条件；没有事实时必须保留为硬缺口。" : "当前来源简历没有足够事实，不能通过改写补齐。" };
  });
  for (const gap of factGaps.filter((item) => requirementById.get(item.requirementId)?.hardConstraint).slice(0, 3)) {
    actions.push({ id: `plan-gap-${stableHashText(gap.requirementId)}`, type: "add_follow_up_question", requirementIds: [gap.requirementId], evidenceUnitIds: [], evidenceRefs: [], proposedIntent: gap.question, reason: gap.reason, expectedImpact: "hard_constraint", riskLevel: "high", status: "proposed" });
  }
  return ResumeOptimizationPlanV2Schema.parse({
    id: `optimization-plan-${stableHashText(`${input.branch.id}:${input.jobId}:${input.branch.revision}:${requirementsHash}`)}`,
    branchId: input.branch.id, jobId: input.jobId, basedOnBranchRevision: input.branch.revision,
    basedOnRevisionId: input.branch.currentRevisionId, requirementsHash,
    executiveSummary: input.coverage.blockingGaps.length ? `当前岗位适配度 ${input.coverage.overallCoverage}。有 ${input.coverage.blockingGaps.length} 个硬性条件仍需提供真实信息；这不会阻止创建岗位简历。` : `当前岗位适配度 ${input.coverage.overallCoverage}。优先前置相关经历并压缩弱相关内容。`,
    actions, factGaps, createdAt: now
  });
}

function uniqueRefs<T>(refs: T[]) { const seen = new Set<string>(); return refs.filter((ref) => { const key = JSON.stringify(ref); if (seen.has(key)) return false; seen.add(key); return true; }); }
