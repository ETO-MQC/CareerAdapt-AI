import type { CareerAdaptDb } from "@/services/storage/db";
import type { BranchMutationUnitOfWork, CareerPersistencePort } from "./careerPersistencePort";

/** Uses the existing v11 stores and ambient Dexie transaction. No business rules. */
export class DexieCareerPersistenceAdapter implements CareerPersistencePort {
  constructor(private readonly db: CareerAdaptDb) {}

  withBranchMutation<T>(work: (unit: BranchMutationUnitOfWork) => Promise<T>): Promise<T> {
    return this.db.transaction("rw", this.db.resumeBranches, this.db.resumeRevisions,
      this.db.resumeBranchOperations, this.db.profiles, this.db.jobDescriptions, async () => work({
        findOperation: operationId => this.db.resumeBranchOperations.where("operationId").equals(operationId).first(),
        readBranch: id => this.db.resumeBranches.get(id),
        readRevision: id => this.db.resumeRevisions.get(id),
        readProfile: id => this.db.profiles.get(id),
        readJob: id => this.db.jobDescriptions.get(id),
        saveBranch: async branch => { await this.db.resumeBranches.put(branch); },
        appendRevision: async revision => { await this.db.resumeRevisions.put(revision); },
        saveOperation: async operation => { await this.db.resumeBranchOperations.put(operation); }
      }));
  }
}
