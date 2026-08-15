export type ResumeRepositoryMutationType = "created" | "updated" | "archived" | "deleted";

export type ResumeRepositoryMutation = {
  type: ResumeRepositoryMutationType;
  profileId: string;
  branchId: string;
  revisionId?: string;
  operationId?: string;
};

type ResumeRepositoryMutationListener = (event: ResumeRepositoryMutation) => void;

const listeners = new Set<ResumeRepositoryMutationListener>();

export function subscribeResumeRepositoryMutation(listener: ResumeRepositoryMutationListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitResumeRepositoryMutation(event: ResumeRepositoryMutation) {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // A UI subscriber must never change the outcome of a committed write.
    }
  }
}
