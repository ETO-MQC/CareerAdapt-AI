import { stableHashText } from "@/services/security/text";
import {
  ResumeCompositionCheckpointSchema,
  ResumeCompositionResultSchema,
  ResumeCompositionTargetContextSchema,
  type ResumeCompositionCheckpoint,
  type ResumeCompositionResult
} from "./contracts";

export type ResumeCompositionSourceFingerprint = {
  branchId: string;
  revisionId: string;
  contentHash: string;
  presentationHash: string;
};

export function createResumeCompositionCheckpoint(input: {
  composition: ResumeCompositionResult;
  source?: ResumeCompositionSourceFingerprint;
  createdAt?: string;
}): ResumeCompositionCheckpoint {
  const composition = ResumeCompositionResultSchema.parse(input.composition);
  if (!composition.writingExecution || !composition.writingOutput) {
    throw new Error("resume_composition_execution_record_missing");
  }
  const targetContext = ResumeCompositionTargetContextSchema.parse({
    ...(composition.targetDirection ? { targetDirection: composition.targetDirection } : {}),
    ...(composition.targetAudience ? { targetAudience: composition.targetAudience } : {}),
    ...(composition.companyType ? { companyType: composition.companyType } : {})
  });
  const evidenceGraphHash = stableHashText(stableSerialize(composition.evidenceGraph));
  const immutableContent = {
    profileId: composition.profileId,
    profileRevision: composition.profileRevision,
    mode: composition.mode,
    jobId: composition.jobId,
    sourceResumeId: composition.sourceResumeId,
    targetContext,
    evidenceGraphHash,
    blueprint: composition.blueprint,
    writingExecution: composition.writingExecution,
    writingOutput: composition.writingOutput,
    reviewResult: composition.reviewResult,
    compositionResult: composition,
    source: input.source
  };
  const contentHash = stableHashText(stableSerialize(immutableContent));
  return ResumeCompositionCheckpointSchema.parse({
    checkpointId: `resume-composition-${contentHash.slice(4, 20)}`,
    profileId: composition.profileId,
    profileRevision: composition.profileRevision,
    mode: composition.mode,
    ...(composition.jobId ? { jobId: composition.jobId } : {}),
    ...(composition.sourceResumeId ? { sourceResumeId: composition.sourceResumeId } : {}),
    targetContext,
    evidenceGraphHash,
    blueprint: composition.blueprint,
    writingExecution: composition.writingExecution,
    writingOutput: composition.writingOutput,
    reviewResult: composition.reviewResult,
    compositionResult: composition,
    createdAt: input.createdAt ?? new Date().toISOString(),
    contentHash,
    ...(input.source ? {
      sourceBranchId: input.source.branchId,
      sourceRevisionId: input.source.revisionId,
      sourceContentHash: input.source.contentHash,
      sourcePresentationHash: input.source.presentationHash
    } : {})
  });
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
}
