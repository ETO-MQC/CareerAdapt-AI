import { nanoid } from "nanoid";
import {
  ResumeBranchSnapshotSchema,
  ResumeRevisionSchema,
  type ResumeBranch,
  type ResumeBranchSnapshot,
  type ResumeRevision,
  type ResumeRevisionSource
} from "@/domain/schemas";

export function createBranchSnapshot(branch: Pick<ResumeBranch, "name" | "lifecycleStatus" | "resumeBasics" | "contentItems" | "structuredContentItems">): ResumeBranchSnapshot {
  return ResumeBranchSnapshotSchema.parse({
    name: branch.name,
    lifecycleStatus: branch.lifecycleStatus,
    resumeBasics: branch.resumeBasics,
    contentItems: branch.contentItems,
    structuredContentItems: branch.structuredContentItems
  });
}

export function createResumeRevision(input: {
  branch: ResumeBranch;
  source: ResumeRevisionSource;
  operationId: string;
  previousRevisionId?: string;
  restoredFromRevisionId?: string;
  now?: string;
}): ResumeRevision {
  const now = input.now ?? new Date().toISOString();
  return ResumeRevisionSchema.parse({
    id: `resume-revision-${nanoid(10)}`,
    branchId: input.branch.id,
    revisionNumber: input.branch.revision,
    source: input.source,
    operationId: input.operationId,
    previousRevisionId: input.previousRevisionId,
    restoredFromRevisionId: input.restoredFromRevisionId,
    snapshot: createBranchSnapshot(input.branch),
    createdAt: now,
    updatedAt: now
  });
}

export function applySnapshotToBranch(input: {
  branch: ResumeBranch;
  snapshot: ResumeBranchSnapshot;
  revision: number;
  currentRevisionId?: string;
  now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  return {
    ...input.branch,
    name: input.snapshot.name,
    lifecycleStatus: input.snapshot.lifecycleStatus,
    resumeBasics: input.snapshot.resumeBasics,
    contentItems: input.snapshot.contentItems,
    structuredContentItems: input.snapshot.structuredContentItems,
    revision: input.revision,
    currentRevisionId: input.currentRevisionId,
    updatedAt: now
  };
}
