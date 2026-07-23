import type {
  CapabilityEntity,
  ResumeBranch,
  ResumeFieldPatch,
  TailoringClaim,
  TailoringDiffRejectionReason,
  TailoringTargetPolicy
} from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";
import {
  capabilityBlockedFromSkill,
  capabilityIsMaterialOnly,
  pickProficiencyCapability,
  resolveCapabilityEntities
} from "./capabilityResolver";

export type TailoringQualityIssue = {
  code: TailoringDiffRejectionReason;
  claimIds: string[];
  message: string;
};

export function tailoringValueHash(value: unknown) {
  return stableHashText(JSON.stringify(value));
}

export function captureAndDedupeTailoringClaims(input: {
  claims: TailoringClaim[];
  branch: ResumeBranch;
  jobId: string;
}) {
  const captured = input.claims.map((claim) => captureClaimSnapshot(claim, input.branch));
  return dedupeTailoringClaims({ claims: captured, jobId: input.jobId });
}

export function captureClaimSnapshot(claim: TailoringClaim, branch: ResumeBranch): TailoringClaim {
  const patch = claim.targetPatches?.[0];
  const originalValue = patch ? readTailoringTargetValue(branch, patch) ?? patch.before : claim.originalValue ?? claim.currentText;
  const suggestedValue = patch?.after ?? claim.suggestedValue ?? claim.proposedText;
  const capability = claim.capability ?? pickProficiencyCapability(resolveCapabilityEntities({ keywords: claim.keywords }));
  return {
    ...claim,
    capability,
    targetPolicy: claim.targetPolicy ?? inferTargetPolicy(claim, capability),
    baseRevisionId: branch.currentRevisionId ?? claim.baseRevisionId,
    originalValue,
    originalValueHash: tailoringValueHash(originalValue),
    suggestedValue,
    resolvedValue: claim.resolvedValue ?? (claim.confirmed ? suggestedValue : undefined),
    currentText: renderValue(originalValue),
    proposedText: renderValue(suggestedValue),
    targetPatches: patch ? [{ ...patch, before: originalValue }] : claim.targetPatches
  };
}

export function dedupeTailoringClaims(input: { claims: TailoringClaim[]; jobId: string }) {
  const byTarget = new Map<string, TailoringClaim>();
  for (const claim of input.claims) {
    const key = tailoringClaimSemanticKey(input.jobId, claim);
    const existing = byTarget.get(key);
    if (!existing) {
      byTarget.set(key, claim);
      continue;
    }
    byTarget.set(key, mergeClaims(existing, claim));
  }

  const bySentence = new Map<string, TailoringClaim>();
  for (const claim of byTarget.values()) {
    const sentence = normalizeSentence(renderValue(claim.resolvedValue ?? claim.suggestedValue ?? claim.proposedText));
    if (!sentence) continue;
    const existing = bySentence.get(sentence);
    if (!existing || sameClaimTarget(existing, claim)) {
      bySentence.set(sentence, existing ? mergeClaims(existing, claim) : claim);
      continue;
    }
    bySentence.set(sentence, mergeClaims(existing, claim));
  }
  return [...bySentence.values()];
}

export function tailoringClaimSemanticKey(jobId: string, claim: TailoringClaim) {
  const patch = claim.targetPatches?.[0];
  const capability = claim.capability?.normalizedLabel ?? "none";
  const policy = claim.targetPolicy ?? inferTargetPolicy(claim, claim.capability);
  const itemId = patch?.itemId ?? claim.targetContentItemId ?? "none";
  const fieldPath = patch ? `${patch.fieldPath}:${patch.targetIndex ?? ""}` : claim.targetFieldPath ?? "none";
  return [jobId, capability, policy, itemId, fieldPath].join("|");
}

export function validateTailoringClaimClosure(input: {
  claims: TailoringClaim[];
  branch?: ResumeBranch;
}): TailoringQualityIssue[] {
  const issues: TailoringQualityIssue[] = [];
  const targetKeys = new Map<string, string>();
  const sentences = new Map<string, string>();

  for (const claim of input.claims) {
    const patch = claim.targetPatches?.[0];
    const finalValue = claim.resolvedValue ?? patch?.after ?? claim.suggestedValue ?? claim.proposedText;
    const finalText = renderValue(finalValue).trim();
    const normalized = normalizeSentence(finalText);
    const targetKey = `${patch?.itemId ?? claim.targetContentItemId}:${patch?.fieldPath ?? claim.targetFieldPath}:${patch?.targetIndex ?? ""}`;
    const previousTarget = targetKeys.get(targetKey);
    if (previousTarget && previousTarget !== claim.id) issues.push(issue("repeated_claim_target", [previousTarget, claim.id], "同一字段存在重复 Claim。"));
    else targetKeys.set(targetKey, claim.id);
    const previousSentence = sentences.get(normalized);
    if (normalized && previousSentence && previousSentence !== claim.id) issues.push(issue("duplicate_sentence", [previousSentence, claim.id], "相同最终句不能写入多个位置。"));
    else if (normalized) sentences.set(normalized, claim.id);

    if (!finalText) issues.push(issue("empty_revision", [claim.id], "最终内容不能为空。"));
    if (claim.section === "skills" && claim.capability?.type === "platform") issues.push(issue("platform_as_skill", [claim.id], "平台名不能作为技能写入。"));
    if (claim.section === "skills" && claim.capability?.type === "company") issues.push(issue("company_as_skill", [claim.id], "公司名不能作为技能写入。"));
    if (claim.section === "skills" && capabilityBlockedFromSkill(claim.capability)) {
      const code = claim.capability?.type === "company" ? "company_as_skill" : "platform_as_skill";
      if (!issues.some((item) => item.code === code && item.claimIds.includes(claim.id))) {
        issues.push(issue(code, [claim.id], "该实体不能作为技能写入。"));
      }
    }
    if (/熟练使用\s*(?:talents?|telent(?:s)?)(?:\s*ai)?\b/i.test(finalText)) {
      issues.push(issue("platform_as_skill", [claim.id], "Talents/示例招聘平台 不得进入熟练度句。"));
    }
    if (/^熟练使用\s*(?:AI|平台|工具|unknown)\b/i.test(finalText)) {
      issues.push(issue("generic_proficiency_sentence", [claim.id], "未知或泛化实体不能直接生成熟练度句。"));
    }
    if (/[的地得]{2,}|(?:进行|完成)(?:进行|完成)/.test(finalText)) {
      issues.push(issue("malformed_chinese_phrase", [claim.id], "最终内容包含异常中文短语。"));
    }
    const originalMetrics = new Set(renderValue(claim.originalValue ?? patch?.before ?? claim.currentText).match(METRIC_PATTERN) ?? []);
    const evidenceText = claim.evidenceRefs.map((ref) => ref.factText).join("\n");
    const unsupportedMetrics = (finalText.match(METRIC_PATTERN) ?? []).filter((metric) =>
      !originalMetrics.has(metric) && !evidenceText.includes(metric)
    );
    if (unsupportedMetrics.length) issues.push(issue("unsupported_metric", [claim.id], "最终内容包含原文和依据均不支持的数字事实。"));
    if (patch?.fieldPath === "name" && claim.section !== "skills") {
      issues.push(issue("identity_field_changed", [claim.id], "岗位定制不能修改身份字段。"));
    }
    if (claim.originalValue !== undefined && claim.originalValueHash !== tailoringValueHash(claim.originalValue)) {
      issues.push(issue("original_snapshot_mismatch", [claim.id], "原文快照哈希不匹配。"));
    }
    if (input.branch && patch && claim.baseRevisionId && claim.originalValueHash) {
      const current = readTailoringTargetValue(input.branch, patch)
        ?? (patch.sectionId === "skills" && patch.fieldPath === "name" && patch.operation === "append" ? "" : undefined);
      if (claim.baseRevisionId !== input.branch.currentRevisionId
        || claim.originalValueHash !== tailoringValueHash(current)
        || tailoringValueHash(patch.before) !== claim.originalValueHash) {
        issues.push(issue("original_snapshot_mismatch", [claim.id], "当前 Revision 已变化，请重新生成建议。"));
      }
    }
  }
  return dedupeIssues(issues);
}

export function readTailoringTargetValue(branch: ResumeBranch, patch: ResumeFieldPatch): ResumeFieldPatch["before"] | undefined {
  const item = branch.structuredContentItems?.find((candidate) => candidate.id === patch.itemId);
  if (!item || item.data.sectionType !== patch.sectionId) return undefined;
  if (patch.fieldPath === "visible" || patch.fieldPath === "order") return item[patch.fieldPath];
  const record = item.data as unknown as Record<string, unknown>;
  const value = record[patch.fieldPath] ?? (patch.fieldPath === "highlights" ? [] : "");
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    || (Array.isArray(value) && value.every((item) => typeof item === "string"))
    ? value as ResumeFieldPatch["before"]
    : undefined;
}

function inferTargetPolicy(claim: TailoringClaim, capability?: CapabilityEntity): TailoringTargetPolicy {
  if (capabilityIsMaterialOnly(capability)) return "material_only";
  if (claim.section === "summary") return "summary_once";
  if (claim.section === "skills") return "skill_once";
  return "specific_item";
}

function mergeClaims(left: TailoringClaim, right: TailoringClaim): TailoringClaim {
  return {
    ...left,
    requirementIds: unique([...(left.requirementIds ?? []), ...(right.requirementIds ?? [])]),
    sourceItemIds: unique([...(left.sourceItemIds ?? []), ...(right.sourceItemIds ?? [])]),
    evidenceRefs: [...left.evidenceRefs, ...right.evidenceRefs].filter((value, index, values) =>
      values.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(value)) === index
    )
  };
}

function sameClaimTarget(left: TailoringClaim, right: TailoringClaim) {
  const a = left.targetPatches?.[0];
  const b = right.targetPatches?.[0];
  return a?.itemId === b?.itemId && a?.fieldPath === b?.fieldPath && a?.targetIndex === b?.targetIndex;
}

function issue(code: TailoringDiffRejectionReason, claimIds: string[], message: string): TailoringQualityIssue {
  return { code, claimIds, message };
}

function dedupeIssues(issues: TailoringQualityIssue[]) {
  const seen = new Set<string>();
  return issues.filter((item) => {
    const key = `${item.code}:${[...item.claimIds].sort().join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function renderValue(value: unknown) {
  return Array.isArray(value) ? value.join("\n") : String(value ?? "");
}

function normalizeSentence(value: string) {
  return value.replace(/\s+/g, "").replace(/[。；;，,！!？?]+$/g, "").toLowerCase();
}

const METRIC_PATTERN = /(?:\d+(?:\.\d+)?%|\d+(?:\.\d+)?x|¥\s*\d+|\$\s*\d+|\d+\s*(?:万|亿|用户|stars?))/gi;
