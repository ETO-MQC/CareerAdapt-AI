import { describe, expect, it } from "vitest";
import {
  findDuplicateCandidates,
  isValidDuplicateReference,
  requiresDuplicateDecision,
  type DedupExistingPosting
} from "@/domain/jobAssets/jobDeduplication";
import { companyTitleFingerprint, contentFingerprint } from "@/domain/jobAssets/jdNormalization";

function posting(overrides: Partial<DedupExistingPosting> = {}): DedupExistingPosting {
  return {
    id: "posting-1",
    sourceName: "board_a",
    sourceJobId: "job-001",
    title: "Go 工程师",
    companyName: "某公司",
    companyTitleFingerprint: companyTitleFingerprint("Go 工程师", "某公司"),
    contentFingerprint: contentFingerprint("Go 工程师", "某公司", "职责：写 Go"),
    ...overrides
  };
}

const INCOMING = {
  sourceName: "board_a",
  sourceJobId: "job-001",
  title: "Go 工程师",
  companyName: "某公司",
  companyTitleFingerprint: companyTitleFingerprint("Go 工程师", "某公司"),
  contentFingerprint: contentFingerprint("Go 工程师", "某公司", "职责：写 Go")
};

describe("V4-P1 stage 2: three-level deduplication", () => {
  it("matches by source_id first when the source and source job id agree", () => {
    const evaluation = findDuplicateCandidates([posting()], INCOMING);
    expect(evaluation.candidates).toEqual([
      { jobPostingId: "posting-1", rule: "source_id", title: "Go 工程师", companyName: "某公司" }
    ]);
    expect(evaluation.algorithm).toBe("careeradapt-dedup-v1");
  });

  it("falls back to company_title when source ids differ", () => {
    const evaluation = findDuplicateCandidates([
      posting({ sourceJobId: "job-999" })
    ], INCOMING);
    expect(evaluation.candidates[0]?.rule).toBe("company_title");
  });

  it("falls back to content when company/title differ but the body matches", () => {
    const evaluation = findDuplicateCandidates([
      posting({
        sourceJobId: "other",
        title: "Go 高级工程师",
        companyTitleFingerprint: companyTitleFingerprint("Go 高级工程师", "某公司")
      })
    ], INCOMING);
    expect(evaluation.candidates[0]?.rule).toBe("content");
  });

  it("keeps the rule precedence per candidate: source_id beats company_title beats content", () => {
    const evaluation = findDuplicateCandidates([
      posting({ id: "p-source" }),
      posting({ id: "p-title", sourceJobId: "other", companyTitleFingerprint: INCOMING.companyTitleFingerprint }),
      posting({
        id: "p-content",
        sourceJobId: "other",
        companyTitleFingerprint: companyTitleFingerprint("别的", "公司"),
        contentFingerprint: INCOMING.contentFingerprint
      })
    ], INCOMING);
    expect(evaluation.candidates.map((candidate) => [candidate.jobPostingId, candidate.rule]))
      .toEqual([
        ["p-source", "source_id"],
        ["p-title", "company_title"],
        ["p-content", "content"]
      ]);
  });

  it("returns no candidates for genuinely different postings", () => {
    const evaluation = findDuplicateCandidates([
      posting({
        sourceJobId: "other",
        companyTitleFingerprint: companyTitleFingerprint("前端", "别家"),
        contentFingerprint: contentFingerprint("前端", "别家", "写 React")
      })
    ], INCOMING);
    expect(evaluation.candidates).toEqual([]);
    expect(requiresDuplicateDecision(evaluation)).toBe(false);
  });

  it("ignores the same source_job_id from a different source name", () => {
    const evaluation = findDuplicateCandidates([
      posting({ sourceName: "board_b" })
    ], INCOMING);
    expect(evaluation.candidates[0]?.rule).not.toBe("source_id");
  });

  it("treats a missing incoming source job id as no source_id evidence", () => {
    const evaluation = findDuplicateCandidates([posting()], { ...INCOMING, sourceJobId: undefined });
    expect(evaluation.candidates[0]?.rule).toBe("company_title");
  });

  it("requires a user decision whenever any candidate exists and validates references", () => {
    const evaluation = findDuplicateCandidates([posting()], INCOMING);
    expect(requiresDuplicateDecision(evaluation)).toBe(true);
    expect(isValidDuplicateReference(evaluation, "posting-1")).toBe(true);
    expect(isValidDuplicateReference(evaluation, "posting-404")).toBe(false);
  });
});
