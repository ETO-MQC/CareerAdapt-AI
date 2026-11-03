import { describe, expect, it } from "vitest";
import { compileResumeComposition } from "@/domain/resumeComposition/ResumeWriter";
import { reviewResumeComposition } from "@/domain/resumeComposition/ResumeReviewer";
import { corpusBullets, corpusProfile } from "../fixtures/p48cCorpus";

describe("SQ13-B1 source contract v1 (independent of frozen p48c)", () => {
  it("keeps strong infra text without proposals when its original provenance supports it", () => {
    const result = compileResumeComposition({ profile: corpusProfile([corpusBullets.infra]), mode: "general" });
    expect(result.reviewResult.diffs).toEqual([]);
    expect(result.items.flatMap(({ data }) => data.sectionType === "project" ? data.highlights : [])).toContain(corpusBullets.infra);
  });

  it("retains a strong but source-mismatched candidate and requires verification, not a quality rewrite", () => {
    const draft = compileResumeComposition({ profile: corpusProfile([corpusBullets.backend]), mode: "general" });
    const item = draft.items.find(({ data }) => data.sectionType === "project")!;
    if (item.data.sectionType === "project") item.data.highlights = [corpusBullets.infra];
    const source = draft.evidenceGraph.nodes.find((node) => node.id === `asset:${item.sourceAssetId}`)!;
    expect(source.sourceExcerpts).toEqual([corpusBullets.backend]);
    const result = reviewResumeComposition(draft);
    expect(result.reviewResult.diffs.some((diff) => diff.kind === "verify" && diff.before === corpusBullets.infra)).toBe(true);
    expect(result.reviewResult.diffs.some((diff) => diff.kind === "rewrite")).toBe(false);
    expect(result.items.flatMap(({ data }) => data.sectionType === "project" ? data.highlights : [])).toContain(corpusBullets.infra);
    expect(source.sourceExcerpts).toEqual([corpusBullets.backend]);
  });
});
