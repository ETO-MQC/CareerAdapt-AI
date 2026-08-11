import type { JobDescription, ResumeItemV2 } from "@/domain/schemas";
import { dedupeCareerWriting, isFiller, isRawOrNegativeSpeech, preservesOwnership, semanticComponentCount, writingOverlap } from "@/domain/profileIntake/CareerWritingQuality";
import {
  ResumeCompositionResultSchema,
  ResumeReviewResultSchema,
  type ResumeCompositionResult,
  type ResumeCompositionMetrics
} from "./contracts";
import { resolveCareerAssetDisplayIdentity } from "./CareerAssetDisplayIdentity";

export function reviewResumeComposition(result: ResumeCompositionResult, input: { job?: JobDescription } = {}) {
  const findings: string[] = [];
  let duplicateBullets = 0;
  let fillerBullets = 0;
  let lowDensityBullets = 0;
  let paragraphHeavyItems = 0;
  let revisedBulletCount = 0;
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
    bullets = bullets.filter((bullet) => {
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
  const unsupportedClaims = result.claims.filter((claim) => claim.classification === "UNSUPPORTED").length;
  if (unsupportedClaims) findings.push(`${unsupportedClaims} unsupported claims were held out of the resume`);
  const metrics: ResumeCompositionMetrics = {
    ...result.metrics,
    duplicateBullets,
    fillerBullets,
    lowDensityBullets,
    paragraphHeavyItems,
    bulletsGenerated: revisedBulletCount,
    pageOverflow,
    onePageReasonable: !pageOverflow || result.blueprint.pageBudget.estimatedPageCount <= 1.2
  };
  const status = findings.some((finding) => /职责表述|项目仍包含|口语|ownership|paragraph|unsupported|density|semantic components/iu.test(finding)) ? "NEEDS_REVIEW" : "PASS";
  const reviewResult = ResumeReviewResultSchema.parse({
    status,
    findings,
    atsCoverage: result.keywordCoverage,
    metrics,
    revisedBulletCount
  });
  const reviewed = ResumeCompositionResultSchema.parse({
    ...result,
    items: result.items.map((item, index) => ({ ...item, data: items[index] })),
    reviewResult,
    metrics
  });
  void input;
  return reviewed;
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
