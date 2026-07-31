import { Blob as NodeBlob } from "node:buffer";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { AgentTaskCompletionGuard } from "@/agent/kernel/AgentTaskCompletionGuard";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import {
  ResumeImportOrchestrator
} from "@/services/resumeImport/ResumeImportOrchestrator";
import {
  AgentAttachmentStore
} from "@/services/agent/AgentAttachmentStore";
import { applyResumeImportReviewDecision } from "@/domain/resumeImport/reviewDecisions";
import {
  AGENT_RESUME_IMPORT_ACCEPT,
  AgentProductCapabilityManifest
} from "@/agent/capabilities/AgentProductCapabilityManifest";

let db: CareerAdaptDb | undefined;
const BrowserBlob = globalThis.Blob;

beforeAll(() => vi.stubGlobal("Blob", NodeBlob));
afterAll(() => vi.stubGlobal("Blob", BrowserBlob));

afterEach(async () => {
  if (db) {
    await db.delete();
    db.close();
    db = undefined;
  }
});

describe("ResumeImportOrchestrator", () => {
  it("prepares and persists a real DOCX through the shared pipeline", async () => {
    const repository = createRepository();
    const file = await fixtureFile(
      "tests/fixtures/resume-import/ordinary.docx",
      "ordinary.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    const progress: string[] = [];
    const result = await new ResumeImportOrchestrator(repository).prepare({
      file,
      fileName: file.name,
      mimeType: file.type,
      size: file.size
    }, {
      onProgress: (event) => progress.push(event.stage)
    });

    expect(result.sourceKind).toBe("docx");
    expect(result.status).toBe("ready_for_review");
    expect(result.draft.schemaVersion).toBe("resume-import-v2");
    expect(result.reviewSummary.itemCount).toBeGreaterThan(0);
    expect((await repository.getImportedResumeDraft(result.importId))?.revision).toBe(result.draftRevision);
    expect(progress).toEqual(expect.arrayContaining(["validating", "extracting", "normalizing", "mapping", "building_draft", "ready_for_review"]));
  });

  it("runs redacted AI semantic mapping before persisting the first review draft", async () => {
    const repository = createRepository();
    const file = new File([
      "张三\n电话：13800000000\n邮箱：zhangsan@example.com\n\n技能\nTypeScript"
    ], "resume.txt", { type: "text/plain" });
    let providerInput = "";
    let providerNameBlockId = "";
    const previousFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        input: { rawText: string };
      };
      providerInput = body.input.rawText;
      const blocks = JSON.parse(providerInput) as Array<{
        id: string;
        text: string;
      }>;
      const nameBlock = blocks.find((block) => block.text.includes("[NAME_1]"));
      if (!nameBlock) throw new Error("expected high-confidence name tokenization");
      providerNameBlockId = nameBlock.id;
      return new Response(JSON.stringify({
        ok: true,
        task: "resume-document-mapper",
        promptVersion: "resume-document-mapper.v6-canonical-v2",
        output: {
          resume: {
            schemaVersion: "careeradapt-resume-v2",
            basics: { name: "[NAME_1]" },
            sections: [],
            unclassifiedBlocks: []
          },
          sourceRefs: [{
            path: "/basics/name",
            blockIds: [nameBlock.id],
            confidenceLevel: "high",
            confidenceReason: "exact source",
            needsConfirmation: false,
          }],
          unclassifiedRefs: blocks
            .filter((block) => block.id !== nameBlock.id)
            .map((block) => ({
              blockIds: [block.id],
              reason: "not mapped in focused test"
            }))
        },
        meta: {
          provider: "test",
          model: "semantic-mapper-test",
          inputLength: providerInput.length,
          outputLength: 100,
          latencyMs: 1
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    try {
      const result = await new ResumeImportOrchestrator(repository).prepare({
        file,
        fileName: file.name,
        mimeType: file.type,
        size: file.size
      }, { semanticMode: "ai" });

      expect(providerInput).toContain("[NAME_1]");
      expect(providerInput).toContain("[PHONE_1]");
      expect(providerInput).toContain("[EMAIL_1]");
      expect(providerInput).not.toContain("13800000000");
      expect(providerInput).not.toContain("zhangsan@example.com");
      expect(result.draft.basics.name?.value).toBe("张三");
      expect(result.draft.parserVersion).toContain("resume-document-mapper.v6-canonical-v2");
      expect(result.draft.schemaVersion).toBe("resume-import-v2");
      const mappedDraft = result.draft.schemaVersion === "resume-import-v2"
        ? result.draft
        : undefined;
      expect(mappedDraft?.basics.name?.mapping).toMatchObject({
        sourcePaths: [providerNameBlockId],
        confidenceLevel: "high",
        needsConfirmation: false
      });
      expect(mappedDraft?.basics.name?.mapping?.sourceValues[0]).toContain("张三");
      const mappedNameBlockId = mappedDraft?.basics.name?.sourceBlockIds[0];
      expect(mappedDraft?.unclassifiedBlocks.some((block) =>
        "sourcePath" in block && block.sourcePath === mappedNameBlockId
      )).toBe(false);
      expect((await repository.getImportedResumeDraft(result.importId))?.parserVersion)
        .toContain("resume-document-mapper.v6-canonical-v2");
    } finally {
      vi.stubGlobal("fetch", previousFetch);
    }
  });

  it("preserves canonical CareerAdapt JSON v2 without sending it through AI", async () => {
    const repository = createRepository();
    const file = await fixtureFile(
      "tests/fixtures/resume-import/reconciliation-v2.json",
      "reconciliation-v2.json",
      "application/json"
    );
    const result = await new ResumeImportOrchestrator(repository).prepare({
      file,
      fileName: file.name,
      mimeType: file.type,
      size: file.size
    });

    expect(result.sourceKind).toBe("standard_json");
    expect(result.draft.sections.map((section) => section.sectionType)).not.toContain("experience");
    expect(result.draft.sections.flatMap((section) => section.items).some((item) => item.structuredItem)).toBe(true);
    expect(result.artifactPayload.sourceType).toBe("standard_json");
  });

  it("refuses to commit a draft containing an unresolved sensitive placeholder", async () => {
    const repository = createRepository();
    const file = await fixtureFile(
      "tests/fixtures/resume-import/reconciliation-v2.json",
      "reconciliation-v2.json",
      "application/json"
    );
    const prepared = await new ResumeImportOrchestrator(repository).prepare({
      file,
      fileName: file.name,
      mimeType: file.type,
      size: file.size
    });
    const reviewed = await repository.saveImportedResumeDraft({
      ...applyResumeImportReviewDecision(prepared.draft, "accept_all"),
      basics: {
        ...prepared.draft.basics,
        name: prepared.draft.basics.name
          ? { ...prepared.draft.basics.name, value: "[NAME_1]" }
          : undefined
      }
    }, prepared.draftRevision);

    await expect(repository.confirmImportedResume({
      importId: reviewed.importId,
      expectedDraftRevision: reviewed.revision,
      operationId: "reject-unresolved-placeholder",
      target: { mode: "new", profileName: "测试用户", createGeneralResume: true }
    })).rejects.toThrow("resume_import_unresolved_sensitive_placeholder");
  });

  it("keeps the deterministic external JSON adapter as an explicit local fallback", async () => {
    const repository = createRepository();
    const file = await fixtureFile(
      "tests/fixtures/resume-import/external-aliases.json",
      "external-aliases.json",
      "application/json"
    );
    const result = await new ResumeImportOrchestrator(repository).prepare({
      file,
      fileName: file.name,
      mimeType: file.type,
      size: file.size
    });

    expect(result.sourceKind).toBe("external_json");
    expect(result.draft.sourceBlocks.length).toBeGreaterThan(0);
    expect(result.draft.schemaVersion).toBe("resume-import-v2");
    expect(result.reviewSummary.conflictCount).toBe(0);
    expect(result.reviewSummary.needsReviewCount).toBeGreaterThanOrEqual(result.reviewSummary.unclassifiedCount);
    const reviewed = await repository.saveImportedResumeDraft(
      applyResumeImportReviewDecision(result.draft, "accept_all"),
      result.draftRevision
    );
    const sourceIds = new Set(reviewed.sourceBlocks.map((block) => block.id));
    const sourcePaths = new Set(reviewed.sourceBlocks.flatMap((block) => block.sourcePath ? [block.sourcePath] : []));
    expect(reviewed.sections.flatMap((section) => section.items)
      .filter((item) => item.included && !item.userEdited)
      .filter((item) =>
        !item.sourceBlockIds.some((id) => sourceIds.has(id))
        && !item.mapping?.sourcePaths.some((path) => sourcePaths.has(path))
      )
      .map((item) => ({
        rawText: item.rawText,
        sourceBlockIds: item.sourceBlockIds,
        sourcePaths: item.mapping?.sourcePaths
      }))).toEqual([]);
    await expect(repository.confirmImportedResume({
      importId: result.importId,
      expectedDraftRevision: reviewed.revision,
      operationId: "confirm-external-json-unit",
      target: { mode: "new", profileName: "外部 JSON 用户", createGeneralResume: true }
    })).resolves.toMatchObject({
      profileId: expect.any(String),
      branchId: expect.any(String),
      revisionId: expect.any(String)
    });
  });

  it.each([
    ["DOCX", "tests/fixtures/resume-import/ordinary.docx", "ordinary.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["JSON", "tests/fixtures/resume-import/reconciliation-v2.json", "reconciliation-v2.json", "application/json"]
  ])("N/O reconciles repeated %s imports through the shared orchestrator boundary", async (_, path, name, type) => {
    const repository = createRepository();
    const orchestrator = new ResumeImportOrchestrator(repository);
    const file = await fixtureFile(path, name, type);
    const firstPrepared = await orchestrator.prepare({
      file,
      fileName: file.name,
      mimeType: file.type,
      size: file.size
    });
    const firstReviewed = await repository.saveImportedResumeDraft(
      applyResumeImportReviewDecision(firstPrepared.draft, "accept_all"),
      firstPrepared.draftRevision
    );
    const first = await repository.confirmImportedResume({
      importId: firstReviewed.importId,
      expectedDraftRevision: firstReviewed.revision,
      operationId: `first-${name}`,
      target: {
        mode: "new",
        profileName: firstReviewed.basics.name?.value ?? `Profile ${name}`,
        createGeneralResume: true
      }
    });
    const secondPrepared = await orchestrator.prepare({
      file,
      fileName: file.name,
      mimeType: file.type,
      size: file.size
    });
    const secondReviewed = await repository.saveImportedResumeDraft(
      applyResumeImportReviewDecision(secondPrepared.draft, "accept_all"),
      secondPrepared.draftRevision
    );
    const plan = await repository.reconcileImportedResume({
      importId: secondReviewed.importId,
      expectedDraftRevision: secondReviewed.revision,
      profileId: first.profileId
    });

    expect(plan.summary.requiresReview).toBe(0);
    expect(plan.decisions.every((decision) =>
      decision.state === "exact_duplicate" || decision.state === "evidence_extension"
    )).toBe(true);
  });
});

describe("Agent local attachment and import task state", () => {
  it("truthfully exposes Markdown/TXT while keeping Agent OCR unavailable", async () => {
    expect(AGENT_RESUME_IMPORT_ACCEPT).toContain(".md");
    expect(AGENT_RESUME_IMPORT_ACCEPT).toContain(".txt");
    expect(AgentProductCapabilityManifest.ocr.entrypoints.agent).toBe("unavailable");
    const store = new AgentAttachmentStore();
    const markdown = await store.register(new File(["# Resume"], "resume.md"));
    const text = await store.register(new File(["Resume"], "resume.txt"));
    expect(markdown.mimeType).toBe("text/markdown");
    expect(text.mimeType).toBe("text/plain");
  });

  it("keeps only metadata durable and explicitly reports source loss", async () => {
    const store = new AgentAttachmentStore();
    const file = new File(["{}"], "resume.json", { type: "application/json" });
    const ref = await store.register(file);

    expect(store.resolve(ref.id).file).toBe(file);
    store.release(ref.id);
    expect(() => store.resolve(ref.id)).toThrow("请重新选择文件");
  });

  it("does not complete import_resume at parse or draft creation", () => {
    const session = AgentRuntime.create("agent_quick_action", "collecting_intent", "导入简历");
    const reducer = new AgentTaskStateReducer();
    const attachment = {
      id: "agent-attachment-unit",
      fileName: "resume.json",
      mimeType: "application/json",
      size: 100,
      hash: "hash-attachment-unit",
      createdAt: "2026-07-27T00:00:00.000Z"
    };
    let state = reducer.reduce(reducer.create(session), { type: "attachment_selected", attachment });
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "prepare_resume_import",
      observation: {
        importId: "import-unit",
        expectedDraftRevision: 0,
        reviewSummary: { itemCount: 3, needsReviewCount: 1 },
        artifactPayload: { sourceFile: "resume.json", sourceType: "standard_json" }
      },
      artifactIds: ["artifact-import-unit"]
    });

    expect(state.stage).toBe("import_review");
    expect(state.completionStatus).toBe("waiting_for_user");
    expect(new AgentTaskCompletionGuard().evaluate(state)).toMatchObject({
      canFinish: true,
      reason: "waiting_for_user"
    });
  });

  it("completes only after an authoritative import commit returns entity ids", () => {
    const session = AgentRuntime.create("resume_import", "confirm_import", "导入简历");
    const reducer = new AgentTaskStateReducer();
    let state = reducer.create(session, "import_resume");
    state.attachment = {
      id: "agent-attachment-commit",
      fileName: "resume.json",
      mimeType: "application/json",
      size: 100,
      createdAt: "2026-07-27T00:00:00.000Z"
    };
    state.knownSlots = {
      importId: "import-commit",
      expectedDraftRevision: 2,
      reviewStatus: "reviewed",
      importTarget: { mode: "new", profileName: "测试用户", createGeneralResume: true }
    };
    state.stage = "confirm_import";
    state.completionStatus = "waiting_for_confirmation";
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "commit_resume_import",
      observation: {
        profileId: "profile-imported",
        branchId: "resume-imported",
        revisionId: "revision-imported",
        idempotent: false
      }
    });

    expect(state.stage).toBe("import_complete");
    expect(state.selectedEntities).toMatchObject({
      profileId: "profile-imported",
      resumeId: "resume-imported",
      revisionId: "revision-imported"
    });
    expect(new AgentTaskCompletionGuard().evaluate(state)).toEqual({
      canFinish: true,
      reason: "goal_completed"
    });
  });

  it("captures review and existing-profile intent from one continuation reply", () => {
    const session = AgentRuntime.create("resume_import", "import_review", "导入简历");
    const reducer = new AgentTaskStateReducer();
    let state = reducer.create(session, "import_resume");
    state.attachment = {
      id: "agent-attachment-review",
      fileName: "resume.json",
      mimeType: "application/json",
      size: 100,
      createdAt: "2026-07-27T00:00:00.000Z"
    };
    state.knownSlots = {
      importId: "import-review",
      expectedDraftRevision: 1,
      reviewStatus: "needs_review"
    };
    state.stage = "import_review";

    state = reducer.reduce(state, {
      type: "user_message",
      message: "确认这些信息，保存到测试用户的资料库"
    });

    expect(state.knownSlots.reviewDecision).toBe("accept_all");
    expect(state.knownSlots.importTargetIntent).toBe("existing");
    expect(state.knownSlots.importTargetProfileName).toBe("测试用户");
  });

  it.each([
    ["Markdown", "resume.md", "text/markdown", "# 匿名候选人\n\n## 项目与研究\n- 保留多行项目要点", "markdown"],
    ["TXT", "resume.txt", "text/plain", "匿名候选人\n\n技术能力\nTypeScript", "text"]
  ])("prepares %s through the shared source-document pipeline", async (_, name, type, content, sourceKind) => {
    const repository = createRepository();
    const file = new File([content], name, { type });
    const result = await new ResumeImportOrchestrator(repository).prepare({
      file,
      fileName: file.name,
      mimeType: file.type,
      size: file.size
    });

    expect(result.sourceKind).toBe(sourceKind);
    expect(result.draft.schemaVersion).toBe("resume-import-v2");
    expect(result.draft.sourceBlocks.map((block) => block.sourceEngine)).toContain(
      sourceKind === "markdown" ? "markdown_parser" : "plain_text"
    );
    expect(result.draft.schemaVersion === "resume-import-v2"
      ? result.draft.qualityReport.recommendedPipeline
      : undefined).toBe("text_structure");
    expect((await repository.getImportedResumeDraft(result.importId))?.source.fileName).toBe(name);
  });

  it("recognizes creating a named career profile without mistaking it for an existing profile", () => {
    const session = AgentRuntime.create("resume_import", "import_review", "导入简历");
    const reducer = new AgentTaskStateReducer();
    let state = reducer.create(session, "import_resume");
    state.attachment = {
      id: "agent-attachment-new-profile",
      fileName: "示例用户.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 100,
      createdAt: "2026-07-29T00:00:00.000Z"
    };
    state.knownSlots = {
      importId: "import-new-profile",
      expectedDraftRevision: 1,
      reviewStatus: "needs_review"
    };
    state.stage = "import_review";

    state = reducer.reduce(state, {
      type: "user_message",
      message: "创建新职业档案，就是现在这个启辰的资料库。然后审核那3项需要确认的资料"
    });

    expect(state.knownSlots.importTargetIntent).toBe("new");
    expect(state.knownSlots.importTarget).toEqual({
      mode: "new",
      profileName: "启辰",
      createGeneralResume: true
    });
    expect(state.knownSlots.reviewDecision).toBeUndefined();
    expect(state.stage).toBe("import_review");
  });

  it("routes an existing target through shared reconciliation and only pauses for unresolved units", () => {
    const session = AgentRuntime.create("resume_import", "reconcile_profile", "导入到现有资料库");
    const reducer = new AgentTaskStateReducer();
    let state = reducer.create(session, "import_resume");
    state.attachment = {
      id: "agent-attachment-reconcile",
      fileName: "resume.json",
      mimeType: "application/json",
      size: 100,
      createdAt: "2026-07-27T00:00:00.000Z"
    };
    state.knownSlots = {
      importId: "import-reconcile",
      expectedDraftRevision: 2,
      reviewStatus: "reviewed",
      importTarget: { mode: "existing", profileId: "profile-existing" }
    };
    state.stage = "reconcile_profile";
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "reconcile_resume_import",
      observation: {
        importId: "import-reconcile",
        profileId: "profile-existing",
        expectedDraftRevision: 2,
        expectedPlanRevision: 0,
        status: "needs_review",
        summary: { existing: 21, mergedEvidence: 7, newFacts: 4, requiresReview: 2 },
        unresolved: [{ incomingItemId: "work-1", state: "conflict" }]
      }
    });

    expect(state.stage).toBe("resolve_conflicts");
    expect(state.completionStatus).toBe("waiting_for_user");
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "resolve_resume_reconciliation",
      observation: {
        importId: "import-reconcile",
        expectedPlanRevision: 1,
        status: "resolved",
        summary: { existing: 21, mergedEvidence: 7, newFacts: 4, requiresReview: 0 },
        unresolvedCount: 0
      }
    });
    expect(state.stage).toBe("confirm_import");
    expect(state.knownSlots.expectedReconciliationRevision).toBe(1);
    expect(state.completionStatus).toBe("active");
    expect(state.knownSlots).not.toHaveProperty("pendingConfirmation");
    state = reducer.reduce(state, {
      type: "confirmation_requested",
      toolName: "commit_resume_import",
      operationId: "commit-import-reconcile"
    });
    expect(state.completionStatus).toBe("waiting_for_confirmation");
    expect(state.knownSlots.pendingConfirmation).toEqual({
      toolName: "commit_resume_import",
      operationId: "commit-import-reconcile"
    });
  });
});

function createRepository() {
  db = new CareerAdaptDb(`CareerAdaptOrchestrator-${crypto.randomUUID()}`);
  return new WorkspaceRepository(db);
}

async function fixtureFile(path: string, name: string, type: string) {
  const buffer = await readFile(path);
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return new File([bytes], name, { type });
}
