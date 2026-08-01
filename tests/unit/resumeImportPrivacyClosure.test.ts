import { describe, expect, it, vi } from "vitest";
import { createImportedResumeDraftFromStructuredJson } from "@/domain/resumeImport/parser";
import { ResumeDocumentSemanticMapper } from "@/services/resumeImport/ResumeDocumentSemanticMapper";
import {
  applyFieldCandidateToDraft,
  FieldCandidateApplyError
} from "@/domain/resumeImport/reviewDecisions";
import type { ImportedResumeFieldCandidate } from "@/domain/schemas";
import {
  containsUnresolvedSensitivePlaceholder,
  createSensitiveTextTokenizer,
  isSensitiveTransportToken,
  restoreKnownSensitiveTokens
} from "@/services/security/text";

const NOW = "2026-07-31T00:00:00.000Z";

describe("resume import privacy and candidate closure", () => {
  it("restores bracketed and provider-normalized bare aliases only from the current map", () => {
    const tokenizer = createSensitiveTextTokenizer();
    const redacted = tokenizer.tokenize("电话 13800138000，邮箱 demo@example.com");
    expect(restoreKnownSensitiveTokens("电话[PHONE_1] PHONE_1", redacted.restorationMap)).toBe("电话13800138000 13800138000");
    expect(restoreKnownSensitiveTokens("XPHONE_1 PHONE_10", redacted.restorationMap)).toBe("XPHONE_1 PHONE_10");
    expect(containsUnresolvedSensitivePlaceholder("PHONE_1", redacted.restorationMap)).toBe(true);
    expect(containsUnresolvedSensitivePlaceholder("PHONE_1", { "[EMAIL_1]": "demo@example.com" })).toBe(false);
  });

  it("does not classify a transport phone token as an abnormal phone candidate", () => {
    const draft = createImportedResumeDraftFromStructuredJson({
      importId: "privacy-phone-token",
      source: { fileName: "resume.json", mimeType: "application/json", fileHash: "privacy-phone-token-hash", pageCount: 1, extractedAt: NOW },
      structuredDraft: { basics: { phone: "PHONE_1" }, sections: [] },
      now: NOW
    });
    expect(isSensitiveTransportToken("PHONE_1")).toBe(true);
    expect(draft.schemaVersion === "resume-import-v2" ? draft.fieldCandidates.filter((candidate) => candidate.targetFieldId === "basics.phone") : []).toHaveLength(0);
  });

  it("restores bare provider aliases through the mapper before building Review candidates", async () => {
    const sourceDraft = createImportedResumeDraftFromStructuredJson({
      importId: "mapper-bare-alias",
      source: { fileName: "resume.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileHash: "mapper-bare-alias-hash", pageCount: 1, extractedAt: NOW },
      structuredDraft: { basics: { name: "张三", email: "zhangsan@example.com", phone: "13800138000" }, sections: [] },
      now: NOW
    });
    if (sourceDraft.schemaVersion !== "resume-import-v2") throw new Error("expected v2 draft");
    const saveAiLogs = vi.fn(async () => undefined);
    const previousFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: { rawText: string } };
      const blocks = JSON.parse(body.input.rawText) as Array<{ id: string }>;
      const blockIds = blocks.length ? [blocks[0].id] : [sourceDraft.sourceBlocks[0]!.id];
      return new Response(JSON.stringify({
        ok: true,
        task: "resume-document-mapper",
        promptVersion: "resume-document-mapper.v6-canonical-v2",
        output: {
          resume: {
            schemaVersion: "careeradapt-resume-v2",
            basics: { name: "NAME_1", email: "EMAIL_1", phone: "PHONE_1" },
            sections: [],
            unclassifiedBlocks: []
          },
          sourceRefs: [
            ...["name", "email", "phone"].map((field) => ({
              path: `/basics/${field}`,
              blockIds,
              confidenceLevel: "high",
              confidenceReason: "exact source",
              needsConfirmation: false
            }))
          ],
          unclassifiedRefs: []
        },
        meta: { provider: "test", model: "bare-alias-test", inputLength: body.input.rawText.length, outputLength: 100, latencyMs: 1 }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    try {
      const mapped = await new ResumeDocumentSemanticMapper({ saveAiLogs } as never).map(sourceDraft);
      expect(containsUnresolvedSensitivePlaceholder(mapped)).toBe(false);
      expect(mapped.basics.name?.value).toBe("张三");
      expect(mapped.basics.email?.value).toBe("zhangsan@example.com");
      expect(mapped.basics.phone?.value).toBe("13800138000");
      expect(mapped.schemaVersion === "resume-import-v2"
        ? mapped.fieldCandidates.filter((candidate) => candidate.targetFieldId === "basics.phone" && isSensitiveTransportToken(candidate.value))
        : []).toHaveLength(0);
    } finally {
      vi.stubGlobal("fetch", previousFetch);
    }
  });

  it("applies accept idempotently and preserves candidate provenance", () => {
    const draft = createImportedResumeDraftFromStructuredJson({
      importId: "candidate-apply",
      source: { fileName: "resume.json", mimeType: "application/json", fileHash: "candidate-apply-hash", pageCount: 1, extractedAt: NOW },
      structuredDraft: { basics: {}, sections: [] },
      now: NOW
    });
    if (draft.schemaVersion !== "resume-import-v2") throw new Error("expected v2 draft");
    const sourceBlockId = draft.sourceBlocks[0]?.id ?? "source-1";
    const candidate: ImportedResumeFieldCandidate = {
      id: "candidate-phone",
      targetFieldId: "basics.phone",
      value: "13800138000",
      sourceBlockIds: [sourceBlockId],
      sourceRanges: [{ blockId: sourceBlockId, start: 0, end: 11 }],
      sectionId: "basics",
      itemId: "basics",
      itemLabel: "基本信息",
      sourceQuote: "13800138000",
      confidence: 0.99,
      needsConfirmation: true,
      userConfirmed: false,
      reviewStatus: "needs_review",
      mappingReason: "来源逐字定位"
    };
    const withCandidate = { ...draft, fieldCandidates: [candidate] };
    const accepted = applyFieldCandidateToDraft(withCandidate, candidate, "accept");
    if (accepted.schemaVersion !== "resume-import-v2") throw new Error("expected v2 draft");
    expect(accepted.basics.phone).toMatchObject({ value: "13800138000", userConfirmed: true, userEdited: false });
    expect(accepted.fieldCandidates[0]).toMatchObject({ reviewStatus: "accepted", userConfirmed: true });
    expect(accepted.basics.phone?.sourceBlockIds).toContain(sourceBlockId);

    const again = applyFieldCandidateToDraft(accepted, accepted.fieldCandidates[0], "accept");
    if (again.schemaVersion !== "resume-import-v2") throw new Error("expected v2 draft");
    expect(again.basics.phone?.value).toBe("13800138000");
    expect(again.fieldCandidates).toHaveLength(1);

    const edited = applyFieldCandidateToDraft(accepted, accepted.fieldCandidates[0], { type: "edit", value: "13900139000" });
    expect(edited.basics.phone).toMatchObject({ value: "13900139000", userConfirmed: true, userEdited: true });
  });

  it("rejects placeholder candidates before rendering or applying them", () => {
    const draft = createImportedResumeDraftFromStructuredJson({
      importId: "candidate-placeholder",
      source: { fileName: "resume.json", mimeType: "application/json", fileHash: "candidate-placeholder-hash", pageCount: 1, extractedAt: NOW },
      structuredDraft: { basics: {}, sections: [] },
      now: NOW
    });
    if (draft.schemaVersion !== "resume-import-v2") throw new Error("expected v2 draft");
    const candidate = {
      id: "candidate-placeholder-phone",
      targetFieldId: "basics.phone" as const,
      value: "PHONE_1",
      sourceBlockIds: ["source-1"],
      sourceQuote: "PHONE_1",
      confidence: 0.45,
      needsConfirmation: true,
      userConfirmed: false,
      reviewStatus: "needs_review" as const,
      mappingReason: "test"
    };
    expect(() => applyFieldCandidateToDraft({ ...draft, fieldCandidates: [candidate] }, candidate, "accept"))
      .toThrowError(FieldCandidateApplyError);
  });
});
