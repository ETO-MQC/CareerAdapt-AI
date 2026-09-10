import type { JobDescription, ResumeItemV2 } from "@/domain/schemas";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { dedupeCareerWriting, isFiller, isRawOrNegativeSpeech, preservesOwnership, semanticComponentCount, writingOverlap } from "@/domain/profileIntake/CareerWritingQuality";
import {
  ResumeCompositionResultSchema,
  ResumeReviewResultSchema,
  type ResumeCompositionResult,
  type ResumeCompositionMetrics,
  type ResumeReviewResult
} from "./contracts";
import { resolveCareerAssetDisplayIdentity } from "./CareerAssetDisplayIdentity";
import { careerResumeQualityWarnings } from "./CareerResumeQualityPolicyV1";

export function reviewResumeComposition(result: ResumeCompositionResult, input: { job?: JobDescription } = {}) {
  const firstPass = reviewResumeCompositionPass(result, input, true);
  if (!firstPass.didRepair) return firstPass.result;
  const repairedPass = reviewResumeCompositionPass(firstPass.result, input, false).result;
  const reviewResult = ResumeReviewResultSchema.parse({
    ...repairedPass.reviewResult,
    status: firstPass.result.reviewResult.status === "NEEDS_REVIEW" || repairedPass.reviewResult.status === "NEEDS_REVIEW"
      ? "NEEDS_REVIEW"
      : "PASS",
    findings: [...new Set([...firstPass.result.reviewResult.findings, ...repairedPass.reviewResult.findings])],
    // Keep the first-pass proposal ledger. A repair pass is an implementation
    // detail; it must not make the original remove/rewrite/shorten proposal
    // disappear before the user can review it.
    diffs: [...new Map([
      ...firstPass.result.reviewResult.diffs,
      ...repairedPass.reviewResult.diffs
    ].map((diff) => [diff.id, diff])).values()]
  });
  return ResumeCompositionResultSchema.parse({
    ...repairedPass,
    reviewResult,
    telemetry: repairedPass.telemetry ? { ...repairedPass.telemetry, reviewStatus: reviewResult.status } : undefined
  });
}

function reviewResumeCompositionPass(result: ResumeCompositionResult, input: { job?: JobDescription }, allowRepair: boolean) {
  const findings: string[] = [];
  let duplicateBullets = 0;
  let fillerBullets = 0;
  let lowDensityBullets = 0;
  let paragraphHeavyItems = 0;
  let revisedBulletCount = 0;
  let bulletRepairCount = 0;
  let bulletRejectedCount = 0;
  const seenBullets: string[] = [];
  const reviewDiffs: ResumeReviewResult["diffs"] = [];

  const items = result.items.map((item) => {
    const data = item.data as unknown as Record<string, unknown>;
    const sourceClaims = item.claimIds.map((id) => result.claims.find((claim) => claim.id === id)).filter((claim): claim is NonNullable<typeof claim> => Boolean(claim));
    let bullets = [
      ...(Array.isArray(data.highlights) ? data.highlights : []),
      ...(Array.isArray(data.outcomes) ? data.outcomes : [])
    ].filter((value): value is string => typeof value === "string");
    const before = bullets.length;
    bullets = dedupeCareerWriting(bullets);
    duplicateBullets += Math.max(0, before - bullets.length);
    if (before > bullets.length) reviewDiffs.push({
      id: `review-diff-${item.sourceAssetId}-deduplicate`,
      kind: "deduplicate",
      itemId: item.sourceAssetId,
      fieldPath: "highlights",
      before: `${before} 条候选 bullet`,
      recommendation: "合并重复或近似重复表述，只保留信息量更高的一条。"
    });
    const candidateBullets = bullets.filter((bullet, bulletIndex) => {
      const filler = isFiller(bullet);
      if (filler) fillerBullets += 1;
      const rawOrNegative = isRawOrNegativeSpeech(bullet);
      if (rawOrNegative) findings.push(`${resolveCareerAssetDisplayIdentity(item.data).label}：移除口语或负向表述`);
      const lowDensity = semanticComponentCount(bullet) < 2;
      if (lowDensity) lowDensityBullets += 1;
      const duplicate = seenBullets.some((candidate) => writingOverlap(candidate, bullet) >= 0.72);
      if (duplicate) duplicateBullets += 1;
      else seenBullets.push(bullet);
      if (filler || rawOrNegative) reviewDiffs.push({
        id: `review-diff-${item.sourceAssetId}-${bulletIndex}-remove`,
        kind: "remove",
        itemId: item.sourceAssetId,
        fieldPath: "highlights",
        before: bullet,
        recommendation: "移除内部草稿、口语或负向说明，不把它带入正式简历。"
      });
      else if (lowDensity) reviewDiffs.push({
        id: `review-diff-${item.sourceAssetId}-${bulletIndex}-shorten`,
        kind: "shorten",
        itemId: item.sourceAssetId,
        fieldPath: "highlights",
        before: bullet,
        recommendation: "补充动作、方法或结果；若没有可确认信息则不要扩写。"
      });
      else if (duplicate) reviewDiffs.push({
        id: `review-diff-${item.sourceAssetId}-${bulletIndex}-duplicate`,
        kind: "deduplicate",
        itemId: item.sourceAssetId,
        fieldPath: "highlights",
        before: bullet,
        recommendation: "与其他条目重复，保留最贴近岗位且证据最强的一条。"
      });
      return !filler && !rawOrNegative && !lowDensity && !duplicate;
    });
    const repairedBullets = candidateBullets.length >= 2 || !allowRepair
      ? candidateBullets
      : repairAffectedBullets({ item, bullets, result, sourceClaims });
    bulletRepairCount += Math.max(0, repairedBullets.length - candidateBullets.length);
    bulletRejectedCount += Math.max(0, bullets.length - repairedBullets.length);
    bullets = dedupeCareerWriting(repairedBullets).filter((bullet) => semanticComponentCount(bullet) >= 2).slice(0, 4);
    revisedBulletCount += bullets.length;
    if (typeof data.description === "string" && data.description.length > 180) paragraphHeavyItems += 1;
    const sourceText = sourceClaims.map((claim) => claim.text).join(" ");
    const displayIdentity = resolveCareerAssetDisplayIdentity(item.data).label;
    if (sourceText && bullets.some((bullet) => !preservesOwnership(sourceText, bullet))) {
      findings.push(`${displayIdentity}：职责表述需要再核对`);
      reviewDiffs.push({
        id: `review-diff-${item.sourceAssetId}-ownership`,
        kind: "verify",
        itemId: item.sourceAssetId,
        fieldPath: "highlights",
        before: bullets.find((bullet) => !preservesOwnership(sourceText, bullet)) ?? sourceText,
        recommendation: "回到来源事实核对参与、协助、负责或主导的边界。"
      });
    }
    if (item.data.sectionType === "project" && typeof data.description === "string" && data.description.trim()) {
      findings.push(`${displayIdentity}：项目段落描述将改为 bullet`);
      reviewDiffs.push({
        id: `review-diff-${item.sourceAssetId}-paragraph`,
        kind: "shorten",
        itemId: item.sourceAssetId,
        fieldPath: "description",
        before: data.description,
        after: bullets.join("\n") || undefined,
        recommendation: "拆成 2–4 条事实 bullet，只保留动作、方法和结果；该段落不会静默消失。"
      });
    }
    if (item.data.sectionType === "project" && typeof data.background === "string" && data.background.trim()) {
      findings.push(`${displayIdentity}：项目背景将从正文移入可审阅 bullet 提案`);
      reviewDiffs.push({
        id: `review-diff-${item.sourceAssetId}-background`,
        kind: "rewrite",
        itemId: item.sourceAssetId,
        fieldPath: "background",
        before: data.background,
        recommendation: "背景字段会被移除；仅保留已有事实 bullet，不新增未经确认的内容。"
      });
    }
    if (item.data.sectionType === "research" && typeof data.description === "string" && data.description.trim()) {
      findings.push(`${displayIdentity}：研究段落描述将改为 bullet`);
      reviewDiffs.push({
        id: `review-diff-${item.sourceAssetId}-research-description`,
        kind: "shorten",
        itemId: item.sourceAssetId,
        fieldPath: "description",
        before: data.description,
        after: bullets.join("\n") || undefined,
        recommendation: "将段落改为可核对的事实 bullet；原段落变化保持在 review ledger 中。"
      });
    }
    return patchBullets(item.data, bullets);
  });

  const projectedLines = items.reduce((sum, item) => sum + itemLineWeight(item), 0);
  const pageOverflow = projectedLines > 31;
  if (pageOverflow) findings.push("estimated one-page budget is exceeded; lower-relevance bullets were trimmed only if a safe reduction was available");
  if (lowDensityBullets) findings.push(`${lowDensityBullets} bullets did not contain enough semantic components and were omitted`);
  const unsupportedClaims = allowRepair ? result.claims.filter((claim) => claim.classification === "UNSUPPORTED").length : 0;
  if (unsupportedClaims) findings.push(`${unsupportedClaims} unsupported claims were held out of the resume`);
  const atsRepair = allowRepair
    ? applySafeAtsRepairs({
      items: result.items.map((item, index) => ({ ...item, data: items[index] })),
      coverage: result.keywordCoverage,
      result,
      reviewDiffs
    })
    : { items: result.items.map((item, index) => ({ ...item, data: items[index] })), repairedCount: 0 };
  if (atsRepair.repairedCount) findings.push(`${atsRepair.repairedCount} evidence-backed ATS keywords proposed for review`);
  const reviewedItems = atsRepair.items.map((item) => item.data);
  const summaryItem = reviewedItems.find((item) => item.sectionType === "summary") as unknown as Record<string, unknown> | undefined;
  const qualityWarnings = careerResumeQualityWarnings({
    summary: typeof summaryItem?.text === "string" ? summaryItem.text : undefined,
    bullets: reviewedItems.flatMap((item) => {
      const record = item as unknown as Record<string, unknown>;
      return [
        ...(Array.isArray(record.highlights) ? record.highlights : []),
        ...(Array.isArray(record.outcomes) ? record.outcomes : [])
      ].filter((value): value is string => typeof value === "string");
    })
  });
  findings.push(...qualityWarnings);
  const baseMetrics = result.metrics;
  const metrics: ResumeCompositionMetrics = {
    ...result.metrics,
    duplicateBullets,
    fillerBullets,
    lowDensityBullets,
    paragraphHeavyItems,
    bulletsGenerated: revisedBulletCount,
    pageOverflow,
    onePageReasonable: !pageOverflow || result.blueprint.pageBudget.estimatedPageCount <= 1.2,
    bulletRepairCount: baseMetrics.bulletRepairCount + bulletRepairCount,
    bulletRejectedCount: baseMetrics.bulletRejectedCount + bulletRejectedCount,
    repairPassCount: baseMetrics.repairPassCount + (bulletRepairCount > 0 ? 1 : 0),
    unsupportedClaimsBlocked: baseMetrics.unsupportedClaimsBlocked + (allowRepair ? unsupportedClaims : 0),
    atsRepairPassCount: baseMetrics.atsRepairPassCount + (allowRepair ? 1 : 0)
  };
  const status = findings.some((finding) => /职责表述|项目段落|项目仍包含|研究段落|ATS keywords|口语|ownership|paragraph|unsupported|density|semantic components|resume_quality|重复/iu.test(finding)) ? "NEEDS_REVIEW" : "PASS";
  const reviewResult = ResumeReviewResultSchema.parse({
    status,
    findings,
    diffs: reviewDiffs,
    atsCoverage: finalKeywordCoverage(result.keywordCoverage, reviewedItems),
    metrics,
    revisedBulletCount: reviewedItems.reduce((sum, item) => sum + bulletCount(item), 0)
  });
  const reviewed = ResumeCompositionResultSchema.parse({
    ...result,
    items: result.items.map((item, index) => ({ ...item, data: reviewedItems[index] })),
    reviewResult,
    metrics,
    telemetry: buildTelemetry({ result, items: reviewedItems, reviewResult, metrics })
  });
  void input;
  return { result: reviewed, didRepair: bulletRepairCount > 0 || atsRepair.repairedCount > 0 };
}

function repairAffectedBullets(input: {
  item: ResumeCompositionResult["items"][number];
  bullets: string[];
  result: ResumeCompositionResult;
  sourceClaims: ResumeCompositionResult["claims"];
}) {
  const asset = input.result.blueprint.assets.find((candidate) => candidate.sourceAssetId === input.item.sourceAssetId);
  if (!asset || !asset.explicitTools.length) return input.bullets.filter((bullet) => semanticComponentCount(bullet) >= 2);
  const safeTool = asset.explicitTools.find((tool) => !/^(?:API|工具|测试|开发)$/iu.test(tool));
  if (!safeTool) return input.bullets.filter((bullet) => semanticComponentCount(bullet) >= 2);
  const repaired = input.bullets.flatMap((bullet) => {
    if (isFiller(bullet) || isRawOrNegativeSpeech(bullet) || semanticComponentCount(bullet) >= 2) return [bullet];
    const sourceText = [
      ...input.sourceClaims.map((claim) => claim.text),
      ...asset.bulletPlan,
      ...asset.explicitTools
    ].join(" ");
    const candidate = `${bullet.replace(/[。；;]+$/u, "")}，使用 ${safeTool}。`;
    const guard = runRuleFactGuard({ originalText: sourceText, checkedText: candidate, usedEvidenceRefs: [] });
    return preservesOwnership(sourceText, candidate) && guard.status === "pass" && semanticComponentCount(candidate) >= 2 ? [candidate] : [];
  });
  return repaired;
}

function finalKeywordCoverage(coverage: ResumeCompositionResult["keywordCoverage"], reviewedData: ResumeCompositionResult["items"][number]["data"][]) {
  const finalText = reviewedData.map((item) => JSON.stringify(item)).join(" ").toLocaleLowerCase();
  return coverage.map((entry) => {
    const present = finalText.includes(entry.keyword.toLocaleLowerCase());
    const finalStatus = entry.status === "SUPPORTED"
      ? present ? "PRESENT" : "MISSING_BUT_SUPPORTED"
      : entry.status === "POTENTIALLY_SUPPORTED"
        ? "ADJACENT_CONFIRMATION_REQUIRED"
        : "CORRECTLY_ABSENT";
    return { ...entry, finalStatus };
  });
}

function applySafeAtsRepairs(input: {
  items: ResumeCompositionResult["items"];
  coverage: ResumeCompositionResult["keywordCoverage"];
  result: ResumeCompositionResult;
  reviewDiffs: ResumeReviewResult["diffs"];
}) {
  let repairedCount = 0;
  const supportedMissing = input.coverage.filter((entry) => entry.status === "SUPPORTED" && entry.sourceAssetIds.length > 0);
  const items = input.items.map((compiledItem) => {
    const item = compiledItem.data;
    if (item.sectionType !== "project") return compiledItem;
    const sourceAssetId = compiledItem.sourceAssetId;
    const candidates = supportedMissing.filter((entry) => entry.sourceAssetIds.includes(sourceAssetId));
    if (!candidates.length) return compiledItem;
    const nodeText = input.result.evidenceGraph.nodes
      .filter((node) => node.sourceAssetIds.includes(sourceAssetId))
      .flatMap((node) => node.sourceExcerpts)
      .join(" ")
      .toLocaleLowerCase();
    const currentTools = item.tools.map((tool) => tool.toLocaleLowerCase());
    const additions = candidates
      .map((entry) => entry.keyword.trim())
      .filter((keyword) => keyword && nodeText.includes(keyword.toLocaleLowerCase()) && !currentTools.includes(keyword.toLocaleLowerCase()))
      .slice(0, 4);
    if (!additions.length) return compiledItem;
    const patched = { ...item, tools: [...item.tools, ...additions] };
    const sourceText = [
      JSON.stringify(item),
      nodeText
    ].join(" ");
    const guard = runRuleFactGuard({ originalText: sourceText, checkedText: JSON.stringify(patched), usedEvidenceRefs: [] });
    if (guard.status !== "pass") return compiledItem;
    repairedCount += additions.length;
    input.reviewDiffs.push({
      id: `review-diff-${sourceAssetId}-ats`,
      kind: "rewrite",
      itemId: sourceAssetId,
      fieldPath: "tools",
      before: item.tools.join(", ") || "（无工具）",
      after: patched.tools.join(", "),
      recommendation: "仅加入证据图中已出现且与岗位相关的关键词；请在确认前核对工具确实被使用。"
    });
    return { ...compiledItem, data: patched };
  });
  return { items, repairedCount };
}

function bulletCount(item: ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  return [
    ...(Array.isArray(record.highlights) ? record.highlights : []),
    ...(Array.isArray(record.outcomes) ? record.outcomes : [])
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).length;
}

function buildTelemetry(input: {
  result: ResumeCompositionResult;
  items: ResumeCompositionResult["items"][number]["data"][];
  reviewResult: ResumeReviewResult;
  metrics: ResumeCompositionMetrics;
}) {
  const coverage = input.reviewResult.atsCoverage;
  return {
    ...(input.result.telemetry ?? {}),
    ...(input.result.writingExecution ? {
      writerMode: input.result.writingExecution.mode,
      writerProvider: input.result.writingExecution.provider,
      writerModel: input.result.writingExecution.model,
      writerLatencyMs: input.result.writingExecution.latencyMs,
      writerFallbackReason: input.result.writingExecution.fallbackReason
    } : {}),
    targetContext: {
      ...(input.result.targetDirection ? { targetDirection: input.result.targetDirection } : {}),
      ...(input.result.targetAudience ? { targetAudience: input.result.targetAudience } : {}),
      ...(input.result.companyType ? { companyType: input.result.companyType } : {})
    },
    selectedAssetCount: input.result.blueprint.assets.length,
    selectedProjectCount: input.items.filter((item) => item.sectionType === "project").length,
    bulletCount: input.items.reduce((sum, item) => sum + bulletCount(item), 0),
    bulletRepairCount: input.metrics.bulletRepairCount,
    bulletRejectedCount: input.metrics.bulletRejectedCount,
    evidenceKeywordSupportedCount: coverage.filter((entry) => entry.status === "SUPPORTED").length,
    evidenceKeywordPotentialCount: coverage.filter((entry) => entry.status === "POTENTIALLY_SUPPORTED").length,
    evidenceKeywordUnsupportedCount: coverage.filter((entry) => entry.status === "UNSUPPORTED").length,
    finalKeywordPresentCount: coverage.filter((entry) => entry.finalStatus === "PRESENT").length,
    finalKeywordMissingSupportedCount: coverage.filter((entry) => entry.finalStatus === "MISSING_BUT_SUPPORTED").length,
    reviewStatus: input.reviewResult.status,
    pageCount: input.metrics.pageOverflow ? Math.max(2, input.result.blueprint.pageBudget.estimatedPageCount) : input.result.blueprint.pageBudget.estimatedPageCount,
    pageCountSource: "blueprint_estimate",
    compressionPassCount: input.metrics.compressionPassCount,
    profileFactsAddedFromTailoring: input.metrics.profileFactsAddedFromTailoring
  };
}

function patchBullets(item: ResumeItemV2, bullets: string[]): ResumeItemV2 {
  if (item.sectionType === "project") return { ...item, description: undefined, background: undefined, highlights: bullets.slice(0, 4), outcomes: [] };
  if (item.sectionType === "research") return { ...item, description: undefined, highlights: bullets.slice(0, 4) };
  if (["education", "work", "internship", "campus", "volunteer"].includes(item.sectionType)) return { ...item, highlights: bullets.slice(0, 4) } as ResumeItemV2;
  return item;
}

function itemLineWeight(item: ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  const bullets = Array.isArray(record.highlights) ? record.highlights.length : 0;
  const title = ["title", "name", "school", "organization", "institution"].some((key) => typeof record[key] === "string" && record[key]) ? 1 : 0.5;
  return title + bullets * 1.6 + (item.sectionType === "skills" ? 0.18 : 0);
}
