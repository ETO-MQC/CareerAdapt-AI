import type { CareerProfile, JobDescription } from "@/domain/schemas";
import type { buildProfileReceiptEvidence } from "@/domain/resumeComposition/profileReceiptEvidence";
import { sha256Utf8 } from "@/domain/jobAssets/sha256";
import { stableStringify } from "@/services/export/snapshot";
import { buildProfileCareerIntelligence } from "./careerIntelligence";
import { evaluateRequirementEvidence, recallEvidenceCandidates } from "./v2/evidence";
import { validateJobRequirementGraphV3 } from "./v3/analyze";
import { validateJobRequirementGraphV4 } from "./v4/analyze";

/** Read-only analysis. The caller must obtain selected jobs from an explicit user decision. */
export function analyzeSelectedProfileImpact(input: {
  personId: string;
  operationId: string;
  profile: CareerProfile;
  evidence: ReturnType<typeof buildProfileReceiptEvidence>;
  selectedJobs: JobDescription[];
  analyzedAt: string;
}) {
  const { profile, evidence } = input;
  if (!input.personId || profile.personId !== input.personId || evidence.personId !== input.personId
    || evidence.operationId !== input.operationId || evidence.graph.profileId !== profile.id
    || evidence.graph.profileRevision !== profile.version || !input.operationId) throw new Error("impact_profile_binding_stale");
  if (!input.selectedJobs.length || new Set(input.selectedJobs.map(job => job.id)).size !== input.selectedJobs.length) {
    throw new Error("impact_job_selection_invalid");
  }
  const allowedFacts = new Set(evidence.graph.nodes.filter(node => node.confirmationStatus === "confirmed").flatMap(node => node.factIds));
  const changedFacts = new Set(evidence.changedFactIds);
  const profileFacts = [...profile.experiences.flatMap(experience => experience.facts),
    ...profile.skills.flatMap(skill => skill.fact ? [skill.fact] : []),
    ...profile.certificates.flatMap(certificate => certificate.fact ? [certificate.fact] : [])];
  const changedSources = profileFacts
    .filter(fact => changedFacts.has(fact.id))
    .map(fact => ({ id: fact.id, text: [fact.statement, ...fact.provenance.filter(source => source.confirmedByUser)
      .map(source => source.sourceQuote ?? source.sourceText)].join(" ").toLocaleLowerCase() }));
  const binding = { personId: input.personId, profileId: profile.id, profileRevision: profile.version,
    operationId: input.operationId, evidenceFingerprint: sha256Utf8(stableStringify(evidence.graph)), analyzedAt: input.analyzedAt };
  const jobs = input.selectedJobs.map(job => {
    const graph = job.requirementGraph;
    const jobBinding = { jobId: job.id, jobRevision: job.updatedAt,
      jobFingerprint: sha256Utf8(stableStringify(job)), graphHash: graph?.graphHash ?? null };
    const valid = graph && graph.requirements.length > 0 && (graph.schemaVersion === "job-requirement-graph-v4"
      ? validateJobRequirementGraphV4(graph, job.rawText).valid
      : validateJobRequirementGraphV3(graph).valid
        && graph.requirements.every(row => job.rawText.slice(row.sourceSpan.start, row.sourceSpan.end) === row.sourceSpan.text));
    if (!valid) return { ...jobBinding, title: job.title, status: "NOT_ANALYZED" as const, rows: [] };

    const analysis = buildProfileCareerIntelligence({ profile, job });
    const units = analysis.evidenceUnits.filter(unit => unit.factRefs.length > 0 && unit.factRefs.every(ref =>
      allowedFacts.has(ref.type === "evidence_file" ? ref.linkedFactId : ref.factId)));
    const matrix = evaluateRequirementEvidence({ profile, graph: analysis.graph, evidenceUnits: units,
      recalls: recallEvidenceCandidates({ graph: analysis.graph, evidenceUnits: units }), now: input.analyzedAt });
    const rows = analysis.graph.nodes.map(requirement => {
      const evaluation = matrix.evaluations.find(row => row.requirementId === requirement.id)!;
      const matched = units.filter(unit => evaluation.evidenceUnitIds.includes(unit.id));
      const relevant = matched.filter(unit => unit.factRefs.some(ref => changedFacts.has(ref.type === "evidence_file" ? ref.linkedFactId : ref.factId)));
      const sourced = relevant.some(unit => changedSources.some(source => unit.factRefs.some(ref =>
        (ref.type === "evidence_file" ? ref.linkedFactId : ref.factId) === source.id)
        && unit.text.trim().length > 0 && source.text.includes(unit.text.trim().toLocaleLowerCase())));
      const flags: Array<"NEW_EVIDENCE_RELEVANT" | "REMAINING_GAP" | "REVIEW_REQUIRED"> = [];
      if (sourced && evaluation.matchLevel !== "none") flags.push("NEW_EVIDENCE_RELEVANT");
      if (!["direct", "strong_transferable"].includes(evaluation.matchLevel)) flags.push("REMAINING_GAP");
      if ((relevant.length > 0 && !sourced) || (sourced && ["weak", "needs_confirmation"].includes(evaluation.matchLevel)) || job.analysisStatus === "needs_review"
        || requirement.needsConfirmation || evaluation.matchLevel === "needs_confirmation") flags.push("REVIEW_REQUIRED");
      return { requirementId: requirement.id, requirement: requirement.statement, source: requirement.sourceSpan,
        matchLevel: evaluation.matchLevel, explanation: evaluation.explanation, missingAspects: evaluation.missingAspects,
        evidence: matched.map(unit => ({ text: unit.text, factRefs: unit.factRefs, sourceBlockIds: unit.sourceBlockIds,
          sources: profileFacts.filter(fact => unit.factRefs.some(ref =>
            (ref.type === "evidence_file" ? ref.linkedFactId : ref.factId) === fact.id))
            .flatMap(fact => fact.provenance.filter(source => source.confirmedByUser)
              .map(source => ({ type: source.sourceType, excerpt: source.sourceQuote ?? source.sourceText }))) })), flags };
    });
    return { ...jobBinding, title: job.title, status: "ANALYZED" as const, rows };
  });
  return { binding, jobs };
}
