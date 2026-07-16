import { describe, expect, it } from "vitest";
import {
  isResumeDiagnosticSnapshotStale,
  runResumeDiagnostics,
  type ResumeDiagnosticsInput
} from "@/domain/resumeDiagnostics";
import {
  ExportRecordSchema,
  JobDescriptionSchema,
  type BranchContentItem,
  type RequirementBlockMatch,
  type ResumePaginationPlan,
  type ResumePresentationConfig,
  type ResumeRenderModel
} from "@/domain/schemas";

const TEST_TIME = "2026-07-06T00:00:00.000Z";

describe("V2-G5b resume diagnostics", () => {
  it("creates stable snapshots and invalidates them when presentation changes", () => {
    const input = diagnosticsFixture();
    const first = runResumeDiagnostics(input);
    const second = runResumeDiagnostics(input);

    expect(first.snapshotKey).toBe(second.snapshotKey);
    expect(first.diagnosticHash).toBe(second.diagnosticHash);
    expect(isResumeDiagnosticSnapshotStale({
      snapshot: first,
      branchRevision: input.branchRevision,
      currentRevisionId: input.currentRevisionId,
      presentationRevision: input.presentationConfig.presentationRevision + 1,
      templateId: input.presentationConfig.templateId,
      pagePolicy: input.presentationConfig.pagination.pagePolicy,
      paginationHash: input.paginationPlan?.paginationHash,
      requirementsHash: input.requirementsHash
    })).toBe(true);
  });

  it("diagnoses requirement coverage, fact gaps, and hidden strong evidence without creating ATS pass claims", () => {
    const snapshot = runResumeDiagnostics(diagnosticsFixture());
    const codes = snapshot.issues.map((issue) => issue.code);

    expect(codes).toContain("REQUIRED_REQUIREMENT_NOT_COVERED");
    expect(codes).toContain("REQUIREMENT_FACT_GAP");
    expect(codes).toContain("REQUIREMENT_ONLY_HIDDEN_EVIDENCE");
    expect(codes).toContain("HIDDEN_STRONG_MATCH_ATS_RISK");
    expect(snapshot.summary.requirementCoverage.totalRequirements).toBe(2);
    expect(snapshot.summary.requirementCoverage.covered).toBe(1);
    expect(snapshot.summary.requirementCoverage.uncovered).toBe(1);
    expect(JSON.stringify(snapshot)).not.toMatch(/通过率|录用概率|面试概率|保证通过|ATS评分/);
  });

  it("diagnoses layout, pagination, template fit, and only offers presentation-safe actions", () => {
    const snapshot = runResumeDiagnostics(diagnosticsFixture({
      pagePolicy: "natural",
      actualPageCount: 5
    }));
    const codes = snapshot.issues.map((issue) => issue.code);
    const safeActionKinds = snapshot.issues.flatMap((issue) =>
      issue.recommendedActions.filter((action) => action.safeAutoApply).map((action) => action.kind)
    );

    expect(codes).toContain("EXCEEDS_RECOMMENDED_PAGE_COUNT");
    expect(codes).toContain("SMALL_AND_TIGHT_READABILITY_RISK");
    expect(codes).toContain("TWO_COLUMN_ATS_STRUCTURE_RISK");
    expect(codes).toContain("TEMPLATE_ROLE_FIT_RECOMMENDATION");
    expect(snapshot.summary.exportHardBlocked).toBe(false);
    expect(safeActionKinds).toEqual(expect.arrayContaining([
      "set_density",
      "set_line_height",
      "switch_template",
      "show_block"
    ]));
    expect(safeActionKinds).not.toContain("open_content_editor");
  });

  it("keeps diagnostic export summary optional and compatible with old ExportRecord parsing", () => {
    const baseRecord = {
      id: "export-g5b",
      operationId: "export-g5b",
      branchId: "branch-g5b",
      revisionId: "revision-g5b",
      branchRevision: 1,
      templateId: "ats-minimal",
      format: "pdf",
      fileName: "CareerAdapt_Resume_20260706.pdf",
      displayName: "CareerAdapt_Resume_20260706.pdf",
      exportStatus: "direct_pdf_success",
      overflowStatus: "fits_one_page",
      exportedAt: TEST_TIME,
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };

    expect(ExportRecordSchema.parse(baseRecord).diagnosticsSnapshotHash).toBeUndefined();
    expect(ExportRecordSchema.parse({
      ...baseRecord,
      diagnosticsEngineVersion: "resume-diagnostics.v1",
      diagnosticsSnapshotHash: "diagnostic-hash-g5b",
      criticalIssueCount: 1,
      warningIssueCount: 2,
      requirementCoverageSummary: {
        totalRequirements: 2,
        covered: 1,
        partial: 0,
        weak: 0,
        uncovered: 1,
        factGaps: 1
      }
    }).warningIssueCount).toBe(2);
  });
});

function diagnosticsFixture(options: {
  pagePolicy?: ResumePresentationConfig["pagination"]["pagePolicy"];
  actualPageCount?: number;
} = {}): ResumeDiagnosticsInput {
  const pagePolicy = options.pagePolicy ?? "one_page_strict";
  const actualPageCount = options.actualPageCount ?? 1;
  const items = branchItems();
  const presentationConfig = presentationFixture(pagePolicy);
  return {
    branchId: "branch-g5b",
    branchRevision: 1,
    currentRevisionId: "revision-g5b",
    branchContentItems: items,
    renderModel: renderModelFixture(),
    presentationConfig,
    template: {
      id: "modern-operations",
      version: 1,
      category: "modern",
      layout: "two-column",
      atsLevel: "medium",
      suitableRoles: ["运营", "产品"],
      tags: ["现代", "双栏"],
      capabilities: {
        supportsDensity: true,
        supportsBodyScale: true,
        supportsHeadingScale: true,
        supportsLineHeight: true,
        supportsSectionGap: true,
        supportsItemGap: true,
        supportsTwoPages: true,
        supportsSectionPageBreaks: true,
        supportsSectionTitleVisibility: true
      }
    },
    job: jobFixture(),
    requirementMatches: [],
    requirementBlockMatches: blockMatchesFixture(),
    requirementsHash: "requirements-hash-g5b",
    paginationPlan: paginationPlanFixture({ pagePolicy, actualPageCount }),
    paginationMeasurement: {
      scrollHeight: actualPageCount > 1 ? 1400 : 920,
      clientHeight: 1000,
      sections: [
        { sectionType: "summary", top: 40, bottom: 120, height: 80, blockIds: ["summary-1"] },
        { sectionType: "experience", top: 140, bottom: 920, height: 780, blockIds: ["exp-1", "exp-2"] }
      ],
      blocks: [
        { sourceItemId: "summary-1", sectionType: "summary", top: 60, bottom: 100, height: 40 },
        { sourceItemId: "exp-1", sectionType: "experience", top: 160, bottom: 520, height: 360 },
        { sourceItemId: "exp-2", sectionType: "experience", top: 540, bottom: 920, height: 380, horizontalOverflow: true }
      ]
    },
    now: TEST_TIME
  };
}

function branchItems(): BranchContentItem[] {
  return [
    item("summary-1", "summary", "Data analyst focused on reporting automation and business dashboards."),
    item("exp-1", "experience", "Built weekly SQL reports for operation teams and maintained Tableau dashboards for sales review."),
    item("exp-2", "experience", "Long URL evidence https://example.com/really/really/really/really/long-path-used-in-project-review")
  ];
}

function item(id: string, itemType: BranchContentItem["itemType"], text: string): BranchContentItem {
  return {
    id,
    itemType,
    source: "resume_import",
    text,
    originalText: text,
    order: id === "summary-1" ? 0 : id === "exp-1" ? 1 : 2,
    visible: true,
    requirementIds: [],
    sourceSuggestionIds: [],
    factRefs: [{
      type: "experience_fact",
      experienceId: "exp-fact",
      factId: `fact-${id}`
    }],
    guardMode: "rule_verified",
    guardStatus: "pass",
    guardRiskLevel: "low",
    guardFindings: []
  };
}

function jobFixture() {
  return JobDescriptionSchema.parse({
    id: "job-g5b",
    title: "Data Analyst",
    company: "ACME",
    rawText: "Must build SQL reports. Must have Salesforce CRM experience.",
    source: "manual",
    requirements: [
      {
        id: "req-sql",
        category: "required_skill",
        description: "Build SQL reports.",
        priority: "high",
        hardConstraint: true,
        sourceSpan: { start: 0, end: 17, text: "Build SQL reports" },
        keywords: ["SQL", "reports"],
        confidence: 0.95,
        createdAt: TEST_TIME,
        updatedAt: TEST_TIME
      },
      {
        id: "req-salesforce",
        category: "required_skill",
        description: "Use Salesforce CRM.",
        priority: "high",
        hardConstraint: true,
        sourceSpan: { start: 18, end: 38, text: "Salesforce CRM" },
        keywords: ["Salesforce", "CRM"],
        confidence: 0.9,
        createdAt: TEST_TIME,
        updatedAt: TEST_TIME
      }
    ],
    createdAt: TEST_TIME,
    updatedAt: TEST_TIME
  });
}

function blockMatchesFixture(): RequirementBlockMatch[] {
  return [
    {
      id: "rbm-req-sql-exp-1",
      jobId: "job-g5b",
      branchId: "branch-g5b",
      branchRevision: 1,
      currentRevisionId: "revision-g5b",
      requirementsHash: "requirements-hash-g5b",
      requirementId: "req-sql",
      contentItemId: "exp-1",
      matchLevel: "strong",
      evidenceRefs: [{
        type: "experience_fact",
        experienceId: "exp-fact",
        factId: "fact-exp-1",
        factQuote: "Built weekly SQL reports",
        factText: "Built weekly SQL reports for operation teams"
      }],
      evidenceFactIds: ["fact-exp-1"],
      evidenceQuotes: ["Built weekly SQL reports"],
      reason: "Strong SQL reporting evidence.",
      source: "deterministic",
      isStale: false,
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    },
    {
      id: "rbm-req-salesforce-none",
      jobId: "job-g5b",
      branchId: "branch-g5b",
      branchRevision: 1,
      currentRevisionId: "revision-g5b",
      requirementsHash: "requirements-hash-g5b",
      requirementId: "req-salesforce",
      matchLevel: "none",
      evidenceRefs: [],
      evidenceFactIds: [],
      evidenceQuotes: [],
      reason: "No supporting fact.",
      source: "deterministic",
      isStale: false,
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    }
  ];
}

function presentationFixture(pagePolicy: ResumePresentationConfig["pagination"]["pagePolicy"]): ResumePresentationConfig {
  return {
    schemaVersion: "resume-presentation-v1",
    branchId: "branch-g5b",
    templateId: "modern-operations",
    contentRevision: {
      branchRevision: 1,
      currentRevisionId: "revision-g5b"
    },
    sectionOrder: ["summary", "skills", "experience", "certificates"],
    itemOrderBySection: {
      summary: ["summary-1"],
      skills: [],
      experience: ["exp-1", "exp-2"],
      certificates: []
    },
    hiddenItemIds: ["exp-1"],
    typography: {
      chineseFont: "system_sans",
      englishFont: "system_sans",
      bodyTextScale: "small",
      titleTextScale: "small",
      lineHeight: "tight"
    },
    spacing: {
      pageMargin: "normal",
      sectionGap: "tight",
      itemGap: "tight"
    },
    theme: {
      primaryColor: "emerald",
      accentColor: "emerald",
      dividerColor: "graphite",
      density: "spacious"
    },
    pagination: {
      pagePolicy,
      preferredPageCount: 2,
      maximumPageCount: 4,
      overflowBehavior: "warn",
      headerFooter: "none",
      showPhoto: false,
      pageBreakBeforeSections: []
    },
    sectionStyleOverrides: {
      summary: { showTitle: false },
      experience: { showTitle: false }
    },
    presentationRevision: 1,
    updatedAt: TEST_TIME
  };
}

function renderModelFixture(): ResumeRenderModel {
  return {
    schemaVersion: "resume-render-v1",
    branchId: "branch-g5b",
    branchRevision: 1,
    branchCurrentRevisionId: "revision-g5b",
    branchName: "G5b Branch",
    jobTitle: "Data Analyst",
    company: "ACME",
    candidate: {
      name: "Alex Chen",
      contacts: ["alex@example.com"]
    },
    sections: [
      {
        type: "summary",
        title: "岗位概览",
        blocks: [{
          sourceItemId: "summary-1",
          itemType: "summary",
          order: 0,
          text: "Data analyst focused on reporting automation and business dashboards.",
          factRefKeys: ["fact-summary"],
          requirementIds: [],
          guardMode: "rule_verified",
          guardStatus: "pass"
        }]
      },
      {
        type: "experience",
        title: "项目与经历",
        blocks: [{
          sourceItemId: "exp-2",
          itemType: "experience",
          order: 1,
          text: "Long URL evidence https://example.com/really/really/really/really/long-path-used-in-project-review",
          factRefKeys: ["fact-exp-2"],
          requirementIds: [],
          guardMode: "rule_verified",
          guardStatus: "pass"
        }]
      }
    ],
    safety: {
      ruleOnlyItemIds: [],
      visibleItemCount: 2,
      excludedItemIds: ["exp-1"]
    },
    sourceTrace: {
      profileId: "profile-g5b",
      jobId: "job-g5b",
      currentRevisionId: "revision-g5b",
      sourceProfileVersion: 1,
      sourceJobVersion: TEST_TIME
    }
  };
}

function paginationPlanFixture(input: {
  pagePolicy: ResumePresentationConfig["pagination"]["pagePolicy"];
  actualPageCount: number;
}): ResumePaginationPlan {
  return {
    schemaVersion: "resume-pagination-v1",
    pagePolicy: input.pagePolicy,
    requestedMaxPages: 4,
    preferredPageCount: 2,
    maximumPageCount: 4,
    overflowBehavior: "warn",
    actualPageCount: input.actualPageCount,
    status: input.actualPageCount === 1
      ? "near_one_page_limit"
      : input.actualPageCount === 2
        ? "fits_two_pages"
        : input.actualPageCount === 3
          ? "fits_three_pages"
          : input.actualPageCount === 4
            ? "fits_four_pages"
            : "exceeds_four_pages",
    pages: input.actualPageCount === 1
      ? [{
        pageNumber: 1,
        sectionTypes: ["summary", "experience"],
        itemIdsBySection: { summary: ["summary-1"], experience: ["exp-2"] },
        blockIds: ["summary-1", "exp-2"]
      }]
      : [
        {
          pageNumber: 1,
          sectionTypes: ["summary"],
          itemIdsBySection: { summary: ["summary-1"] },
          blockIds: ["summary-1"]
        },
        {
          pageNumber: 2,
          sectionTypes: ["experience"],
          itemIdsBySection: { experience: ["exp-2"] },
          blockIds: ["exp-2"]
        }
      ],
    forcedBreakBeforeSections: [],
    overflowBlockIds: [],
    oversizedBlockIds: [],
    measurement: {
      scrollHeight: input.actualPageCount > 1 ? 1400 : 980,
      clientHeight: 1000,
      remainingPx: input.actualPageCount > 1 ? -400 : 20
    },
    paginationHash: `pagination-hash-${input.pagePolicy}-${input.actualPageCount}`
  };
}
