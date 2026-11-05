import { projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import { stableHashText } from "@/services/security/text";
import { describe, it, expect, vi } from "vitest";
import { comparePdfText } from "@/services/export/pdfTextReadiness";
import { reviewExistingGeneralResume } from "@/domain/resumeComposition/reviewExistingGeneralResume";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { CareerResumeWritingService } from "@/domain/resumeComposition/CareerResumeWritingService";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";

describe("RESUME-01 actual PDF comparison", () => {
  it("preserves Chinese, English, numbers, symbols and every page", () => {
    expect(comparePdfText("中文 Python 2026 C++ 35% → 完成", ["中文 Python 2026", "C++ 35% → 完成"])).toMatchObject({ textLayer: "pass", contentParity: "pass", readingOrder: "pass" });
  });
  it.each([["正文", []], ["正文末页", ["正文"]], ["正文", ["正文正文"]], ["标题正文", ["正文标题"]], ["35% C++", ["35 C+"]]])("does not pass missing, duplicate, reordered or corrupted text", (source, pages) => {
    expect(comparePdfText(source as string, pages as string[]).contentParity).toBe("needs_review");
    expect(comparePdfText(source as string, pages as string[]).readingOrder).toBe("unknown");
  });
  it("separates complete content from a real stream ordering issue", () => {
    expect(comparePdfText("姓名\n邮箱\n项目经历\n正文", ["姓名项目经历邮箱正文"]))
      .toMatchObject({ contentParity: "pass", readingOrder: "needs_review" });
    expect(comparePdfText("标题\n正文", ["标题正文正文"]).contentParity).toBe("needs_review");
  });
  it("keeps an unavailable baseline unknown", () => expect(comparePdfText("", ["x"]).contentParity).toBe("unknown"));
});

describe("RESUME-01 current-revision review", () => {
  it("reviews current source text, keeps absent evidence unknown and performs zero formal writes", async () => {
    const db = new CareerAdaptDb(`resume01-${crypto.randomUUID()}`);
    try {
      const repo = new WorkspaceRepository(db);
      const profile = migrateCareerProfileToV2(structuredClone(demoCareerProfile));
      await repo.saveProfile(profile);
      const { branch } = await repo.ensureGeneralResumeFromProfile({ profileId: profile.id, operationId: "resume01-source", mode: "create_new" });
      const before = await repo.listResumeRevisions(branch.id);
      const profileBefore = await repo.getProfile(profile.id);
      const source = structuredClone(branch);
      const item = source.structuredContentItems!.find(item => "highlights" in item.data)!;
      expect(item).toBeTruthy();
      if ("highlights" in item.data) item.data.highlights = ["学习能力强，工作认真负责", "学习能力强，工作认真负责", "主导项目收入增长 999%"];
      item.factRefs = [];
      source.contentItems.find(legacy => legacy.id === item.id)!.factRefs = [];
      const report = reviewExistingGeneralResume(profile, source);
      expect(report.revisionId).toBe(branch.currentRevisionId);
      expect(report.reviewResult.diffs.some(diff => diff.before.includes("学习能力强"))).toBe(true);
      expect(report.reviewResult.diagnostics?.hardGate.status).toBe("blocked");
      expect(report.reviewResult.diagnostics?.atsStructure.textExtractability.status).toBe("unknown");
      expect(report.evidence.find(e => e.itemId === item.id)?.excerpt).toBeUndefined();
      const confirmedSource = structuredClone(source);
      const confirmedItem = confirmedSource.structuredContentItems!.find(candidate => candidate.id === item.id)!;
      if ("highlights" in confirmedItem.data) confirmedItem.data.highlights = ["使用 SQL 完成基础查询与数据整理。"];
      const confirmedText = projectResumeItemV2(confirmedItem.data);
      const confirmedLegacy = confirmedSource.contentItems.find(candidate => candidate.id === item.id)!;
      confirmedLegacy.text = confirmedText;
      confirmedLegacy.guardStatus = "pass";
      confirmedLegacy.source = "user_manual";
      confirmedLegacy.userConfirmation = { scope: "resume_only", confirmedTextHash: stableHashText(confirmedText), confirmedAt: profile.updatedAt };
      Object.assign(confirmedItem, { source: "user_manual", guardStatus: "pass", legacyTextProjection: confirmedText, userConfirmation: confirmedLegacy.userConfirmation });
      const confirmedReport = reviewExistingGeneralResume(profile, confirmedSource);
      expect(confirmedReport.reviewResult.diffs.some(diff => diff.id === `review:${item.id}:verify`)).toBe(false);
      expect(confirmedReport.evidence.find(e => e.itemId === item.id)?.excerpt).toBe(confirmedText);
      confirmedLegacy.userConfirmation.confirmedTextHash = "incorrect-confirmation";
      confirmedItem.userConfirmation = confirmedLegacy.userConfirmation;
      expect(reviewExistingGeneralResume(profile, confirmedSource).reviewResult.diffs.some(diff => diff.id === `review:${item.id}:verify`)).toBe(true);
      const writer = new CareerResumeWritingService();
      const writeSpy = vi.spyOn(writer, "writeWithExecution");
      const service = new BrowserAgentToolService(repo, undefined, writer);
      const planned = await service.planResumeComposition({ profileId: profile.id, expectedProfileRevision: profile.version,
        mode: "general", sourceResumeId: branch.id, reviewOnly: true });
      expect(planned.sourceReview?.revisionId).toBe(branch.currentRevisionId);
      expect(writeSpy).not.toHaveBeenCalled();
      expect(await db.appMeta.toArray()).not.toEqual(expect.arrayContaining([expect.objectContaining({ key: expect.stringContaining("resumeCompositionCheckpoint") })]));
      expect(await repo.listResumeRevisions(branch.id)).toEqual(before);
      expect(await repo.getResumeBranch(branch.id)).toEqual(branch);
      expect(await repo.getProfile(profile.id)).toEqual(profileBefore);
      expect(source.structuredContentItems).not.toEqual(branch.structuredContentItems);
      expect(item.data).toEqual(source.structuredContentItems!.find(i => i.id === item.id)!.data);
      const exportInput = { operationId: "resume01-export", branchId: branch.id, expectedBranchRevision: branch.revision,
        expectedRevisionId: branch.currentRevisionId!, templateId: "classic-technical", overflowStatus: "fits_one_page" as const,
        exportStatus: "direct_pdf_success" as const, fileName: "synthetic.pdf", snapshotHash: "synthetic-snapshot", presentationRevision: 0 };
      const pdfTextReadiness = { version: "pdf-text-1" as const, revisionId: branch.currentRevisionId!, templateId: "classic-technical",
        snapshotHash: "synthetic-snapshot", presentationRevision: 0, pageCount: 1, textLayer: "pass" as const,
        contentParity: "pass" as const, readingOrder: "unknown" as const, extractedCharacters: 42, expectedCharacters: 42, thirdPartyAts: "unknown" as const };
      const exported = await repo.createResumeExportRecord({ ...exportInput, pdfTextReadiness });
      expect(exported.record.pdfTextReadiness).toEqual(pdfTextReadiness);
      await expect(repo.createResumeExportRecord({ ...exportInput, operationId: "wrong-binding", pdfTextReadiness: { ...pdfTextReadiness, revisionId: "other-revision" } }))
        .rejects.toThrow("export_pdf_readiness_binding_mismatch");
      expect(() => reviewExistingGeneralResume(profile, { ...source, branchPurpose: "job_specific" })).toThrow("general_review_target_invalid");
    } finally { db.close(); }
  });
});
