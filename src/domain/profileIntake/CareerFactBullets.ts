import type { FactMaturity, FactStatement, ResumeItemV2 } from "@/domain/schemas";
import { factMaturityOf } from "@/domain/profile/factMaturity";
import { assessCareerAssetCompleteness } from "./ProfileIntakeCompleteness";
import { stableHashText } from "@/services/security/text";

export type CareerFactBullet = {
  id: string;
  text: string;
  factIds: string[];
  sourceQuotes: string[];
  maturity: FactMaturity;
  evidenceStatus: "confirmed";
};

export type CareerExperienceReview = {
  itemId: string;
  label: string;
  role?: string;
  time?: string;
  reviewState: "ready_for_confirmation" | "needs_more_detail";
  bullets: CareerFactBullet[];
  missingDimensions: string[];
  nextQuestion?: string;
};

/**
 * Turns already-confirmed facts into reviewable bullets without paraphrasing
 * them. This is deliberately a projection: it creates no FactStatement and
 * cannot enter Profile or a ResumeBranch until the existing write contract is
 * explicitly invoked.
 */
export function buildCareerFactBullets(input: {
  item: ResumeItemV2;
  facts: FactStatement[];
  max?: number;
}): CareerFactBullet[] {
  const maximum = Math.max(1, Math.min(4, input.max ?? 4));
  const bullets: CareerFactBullet[] = [];
  for (const fact of input.facts) {
    if (!isConfirmedFact(fact)) continue;
    const sourceQuotes = unique([
      ...fact.provenance.map((source) => source.sourceQuote ?? ""),
      ...fact.provenance.map((source) => source.sourceText)
    ]);
    const segments = splitFactText(fact.statement);
    for (const text of segments) {
      const normalized = normalize(text);
      if (!normalized || bullets.some((bullet) => normalize(bullet.text) === normalized)) continue;
      bullets.push({
        id: `career-fact-bullet-${stableHashText(`${fact.id}:${normalized}`)}`,
        text,
        factIds: [fact.id],
        sourceQuotes,
        maturity: factMaturityOf(fact),
        evidenceStatus: "confirmed"
      });
      if (bullets.length >= maximum) return bullets;
    }
  }
  return bullets;
}

export function buildCareerExperienceReview(input: {
  item: ResumeItemV2;
  facts: FactStatement[];
  sourceEvidence?: string[];
  maxBullets?: number;
}): CareerExperienceReview {
  const bullets = buildCareerFactBullets({ item: input.item, facts: input.facts, max: input.maxBullets });
  const completeness = assessCareerAssetCompleteness(input.item, [
    ...(input.sourceEvidence ?? []),
    ...bullets.map((bullet) => bullet.text)
  ]);
  // A confirmed bullet is enough to show a usable partial review, but a
  // high-value gap should still get one useful follow-up while information
  // gain remains. Optional gaps (for example challenge or collaboration)
  // must not hold the user in intake indefinitely.
  const needsHighValueFollowUp = completeness.missing.length > 0
    && completeness.informationGain > 0
    && completeness.readiness < 1;
  return {
    itemId: input.item.id,
    label: itemLabel(input.item),
    ...itemRoleAndTime(input.item),
    reviewState: bullets.length && !needsHighValueFollowUp ? "ready_for_confirmation" : "needs_more_detail",
    bullets,
    missingDimensions: completeness.missing,
    nextQuestion: completeness.nextQuestion
  };
}

function isConfirmedFact(fact: FactStatement) {
  return fact.confirmedByUser
    && fact.riskLevel !== "high"
    && fact.provenance.some((source) => source.confirmedByUser);
}

function splitFactText(value: string) {
  return value
    .split(/[\r\n。！？!?；;]+/u)
    .map((item) => item.trim().replace(/^[\-•·\s]+/u, ""))
    .filter((item) => item.length >= 6);
}

function itemLabel(item: ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  return [record.title, record.name, record.organization, record.school, record.institution, record.language]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?? item.sectionType;
}

function itemRoleAndTime(item: ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  const role = [record.role, record.authorRole]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const time = [record.startDate, record.endDate, record.awardedAt, record.publishedAt]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" — ") || undefined;
  return { ...(role ? { role } : {}), ...(time ? { time } : {}) };
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/[\s，。；：、,.!！?？]+/gu, "");
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
