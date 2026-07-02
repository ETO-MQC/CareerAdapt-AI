import { nanoid } from "nanoid";
import {
  ResumeBranchSnapshotSchema,
  ResumeRevisionSchema,
  type ResumeBranch,
  type ResumeBranchSnapshot,
  type ResumeRevision,
  type ResumeRevisionSource
} from "@/domain/schemas";

export function createBranchSnapshot(branch: Pick<ResumeBranch, "name" | "lifecycleStatus" | "contentItems">): ResumeBranchSnapshot {
  return ResumeBranchSnapshotSchema.parse({
    name: branch.name,
    lifecycleStatus: branch.lifecycleStatus,
    contentItems: branch.contentItems
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
    contentItems: input.snapshot.contentItems,
    revision: input.revision,
    currentRevisionId: input.currentRevisionId,
    updatedAt: now
  };
}
