export type ReconciliationCandidate = {
  key: string;
  value: string;
  sourceId: string;
  evidenceIds: string[];
};

export type ReconciliationResult = {
  kind: "exact_duplicate" | "near_duplicate" | "additive_fact" | "conflict";
  incoming: ReconciliationCandidate;
  existing?: ReconciliationCandidate;
  similarity: number;
  requiresConfirmation: boolean;
};

export function reconcileAuthoritativeFact(
  incoming: ReconciliationCandidate,
  existing: ReconciliationCandidate[]
): ReconciliationResult {
  const sameKey = existing.filter((candidate) => candidate.key === incoming.key);
  const ranked = sameKey
    .map((candidate) => ({ candidate, similarity: similarity(candidate.value, incoming.value) }))
    .sort((left, right) => right.similarity - left.similarity);
  const closest = ranked[0];
  if (!closest) return { kind: "additive_fact", incoming, similarity: 0, requiresConfirmation: true };
  if (closest.similarity === 1) {
    return { kind: "exact_duplicate", incoming, existing: closest.candidate, similarity: 1, requiresConfirmation: false };
  }
  if (closest.similarity >= 0.82) {
    return { kind: "near_duplicate", incoming, existing: closest.candidate, similarity: closest.similarity, requiresConfirmation: true };
  }
  return { kind: "conflict", incoming, existing: closest.candidate, similarity: closest.similarity, requiresConfirmation: true };
}

export type GeneratedPdfQualityInput = {
  resumeId: string;
  revisionId: string;
  jobId?: string;
  pdfBytes: Uint8Array;
};

export type GeneratedPdfQualityResult = {
  visualQuality: "pass" | "warning" | "fail";
  extractedText: string;
  atsParseable: boolean;
  requirementKeywordCoverage: number;
  factGuardPassed: boolean;
  issues: string[];
};

export interface GeneratedPdfQualityAdapter {
  verify(input: GeneratedPdfQualityInput, signal?: AbortSignal): Promise<GeneratedPdfQualityResult>;
}

export type RelevanceWeightedContent = {
  id: string;
  jobRequirementRelevance: number;
  evidenceStrength: number;
  uniqueness: number;
  narrativeImportance: number;
  redundancy: number;
  pageCost: number;
};

export function scorePageContent(item: RelevanceWeightedContent) {
  return round(
    item.jobRequirementRelevance * 0.32
    + item.evidenceStrength * 0.27
    + item.uniqueness * 0.16
    + item.narrativeImportance * 0.2
    - item.redundancy * 0.18
    - item.pageCost * 0.17
  );
}

function similarity(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return 1;
  const aTerms = new Set(a.split(" ").filter(Boolean));
  const bTerms = new Set(b.split(" ").filter(Boolean));
  const intersection = [...aTerms].filter((term) => bTerms.has(term)).length;
  const union = new Set([...aTerms, ...bTerms]).size;
  return union ? round(intersection / union) : 0;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, " ").trim();
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
