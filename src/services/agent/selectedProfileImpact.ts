import { recoverProfileIntakeCommit } from "@/agent/runtime/profileIntakeCommitRecovery";
import { analyzeSelectedProfileImpact } from "@/domain/jobOptimization/selectedProfileImpact";
import { buildProfileReceiptEvidence } from "@/domain/resumeComposition/profileReceiptEvidence";
import { sha256Utf8 } from "@/domain/jobAssets/sha256";
import { stableStringify } from "@/services/export/snapshot";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import type { ProfileIntakeOperationRequest, WorkspaceRepository } from "@/services/storage/repositories";

/** Caller must supply only the IDs confirmed by the current user's selection checkpoint. */
export async function analyzeExplicitlySelectedProfileJobs(input: {
  repository: WorkspaceRepository;
  request: ProfileIntakeOperationRequest & { personId: string };
  selectedJobIds: string[];
  analyzedAt: string;
}) {
  const { repository, request, selectedJobIds } = input;
  if (!selectedJobIds.length || new Set(selectedJobIds).size !== selectedJobIds.length) throw new Error("impact_job_selection_invalid");
  const context = await repository.getActiveCareerContext();
  if (!context || context.personId !== request.personId || context.profileId !== request.targetProfileId) {
    throw new Error("impact_active_person_changed");
  }
  const recovered = await recoverProfileIntakeCommit(repository, request);
  if (recovered.status !== "COMMITTED_VERIFIED" || !recovered.evidence) throw new Error("impact_receipt_unverified");
  const profile = await repository.getAvailableProfile(request.targetProfileId);
  if (!profile || profile.personId !== request.personId || profile.version !== recovered.receipt.profileVersion) {
    throw new Error("impact_profile_binding_stale");
  }
  const evidence = buildProfileReceiptEvidence({ personId: request.personId, operationId: request.operationId,
    profile, receipt: recovered.receipt });
  const jobs = await Promise.all(selectedJobIds.map(id => repository.getAvailableJobDescription(id)));
  if (jobs.some(job => !job)) throw new Error("impact_selected_job_unavailable");
  const selectedJobs = jobs.filter((job): job is NonNullable<typeof job> => Boolean(job));
  const result = analyzeSelectedProfileImpact({ personId: request.personId, operationId: request.operationId,
    profile, evidence, selectedJobs, analyzedAt: input.analyzedAt });
  const confirmed = new Set(evidence.graph.nodes.filter(node => node.confirmationStatus === "confirmed").flatMap(node => node.factIds));
  const changedItems = new Set(recovered.receipt.committedItems.map(item => item.id));
  const changes = canonicalProfileLibraryItems(profile).filter(item => changedItems.has(item.id)
    && item.factIds.length > 0 && item.factIds.every(id => confirmed.has(id)))
    .map(item => ({ id: item.id, sectionType: item.sectionType, title: item.title, subtitle: item.subtitle, body: item.body, factIds: item.factIds }));
  const [latestContext, latestProfile, ...latestJobs] = await Promise.all([
    repository.getActiveCareerContext(), repository.getAvailableProfile(profile.id),
    ...selectedJobIds.map(id => repository.getAvailableJobDescription(id))
  ]);
  const stale = !latestContext || latestContext.personId !== request.personId || latestContext.profileId !== profile.id
    || !latestProfile || latestProfile.version !== profile.version
    || sha256Utf8(stableStringify(latestProfile)) !== sha256Utf8(stableStringify(profile))
    || latestJobs.some((job, index) => !job || sha256Utf8(stableStringify(job)) !== result.jobs[index].jobFingerprint);
  return { ...result, changes, stale };
}

export type SelectedProfileImpact = Awaited<ReturnType<typeof analyzeExplicitlySelectedProfileJobs>>;

/** Recheck a saved report before showing it or using it for another action. */
export async function isSelectedProfileImpactCurrent(repository: WorkspaceRepository, report: {
  binding: { personId: string; profileId: string; profileRevision: number; evidenceFingerprint: string };
  jobs: Array<{ jobId: string; jobFingerprint: string }>;
  stale: boolean;
}) {
  const snapshot = await repository.getActiveCareerSnapshotReadOnly();
  if (!snapshot || snapshot.context.personId !== report.binding.personId || snapshot.context.profileId !== report.binding.profileId) return false;
  const profile = snapshot.profile;
  if (profile.personId !== report.binding.personId || profile.version !== report.binding.profileRevision) return false;
  const { buildResumeEvidenceGraph } = await import("@/domain/resumeComposition/ResumeEvidenceGraph");
  if (sha256Utf8(stableStringify(buildResumeEvidenceGraph({ profile }))) !== report.binding.evidenceFingerprint) return false;
  const jobs = await Promise.all(report.jobs.map(job => repository.getAvailableJobDescription(job.jobId)));
  return !report.stale && jobs.every((job, index) => job && sha256Utf8(stableStringify(job)) === report.jobs[index].jobFingerprint);
}
