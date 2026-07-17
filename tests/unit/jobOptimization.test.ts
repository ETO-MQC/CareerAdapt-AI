import { afterEach, describe, expect, it } from "vitest";
import { createImportedResumeDraftFromPdf } from "@/domain/resumeImport/parser";
import { buildResumeImportConfirmation } from "@/domain/resumeImport/confirm";
import {
  buildJobOptimizationSummary,
  buildRequirementBlockMatches,
  computeRequirementsHash,
  createBlockSuggestion,
  createDeterministicBlockSuggestion,
  staleReasonForSuggestion
} from "@/domain/jobOptimization";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { createRuleRequirementMatches } from "@/domain/match/matcher";
import {
  JobDescriptionSchema,
  type JobDescription,
  type PdfPageText,
  type RequirementBlockMatch,
  type RequirementMatch,
  type ResumeBranch
} from "@/domain/schemas";
import { CareerAdaptDb } from "@/services/storage/db";
import { RevisionConflictError, WorkspaceRepository } from "@/services/storage/repositories";

const TEST_TIME = "2026-07-05T09:00:00.000Z";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  if (!db) {
    return;
  }

  db.close();
  await db.delete();
  db = undefined;
});

describe("V2-G5a job optimization", () => {
  it("maps confirmed job requirements to branch content blocks and summarizes fact gaps", () => {
    const { profile, branch } = buildImportedGeneralResume();
    const job = createSqlAnalystJob();
    const matches = createRuleRequirementMatches({ profile, job }, TEST_TIME);
    const blockMatches = buildRequirementBlockMatches({ profile, job, branch, matches, now: TEST_TIME });
    const summary = buildJobOptimizationSummary({ job, branch, matches: blockMatches });

    const sqlBlock = blockMatches.find((match) => match.requirementId === "req-sql-reporting" && match.contentItemId);
    const missingBlock = blockMatches.find((match) => match.requirementId === "req-salesforce-crm");

    expect(sqlBlock?.matchLevel).toBe("strong");
    expect(sqlBlock?.evidenceRefs.length).toBeGreaterThan(0);
    expect(missingBlock?.matchLevel).toBe("none");
    expect(missingBlock?.contentItemId).toBeUndefined();
    expect(summary.totalRequirements).toBe(2);
    expect(summary.strong).toBe(1);
    expect(summary.none).toBe(1);
  });

  it("creates block suggestions with revision locks, evidence, guard preview, and stale detection", () => {
    const { profile, branch } = buildImportedGeneralResume();
    const job = createSqlAnalystJob();
    const matches = createRuleRequirementMatches({ profile, job }, TEST_TIME);
    const blockMatches = buildRequirementBlockMatches({ profile, job, branch, matches, now: TEST_TIME });
    const targetMatch = requireMatchedBlock(blockMatches);
    const contentItem = branch.contentItems.find((item) => item.id === targetMatch.contentItemId)!;
    const suggestion = createDeterministicBlockSuggestion({
      draftId: "draft-g5a-unit",
      job,
      branch,
      contentItem,
      matches: [targetMatch],
      kind: "compress",
      promptVersion: "resume-tailor.fallback.v1",
      now: TEST_TIME
    });
    const requirementsHash = computeRequirementsHash({ job, matches });

    expect(suggestion.branchId).toBe(branch.id);
    expect(suggestion.targetContentItemId).toBe(contentItem.id);
    expect(suggestion.targetSectionId).toMatch(/^(summary|education|work|internship|project|research|campus|volunteer|awards|skills|certificates|languages|publications|patents|portfolio|other|custom)$/);
    expect(suggestion.targetFieldId).toMatch(new RegExp(`^${suggestion.targetSectionId}\\.`));
    expect(suggestion.targetFieldPath).toContain(`items.${contentItem.id}.`);
    expect(suggestion.requirementsHash).toBe(requirementsHash);
    expect(suggestion.usedEvidenceRefs.length).toBeGreaterThan(0);
    expect(suggestion.guardPreview).toBeDefined();
    expect(staleReasonForSuggestion({ suggestion, branch, requirementsHash })).toBeUndefined();

    const editedBranch = {
      ...branch,
      contentItems: branch.contentItems.map((item) =>
        item.id === contentItem.id ? { ...item, text: `${item.text} Edited after suggestion.` } : item
      )
    };
    expect(staleReasonForSuggestion({ suggestion, branch: editedBranch, requirementsHash })).toBe("original_text_changed");
  });

  it("derives a job branch and applies accepted block suggestions without mutating the general branch", async () => {
    const repository = createRepository();
    const { profile, branch: generalBranch } = await confirmImportedGeneralResume(repository);
    const job = await repository.saveJobDescription(createSqlAnalystJob());
    const matches = bindMatchesToResume(createRuleRequirementMatches({ profile, job }, TEST_TIME), generalBranch);
    await repository.saveRuleRequirementMatches({ profile, job, matches });

    const derived = await repository.deriveJobSpecificBranchFromBranch({
      sourceBranchId: generalBranch.id,
      jobId: job.id,
      expectedSourceRevision: generalBranch.revision,
      expectedSourceRevisionId: generalBranch.currentRevisionId!,
      operationId: "g5a-derive-unit",
      name: "SQL analyst branch"
    });
    const duplicate = await repository.deriveJobSpecificBranchFromBranch({
      sourceBranchId: generalBranch.id,
      jobId: job.id,
      expectedSourceRevision: generalBranch.revision,
      expectedSourceRevisionId: generalBranch.currentRevisionId!,
      operationId: "g5a-derive-unit-duplicate-check",
      name: "SQL analyst branch duplicate"
    });

    expect(derived.branch.branchPurpose).toBe("job_specific");
    expect(derived.branch.sourceBranchId).toBe(generalBranch.id);
    expect(derived.branch.structuredContentItems).toEqual(generalBranch.structuredContentItems);
    expect(duplicate.duplicate).toBe(true);

    const draft = await repository.createJobAdaptationDraft({
      profile,
      job,
      matches,
      operationId: "g5a-draft-unit",
      branchId: derived.branch.id,
      sourceBranchId: generalBranch.id,
      sourceRevisionId: derived.branch.currentRevisionId!,
      sourceBranchRevision: derived.branch.revision
    });
    const blockMatches = buildRequirementBlockMatches({
      profile,
      job,
      branch: derived.branch,
      matches,
      now: TEST_TIME
    });
    const targetMatch = requireMatchedBlock(blockMatches);
    const contentItem = derived.branch.contentItems.find((item) => item.id === targetMatch.contentItemId)!;
    const guardResult = runRuleFactGuard({
      originalText: contentItem.originalText,
      checkedText: contentItem.text,
      usedEvidenceRefs: targetMatch.evidenceRefs,
      now: TEST_TIME
    });
    const suggestion = createBlockSuggestion({
      draftId: draft.draft.id,
      branch: derived.branch,
      contentItem,
      requirementIds: [targetMatch.requirementId],
      requirementsHash: computeRequirementsHash({ job, matches }),
      kind: "rewrite",
      suggestedText: contentItem.text,
      reason: "Keep the verified block while associating it with the target SQL requirement.",
      usedEvidenceRefs: targetMatch.evidenceRefs,
      guardResult,
      promptVersion: "resume-tailor.unit",
      now: TEST_TIME
    });
    const savedSuggestion = await repository.saveGeneratedBlockSuggestion({
      profile,
      job,
      draftId: draft.draft.id,
      matches,
      suggestion,
      expectedRevision: draft.draft.revision,
      operationId: "g5a-generate-unit"
    });
    const accepted = await repository.applyResumeBlockSuggestion({
      branchId: derived.branch.id,
      suggestionId: savedSuggestion.suggestion.id,
      contentItemId: contentItem.id,
      expectedBranchRevision: derived.branch.revision,
      expectedRevisionId: derived.branch.currentRevisionId!,
      expectedOriginalTextHash: savedSuggestion.suggestion.originalTextHash!,
      requirementsHash: savedSuggestion.suggestion.requirementsHash!,
      operationId: "g5a-accept-unit",
      acceptedText: savedSuggestion.suggestion.suggestedText
    });
    const generalAfter = await repository.getResumeBranch(generalBranch.id);

    expect(accepted.branch.revision).toBe(derived.branch.revision + 1);
    expect(accepted.revision?.source).toBe("suggestion_accept");
    expect(accepted.suggestion.status).toBe("accepted");
    expect(accepted.branch.contentItems.find((item) => item.id === contentItem.id)?.sourceSuggestionIds).toContain(suggestion.id);
    const acceptedStructured = accepted.branch.structuredContentItems?.find((item) => item.id === contentItem.id)?.data as unknown as Record<string, unknown>;
    const targetField = suggestion.targetFieldId!.split(".").at(-1)!;
    expect(Array.isArray(acceptedStructured[targetField]) ? acceptedStructured[targetField]?.[0] : acceptedStructured[targetField]).toBe(suggestion.suggestedText);
    expect(generalAfter?.revision).toBe(generalBranch.revision);
    expect(generalAfter?.contentItems.find((item) => item.id === contentItem.id)?.text).toBe(contentItem.text);
  });

  it("deduplicates only the exact source revision and creates a separate branch after the general resume changes", async () => {
    const repository = createRepository();
    const { profile, branch: originalGeneral } = await confirmImportedGeneralResume(repository);
    const job = await repository.saveJobDescription(createSqlAnalystJob());
    const initialMatches = bindMatchesToResume(createRuleRequirementMatches({ profile, job }, TEST_TIME), originalGeneral);
    await repository.saveRuleRequirementMatches({ profile, job, matches: initialMatches });

    const first = await repository.deriveJobSpecificBranchFromBranch({
      sourceBranchId: originalGeneral.id,
      jobId: job.id,
      expectedSourceRevision: originalGeneral.revision,
      expectedSourceRevisionId: originalGeneral.currentRevisionId!,
      operationId: "p34-source-v1",
      name: "SQL analyst from source v1"
    });
    const duplicate = await repository.deriveJobSpecificBranchFromBranch({
      sourceBranchId: originalGeneral.id,
      jobId: job.id,
      expectedSourceRevision: originalGeneral.revision,
      expectedSourceRevisionId: originalGeneral.currentRevisionId!,
      operationId: "p34-source-v1-duplicate",
      name: "Should not be created"
    });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.branch.id).toBe(first.branch.id);

    const firstItem = originalGeneral.contentItems[0];
    const edited = await repository.editResumeBranch({
      branchId: originalGeneral.id,
      expectedRevision: originalGeneral.revision,
      operationId: "p34-update-general-source",
      edits: [{ itemId: firstItem.id, text: `${firstItem.text} Updated source.` }]
    });
    const latestMatches = bindMatchesToResume(createRuleRequirementMatches({ profile, job }, TEST_TIME), edited.branch);
    await repository.saveRuleRequirementMatches({ profile, job, matches: latestMatches });
    const second = await repository.deriveJobSpecificBranchFromBranch({
      sourceBranchId: edited.branch.id,
      jobId: job.id,
      expectedSourceRevision: edited.branch.revision,
      expectedSourceRevisionId: edited.branch.currentRevisionId!,
      operationId: "p34-source-v2",
      name: "SQL analyst from source v2"
    });

    expect(second.duplicate).toBe(false);
    expect(second.branch.id).not.toBe(first.branch.id);
    expect(second.branch.sourceRevisionId).toBe(edited.branch.currentRevisionId);
    expect(first.branch.contentItems[0].text).toBe(firstItem.text);
  });

  it("blocks high-risk accepted edits and stale branch revisions", async () => {
    const repository = createRepository();
    const { profile, branch: generalBranch } = await confirmImportedGeneralResume(repository);
    const job = await repository.saveJobDescription(createSqlAnalystJob());
    const matches = bindMatchesToResume(createRuleRequirementMatches({ profile, job }, TEST_TIME), generalBranch);
    await repository.saveRuleRequirementMatches({ profile, job, matches });
    const derived = await repository.deriveJobSpecificBranchFromBranch({
      sourceBranchId: generalBranch.id,
      jobId: job.id,
      expectedSourceRevision: generalBranch.revision,
      expectedSourceRevisionId: generalBranch.currentRevisionId!,
      operationId: "g5a-derive-blocked",
      name: "Blocked branch"
    });
    const draft = await repository.createJobAdaptationDraft({
      profile,
      job,
      matches,
      operationId: "g5a-draft-blocked",
      branchId: derived.branch.id,
      sourceBranchId: generalBranch.id,
      sourceRevisionId: derived.branch.currentRevisionId!,
      sourceBranchRevision: derived.branch.revision
    });
    const blockMatches = buildRequirementBlockMatches({ profile, job, branch: derived.branch, matches, now: TEST_TIME });
    const targetMatch = requireMatchedBlock(blockMatches);
    const contentItem = derived.branch.contentItems.find((item) => item.id === targetMatch.contentItemId)!;
    const guardResult = runRuleFactGuard({
      originalText: contentItem.originalText,
      checkedText: contentItem.text,
      usedEvidenceRefs: targetMatch.evidenceRefs,
      now: TEST_TIME
    });
    const savedSuggestion = await repository.saveGeneratedBlockSuggestion({
      profile,
      job,
      draftId: draft.draft.id,
      matches,
      suggestion: createBlockSuggestion({
        draftId: draft.draft.id,
        branch: derived.branch,
        contentItem,
        requirementIds: [targetMatch.requirementId],
        requirementsHash: computeRequirementsHash({ job, matches }),
        kind: "rewrite",
        suggestedText: contentItem.text,
        reason: "Verified suggestion.",
        usedEvidenceRefs: targetMatch.evidenceRefs,
        guardResult,
        promptVersion: "resume-tailor.unit",
        now: TEST_TIME
      }),
      expectedRevision: draft.draft.revision,
      operationId: "g5a-generate-blocked"
    });

    await expect(repository.applyResumeBlockSuggestion({
      branchId: derived.branch.id,
      suggestionId: savedSuggestion.suggestion.id,
      contentItemId: contentItem.id,
      expectedBranchRevision: derived.branch.revision,
      expectedRevisionId: derived.branch.currentRevisionId!,
      expectedOriginalTextHash: savedSuggestion.suggestion.originalTextHash!,
      requirementsHash: savedSuggestion.suggestion.requirementsHash!,
      operationId: "g5a-accept-high-risk",
      acceptedText: `${savedSuggestion.suggestion.suggestedText} Improved results by 999%.`
    })).rejects.toThrow("guard_blocked");

    const edited = await repository.editResumeBranch({
      branchId: derived.branch.id,
      expectedRevision: derived.branch.revision,
      operationId: "g5a-edit-before-stale-accept",
      edits: [{ itemId: contentItem.id, text: contentItem.text }]
    });
    await expect(repository.applyResumeBlockSuggestion({
      branchId: derived.branch.id,
      suggestionId: savedSuggestion.suggestion.id,
      contentItemId: contentItem.id,
      expectedBranchRevision: derived.branch.revision,
      expectedRevisionId: derived.branch.currentRevisionId!,
      expectedOriginalTextHash: savedSuggestion.suggestion.originalTextHash!,
      requirementsHash: savedSuggestion.suggestion.requirementsHash!,
      operationId: "g5a-accept-stale",
      acceptedText: savedSuggestion.suggestion.suggestedText
    })).rejects.toBeInstanceOf(RevisionConflictError);
    expect(edited.branch.revision).toBe(derived.branch.revision + 1);
  });
});

function createRepository() {
  db = new CareerAdaptDb(`CareerAdaptG5aDb-${crypto.randomUUID()}`);
  return new WorkspaceRepository(db);
}

function bindMatchesToResume(matches: RequirementMatch[], branch: ResumeBranch) {
  const revisionId = branch.currentRevisionId;
  if (!revisionId) {
    throw new Error("test_resume_revision_missing");
  }
  return matches.map((match) => ({
    ...match,
    sourceResumeBranchId: branch.id,
    sourceResumeBranchRevision: branch.revision,
    sourceResumeRevisionId: revisionId
  }));
}

function buildImportedGeneralResume() {
  const draft = createImportedResumeDraftFromPdf({
    importId: "resume-import-g5a-domain",
    source: {
      sourceSessionId: "pdf-session-g5a-domain",
      fileName: "g5a-domain.pdf",
      fileHash: "hash-g5a-domain-resume",
      pageCount: 2
    },
    pages: createPageTexts("pdf-session-g5a-domain"),
    now: TEST_TIME
  });
  const built = buildResumeImportConfirmation({
    draft: confirmAllFieldCandidates(draft),
    operationId: "confirm-g5a-domain",
    now: TEST_TIME
  });
  return { profile: built.profile, branch: built.branch };
}

async function confirmImportedGeneralResume(repository: WorkspaceRepository) {
  const sessionId = `pdf-session-g5a-${crypto.randomUUID()}`;
  const importId = `resume-import-g5a-${crypto.randomUUID()}`;
  const draft = createImportedResumeDraftFromPdf({
    importId,
    source: {
      sourceSessionId: sessionId,
      fileName: "g5a.pdf",
      fileHash: `hash-g5a-${crypto.randomUUID()}`,
      pageCount: 2
    },
    pages: createPageTexts(sessionId),
    now: TEST_TIME
  });
  const saved = await repository.saveImportedResumeDraft(confirmAllFieldCandidates(draft), 0);
  const confirmed = await repository.confirmImportedResume({
    importId: saved.importId,
    expectedDraftRevision: saved.revision,
    operationId: `confirm-${saved.importId}`
  });
  const profile = await repository.getProfile(confirmed.profileId);
  const branch = await repository.getResumeBranch(confirmed.branchId);
  if (!profile || !branch) {
    throw new Error("g5a_test_import_confirmation_failed");
  }
  return { profile, branch };
}

function confirmAllFieldCandidates<T extends ReturnType<typeof createImportedResumeDraftFromPdf>>(draft: T): T {
  if (draft.schemaVersion !== "resume-import-v2") {
    throw new Error("expected_resume_import_v2_draft");
  }
  return {
    ...draft,
    fieldCandidates: draft.fieldCandidates.map((candidate) => ({
      ...candidate,
      needsConfirmation: false,
      userConfirmed: true
    }))
  } as T;
}

function createSqlAnalystJob(): JobDescription {
  const rawText = "Data Analyst Intern requires SQL reporting and Tableau dashboard maintenance. Salesforce CRM is preferred.";
  return JobDescriptionSchema.parse({
    id: "job-g5a-sql-analyst",
    title: "Data Analyst Intern",
    company: "ACME Analytics",
    industry: "Analytics",
    location: "Remote",
    workType: "Internship",
    rawText,
    source: "manual",
    parsedAt: TEST_TIME,
    requirements: [
      {
        id: "req-sql-reporting",
        category: "required_skill",
        description: "Build weekly SQL reports and maintain reporting workflows.",
        priority: "high",
        hardConstraint: true,
        sourceSpan: sourceSpan("SQL reporting"),
        keywords: ["SQL", "reports"],
        confidence: 0.96,
        createdAt: TEST_TIME,
        updatedAt: TEST_TIME
      },
      {
        id: "req-salesforce-crm",
        category: "preferred_skill",
        description: "Salesforce CRM experience is preferred.",
        priority: "nice_to_have",
        hardConstraint: false,
        sourceSpan: sourceSpan("Salesforce CRM"),
        keywords: ["Salesforce", "CRM"],
        confidence: 0.88,
        createdAt: TEST_TIME,
        updatedAt: TEST_TIME
      }
    ],
    createdAt: TEST_TIME,
    updatedAt: TEST_TIME
  });
}

function sourceSpan(text: string) {
  return {
    start: 0,
    end: text.length,
    text
  };
}

function requireMatchedBlock(matches: RequirementBlockMatch[]) {
  const match = matches.find((candidate) => candidate.requirementId === "req-sql-reporting" && candidate.contentItemId && candidate.evidenceRefs.length > 0);
  if (!match) {
    throw new Error("g5a_test_matched_block_missing");
  }
  return match;
}

function createPageTexts(sessionId: string): PdfPageText[] {
  const page1 = [
    "Alex Chen",
    "alex@example.com 13800138000",
    "Summary",
    "Data analyst focused on clean reporting and dashboard automation.",
    "Work Experience",
    "ACME Analytics | Data Analyst",
    "- Built weekly SQL reports for operation teams.",
    "- Maintained Tableau dashboards for sales review."
  ].join("\n");
  const page2 = [
    "Projects",
    "Inventory Forecasting Project",
    "- Built a Python model for stock planning.",
    "Skills",
    "SQL, Python, Tableau"
  ].join("\n");

  return [
    {
      id: `${sessionId}-page-1`,
      sessionId,
      pageNumber: 1,
      extractedPageText: page1,
      cleanedPageText: page1,
      charStart: 0,
      charEnd: page1.length,
      textItemCount: 24,
      warnings: [],
      rawTextHash: `${sessionId}-raw-1`,
      cleanedTextHash: `${sessionId}-clean-1`,
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    },
    {
      id: `${sessionId}-page-2`,
      sessionId,
      pageNumber: 2,
      extractedPageText: page2,
      cleanedPageText: page2,
      charStart: page1.length + 1,
      charEnd: page1.length + 1 + page2.length,
      textItemCount: 16,
      warnings: [],
      rawTextHash: `${sessionId}-raw-2`,
      cleanedTextHash: `${sessionId}-clean-2`,
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    }
  ];
}
