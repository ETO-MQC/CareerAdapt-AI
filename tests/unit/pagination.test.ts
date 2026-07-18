import { describe, expect, it } from "vitest";
import { ResumeRenderModelSchema, type ResumePresentationConfig, type ResumeRenderModel } from "@/domain/schemas";
import { coverageCounts, paginatedCoverage } from "@/services/export/renderCoverage";
import {
  createResumePaginationPlan,
  isPaginationPlanBlocked,
  paginateResumeRenderModel
} from "@/services/export/pagination";

const baseConfig: ResumePresentationConfig["pagination"] = {
  pagePolicy: "natural",
  preferredPageCount: 2,
  maximumPageCount: 4,
  overflowBehavior: "warn",
  headerFooter: "none",
  showPhoto: false,
  pageBreakBeforeSections: []
};

describe("P3.8a multi-page pagination planning", () => {
  it("creates a one-page plan by default", () => {
    const plan = createResumePaginationPlan({
      measurement: measurementFixture({ scrollHeight: 900, clientHeight: 1000 }),
      paginationConfig: baseConfig
    });

    expect(plan.pagePolicy).toBe("natural");
    expect(plan.requestedMaxPages).toBe(4);
    expect(plan.actualPageCount).toBe(1);
    expect(plan.status).toBe("fits_one_page");
    expect(isPaginationPlanBlocked(plan)).toBe(false);
  });

  it("allows up-to-two-pages when content crosses one A4 page", () => {
    const plan = createResumePaginationPlan({
      measurement: measurementFixture({ scrollHeight: 1600, clientHeight: 1000 }),
      paginationConfig: baseConfig
    });

    expect(plan.requestedMaxPages).toBe(4);
    expect(plan.actualPageCount).toBe(2);
    expect(plan.status).toBe("fits_two_pages");
    expect(isPaginationPlanBlocked(plan)).toBe(false);
  });

  it("keeps two pages visible when one-page preference is enabled", () => {
    const plan = createResumePaginationPlan({
      measurement: measurementFixture({ scrollHeight: 1600, clientHeight: 1000 }),
      paginationConfig: { ...baseConfig, pagePolicy: "prefer_one_page", preferredPageCount: 1 }
    });

    expect(plan.actualPageCount).toBe(2);
    expect(plan.status).toBe("fits_two_pages");
    expect(isPaginationPlanBlocked(plan)).toBe(false);
  });

  it("supports three and four pages without clipping or blocking", () => {
    const threePagePlan = createResumePaginationPlan({
      measurement: multiPageMeasurement(3),
      paginationConfig: baseConfig
    });
    const plan = createResumePaginationPlan({
      measurement: multiPageMeasurement(4),
      paginationConfig: baseConfig
    });

    expect(threePagePlan.actualPageCount).toBe(3);
    expect(threePagePlan.status).toBe("fits_three_pages");
    expect(plan.actualPageCount).toBe(4);
    expect(plan.status).toBe("fits_four_pages");
    expect(plan.pages.flatMap((page) => page.blockIds)).toHaveLength(4);
    expect(isPaginationPlanBlocked(plan)).toBe(false);
  });

  it("warns above four pages while preserving every page", () => {
    const plan = createResumePaginationPlan({
      measurement: multiPageMeasurement(5),
      paginationConfig: baseConfig
    });

    expect(plan.actualPageCount).toBe(5);
    expect(plan.status).toBe("exceeds_four_pages");
    expect(plan.pages).toHaveLength(5);
    expect(isPaginationPlanBlocked(plan)).toBe(false);
  });

  it("does not impose a hidden technical page cap", () => {
    const plan = createResumePaginationPlan({
      measurement: multiPageMeasurement(25),
      paginationConfig: baseConfig
    });

    expect(plan.actualPageCount).toBe(25);
    expect(plan.pages).toHaveLength(25);
    expect(plan.pages.at(-1)?.blockIds).toEqual(["experience-25"]);
    expect(plan.status).toBe("exceeds_four_pages");
  });

  it("honors section page-break hints without creating a blank first page", () => {
    const plan = createResumePaginationPlan({
      measurement: measurementFixture({ scrollHeight: 900, clientHeight: 1000 }),
      paginationConfig: {
        ...baseConfig,
        pageBreakBeforeSections: ["summary", "experience"]
      }
    });

    expect(plan.forcedBreakBeforeSections).toEqual(["experience"]);
    expect(plan.pages).toHaveLength(2);
    expect(plan.pages[0].blockIds).toEqual(["summary-1"]);
    expect(plan.pages[1].blockIds).toContain("experience-1");
  });

  it("changes pagination hash when manual break config changes", () => {
    const measurement = measurementFixture({ scrollHeight: 900, clientHeight: 1000 });
    const withoutBreak = createResumePaginationPlan({
      measurement,
      paginationConfig: baseConfig
    });
    const withBreak = createResumePaginationPlan({
      measurement,
      paginationConfig: { ...baseConfig, pageBreakBeforeSections: ["experience"] }
    });

    expect(withoutBreak.paginationHash).not.toBe(withBreak.paginationHash);
  });

  it("splits render models by page plan without changing source facts", () => {
    const plan = createResumePaginationPlan({
      measurement: measurementFixture({ scrollHeight: 1600, clientHeight: 1000 }),
      paginationConfig: baseConfig
    });
    const pages = paginateResumeRenderModel(renderModelFixture(), plan);

    expect(pages).toHaveLength(2);
    expect(pages[0].sections.flatMap((section) => section.blocks.map((block) => block.sourceItemId))).toContain("summary-1");
    expect(pages[1].sections.flatMap((section) => section.blocks.map((block) => block.sourceItemId))).toContain("experience-3");
    expect(pages[0].sourceTrace).toEqual(pages[1].sourceTrace);
  });

  it("keeps item heading with the first bullet while later bullets and sections continue", () => {
    const measurement = {
      scrollHeight: 1380,
      clientHeight: 1000,
      sections: [
        measuredSection("project", "project", 680, 1120, ["project-1"]),
        measuredSection("awards", "awards", 1130, 1200, ["award-1"]),
        measuredSection("skills", "skills", 1210, 1280, ["skill-1"]),
        measuredSection("languages", "languages", 1290, 1360, ["language-1"])
      ],
      blocks: [
        {
          sourceItemId: "project-1", sectionType: "project" as const, sectionId: "project", top: 720, bottom: 1110, height: 390,
          units: [
            unit("heading", 720, 760),
            unit("highlight:0", 770, 850),
            unit("highlight:1", 860, 930),
            unit("highlight:2", 940, 1020),
            unit("highlight:3", 1030, 1110)
          ]
        },
        measuredBlock("award-1", "awards", "awards", 1150, 1180, "heading"),
        measuredBlock("skill-1", "skills", "skills", 1230, 1260, "content"),
        measuredBlock("language-1", "languages", "languages", 1310, 1340, "content")
      ]
    };
    const plan = createResumePaginationPlan({ measurement, paginationConfig: baseConfig });
    const pages = paginateResumeRenderModel(fragmentModelFixture(), plan);

    expect(plan.actualPageCount).toBe(2);
    expect(pages).toHaveLength(2);
    if (pages[0].schemaVersion !== "resume-render-v2" || pages[1].schemaVersion !== "resume-render-v2") throw new Error("expected v2 pages");
    const firstProject = pages[0].structuredSections.find((section) => section.sectionType === "project")?.items[0]?.presentation;
    const continuedProject = pages[1].structuredSections.find((section) => section.sectionType === "project")?.items[0]?.presentation;
    expect(firstProject).toMatchObject({ primaryTitle: "Long project", highlights: ["bullet 1", "bullet 2"], fragmentIndex: 0 });
    expect(continuedProject).toMatchObject({ primaryTitle: undefined, highlights: ["bullet 3", "bullet 4"] });
    expect(pages[0].structuredSections.find((section) => section.sectionType === "project")?.showTitle).toBe(true);
    expect(pages[1].structuredSections.find((section) => section.sectionType === "project")?.showTitle).toBe(false);
    expect(coverageCounts(paginatedCoverage(pages))).toMatchObject({ project: 1, awards: 1, skills: 1, languages: 1 });
  });
});

function measuredSection(sectionType: "project" | "awards" | "skills" | "languages", sectionId: string, top: number, bottom: number, blockIds: string[]) {
  return { sectionType, sectionId, top, bottom, height: bottom - top, blockIds };
}

function unit(key: string, top: number, bottom: number) {
  return { key, top, bottom, height: bottom - top };
}

function measuredBlock(sourceItemId: string, sectionType: "awards" | "skills" | "languages", sectionId: string, top: number, bottom: number, key: string) {
  return { sourceItemId, sectionType, sectionId, top, bottom, height: bottom - top, units: [unit(key, top, bottom)] };
}

function fragmentModelFixture(): ResumeRenderModel {
  const items = [
    { sectionType: "project" as const, sectionId: "project", itemId: "project-1", data: { id: "project-1", sectionType: "project" as const, title: "Long project", current: false, tools: [], highlights: ["bullet 1", "bullet 2", "bullet 3", "bullet 4"], outcomes: [], customFields: [] }, presentation: { id: "project-1", sourceItemId: "project-1", sectionType: "project" as const, primaryTitle: "Long project", inlineMeta: [], secondaryMeta: [], highlights: ["bullet 1", "bullet 2", "bullet 3", "bullet 4"], links: [], customRows: [], warnings: [] } },
    { sectionType: "awards" as const, sectionId: "awards", itemId: "award-1", data: { id: "award-1", sectionType: "awards" as const, name: "Award", customFields: [] }, presentation: { id: "award-1", sourceItemId: "award-1", sectionType: "awards" as const, primaryTitle: "Award", inlineMeta: [], secondaryMeta: [], highlights: [], links: [], customRows: [], warnings: [] } },
    { sectionType: "skills" as const, sectionId: "skills", itemId: "skill-1", data: { id: "skill-1", sectionType: "skills" as const, name: "Skill", customFields: [] }, presentation: { id: "skill-1", sourceItemId: "skill-1", sectionType: "skills" as const, primaryTitle: "Skill", inlineMeta: [], secondaryMeta: [], highlights: [], links: [], customRows: [], warnings: [] } },
    { sectionType: "languages" as const, sectionId: "languages", itemId: "language-1", data: { id: "language-1", sectionType: "languages" as const, language: "Language", customFields: [] }, presentation: { id: "language-1", sourceItemId: "language-1", sectionType: "languages" as const, primaryTitle: "Language", inlineMeta: [], secondaryMeta: [], highlights: [], links: [], customRows: [], warnings: [] } }
  ];
  return ResumeRenderModelSchema.parse({
    schemaVersion: "resume-render-v2", branchId: "fragment", branchRevision: 1, branchCurrentRevisionId: "rev", branchName: "fragment",
    jobTitle: "general", company: "general", candidate: { name: "Candidate", contacts: [] }, sections: [],
    structuredSections: items.map((item, order) => ({ sectionId: item.sectionId, sectionType: item.sectionType, title: item.sectionId, order, items: [{ ...item, plainText: item.itemId }] })),
    compatibilityWarnings: [], safety: { ruleOnlyItemIds: [], visibleItemCount: items.length, excludedItemIds: [] },
    sourceTrace: { profileId: "profile", currentRevisionId: "rev", sourceProfileVersion: 1 }
  });
}

function measurementFixture(input: { scrollHeight: number; clientHeight: number }) {
  const lastBlockTop = input.scrollHeight <= input.clientHeight ? 760 : 1060;
  const lastBlockBottom = input.scrollHeight <= input.clientHeight
    ? Math.min(860, input.scrollHeight - 40)
    : Math.max(1260, input.scrollHeight - 40);
  return {
    scrollHeight: input.scrollHeight,
    clientHeight: input.clientHeight,
    sections: [
      {
        sectionType: "summary" as const,
        top: 40,
        bottom: 120,
        height: 80,
        blockIds: ["summary-1"]
      },
      {
        sectionType: "experience" as const,
        top: 140,
        bottom: input.scrollHeight,
        height: input.scrollHeight - 140,
        blockIds: ["experience-1", "experience-2", "experience-3"]
      }
    ],
    blocks: [
      { sourceItemId: "summary-1", sectionType: "summary" as const, top: 60, bottom: 90, height: 30 },
      { sourceItemId: "experience-1", sectionType: "experience" as const, top: 160, bottom: 420, height: 260 },
      { sourceItemId: "experience-2", sectionType: "experience" as const, top: 460, bottom: 820, height: 360 },
      { sourceItemId: "experience-3", sectionType: "experience" as const, top: lastBlockTop, bottom: lastBlockBottom, height: Math.max(1, lastBlockBottom - lastBlockTop) }
    ]
  };
}

function multiPageMeasurement(pageCount: number) {
  const clientHeight = 1000;
  const blocks = Array.from({ length: pageCount }, (_, index) => ({
    sourceItemId: `experience-${index + 1}`,
    sectionType: "experience" as const,
    top: index * clientHeight + 120,
    bottom: index * clientHeight + 720,
    height: 600
  }));
  return {
    scrollHeight: pageCount * clientHeight - 120,
    clientHeight,
    sections: [{
      sectionType: "experience" as const,
      top: 100,
      bottom: pageCount * clientHeight - 120,
      height: pageCount * clientHeight - 220,
      blockIds: blocks.map((block) => block.sourceItemId)
    }],
    blocks
  };
}

function renderModelFixture(): ResumeRenderModel {
  return {
    schemaVersion: "resume-render-v1",
    branchId: "branch",
    branchRevision: 1,
    branchCurrentRevisionId: "revision",
    branchName: "Pagination branch",
    jobTitle: "Data Analyst",
    company: "CareerAdapt",
    candidate: {
      name: "陈同学",
      contacts: ["demo.student@example.com"]
    },
    sections: [
      {
        type: "summary",
        title: "岗位概览",
        blocks: [block("summary-1", "summary")]
      },
      {
        type: "experience",
        title: "项目与经历",
        blocks: [
          block("experience-1", "experience"),
          block("experience-2", "experience"),
          block("experience-3", "experience")
        ]
      }
    ],
    safety: {
      ruleOnlyItemIds: [],
      visibleItemCount: 4,
      excludedItemIds: []
    },
    sourceTrace: {
      profileId: "profile",
      jobId: "job",
      currentRevisionId: "revision",
      sourceProfileVersion: 1,
      sourceJobVersion: "job-v1"
    }
  };
}

function block(sourceItemId: string, itemType: "summary" | "experience") {
  return {
    sourceItemId,
    itemType,
    order: 0,
    text: sourceItemId,
    factRefKeys: ["fact"],
    requirementIds: [],
    guardMode: "rule_verified" as const,
    guardStatus: "pass" as const
  };
}
