import { describe, expect, it } from "vitest";
import { resolveTailoringEntityReference } from "@/agent/runtime/tailoringContextResolver";

const jobs = [
  { id: "job-a", title: "Android研发实习生", company: "智乐活", order: 1 },
  { id: "job-b", title: "前端研发实习生", company: "云启", order: 2 },
  { id: "job-c", title: "AI产品实习生", company: "智乐活", order: 3 }
];

describe("tailoring context entity resolver", () => {
  it("resolves ordinals and relative last-item language", () => {
    expect(resolveTailoringEntityReference("第二个", jobs)).toMatchObject({
      status: "resolved",
      candidate: { id: "job-b" },
      reason: "ordinal"
    });
    expect(resolveTailoringEntityReference("最后一个", jobs)).toMatchObject({
      status: "resolved",
      candidate: { id: "job-c" },
      reason: "relative"
    });
  });

  it("matches title/company aliases without inventing ids", () => {
    expect(resolveTailoringEntityReference("Android那个", jobs)).toMatchObject({
      status: "resolved",
      candidate: { id: "job-a" }
    });
    expect(resolveTailoringEntityReference("安卓那个", jobs)).toMatchObject({
      status: "resolved",
      candidate: { id: "job-a" }
    });
    expect(resolveTailoringEntityReference("智乐活的 Android研发实习生", jobs)).toMatchObject({
      status: "resolved",
      candidate: { id: "job-a" }
    });
    expect(resolveTailoringEntityReference("Android研发实习生 · 智乐活", jobs)).toMatchObject({ status: "resolved", candidate: { id: "job-a" }, reason: "exact" });
    expect(resolveTailoringEntityReference("智乐活｜Android研发实习生", jobs)).toMatchObject({ status: "resolved", candidate: { id: "job-a" }, reason: "exact" });
    expect(resolveTailoringEntityReference("Android研发实习生 — 智乐活", jobs)).toMatchObject({ status: "resolved", candidate: { id: "job-a" }, reason: "exact" });
  });

  it("returns ambiguity and the current candidate set", () => {
    const ambiguous = resolveTailoringEntityReference("智乐活那个", jobs);
    expect(ambiguous.status).toBe("ambiguous");
    if (ambiguous.status === "ambiguous") {
      expect(ambiguous.candidates.map((candidate) => candidate.id)).toEqual(["job-a", "job-c"]);
    }
  });
});
