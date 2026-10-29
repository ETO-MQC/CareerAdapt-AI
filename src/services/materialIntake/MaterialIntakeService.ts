"use client";

import { MaterialIntakeInputSchema, validateMaterialClassification, type MaterialIntakeArtifact } from "@/domain/materialIntake/materialIntake";
import { ResumeImportOrchestrator, ResumeImportOrchestratorError, type ResumeImportExtractionResult } from "@/services/resumeImport/ResumeImportOrchestrator";
import { buildImportQualityReportV2 } from "@/domain/resumeImport/pipeline";
import { ResumeDocumentSemanticMapper } from "@/services/resumeImport/ResumeDocumentSemanticMapper";
import { agentAttachmentStore, type AgentAttachmentStore } from "@/services/agent/AgentAttachmentStore";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { readResumeImportSemanticPreference } from "@/services/preferences/resumeImportAi";
import { agentImportProgressBus } from "@/services/agent/AgentImportProgressBus";
import { ImportedResumeDraftV2Schema } from "@/domain/schemas";
import { hashText } from "@/services/security/text";

export class MaterialIntakeService {
  constructor(private readonly repository = new WorkspaceRepository(), private readonly attachments: AgentAttachmentStore = agentAttachmentStore) {}

  async prepare(raw: unknown, sessionId: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const input = MaterialIntakeInputSchema.parse(raw);
    const { ref, file } = await this.attachments.restore(input.attachmentId, sessionId);
    let artifact = await this.repository.getMaterialIntake(ref.id, sessionId);
    if (!artifact || artifact.reviewState === "manual_review" || input.manualText) {
      let extraction: ResumeImportExtractionResult;
      try {
        const materialFile = input.manualText
          ? new File([input.manualText], "manual-transcription.txt", { type: "text/plain" })
          : file.type ? file : new File([await file.arrayBuffer()], ref.fileName, { type: ref.mimeType });
        extraction = await new ResumeImportOrchestrator(this.repository).extractSourceDocument({
          file: materialFile, fileName: materialFile.name, mimeType: materialFile.type, size: materialFile.size
        }, {
          signal, materialIntake: true,
          semanticMode: readResumeImportSemanticPreference() === "ai" ? "ai" : "local",
          onProgress: (progress) => agentImportProgressBus.emit({ ...progress, agentSessionId: sessionId })
        });
      } catch (error) {
        signal?.throwIfAborted();
        if (!(error instanceof ResumeImportOrchestratorError) || error.recovery !== "manual_review") throw error;
        const sourceKind = ref.mimeType === "application/pdf" ? "scanned_pdf" : "image";
        artifact = await this.repository.saveMaterialIntake({
          schemaVersion: "career-material-intake-v1", attachmentId: ref.id, sessionId,
          sourceId: `material-source:${ref.hash}`, hash: ref.hash!, fileName: ref.fileName, mimeType: ref.mimeType,
          sourceDocument: { schemaVersion: "resume-source-document-v2", sourceId: `material-source:${ref.hash}`, sourceKind,
            fileName: ref.fileName, fileHash: ref.hash!, pageCount: 1, blocks: [],
            quality: buildImportQualityReportV2({ classification: sourceKind, pageCount: 1, blocks: [] }) },
          reviewState: "manual_review", warnings: [error.message], createdAt: new Date().toISOString()
        });
        return { artifact, formalWrites: false, nextAction: "manual_review", userPrompt: "原附件已保留。请对照原件补充可辨认文字，或稍后重试 OCR；无需重新上传。" };
      }
      if (input.manualText) {
        const blocks = extraction.sourceDocument.blocks.map((block) => ({ ...block, sourceEngine: "manual_transcription" as const, extractionConfidence: 0 }));
        extraction.sourceDocument = { ...extraction.sourceDocument, blocks };
        extraction.fallbackDraft = { ...extraction.fallbackDraft, sourceBlocks: blocks,
          fieldCandidates: extraction.fallbackDraft.schemaVersion === "resume-import-v2" ? extraction.fallbackDraft.fieldCandidates.map((field) => ({ ...field, confidence: 0, userConfirmed: false, reviewStatus: "needs_review" as const })) : [] } as typeof extraction.fallbackDraft;
      }
      signal?.throwIfAborted();
      artifact = {
        schemaVersion: "career-material-intake-v1", attachmentId: ref.id, sessionId,
        sourceId: `material-source:${ref.hash}`, hash: ref.hash!, fileName: ref.fileName, mimeType: ref.mimeType,
        sourceDocument: { ...extraction.sourceDocument, sourceId: `material-source:${ref.hash}`, fileHash: ref.hash! },
        reviewState: "extracted", warnings: [...extraction.fallbackDraft.warnings.map((warning) => warning.message), ...(input.manualText ? ["来源文字为待核对转写，尚未与原件核验。"] : [])], createdAt: new Date().toISOString()
      };
      await this.repository.setMeta(`material-source-draft:${sessionId}:${ref.id}`, extraction.fallbackDraft);
      await this.repository.setMeta(`material-source-extraction:${sessionId}:${ref.id}`, extraction);
      artifact = await this.repository.saveMaterialIntake(artifact);
    }
    if (input.classification) {
      artifact = await this.repository.saveMaterialIntake({
        ...artifact, classification: validateMaterialClassification(artifact, input.classification), reviewState: "classified"
      });
    }
    if (input.destination === "profile") {
      // Stable across sessions/entrypoints. Reuse the same review/reconciliation draft.
      const sourceDraft = ImportedResumeDraftV2Schema.parse((await this.repository.getMeta(`material-source-draft:${sessionId}:${ref.id}`))?.value);
      const textHash = await hashText(artifact.sourceDocument.blocks.map((block) => block.normalizedText).join("\n"));
      const importId = `material-profile:${artifact.hash}:${textHash}`;
      let draft = await this.repository.getImportedResumeDraft(importId);
      if (draft?.status === "confirmed") return { artifact, formalWrites: false, status: "already_saved", nextAction: "open_profile", profileId: draft.confirmedProfileId, userPrompt: "这份材料已经确认保存，可继续查看资料库。" };
      if (!draft) {
        let mapped = readResumeImportSemanticPreference() === "ai"
          ? await new ResumeDocumentSemanticMapper(this.repository).map(sourceDraft, { signal })
          : sourceDraft;
        // A certificate heading is not a person's name. Local resume heuristics
        // are only a source fallback for non-resume evidence, never identity.
        if (readResumeImportSemanticPreference() !== "ai" && sourceDraft.sourceKind !== "standard_json" && artifact.classification?.materialKind !== "resume") {
          mapped = { ...mapped, basics: { links: [] },
            ...(mapped.schemaVersion === "resume-import-v2" ? { fieldCandidates: mapped.fieldCandidates.filter((field) => !field.targetFieldId.startsWith("basics.")) } : {}) };
        }
        signal?.throwIfAborted();
        draft = await this.repository.saveImportedResumeDraft({ ...mapped, importId }, 0);
      }
      artifact = await this.repository.saveMaterialIntake({ ...artifact, importId, reviewState: "review_ready" });
      return { artifact, importId, expectedDraftRevision: draft.revision, status: "ready_for_review",
        candidates: draft.schemaVersion === "resume-import-v2" ? draft.fieldCandidates.map((field) => ({
          field: field.targetFieldId, value: field.value, originalQuote: field.sourceQuote,
          sourceBlockIds: field.sourceBlockIds, confidence: field.confidence, verificationState: field.userConfirmed ? "user_confirmed" : "unconfirmed"
        })) : [],
        fileName: artifact.fileName, sourceKind: draft.sourceKind, warnings: artifact.warnings,
        artifactPayload: { importId, draftRevision: draft.revision, sourceFile: artifact.fileName, sourceType: draft.sourceKind, warnings: artifact.warnings, reviewState: "ready_for_review", target: { status: "unresolved" } },
        nextAction: "review_import", formalWrites: false };
    }
    return { artifact, sourceText: materialSourceText(artifact), formalWrites: false,
      nextAction: artifact.classification ? "choose_career_workflow" : "classify_source_blocks",
      trust: "untrusted_document_data" };
  }
}

export function materialSourceText(artifact: MaterialIntakeArtifact) {
  return [...artifact.sourceDocument.blocks].sort((a, b) => a.order - b.order).map((block) => block.normalizedText).join("\n");
}
