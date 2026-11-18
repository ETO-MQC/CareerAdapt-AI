import type { CareerProfile } from "@/domain/schemas";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import { stableStringify } from "@/services/export/snapshot";
import { buildResumeEvidenceGraph } from "./ResumeEvidenceGraph";

/** The receipt must come from the repository's verified receipt lookup. */
export function buildProfileReceiptEvidence(input: {
  personId: string;
  operationId: string;
  profile: CareerProfile;
  receipt: {
    operationId: string;
    personId: string;
    profileId: string;
    profileVersion: number;
    committedItems: Array<{ id: string; content: string }>;
    committedFacts: Array<{ id: string; content: string }>;
  };
}) {
  const { personId, operationId, profile, receipt } = input;
  if (profile.personId !== personId || receipt.personId !== personId || receipt.profileId !== profile.id
    || receipt.profileVersion !== profile.version || !operationId || receipt.operationId !== operationId) {
    throw new Error("profile_receipt_binding_stale");
  }

  const items = new Map(canonicalProfileLibraryItems(profile).map(item => [item.id, stableStringify(item)]));
  const facts = new Map(profile.experiences.flatMap(experience => experience.facts)
    .map(fact => [fact.id, stableStringify(fact)]));
  if (receipt.committedItems.some(item => items.get(item.id) !== item.content)
    || receipt.committedFacts.some(fact => facts.get(fact.id) !== fact.content)) {
    throw new Error("profile_receipt_content_stale");
  }
  const changedFactIds = new Set(receipt.committedFacts.map(fact => fact.id));
  const graph = buildResumeEvidenceGraph({ profile });
  return {
    personId,
    operationId,
    graph,
    changedFactIds: [...changedFactIds].filter(id => graph.nodes.some(node => node.confirmationStatus === "confirmed" && node.factIds.includes(id))),
    changedNodes: graph.nodes.filter(node => node.confirmationStatus === "confirmed"
      && node.factIds.some(id => changedFactIds.has(id)))
  };
}
