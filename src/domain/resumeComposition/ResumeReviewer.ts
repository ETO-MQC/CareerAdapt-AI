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

export function reviewResumeComposition(result: ResumeCompositionResult, input: { job?: JobDescription } = {}) {
  const firstPass = reviewResumeCompositionPass(result, input, true);
  if (!firstPass.didRepair) return firstPass.result;
  return reviewResumeCompositionPass(firstPass.result, input, false).result;
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
    const candidateBullets = bullets.filter((bullet) => {
      const filler = isFiller(bullet);
      if (filler) fillerBullets += 1;
      const rawOrNegative = isRawOrNegativeSpeech(bullet);
      if (rawOrNegative) findings.push(`${resolveCareerAssetDisplayIdentity(item.data).label}：移除口语或负向表述`);
      const lowDensity = semanticComponentCount(bullet) < 2;
      if (lowDensity) lowDensityBullets += 1;
      const duplicate = seenBullets.some((candidate) => writingOverlap(candidate, bullet) >= 0.72);
      if (duplicate) duplicateBullets += 1;
      else seenBullets.push(bullet);
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
    if (sourceText && bullets.some((bullet) => !preservesOwnership(sourceText, bullet))) findings.push(`${displayIdentity}：职责表述需要再核对`);
    if (item.data.sectionType === "project" && typeof data.description === "string" && data.description.trim()) findings.push(`${displayIdentity}：项目仍包含较长段落描述`);
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
      result
    })
    : { items: result.items.map((item, index) => ({ ...item, data: items[index] })), repairedCount: 0 };
  const reviewedItems = atsRepair.items.map((item) => item.data);
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
  const status = findings.some((finding) => /职责表述|项目仍包含|口语|ownership|paragraph|unsupported|density|semantic components/iu.test(finding)) ? "NEEDS_REVIEW" : "PASS";
  const reviewResult = ResumeReviewResultSchema.parse({
    status,
    findings,
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
