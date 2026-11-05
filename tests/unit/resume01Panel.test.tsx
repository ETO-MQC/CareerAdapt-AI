import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ResumeDiagnosticsPanel } from "@/components/resume/diagnostics/ResumeDiagnosticsPanel";
import type { GeneralResumeReview } from "@/domain/resumeComposition/reviewExistingGeneralResume";
import type { PdfTextReadiness } from "@/services/export/pdfTextReadiness";

describe("RESUME-01 stale reports", () => {
  it("labels an old original-review revision and withholds previous PDF passes", () => {
    const generalReview = { branchId: "b", revisionId: "old", branchRevision: 1, profileRevision: 1,
      reviewResult: { diffs: [] }, evidence: [], originalItemCount: 0 } as unknown as GeneralResumeReview;
    const pdfReadiness = { textLayer: "pass", contentParity: "pass", readingOrder: "pass", pageCount: 1 } as PdfTextReadiness;
    render(<ResumeDiagnosticsPanel generalReview={generalReview} reviewStale pdfReadiness={pdfReadiness} pdfStale
      stale={false} running={false} canEdit onRun={() => {}} onLocateIssue={() => {}} onApplyAction={() => {}} onIgnoreIssue={() => {}} />);
    expect(screen.getByTestId("general-resume-review")).toHaveTextContent("已过期，请重新审阅");
    expect(screen.getByTestId("pdf-text-readiness")).toHaveTextContent("检查已过期");
    expect(screen.getByTestId("pdf-text-readiness")).not.toHaveTextContent("pass");
    expect(screen.getByTestId("pdf-text-readiness")).toHaveTextContent("unknown");
  });
});
