import { describe, expect, it, vi } from "vitest";
import { classifyTailoringClaim, claimDecisionFor } from "@/domain/jobOptimization/claimGuard";
import { recommendedTailoringIntensity, sectionTailoringPolicy } from "@/domain/jobOptimization/sectionPolicy";
import { applyTailoringPlan, confirmTailoringClaims } from "@/services/jobs/tailoringService";
import type { ResumeTailoringPlan } from "@/domain/schemas";

const NOW = "2026-07-20T08:00:00.000Z";

describe("Claim Guard", () => {
  it("maps the four support levels to stable decisions", () => {
    expect(claimDecisionFor("verified")).toBe("auto_applicable");
    expect(claimDecisionFor("reasonable_inference")).toBe("requires_confirmation");
    expect(claimDecisionFor("user_declared")).toBe("requires_confirmation");
    expect(claimDecisionFor("unsupported_hard_fact")).toBe("blocked");
  });

  it("keeps user-declared skills separate from verified evidence", () => {
    const claim = classifyTailoringClaim({ id: "pytest", section: "skills", proposedText: "了解 pytest", reason: "岗位关键词", declaredByUser: true });
    expect(claim).toMatchObject({ supportLevel: "user_declared", decision: "requires_confirmation", syncScope: "resume_only", confirmed: false });
  });

  it("permanently blocks invented numeric outcomes", () => {
    const claim = classifyTailoringClaim({ id: "number", section: "project", currentText: "优化核心流程", proposedText: "优化核心流程并提升 80%", reason: "增强成果" });
    expect(claim).toMatchObject({ supportLevel: "unsupported_hard_fact", decision: "blocked", syncScope: "rejected" });
  });
});

describe("tailoring intensity and section policy", () => {
  it("uses balanced as the middle recommendation", () => {
    expect(recommendedTailoringIntensity(80)).toBe("conservative");
    expect(recommendedTailoringIntensity(55)).toBe("balanced");
    expect(recommendedTailoringIntensity(20)).toBe("proactive");
  });

  it("never rewrites immutable factual sections", () => {
    for (const section of ["education", "awards", "certificates", "publications", "patents"] as const) {
      expect(sectionTailoringPolicy(section, "proactive")).toMatchObject({ immutableFacts: true, allowsInference: false, allowsUserDeclared: false });
      expect(sectionTailoringPolicy(section, "proactive").allowedActions).toEqual(["show", "hide", "reorder", "format"]);
    }
    expect(sectionTailoringPolicy("skills", "proactive").allowsUserDeclared).toBe(true);
    expect(sectionTailoringPolicy("project", "balanced").allowsInference).toBe(true);
    expect(sectionTailoringPolicy("project", "conservative").allowsInference).toBe(false);
  });
});

describe("tailoring application service", () => {
  const plan: ResumeTailoringPlan = {
    id: "plan-1", branchId: "branch-1", jobId: "job-1", intensity: "balanced", basedOnBranchRevision: 1,
    estimatedFitScore: 68, createdAt: NOW,
    claims: [{ id: "claim-1", section: "skills", currentText: "", proposedText: "了解 pytest", reason: "岗位要求", keywords: ["pytest"], supportLevel: "user_declared", decision: "requires_confirmation", evidenceRefs: [], syncScope: "resume_only", confirmed: false }]
  };

  it("groups confirmation and defaults it to resume-only", async () => {
    const before = await applyTailoringPlan({ plan, operationId: "apply-1", apply: vi.fn() });
    expect(before.status).toBe("needs_confirmation");
    expect(before.confirmationGroups?.[0].defaultSyncScope).toBe("resume_only");

    const confirmed = confirmTailoringClaims({ plan, confirmations: [{ claimId: "claim-1", accepted: true, proficiency: "aware", syncScope: "resume_only" }] });
    const apply = vi.fn().mockResolvedValue({ branchId: "branch-1", revisionId: "revision-2" });
    const result = await applyTailoringPlan({ plan: confirmed.plan!, operationId: "apply-1", apply });
    expect(result).toMatchObject({ status: "completed", resultRefs: { branchId: "branch-1", revisionId: "revision-2", planId: "plan-1" } });
    expect(apply).toHaveBeenCalledOnce();
  });
});
