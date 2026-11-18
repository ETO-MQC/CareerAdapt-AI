import { z } from "zod";
import type { AgentToolExecutionContext } from "@/agent/contracts/agentTool";
import type { WorkspaceRepository } from "@/services/storage/repositories";
import { isSelectedProfileImpactCurrent } from "./selectedProfileImpact";
import { ProfileImpactProposalSchema } from "@/agent/contracts/profileImpactProposal";
import { tailoringDiffId } from "@/services/jobs/tailoringDiffId";

const SnapshotSchema = z.object({
  binding: z.object({ personId: z.string(), profileId: z.string(), profileRevision: z.number(),
    operationId: z.string(), evidenceFingerprint: z.string() }),
  stale: z.boolean(),
  jobs: z.array(z.object({ jobId: z.string(), jobRevision: z.string(), jobFingerprint: z.string(), title: z.string(), status: z.string(),
    rows: z.array(z.object({ requirementId: z.string(), requirement: z.string(), matchLevel: z.string(), flags: z.array(z.string()),
      missingAspects: z.array(z.string()), evidence: z.array(z.object({ text: z.string(),
        sources: z.array(z.object({ excerpt: z.string() })) })) })) }))
});

/** A report belongs to the current session and is never borrowed from a different conversation. */
export async function readSessionProfileImpact(repository: WorkspaceRepository, context: AgentToolExecutionContext | undefined, jobId?: string) {
  const binding = context?.careerSessionBinding;
  if (!binding) return undefined;
  const session = await repository.getAgentSession(binding.agentSessionId);
  if (!session || session.personId !== binding.personId) return undefined;
  const parsed = SnapshotSchema.safeParse(session.taskState?.knownSlots.profileImpactReport);
  if (!parsed.success) return undefined;
  const report = parsed.data;
  const outcome = session.taskState?.knownSlots.profileIntakeCommitOutcome as { operationId?: unknown; status?: unknown } | undefined;
  if (report.binding.personId !== binding.personId || report.binding.profileId !== binding.profileId
    || outcome?.status !== "COMMITTED_VERIFIED" || outcome.operationId !== report.binding.operationId) return undefined;
  const current = report.binding.profileRevision === binding.profileRevision && await isSelectedProfileImpactCurrent(repository, report);
  const { personId, profileId, profileRevision, evidenceFingerprint } = report.binding;
  const proposal = ProfileImpactProposalSchema.safeParse(session.taskState?.knownSlots.profileImpactProposal);
  const p = proposal.success && proposal.data.sessionId === session.id && proposal.data.status === "pending"
    && proposal.data.profileId === profileId && proposal.data.profileRevision === profileRevision ? proposal.data : undefined;
  const branch = current && p ? await repository.getAvailableResumeBranch(p.branchId) : undefined;
  const review = current && p && branch?.currentRevisionId === p.revisionId ? { proposalId: p.id, suggestions: [
    { index: 1, location: p.sectionType, original: "", proposed: p.body.slice(0, 400), decision: p.addDecision },
    ...p.diffs.slice(0, 29).map((diff, index) => ({ index: index + 2, location: `${diff.target.sectionId}.${diff.target.fieldPath}`,
      original: String(Array.isArray(diff.original) ? diff.original.join("\n") : diff.original).slice(0, 400),
      proposed: String(Array.isArray(diff.value) ? diff.value.join("\n") : diff.value).slice(0, 400),
      decision: p.reviews.find(item => item.diffId === tailoringDiffId(diff))?.decision ?? "pending" }))
  ] } : undefined;
  return {
    sessionId: session.id,
    status: current ? "current" as const : "stale" as const,
    binding: { personId, profileId, profileRevision, evidenceFingerprint },
    ...(review ? { review } : {}),
    recommendedActions: current ? ["核对证据和未满足的岗位要求，再由用户选择是否修改岗位简历。"] : ["资料或岗位已变化，请重新选择岗位并分析。"],
    jobs: current ? report.jobs.filter(job => !jobId || job.jobId === jobId).slice(0, 10).map(job => ({
      jobId: job.jobId, jobRevision: job.jobRevision, jobFingerprint: job.jobFingerprint, title: job.title, status: job.status,
      requirements: job.rows.slice(0, 8).map(row => ({ requirementId: row.requirementId,
        requirement: row.requirement.slice(0, 300), matchLevel: row.matchLevel, flags: row.flags,
        missingAspects: row.missingAspects.slice(0, 4).map(item => item.slice(0, 300)),
        evidence: row.evidence.slice(0, 3).map(item => ({ text: item.text.slice(0, 400),
          sources: item.sources.slice(0, 2).map(source => source.excerpt.slice(0, 400)) })) }))
    })) : []
  };
}
