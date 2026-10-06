import { describe, expect, it } from "vitest";
import {
  FACT_PROPOSAL_DEFAULT_TTL_DAYS,
  FactProposalSchema,
  confirmFactProposal,
  createFactProposal,
  factProposalExpired,
  factProposalRenderable,
  type FactProposal
} from "@/domain/factProposal";

const NOW = "2026-10-06T00:00:00.000Z";

function provenance() {
  return [{
    sourceType: "ai_suggestion" as const,
    sourceId: "job-analysis:job-1",
    sourceText: "JD 要求 3 年以上 Go 后端经验",
    confidence: 0.9,
    confirmedByUser: false,
    riskLevel: "low" as const,
    createdAt: NOW
  }];
}

function validProposal(overrides: Partial<FactProposal> = {}): FactProposal {
  return FactProposalSchema.parse(proposalInput(overrides));
}

function proposalInput(overrides: Partial<FactProposal> = {}): FactProposal {
  return {
    id: "proposal_1",
    createdAt: NOW,
    updatedAt: NOW,
    schemaVersion: "fact-proposal-v1",
    proposalType: "missing_skill",
    question: "你是否有生产环境 Go 服务经验？",
    relatedRequirementId: "req-go-3y",
    candidateAnswer: "有，两年半生产环境经验",
    userConfirmed: false,
    provenance: provenance(),
    scope: "job_specific",
    expiresAt: "2026-11-05T00:00:00.000Z",
    ...overrides
  };
}

describe("V4-P1 prerequisite: Fact Proposal expiresAt semantics", () => {
  it("creates a proposal with the default 30-day TTL when no expiry is given", () => {
    const proposal = createFactProposal({
      id: "proposal_1",
      proposalType: "missing_skill",
      question: "你是否有生产环境 Go 服务经验？",
      relatedRequirementId: "req-go-3y",
      provenance: provenance(),
      scope: "job_specific"
    }, { now: NOW });

    expect(proposal.userConfirmed).toBe(false);
    expect(new Date(proposal.expiresAt).getTime() - new Date(proposal.createdAt).getTime())
      .toBe(FACT_PROPOSAL_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000);
    expect(FactProposalSchema.safeParse(proposal).success).toBe(true);
  });

  it("rejects constructing a proposal without an expiry window", () => {
    const expiredAtCreation = proposalInput({ expiresAt: NOW });
    expect(FactProposalSchema.safeParse(expiredAtCreation).success).toBe(false);

    const beforeCreation = proposalInput({ createdAt: "2026-12-01T00:00:00.000Z" });
    expect(FactProposalSchema.safeParse(beforeCreation).success).toBe(false);
  });

  it("requires gap proposals to reference a requirement and clarification proposals not to", () => {
    const gapWithoutRequirement = proposalInput({ relatedRequirementId: undefined });
    expect(FactProposalSchema.safeParse(gapWithoutRequirement).success).toBe(false);

    const clarificationWithRequirement = proposalInput({
      proposalType: "clarification",
      relatedRequirementId: "req-go-3y"
    });
    expect(FactProposalSchema.safeParse(clarificationWithRequirement).success).toBe(false);

    const clarification = proposalInput({ proposalType: "clarification", relatedRequirementId: undefined });
    expect(FactProposalSchema.safeParse(clarification).success).toBe(true);
  });

  it("reports expiry as a pure time comparison at and after the boundary", () => {
    const proposal = validProposal();
    expect(factProposalExpired(proposal, "2026-11-04T23:59:59.999Z")).toBe(false);
    expect(factProposalExpired(proposal, "2026-11-05T00:00:00.000Z")).toBe(true);
    expect(factProposalExpired(proposal, "2027-01-01T00:00:00.000Z")).toBe(true);
  });

  it("confirms an unconfirmed, unexpired proposal with an answer", () => {
    const proposal = validProposal({ candidateAnswer: "" });
    const result = confirmFactProposal(proposal, { at: "2026-10-07T00:00:00.000Z", answer: "有三年经验" });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.proposal.userConfirmed).toBe(true);
      expect(result.proposal.candidateAnswer).toBe("有三年经验");
      expect(result.proposal.id).toBe(proposal.id);
    }
  });

  it("refuses to confirm expired proposals even with an answer", () => {
    const proposal = validProposal();
    const result = confirmFactProposal(proposal, { at: "2026-11-05T00:00:00.000Z", answer: "有" });
    expect(result).toMatchObject({ ok: false, code: "fact_proposal_expired" });
  });

  it("refuses double confirmation and answerless confirmation", () => {
    const confirmed = validProposal({ userConfirmed: true });
    expect(confirmFactProposal(confirmed, { at: NOW, answer: "x" }))
      .toMatchObject({ ok: false, code: "fact_proposal_already_confirmed" });

    const answerless = validProposal({ candidateAnswer: "" });
    expect(confirmFactProposal(answerless, { at: NOW }))
      .toMatchObject({ ok: false, code: "fact_proposal_answer_required" });
  });

  it("keeps unconfirmed or expired proposals out of preview eligibility", () => {
    const unconfirmed = validProposal();
    expect(factProposalRenderable(unconfirmed, NOW)).toBe(false);

    const confirmed = confirmFactProposal(unconfirmed, { at: NOW, answer: "有" });
    if (!confirmed.ok) throw new Error("expected confirmation to succeed");
    expect(factProposalRenderable(confirmed.proposal, NOW)).toBe(true);
    expect(factProposalRenderable(confirmed.proposal, "2026-12-01T00:00:00.000Z")).toBe(false);
  });

  it("rejects a confirmed proposal without a carried answer (schema invariant)", () => {
    const invalid = proposalInput({ userConfirmed: true, candidateAnswer: "   " });
    expect(FactProposalSchema.safeParse(invalid).success).toBe(false);
  });
});
