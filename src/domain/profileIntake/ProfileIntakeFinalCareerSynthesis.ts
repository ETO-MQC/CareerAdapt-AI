import { z } from "zod";
import { ResumeItemV2Schema } from "@/domain/schemas/resumeV2";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import type { ImportedResumeDraft } from "@/domain/schemas/resumeImport";
import type { ProfileIntakeSourceTurn } from "./ProfileIntakeSourceTurn";
import {
  ProfileIntakeFinalSynthesisAssetSchema,
  ProfileIntakeFinalSynthesisSchema,
  type ProfileIntakeFinalSynthesis,
  type ProfileIntakeFinalSynthesisAsset
} from "./ProfileIntakeFinalSynthesis";
import { dedupeCareerWriting, preservesOwnership } from "./CareerWritingQuality";

export const ProfileIntakeFinalCareerSynthesisInputSchema = z.object({
  sourceTurns: z.array(z.object({
    turnId: z.string().min(1),
    exactSourceText: z.string().min(1).max(24_000),
    candidateIds: z.array(z.string().min(1)).max(40).default([])
  }).strict()).max(40),
  assets: z.array(ProfileIntakeFinalSynthesisAssetSchema).max(40)
}).strict();

export const ProfileIntakeFinalCareerSynthesisAssetSchema = z.object({
  candidateId: z.string().min(1),
  structuredItem: ResumeItemV2Schema,
  careerReadySummary: z.string().min(1).max(1_600),
  careerReadyHighlights: z.array(z.string().min(1).max(800)).max(4).default([]),
  missingDimensions: z.array(z.string().min(1)).max(24).default([]),
  conflicts: z.array(z.string().min(1)).max(24).default([])
}).strict();

export const ProfileIntakeFinalCareerSynthesisOutputSchema = z.object({
  assets: z.array(ProfileIntakeFinalCareerSynthesisAssetSchema).max(40)
}).strict();

export type ProfileIntakeFinalCareerSynthesisInput = z.infer<typeof ProfileIntakeFinalCareerSynthesisInputSchema>;
export type ProfileIntakeFinalCareerSynthesisOutput = z.infer<typeof ProfileIntakeFinalCareerSynthesisOutputSchema>;

export function buildProfileIntakeFinalCareerSynthesisInput(input: {
  draft: ImportedResumeDraft;
  synthesis: ProfileIntakeFinalSynthesis;
  sourceTurns: ProfileIntakeSourceTurn[];
}): ProfileIntakeFinalCareerSynthesisInput {
  const activeCandidateIds = new Set(input.synthesis.assets.flatMap((asset) => asset.sourceCandidateIds));
  return ProfileIntakeFinalCareerSynthesisInputSchema.parse({
    sourceTurns: input.sourceTurns
      .filter((turn) => turn.processingStatus !== "superseded")
      .map((turn) => ({
        turnId: turn.turnId,
        exactSourceText: turn.exactSourceText,
        candidateIds: turn.candidateIds.filter((id) => activeCandidateIds.has(id))
      })),
    assets: input.synthesis.assets
  });
}

/**
 * Merge the typed writing pass back into the deterministic synthesis.  The
 * deterministic structured item, source IDs, missing dimensions and conflict
 * fields remain authoritative.  AI wording is accepted per bullet only after
 * a local fact guard and source-overlap check; invalid bullets are quarantined
 * and replaced with grounded deterministic text.
 */
export function applyProfileIntakeFinalCareerSynthesis(input: {
  draft: ImportedResumeDraft;
  synthesis: ProfileIntakeFinalSynthesis;
  output: ProfileIntakeFinalCareerSynthesisOutput;
}): { draft: ImportedResumeDraft; synthesis: ProfileIntakeFinalSynthesis } {
  const outputByCandidate = new Map(input.output.assets.map((asset) => [asset.candidateId, asset]));
  const nextAssets = input.synthesis.assets.map((asset) => {
    const generated = outputByCandidate.get(asset.candidateId);
    const sourceText = sourceTextForAsset(input.draft, asset);
    const fallback = fallbackCareerWriting(asset, sourceText);
    if (!generated) return {
      ...asset,
      careerReadySummary: fallback.summary,
      careerReadyHighlights: fallback.highlights
    };
    const acceptedHighlights = dedupeCareerWriting(generated.careerReadyHighlights)
      .filter((highlight) => isGroundedCareerText(highlight, sourceText))
      .slice(0, 4);
    const unsupportedClaimCount = generated.careerReadyHighlights.length - acceptedHighlights.length
      + (isGroundedCareerText(generated.careerReadySummary, sourceText) ? 0 : 1);
    const highlights = ensureCareerHighlights(acceptedHighlights, fallback.highlights, sourceText);
    const summary = isGroundedCareerText(generated.careerReadySummary, sourceText)
      ? generated.careerReadySummary
      : fallback.summary;
    return {
      ...asset,
      // AI cannot alter identity, schema fields, provenance or deterministic
      // completeness.  It only supplies career-ready wording.
      careerReadySummary: summary,
      careerReadyHighlights: highlights,
      qualityGate: {
        ...asset.qualityGate,
        unsupportedClaimCount
      }
    };
  });
  const synthesis = ProfileIntakeFinalSynthesisSchema.parse({
    ...input.synthesis,
    assets: nextAssets
  });
  const summaryByCandidate = new Map(synthesis.assets.map((asset) => [asset.candidateId, asset.careerReadySummary]));
  const draft = {
    ...input.draft,
    sections: input.draft.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => summaryByCandidate.has(item.id)
        ? { ...item, normalizedText: summaryByCandidate.get(item.id)! }
        : item)
    }))
  } as ImportedResumeDraft;
  return { draft, synthesis };
}

function sourceTextForAsset(draft: ImportedResumeDraft, asset: ProfileIntakeFinalSynthesisAsset) {
  const sourceCandidateIds = new Set(asset.sourceCandidateIds);
  const source = draft.sections.flatMap((section) => section.items)
    .filter((item) => sourceCandidateIds.has(item.id))
    .flatMap((item) => [item.rawText, item.sourceQuote ?? "", ...(item.conversationEvidence?.map((evidence) => evidence.sourceQuote) ?? [])]);
  return source.filter(Boolean).join("\n");
}

function fallbackCareerWriting(asset: ProfileIntakeFinalSynthesisAsset, sourceText: string) {
  const structured = asset.structuredItem as unknown as Record<string, unknown>;
  const identity = [
    structured.title,
    structured.name,
    structured.organization,
    structured.institution,
    structured.school,
    structured.role
  ].find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const summary = [identity, ...asset.highlights].filter(Boolean).join("：")
    || sourceText.split(/[\n。；;]+/u).map((value) => value.trim()).find(Boolean)
    || "待整理经历";
  return {
    summary,
    highlights: ensureCareerHighlights(asset.highlights, [], sourceText)
  };
}

function ensureCareerHighlights(primary: string[], fallback: string[], sourceText: string) {
  const values = dedupeCareerWriting([...primary, ...fallback, ...sourceText.split(/[\n。；;]+/u)])
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => isGroundedCareerText(value, sourceText));
  return values.slice(0, 4);
}

function isGroundedCareerText(text: string, source: string) {
  if (!text.trim() || !source.trim()) return false;
  const factGuard = runRuleFactGuard({ originalText: source, checkedText: text, usedEvidenceRefs: [] });
  if (factGuard.status === "blocked_high_risk" || factGuard.status === "needs_edit") return false;
  if (!preservesOwnership(source, text)) return false;
  const terms = factTerms(text);
  if (!terms.length) return false;
  const normalizedSource = source.toLocaleLowerCase().replace(/\s+/gu, "");
  return terms.some((term) => normalizedSource.includes(term.toLocaleLowerCase().replace(/\s+/gu, "")));
}

function factTerms(text: string) {
  return (text.match(/[A-Za-z][A-Za-z0-9+#.-]{2,}|[\u4e00-\u9fff]{2,8}/gu) ?? [])
    .filter((term, index, all) => all.indexOf(term) === index)
    .slice(0, 20);
}
