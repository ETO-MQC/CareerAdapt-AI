import { describe, expect, it } from "vitest";
import type { ResumePresentationConfig, ResumeRenderModel } from "@/domain/schemas";
import {
  createResumePaginationPlan,
  isPaginationPlanBlocked,
  paginateResumeRenderModel
} from "@/services/export/pagination";

const baseConfig: ResumePresentationConfig["pagination"] = {
  pagePolicy: "one_page_strict",
  pageBreakBeforeSections: []
};

describe("V2 G3b pagination planning", () => {
  it("creates a one-page plan by default", () => {
    const plan = createResumePaginationPlan({
      measurement: measurementFixture({ scrollHeight: 900, clientHeight: 1000 }),
      paginationConfig: baseConfig
    });

    expect(plan.pagePolicy).toBe("one_page_strict");
    expect(plan.requestedMaxPages).toBe(1);
    expect(plan.actualPageCount).toBe(1);
    expect(plan.status).toBe("fits_one_page");
    expect(isPaginationPlanBlocked(plan)).toBe(false);
  });

  it("allows up-to-two-pages when content crosses one A4 page", () => {
    const plan = createResumePaginationPlan({
      measurement: measurementFixture({ scrollHeight: 1600, clientHeight: 1000 }),
      paginationConfig: { pagePolicy: "up_to_two_pages", pageBreakBeforeSections: [] }
    });

    expect(plan.requestedMaxPages).toBe(2);
    expect(plan.actualPageCount).toBe(2);
    expect(plan.status).toBe("fits_two_pages");
    expect(isPaginationPlanBlocked(plan)).toBe(false);
  });

  it("blocks strict one-page when the same content needs two pages", () => {
    const plan = createResumePaginationPlan({
      measurement: measurementFixture({ scrollHeight: 1600, clientHeight: 1000 }),
      paginationConfig: baseConfig
    });

    expect(plan.actualPageCount).toBe(2);
    expect(plan.status).toBe("fits_two_pages");
    expect(isPaginationPlanBlocked(plan)).toBe(true);
  });

  it("blocks content that exceeds two pages", () => {
    const plan = createResumePaginationPlan({
      measurement: measurementFixture({ scrollHeight: 2600, clientHeight: 1000 }),
      paginationConfig: { pagePolicy: "up_to_two_pages", pageBreakBeforeSections: [] }
    });

    expect(plan.actualPageCount).toBe(3);
    expect(plan.status).toBe("exceeds_two_pages");
    expect(isPaginationPlanBlocked(plan)).toBe(true);
  });

  it("honors section page-break hints without creating a blank first page", () => {
    const plan = createResumePaginationPlan({
      measurement: measurementFixture({ scrollHeight: 900, clientHeight: 1000 }),
      paginationConfig: {
        pagePolicy: "up_to_two_pages",
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
      paginationConfig: { pagePolicy: "up_to_two_pages", pageBreakBeforeSections: [] }
    });
    const withBreak = createResumePaginationPlan({
      measurement,
      paginationConfig: { pagePolicy: "up_to_two_pages", pageBreakBeforeSections: ["experience"] }
    });

    expect(withoutBreak.paginationHash).not.toBe(withBreak.paginationHash);
  });

  it("splits render models by page plan without changing source facts", () => {
    const plan = createResumePaginationPlan({
      measurement: measurementFixture({ scrollHeight: 1600, clientHeight: 1000 }),
      paginationConfig: { pagePolicy: "up_to_two_pages", pageBreakBeforeSections: [] }
    });
    const pages = paginateResumeRenderModel(renderModelFixture(), plan);

    expect(pages).toHaveLength(2);
    expect(pages[0].sections.flatMap((section) => section.blocks.map((block) => block.sourceItemId))).toContain("summary-1");
    expect(pages[1].sections.flatMap((section) => section.blocks.map((block) => block.sourceItemId))).toContain("experience-3");
    expect(pages[0].sourceTrace).toEqual(pages[1].sourceTrace);
  });
});

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
