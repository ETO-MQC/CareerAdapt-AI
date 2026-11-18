import { describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import { buildProfileReceiptEvidence } from "@/domain/resumeComposition/profileReceiptEvidence";
import { buildResumeEvidenceGraph } from "@/domain/resumeComposition/ResumeEvidenceGraph";
import { stableStringify } from "@/services/export/snapshot";

function fixture() {
  const profile = migrateCareerProfileToV2({ ...structuredClone(demoCareerProfile), personId: "person-test" });
  const graph = buildResumeEvidenceGraph({ profile });
  const fact = profile.experiences.flatMap(experience => experience.facts)
    .find(candidate => graph.nodes.some(node => node.factIds.includes(candidate.id)))!;
  const receipt = { operationId: "operation-test", personId: "person-test", profileId: profile.id, profileVersion: profile.version,
    committedItems: [], committedFacts: [{ id: fact.id, content: stableStringify(fact) }] };
  return { personId: "person-test", operationId: "operation-test", profile, receipt, fact };
}

describe("receipt-bound profile evidence", () => {
  it("selects confirmed graph nodes tied to the actual committed fact", () => {
    const input = fixture();
    const result = buildProfileReceiptEvidence(input);
    expect(result.changedNodes.length).toBeGreaterThan(0);
    expect(result.changedNodes.every(node => node.confirmationStatus === "confirmed" && node.factIds.includes(input.fact.id))).toBe(true);
  });

  it("rejects stale versions, different persons and altered receipt content", () => {
    const input = fixture();
    expect(() => buildProfileReceiptEvidence({ ...input, personId: "another" })).toThrow("profile_receipt_binding_stale");
    expect(() => buildProfileReceiptEvidence({ ...input, operationId: "another" })).toThrow("profile_receipt_binding_stale");
    expect(() => buildProfileReceiptEvidence({ ...input, profile: { ...input.profile, version: input.profile.version + 1 } })).toThrow("profile_receipt_binding_stale");
    expect(() => buildProfileReceiptEvidence({ ...input, receipt: { ...input.receipt, committedFacts: [{ id: input.fact.id, content: "{}" }] } })).toThrow("profile_receipt_content_stale");
  });

  it("does not promote an unconfirmed fact to evidence", () => {
    const input = fixture();
    input.fact.confirmedByUser = false;
    input.receipt.committedFacts[0].content = stableStringify(input.fact);
    expect(buildProfileReceiptEvidence(input).changedNodes).toEqual([]);
  });
});
