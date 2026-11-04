import type { CareerProfile, ResumeBranch } from "@/domain/schemas";
import { migrateResumeBranchToV2 } from "@/domain/migrations/resumeV2";

/** Restrict formal facts to the visible items in this exact branch snapshot. */
export function profileLimitedToResume(profile: CareerProfile, branch: ResumeBranch): CareerProfile {
  const refs = branch.profileId === profile.id
    ? migrateResumeBranchToV2(branch).structuredContentItems.filter(item => item.visible).flatMap(item => item.factRefs) : [];
  const linkedFactIds = new Set(refs.flatMap(ref => ref.type === "evidence_file" && profile.evidences.some(evidence => evidence.id === ref.evidenceId) ? [ref.linkedFactId] : []));
  const factIds = new Set(refs.map(ref => ref.type === "evidence_file" ? ref.linkedFactId : ref.factId));
  return { ...profile,
    experiences: profile.experiences.map(item => ({ ...item, facts: item.facts.filter(fact => linkedFactIds.has(fact.id) || refs.some(ref => ref.type === "experience_fact" && ref.experienceId === item.id && ref.factId === fact.id)) })).filter(item => item.facts.length),
    skills: profile.skills.filter(item => item.fact && (linkedFactIds.has(item.fact.id) || refs.some(ref => ref.type === "skill_fact" && ref.skillId === item.id && ref.factId === item.fact!.id))),
    certificates: profile.certificates.filter(item => item.fact && (linkedFactIds.has(item.fact.id) || refs.some(ref => ref.type === "certificate_fact" && ref.certificateId === item.id && ref.factId === item.fact!.id))),
    evidences: profile.evidences.filter(item => refs.some(ref => ref.type === "evidence_file" && ref.evidenceId === item.id)),
    structuredFacts: profile.structuredFacts?.map(item => ({ ...item, factIds: item.factIds.filter(id => factIds.has(id)) })).filter(item => item.factIds.length)
  };
}
