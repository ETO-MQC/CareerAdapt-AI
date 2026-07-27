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

  it("preserves canonical JSON v2 without flattening it into generic experience", async () => {
    const repository = createRepository();
    const file = await fixtureFile(
      "tests/fixtures/resume-import/structured-standard.json",
      "structured-standard.json",
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

  it("keeps the deterministic external JSON adapter path", async () => {
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
});

describe("Agent local attachment and import task state", () => {
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
