import { describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { createJobAdaptationDraft } from "@/domain/adaptation/draft";
import { mapAdaptationDraftToResumeBranch } from "@/domain/branch/mapper";
import { createRuleRequirementMatches } from "@/domain/match/matcher";
import { mapBranchToResumeDocument } from "@/domain/resumeDocument/mapper";
import { ResumePresentationConfigSchema, type BranchFactRef } from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";

const TEST_TIME = "2026-07-03T12:00:00.000Z";

function createVerifiedBranch() {
  const job = demoJobDescriptions[0];
  const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
  const draft = createJobAdaptationDraft({
    profile: demoCareerProfile,
    job,
    matches,
    operationId: "v2-g0a-doc-draft",
    now: TEST_TIME
  });
  return {
    job,
    mapped: mapAdaptationDraftToResumeBranch({
      draft,
      suggestions: [],
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "v2-g0a-doc-branch",
      name: "V2 G0a document branch",
      now: TEST_TIME
    })
  };
}

describe("V2 G0a resume document mapper", () => {
  it("renders only text that matches an explicit resume-only confirmation", () => {
    const { job, mapped } = createVerifiedBranch();
    const sourceItem = mapped.branch.contentItems.find((item) => item.itemType !== "structural")!;
    const text = "用户确认的当前简历内容";
    const confirmedItem = {
      ...sourceItem,
      source: "user_manual" as const,
      text,
      originalText: text,
      factRefs: [],
      userConfirmation: {
        scope: "resume_only" as const,
        confirmedTextHash: stableHashText(text),
        confirmedAt: TEST_TIME
      }
    };
    const confirmedDocument = mapBranchToResumeDocument({
      branch: { ...mapped.branch, contentItems: [confirmedItem] },
      profile: demoCareerProfile,
      job,
      templateId: "classic-technical"
    });
    const mismatchedDocument = mapBranchToResumeDocument({
      branch: { ...mapped.branch, contentItems: [{ ...confirmedItem, text: `${text}（未确认改动）` }] },
      profile: demoCareerProfile,
      job,
      templateId: "classic-technical"
    });

    expect(confirmedDocument.blocks.find((block) => block.contentItemId === confirmedItem.id)?.renderable).toBe(true);
    expect(mismatchedDocument.blocks.find((block) => block.contentItemId === confirmedItem.id)).toMatchObject({
      renderable: false,
      notRenderableReason: "resume_only_confirmation_mismatch"
    });
  });

  it("maps every content item and marks visible, renderable, editable, and guard status separately", () => {
    const { job, mapped } = createVerifiedBranch();
    const hiddenItem = mapped.branch.contentItems[0];
    const invalidItem = mapped.branch.contentItems.find((item) =>
      item.id !== hiddenItem.id && item.itemType !== "structural" && item.factRefs.length > 0
    );
    if (!invalidItem) {
      throw new Error("test fixture requires a factual content item");
    }
    const branch = {
      ...mapped.branch,
      contentItems: mapped.branch.contentItems.map((item) => {
        if (item.id === hiddenItem.id) {
          return { ...item, visible: false };
        }
        if (item.id === invalidItem.id) {
          return {
            ...item,
            factRefs: item.factRefs.map((ref, index) => index === 0 ? makeMissingFactRef(ref) : ref)
          };
        }
        return item;
      })
    };

    const document = mapBranchToResumeDocument({
      branch,
      profile: demoCareerProfile,
      job,
      templateId: "classic-technical"
    });

    const derivedSummary = document.blocks.find((block) => block.derivedFrom === "resumeBasics.summary");
    expect(document.blocks).toHaveLength(branch.contentItems.length + (derivedSummary ? 1 : 0));
    expect(document.blocks.find((block) => block.contentItemId === hiddenItem.id)).toMatchObject({
      visible: false,
      renderable: true,
      editable: true,
      guardStatus: hiddenItem.guardStatus
    });
    expect(document.blocks.find((block) => block.contentItemId === invalidItem.id)).toMatchObject({
      visible: true,
      renderable: false,
      notRenderableReason: "invalid_fact_reference"
    });
  });

  it("marks legacy, archived, invalid_reference, and missing currentRevision branches as not editable", () => {
    const { job, mapped } = createVerifiedBranch();
    const variants = [
      {
        branch: { ...mapped.branch, migrationStatus: "legacy_unverified" as const, requirementMatchIds: [] },
        reason: "legacy_unverified"
      },
      {
        branch: { ...mapped.branch, lifecycleStatus: "archived" as const },
        reason: "archived"
      },
      {
        branch: {
          ...mapped.branch,
          syncStatusCache: {
            ...mapped.branch.syncStatusCache,
            status: "invalid_reference" as const,
            invalidFactRefs: ["missing"],
            message: "invalid"
          }
        },
        reason: "invalid_reference"
      },
      {
        branch: { ...mapped.branch, currentRevisionId: undefined },
        reason: "missing_current_revision"
      }
    ];

    for (const variant of variants) {
      const document = mapBranchToResumeDocument({
        branch: variant.branch,
        profile: demoCareerProfile,
        job,
        templateId: "classic-technical"
      });
      expect(document.editable).toBe(false);
      expect(document.notEditableReason).toBe(variant.reason);
      expect(document.blocks.every((block) => !block.editable)).toBe(true);
    }
  });

  it("derives a basics summary into one editable presentation block and respects hidden state", () => {
    const { job, mapped } = createVerifiedBranch();
    const branch = {
      ...mapped.branch,
      contentItems: mapped.branch.contentItems.filter((item) => item.itemType !== "summary"),
      resumeBasics: {
        name: demoCareerProfile.basics.name,
        email: demoCareerProfile.basics.email ?? "",
        phone: demoCareerProfile.basics.phone ?? "",
        location: demoCareerProfile.basics.location ?? "",
        summary: "来自简历基本信息的自我评价",
        links: demoCareerProfile.basics.links
      }
    };
    const derivedId = `derived-summary:${branch.id}`;
    const document = mapBranchToResumeDocument({
      branch,
      profile: demoCareerProfile,
      job,
      templateId: "classic-technical"
    });
    expect(document.blocks.filter((block) => block.derivedFrom === "resumeBasics.summary")).toHaveLength(1);
    expect(document.blocks.find((block) => block.contentItemId === derivedId)).toMatchObject({
      text: "来自简历基本信息的自我评价",
      editable: true,
      renderable: true,
      visible: true
    });

    const hiddenConfig = ResumePresentationConfigSchema.parse({
      schemaVersion: "resume-presentation-v1",
      branchId: branch.id,
      templateId: "classic-technical",
      contentRevision: { branchRevision: branch.revision, currentRevisionId: branch.currentRevisionId! },
      hiddenItemIds: [derivedId],
      presentationRevision: 1,
      updatedAt: TEST_TIME
    });
    const hiddenDocument = mapBranchToResumeDocument({
      branch,
      profile: demoCareerProfile,
      job,
      templateId: "classic-technical",
      presentationConfig: hiddenConfig
    });
    expect(hiddenDocument.blocks.find((block) => block.contentItemId === derivedId)).toMatchObject({
      presentationHidden: true,
      visible: false
    });
  });
});

function makeMissingFactRef(ref: BranchFactRef): BranchFactRef {
  if (ref.type === "evidence_file") {
    return { ...ref, linkedFactId: "missing-fact" };
  }
  return { ...ref, factId: "missing-fact" };
}
