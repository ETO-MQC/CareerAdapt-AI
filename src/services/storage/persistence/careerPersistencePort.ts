import type { CareerProfile, JobDescription, ResumeBranch, ResumeBranchOperation, ResumeRevision } from "@/domain/schemas";

/** Internal Repository infrastructure. Never expose this unit of work as a Domain API.
 * One transaction owns the five existing branch-mutation stores. Receipts replay
 * before CAS; Repository validates and increments revision inside this transaction.
 * No externally awaited IO may occur in work. Errors must abort every write.
 */
export interface BranchMutationUnitOfWork {
  findOperation(operationId: string): Promise<ResumeBranchOperation | undefined>;
  readBranch(branchId: string): Promise<ResumeBranch | undefined>;
  readRevision(revisionId: string): Promise<ResumeRevision | undefined>;
  readProfile(profileId: string): Promise<CareerProfile | undefined>;
  readJob(jobId: string): Promise<JobDescription | undefined>;
  saveBranch(branch: ResumeBranch): Promise<void>;
  appendRevision(revision: ResumeRevision): Promise<void>;
  saveOperation(operation: ResumeBranchOperation): Promise<void>;
}

export interface CareerPersistencePort {
  withBranchMutation<T>(work: (unit: BranchMutationUnitOfWork) => Promise<T>): Promise<T>;
}
