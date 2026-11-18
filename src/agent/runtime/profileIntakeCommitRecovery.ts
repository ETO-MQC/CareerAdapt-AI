import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import { stableStringify } from "@/services/export/snapshot";
import type { ProfileIntakeOperationRequest, WorkspaceRepository } from "@/services/storage/repositories";
import { buildProfileReceiptEvidence } from "@/domain/resumeComposition/profileReceiptEvidence";

/** Read-only recovery: a missing receipt is not proof that a write did not commit. */
export async function recoverProfileIntakeCommit(
  repository: WorkspaceRepository,
  request: ProfileIntakeOperationRequest & { personId: string }
) {
  let receipt: Awaited<ReturnType<WorkspaceRepository["getProfileIntakeOperationReceipt"]>>;
  try {
    receipt = await repository.getProfileIntakeOperationReceipt(request);
  } catch (error) {
    if (error instanceof Error && error.message === "profile_intake_operation_receipt_unverifiable") {
      return { status: "LEGACY_UNVERIFIABLE" as const };
    }
    return { status: "UNKNOWN" as const, receiptQuerySucceeded: false as const };
  }
  if (!receipt) return { status: "UNKNOWN" as const, receiptQuerySucceeded: true as const };
  try {
    const profile = await repository.getProfile(receipt.profileId);
    if (!profile || profile.id !== receipt.profileId || profile.personId !== receipt.personId
      || profile.version !== receipt.profileVersion) {
      return { status: "COMMITTED_READBACK_UNVERIFIED" as const, receipt };
    }
    const items = new Map(canonicalProfileLibraryItems(profile).map((item) => [item.id, stableStringify(item)]));
    const facts = new Map(profile.experiences.flatMap((experience) => experience.facts)
      .map((fact) => [fact.id, stableStringify(fact)]));
    if (!receipt.committedItems.length || receipt.committedItems.some((item) => items.get(item.id) !== item.content)
      || receipt.committedFacts.some((fact) => facts.get(fact.id) !== fact.content)) {
      return { status: "COMMITTED_READBACK_UNVERIFIED" as const, receipt };
    }
    try {
      const evidence = buildProfileReceiptEvidence({ personId: request.personId, operationId: request.operationId, profile, receipt });
      return { status: "COMMITTED_VERIFIED" as const, receipt, evidence };
    } catch (error) {
      return { status: "COMMITTED_VERIFIED" as const, receipt,
        evidenceError: error instanceof Error ? error.message : "profile_evidence_build_failed" };
    }
  } catch {
    return { status: "COMMITTED_READBACK_UNVERIFIED" as const, receipt };
  }
}
