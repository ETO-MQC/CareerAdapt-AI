import { isRenderableContentItem } from "@/domain/resumeDocument/mapper";
import type { CareerProfile, ResumeBranch } from "@/domain/schemas";
import { migrateResumeBranchToV2, projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { buildResumeEvidenceGraph } from "./ResumeEvidenceGraph";
import { planResumeBlueprint } from "./ResumeBlueprint";
import { ResumeCompositionMetricsSchema } from "./contracts";
import { reviewResumeComposition } from "./ResumeReviewer";
import { diagnoseResumeQuality } from "./qualityDiagnostics";
import type { ResumeClaim, ResumeCompositionResult } from "./contracts";

/** Adapt the selected revision to the existing Reviewer; never review a regenerated
 * Profile draft as though it were the user's current document. No writes or AI. */
export function reviewExistingGeneralResume(profile: CareerProfile, branch: ResumeBranch) {
  if (branch.profileId !== profile.id || branch.branchPurpose !== "general" || !branch.currentRevisionId) {
    throw new Error("general_review_target_invalid");
  }
  const evidenceGraph = buildResumeEvidenceGraph({ profile });
  const blueprint = planResumeBlueprint({ profile, graph: evidenceGraph, mode: "general" });
  const source = migrateResumeBranchToV2(branch);
  const claims: ResumeClaim[] = [];
  const items = source.structuredContentItems.filter(item => item.visible).sort((a, b) => a.order - b.order).map(item => {
    const factIds = item.factRefs.map(ref => ref.type === "evidence_file" ? ref.linkedFactId : ref.factId);
    const nodes = evidenceGraph.nodes.filter(node => node.confirmationStatus === "confirmed" && node.factIds.some(id => factIds.includes(id)));
    const legacy = source.contentItems.find(candidate => candidate.id === item.id);
    const confirmedByUser = Boolean(legacy?.userConfirmation && isRenderableContentItem({ item: legacy, profile }).renderable
      && legacy.text === projectResumeItemV2(item.data));
    if (!nodes.length && confirmedByUser && legacy) {
      const node = { id: `asset:${item.id}`, type: "evidence" as const, value: "用户已确认的简历原文",
        sourceAssetIds: [item.id], factIds: [], sourceTurnIds: [], confirmationStatus: "confirmed" as const,
        ownershipStrength: 0, sourceExcerpts: [legacy.text] };
      evidenceGraph.nodes.push(node);
      nodes.push(node);
    }
    const sourceText = [...new Set(nodes.flatMap(node => node.sourceExcerpts))].join("\n");
    const text = projectResumeItemV2(item.data);
    const guard = runRuleFactGuard({ originalText: sourceText, checkedText: text, usedEvidenceRefs: [] });
    // A valid existing resume-only confirmation is explicit user evidence.
    // Missing Profile records alone never invalidate that confirmation.
    const classification = !sourceText ? "NEEDS_USER_CONFIRMATION" : guard.status === "blocked_high_risk" ? "UNSUPPORTED"
      : guard.status !== "pass" ? "NEEDS_USER_CONFIRMATION" : "SUPPORTED";
    const id = `review:${item.id}`;
    claims.push({ id, text, classification, sourceAssetIds: [item.id], factIds: nodes.flatMap(node => node.factIds),
      sourceTurnIds: nodes.flatMap(node => node.sourceTurnIds), evidenceNodeIds: nodes.map(node => node.id),
      guardStatus: !sourceText ? "not_run" : guard.status === "blocked_high_risk" ? "blocked" : guard.status === "pass" ? "pass" : "needs_edit", reason: confirmedByUser && !factIds.length ? "用户已通过原有确认流程确认此版本原文；不反写Profile。" : sourceText ? "核对已确认来源与当前简历原文。" : "缺少独立来源，需核对；不表示候选人不具备。" });
    // Reviewer locates sources by asset ID. These aliases contain only graph
    // evidence, never the resume's own claims masquerading as source evidence.
    evidenceGraph.nodes.push(...nodes.filter(node => node.id !== `asset:${item.id}`).slice(0, 1).map(node => ({
      ...node, id: `asset:${item.id}`, sourceExcerpts: [...new Set(nodes.flatMap(n => n.sourceExcerpts))]
    })));
    return { sourceAssetId: item.id, data: structuredClone(item.data), claimIds: [id], factIds,
      sourceBlockIds: item.sourceBlockIds, sourceExcerpt: sourceText || undefined };
  });
  const metrics = ResumeCompositionMetricsSchema.parse({ sourceAssets: items.length, selectedAssets: items.length,
    derivedSkills: 0, questionsAsked: 0, supportedClaims: claims.filter(claim => claim.classification === "SUPPORTED").length,
    derivedPresentationClaims: 0, needsConfirmationClaims: claims.filter(claim => claim.classification === "NEEDS_USER_CONFIRMATION").length,
    unsupportedClaims: claims.filter(claim => claim.classification === "UNSUPPORTED").length,
    bulletsGenerated: 0, duplicateBullets: 0, fillerBullets: 0, paragraphHeavyItems: 0, pageOverflow: false, onePageReasonable: false });
  const current: ResumeCompositionResult = { schemaVersion: "resume-composition-v1", mode: "general", profileId: profile.id,
    profileRevision: profile.version, evidenceGraph, blueprint, items, claims, keywordCoverage: [], sourceResumeId: branch.id,
    metrics, informationNeeds: [], skillGroups: [],
    reviewResult: { status: "PASS", findings: [], diffs: [], atsCoverage: [], metrics, revisedBulletCount: 0 },
    proposal: { mode: "general", title: "当前简历原文审阅", summary: "只读诊断，不是改写提案。", selectedAssetTitles: [],
      derivedSkillNames: [], bulletCount: 0, informationNeeds: [], contactReminder: false, actions: [] } };
  const reviewed = reviewResumeComposition(current);
  // Audit the original emitted claims, including those a repair would omit.
  const diagnostics = diagnoseResumeQuality({ ...current, metrics: reviewed.metrics, reviewResult: reviewed.reviewResult });
  diagnostics.atsStructure.supportedKeywordCoverage = { status: "unknown", reason: "通用审阅未指定岗位关键词；不得由空列表推定覆盖通过。" };
  diagnostics.atsStructure.unsupportedKeywordInjection = { status: "unknown", reason: "未指定外部关键词集；原文事实风险由独立门禁检查。" };
  diagnostics.atsStructure.fieldCompleteness = { status: "unknown", reason: "栏目存在不代表所有客观字段完整，需结合当前内容核对。" };
  return {
    branchId: branch.id, revisionId: branch.currentRevisionId, branchRevision: branch.revision, profileRevision: profile.version,
    reviewResult: { ...reviewed.reviewResult, diagnostics, diffs: [...reviewed.reviewResult.diffs,
      ...claims.filter(claim => claim.classification !== "SUPPORTED").map(claim => ({
        id: `${claim.id}:verify`, kind: "verify" as const, itemId: claim.sourceAssetIds[0], fieldPath: "item",
        before: claim.text, recommendation: claim.reason, after: undefined
      }))] },
    evidence: items.map(item => ({ itemId: item.sourceAssetId, excerpt: item.sourceExcerpt, factIds: item.factIds })),
    // Candidate edits are advisory only; formal writes use existing checkpoint confirmation.
    originalItemCount: items.length
  };
}
export type GeneralResumeReview = ReturnType<typeof reviewExistingGeneralResume>;
