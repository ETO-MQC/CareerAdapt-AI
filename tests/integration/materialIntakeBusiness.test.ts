import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { AgentAttachmentStore, agentAttachmentStore } from "@/services/agent/AgentAttachmentStore";
import { MaterialIntakeService } from "@/services/materialIntake/MaterialIntakeService";
import { writeResumeImportSemanticPreference } from "@/services/preferences/resumeImportAi";
import { applyResumeImportReviewDecision } from "@/domain/resumeImport/reviewDecisions";
import { omitRejectedMaterialValues, reclassifyMaterialSection } from "@/domain/materialIntake/review";
import { CareerProfileSchema, type ImportedResumeDraft, type ResumeItemV2 } from "@/domain/schemas";
import { executeCareerWorkflowFacade } from "@/agent/workflows/CareerWorkflowFacade";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { CareerToolGateway, CareerToolGatewayExecutor } from "@/agent/tools/CareerToolGateway";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";

let db: CareerAdaptDb;
let repository: WorkspaceRepository;
let store: AgentAttachmentStore;
let service: MaterialIntakeService;
beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob); writeResumeImportSemanticPreference("local");
  db = new CareerAdaptDb(`material-business-${crypto.randomUUID()}`);
  repository = new WorkspaceRepository(db); store = new AgentAttachmentStore(repository); service = new MaterialIntakeService(repository, store);
});
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); await db.delete(); db.close(); });

const certificate: ResumeItemV2 = { id: "cert", sectionType: "certificates", name: "匿名职业资格", issuer: "匿名机构", issuedAt: "2025-06", customFields: [] };
function document(items: ResumeItemV2[] = [certificate]) {
  return JSON.stringify({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN", basics: { portfolioLinks: [], otherLinks: [], customFields: [] },
    sections: items.map((item, index) => ({ id: `section-${index}`, sectionType: item.sectionType, title: item.sectionType, order: index, visible: true, items: [item] })), unclassifiedBlocks: [] });
}
async function profile(id = "profile-a") {
  return repository.saveProfile(CareerProfileSchema.parse({ id, name: id, basics: { name: id, links: [] }, version: 1,
    experiences: [], skills: [], certificates: [], evidences: [], unclassifiedBlocks: [],
    preference: { targetRoles: [], targetCities: [], industries: [] }, createdAt: "2026-11-07T00:00:00Z", updatedAt: "2026-11-07T00:00:00Z" }));
}
async function prepare(text = document(), sessionId = "center", targetProfileId?: string, purpose?: string) {
  const ref = await store.register(new File([text], "material.json", { type: "application/json" }), { agentSessionId: sessionId });
  const result = await service.prepare({ attachmentId: ref.id, destination: "profile", targetProfileId, purpose }, sessionId);
  return { ref, result, draft: (await repository.getImportedResumeDraft(result.importId!))! };
}
async function reviewed(draft: ImportedResumeDraft) {
  return repository.saveImportedResumeDraft(applyResumeImportReviewDecision(draft, "accept_all"), draft.revision);
}
async function confirm(draft: ImportedResumeDraft, profileId?: string, operationId = `confirm-${draft.importId}`) {
  const plan = profileId ? await repository.reconcileImportedResume({ importId: draft.importId, expectedDraftRevision: draft.revision, profileId }) : undefined;
  return repository.confirmImportedResume({ importId: draft.importId, expectedDraftRevision: draft.revision, expectedReconciliationRevision: plan?.revision, operationId,
    target: profileId ? { mode: "existing", profileId, createGeneralResume: false } : { mode: "new", profileName: "匿名人物", createGeneralResume: false } });
}
async function formal() { return { profiles: await db.profiles.toArray(), branches: await db.resumeBranches.toArray(), revisions: await db.resumeRevisions.toArray() }; }

describe("B0/B1/B2 material business workflow with actual Repository / IndexedDB", () => {
  it("B06 reuses the canonical draft through both independently owned entries and concurrent preparation", async () => {
    const p = await profile();
    const first = await prepare(document(), "center", p.id);
    const second = await prepare(document(), "hermes", p.id);
    expect(second.draft.importId).toBe(first.draft.importId);
    const both = await Promise.all([service.prepare({ attachmentId: first.ref.id, destination: "profile", targetProfileId: p.id }, "center"), service.prepare({ attachmentId: second.ref.id, destination: "profile", targetProfileId: p.id }, "hermes")]);
    expect(both[0].expectedDraftRevision).toBe(both[1].expectedDraftRevision);
    expect(await repository.getMaterialSources(first.draft.importId)).toHaveLength(2);
    await expect(new AgentAttachmentStore(repository).restore(first.ref.id, "hermes")).rejects.toMatchObject({ code: "agent_attachment_session_mismatch" });
    expect((await formal()).profiles).toHaveLength(1);
  });

  it("B11 Profile-only saves once with an authoritative version and no Branch / Revision", async () => {
    const p = await profile(); const f = await prepare(document(), "center", p.id); const draft = await reviewed(f.draft);
    const before = await formal(); expect(before.profiles[0].certificates).toHaveLength(0);
    const results = await Promise.all([confirm(draft, p.id), confirm(draft, p.id)]);
    expect(results.map((result) => result.idempotent).sort()).toEqual([false, true]);
    const saved = (await repository.getProfile(p.id))!;
    expect(saved.version).toBe(p.version + 1); expect(results[0].profileVersion).toBe(saved.version);
    expect(saved.certificates).toHaveLength(1);
    expect((await formal()).branches).toHaveLength(0); expect((await formal()).revisions).toHaveLength(0);
    const sources = await repository.getProfileMaterialSources(p.id, saved.structuredFacts![0].data.id);
    expect(sources[0].hash).toBe(f.ref.hash);
    expect((await new AgentAttachmentStore(repository).restore(sources[0].attachmentId, sources[0].sessionId)).ref.hash).toBe(f.ref.hash);
  });

  it("B17 same hash on another Profile or purpose requires a different provisional task", async () => {
    const a = await profile(); const b = await profile("profile-b");
    const first = await prepare(document(), "s", a.id); const draft = await reviewed(first.draft); await confirm(draft, a.id);
    const forB = await prepare(document(), "s", b.id);
    const otherUse = await prepare(document(), "s", a.id, "credential_verification");
    expect(forB.draft.importId).not.toBe(first.draft.importId); expect(otherUse.draft.importId).not.toBe(first.draft.importId);
    expect(forB.result.status).toBe("ready_for_review"); expect(otherUse.result.status).toBe("ready_for_review");
    expect((await repository.getProfile(b.id))!.certificates).toHaveLength(0);
    await expect(repository.confirmImportedResume({ importId: draft.importId, expectedDraftRevision: draft.revision, operationId: `confirm-${draft.importId}`, target: { mode: "existing", profileId: b.id, createGeneralResume: false } })).rejects.toThrow("material_target_mismatch");
    expect((await repository.listMaterialImports(a.id)).map((entry) => entry.importId)).toContain(first.draft.importId);
  });

  it("B07 different source documents extend evidence without another entity", async () => {
    const p = await profile();
    const a = await prepare(document(), "a", p.id); await confirm(await reviewed(a.draft), p.id);
    const b = await prepare(document() + "\n", "b", p.id);
    const draft = await reviewed(b.draft);
    const plan = await repository.reconcileImportedResume({ importId: draft.importId, expectedDraftRevision: draft.revision, profileId: p.id });
    expect(plan.decisions.some((decision) => decision.state === "evidence_extension")).toBe(true);
    await confirm(draft, p.id);
    const saved = (await repository.getProfile(p.id))!;
    expect(saved.certificates).toHaveLength(1); expect(saved.certificates[0].fact!.provenance).toHaveLength(2);
    expect(await repository.getProfileMaterialSources(p.id, saved.structuredFacts![0].data.id)).toHaveLength(2);
  });

  it("B08 defers conflicting dates, then explicitly keeps existing without overwriting", async () => {
    const p = await profile();
    const intern = (date: string): ResumeItemV2 => ({ id: "intern", sectionType: "internship", organization: "匿名公司", role: "实习生", startDate: date, endDate: "2025-07", current: false, highlights: ["参与资料整理"], customFields: [] });
    const a = await prepare(document([intern("2025-03")]), "a", p.id); await confirm(await reviewed(a.draft), p.id);
    const b = await prepare(document([intern("2025-04")]), "b", p.id); const draft = await reviewed(b.draft);
    let plan = await repository.reconcileImportedResume({ importId: draft.importId, expectedDraftRevision: draft.revision, profileId: p.id });
    expect(plan.conflicts[0].fields[0]).toMatchObject({ existingValue: "2025-03", incomingValue: "2025-04" });
    const before = await formal(); await expect(confirm(draft, p.id)).rejects.toThrow("profile_reconciliation_unresolved"); expect(await formal()).toEqual(before);
    plan = await repository.resolveProfileReconciliation({ importId: draft.importId, expectedPlanRevision: plan.revision, incomingItemId: plan.decisions[0].incomingItemId, resolution: "defer" });
    await expect(confirm(draft, p.id)).rejects.toThrow("profile_reconciliation_unresolved");
    await repository.resolveProfileReconciliation({ importId: draft.importId, expectedPlanRevision: plan.revision, incomingItemId: plan.decisions[0].incomingItemId, resolution: "keep_existing" });
    await confirm(draft, p.id); expect((await repository.getProfile(p.id))!.experiences[0].startDate).toBe("2025-03");
  });

  it("B09 rejects a whole candidate without any implicit write and excludes it from final save", async () => {
    const p = await profile(); const award: ResumeItemV2 = { id: "award", sectionType: "awards", name: "匿名团队奖", customFields: [] };
    const f = await prepare(document([certificate, award]), "a", p.id); const before = await formal();
    const draft = await repository.saveImportedResumeDraft({ ...f.draft, sections: f.draft.sections.map((section) => ({ ...section, items: section.items.map((item) => ({ ...item, included: item.structuredItem?.sectionType !== "awards" })) })) }, f.draft.revision);
    expect(await formal()).toEqual(before); await confirm(await reviewed(draft), p.id);
    expect((await repository.getProfile(p.id))!.structuredFacts!.some((entry) => entry.data.sectionType === "awards")).toBe(false);
  });

  it("B10 keeps raw blocks and quotes immutable when a candidate is edited and refreshed", async () => {
    const f = await prepare(); const item = f.draft.sections[0].items[0];
    const changed = await repository.saveImportedResumeDraft({ ...f.draft, sections: [{ ...f.draft.sections[0], items: [{ ...item,
      structuredItem: { ...certificate, issuer: "人工更正机构" }, userEdited: true, userConfirmed: true, sourceStatus: "user_confirmed_modified" }] }] }, f.draft.revision);
    const restored = await new WorkspaceRepository(db).getImportedResumeDraft(changed.importId);
    expect(restored!.sections[0].items[0].rawText).toBe(item.rawText); expect(restored!.sourceBlocks).toEqual(f.draft.sourceBlocks);
    expect(restored!.sections[0].items[0].structuredItem).toMatchObject({ issuer: "人工更正机构" });
    expect((await repository.getMaterialSources(changed.importId))[0].sourceDocument.blocks).toEqual(f.result.artifact.sourceDocument.blocks);
  });

  it("B12 restores draft revision, candidate selections, page and target without extraction", async () => {
    const f = await prepare(); const draft = await reviewed(f.draft);
    await repository.saveMaterialReviewState({ importId: draft.importId, targetMode: "new", targetProfileId: "", newProfileName: "匿名人物", selectedPageNumber: 1, reviewedUnclassifiedKeys: ["source-a"], basicMergeActions: {} });
    const fresh = new MaterialIntakeService(new WorkspaceRepository(db), new AgentAttachmentStore(repository));
    const result = await fresh.prepare({ attachmentId: f.ref.id, destination: "profile" }, "center");
    expect(result.importId).toBe(draft.importId); expect(result.expectedDraftRevision).toBe(draft.revision);
    expect(await repository.getMaterialReviewState(draft.importId)).toMatchObject({ newProfileName: "匿名人物", reviewedUnclassifiedKeys: ["source-a"] });
  });

  it("B15 confirmation failure rolls back, preserves the draft, and retry commits exactly once", async () => {
    const p = await profile(); const f = await prepare(document(), "a", p.id); const draft = await reviewed(f.draft);
    await repository.reconcileImportedResume({ importId: draft.importId, expectedDraftRevision: draft.revision, profileId: p.id });
    const before = await formal();
    const fail = () => { throw new Error("injected_profile_write_failure"); }; db.profiles.hook("updating", fail);
    await expect(confirm(draft, p.id)).rejects.toThrow("injected_profile_write_failure"); db.profiles.hook("updating").unsubscribe(fail);
    expect(await formal()).toEqual(before); expect((await repository.getImportedResumeDraft(draft.importId))!.status).toBe("reviewing");
    await confirm(draft, p.id); expect((await repository.getProfile(p.id))!.version).toBe(p.version + 1);
  });

  it("B11 stale Profile CAS blocks confirmation without formal writes", async () => {
    const p = await profile(); const f = await prepare(document(), "a", p.id); const draft = await reviewed(f.draft);
    const plan = await repository.reconcileImportedResume({ importId: draft.importId, expectedDraftRevision: draft.revision, profileId: p.id });
    await repository.saveProfile({ ...(await repository.getProfile(p.id))!, version: p.version + 1 }); const before = await formal();
    await expect(repository.confirmImportedResume({ importId: draft.importId, expectedDraftRevision: draft.revision, expectedReconciliationRevision: plan.revision, operationId: "stale", target: { mode: "existing", profileId: p.id, createGeneralResume: false } })).rejects.toThrow();
    expect(await formal()).toEqual(before);
  });

  it("B04 changes certificate to award canonically, preserving original evidence and requiring review", async () => {
    const f = await prepare(); const changed = reclassifyMaterialSection(f.draft, f.draft.sections[0].id, "awards");
    expect(changed.sections[0].items[0]).toMatchObject({ userConfirmed: false, sourceStatus: "ambiguous", structuredItem: { sectionType: "awards", name: certificate.name } });
    expect(changed.sourceBlocks).toEqual(f.draft.sourceBlocks);
    const draft = await reviewed(await repository.saveImportedResumeDraft(changed, f.draft.revision));
    const result = await confirm(draft); const saved = (await repository.getProfile(result.profileId))!;
    expect(saved.structuredFacts!.some((entry) => entry.data.sectionType === "awards")).toBe(true);
    expect(saved.skills).toHaveLength(0);
  });

  it("B09 removes a rejected sole required field by excluding its entity, preserving the raw source", async () => {
    const f = await prepare(); if (f.draft.schemaVersion !== "resume-import-v2") throw new Error("v2 required");
    const item = f.draft.sections[0].items[0];
    const candidate = { id: "reject-name", targetFieldId: "certificates.name" as const, itemId: item.id, sectionId: f.draft.sections[0].id, value: certificate.name,
      sourceQuote: item.rawText, sourceBlockIds: item.sourceBlockIds, confidence: 0.9, needsConfirmation: false, userConfirmed: false, reviewStatus: "rejected" as const, mappingReason: "explicit_rejection" };
    const draft = omitRejectedMaterialValues({ ...f.draft, fieldCandidates: [candidate] });
    expect(draft.sections[0].items[0].included).toBe(false); expect(draft.sourceBlocks).toEqual(f.draft.sourceBlocks);
  });

  it("B13 rejects empty, unsupported and oversized inputs without formal writes", async () => {
    const before = await formal();
    await expect(store.register(new File([], "empty.txt"), { agentSessionId: "a" })).rejects.toMatchObject({ code: "agent_attachment_empty" });
    await expect(store.register(new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.pdf"), { agentSessionId: "a" })).rejects.toMatchObject({ code: "agent_attachment_too_large" });
    const ref = await store.register(new File(["binary"], "unknown.bin"), { agentSessionId: "a" });
    await expect(service.prepare({ attachmentId: ref.id }, "a")).rejects.toThrow(); expect(await formal()).toEqual(before);
  });

  it("B14/B16 failed OCR is restored without automatic retry; manual transcription retains original bytes and identity", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: false, engine: "paddleocr-vl-local", configured: false, modelAvailable: false, runtimeAvailable: false, message: "unavailable" }));
    vi.stubGlobal("fetch", fetch);
    const ref = await store.register(new File(["original-image-bytes"], "certificate.png", { type: "image/png" }), { agentSessionId: "a" });
    const failed = await service.prepare({ attachmentId: ref.id, destination: "profile" }, "a");
    expect(failed.nextAction).toBe("manual_review"); const count = fetch.mock.calls.length;
    const restored = await new MaterialIntakeService(repository, new AgentAttachmentStore(repository)).prepare({ attachmentId: ref.id }, "a");
    expect(restored.nextAction).toBe("manual_review"); expect(fetch).toHaveBeenCalledTimes(count);
    const manual = await service.prepare({ attachmentId: ref.id, manualText: "证书\n匿名职业资格\n颁发方：匿名机构", destination: "profile" }, "a");
    expect(manual.artifact.sourceDocument.blocks.every((block) => block.sourceEngine === "manual_transcription" && block.extractionConfidence === 0)).toBe(true);
    const draft = (await repository.getImportedResumeDraft(manual.importId!))!;
    expect(draft.source.fileHash).toBe(ref.hash); expect(draft.source.fileName).toBe(ref.fileName);
    expect((await repository.getMeta(`material-recognition:a:${ref.id}`))!.value).toEqual(failed.artifact.sourceDocument);
    expect(await (await new AgentAttachmentStore(repository).restore(ref.id, "a")).file.text()).toBe("original-image-bytes");
    const retry = await service.prepare({ attachmentId: ref.id, destination: "profile" }, "a"); expect(retry.importId).toBe(manual.importId);
    expect(await repository.listProfiles()).toHaveLength(0);
    const classified = reclassifyMaterialSection(draft, draft.sections[0].id, "certificates");
    const edited = { ...classified, sections: classified.sections.map((section) => ({ ...section, items: section.items.map((item) => ({ ...item,
      structuredItem: { ...certificate, description: item.rawText }, userEdited: true })) })) };
    const result = await confirm(await reviewed(await repository.saveImportedResumeDraft(edited, draft.revision)));
    expect((await repository.getProfile(result.profileId))!.certificates).toHaveLength(1);
    expect((await repository.getMaterialSources(draft.importId))[0].sourceDocument.blocks.every((block) => block.sourceEngine === "manual_transcription")).toBe(true);
  });

  it("B15 aborting inside the actual confirmation transaction rolls back all formal data", async () => {
    const p = await profile(); const f = await prepare(document(), "a", p.id); const draft = await reviewed(f.draft);
    const plan = await repository.reconcileImportedResume({ importId: draft.importId, expectedDraftRevision: draft.revision, profileId: p.id });
    const abort = new AbortController(); const before = await formal();
    const cancel = () => { abort.abort(); }; db.profiles.hook("updating", cancel);
    await expect(repository.confirmImportedResume({ signal: abort.signal, importId: draft.importId, expectedDraftRevision: draft.revision, expectedReconciliationRevision: plan.revision, operationId: "cancel", target: { mode: "existing", profileId: p.id, createGeneralResume: false } })).rejects.toThrow();
    db.profiles.hook("updating").unsubscribe(cancel);
    expect(await formal()).toEqual(before); expect((await repository.getImportedResumeDraft(draft.importId))!.status).toBe("reviewing");
    await confirm(draft, p.id); expect((await repository.getProfile(p.id))!.certificates).toHaveLength(1);
  });

  it("Hermes uses the Host bound Profile rather than a model supplied target", async () => {
    const p = await profile();
    const call = vi.fn(async () => ({ ok: true, data: { importId: "material-profile:bound", expectedDraftRevision: 0 }, artifacts: [], receipt: { operationId: "material", toolName: "career.material.prepare", status: "completed" as const, completedAt: new Date().toISOString() } }));
    const result = await executeCareerWorkflowFacade("career.workflow.material_intake", { attachmentId: "owned", targetProfileId: "other-profile", destination: "profile" }, {
      agentSessionId: "session-a", careerSessionBinding: { agentSessionId: "session-a", personId: p.personId!, profileId: p.id, profileVersionNumber: p.profileVersionNumber ?? 1, profileRevision: p.version }
    }, "prepare", call);
    expect(call.mock.calls[0]).toBeDefined();
    expect(call).toHaveBeenCalledWith("career.material.prepare", expect.objectContaining({ targetProfileId: p.id, sessionId: "session-a" }), expect.anything());
    expect(result.data.workflowCheckpoint).toMatchObject({ kind: "resume_import_review", materialDestination: "profile" });
  });

  it.each(["education", "work", "internship", "project", "awards", "certificates", "skills", "languages", "other"] as const)("B03 user classification to %s changes canonical type and preserves all source text", async (type) => {
    const f = await prepare(); const next = reclassifyMaterialSection(f.draft, f.draft.sections[0].id, type);
    expect(next.sections[0].items[0].structuredItem?.sectionType).toBe(type);
    expect(next.sections[0].items[0].rawText).toBe(f.draft.sections[0].items[0].rawText);
    expect(next.sections[0].items[0].userConfirmed).toBe(false);
  });

  it("B17 a new-person receipt is reused only for its authoritative Profile, and explicit another-person intent gets a fresh task", async () => {
    const f = await prepare(); const result = await confirm(await reviewed(f.draft));
    const existing = await service.prepare({ attachmentId: f.ref.id, targetProfileId: result.profileId, destination: "profile" }, "center");
    expect(existing).toMatchObject({ status: "already_saved", profileId: result.profileId });
    const another = await service.prepare({ attachmentId: f.ref.id, newProfileIntentId: "explicit-other-person", destination: "profile" }, "center");
    expect(another.importId).not.toBe(f.draft.importId); expect(another.status).toBe("ready_for_review");
  });

  it("B1 persists the real material Gateway result into Host TaskState before narration ends and restores its exact draft", async () => {
    const p = await profile(); await repository.setActiveProfileId(p.id);
    const registry = createAgentToolRegistry(new BrowserAgentToolService(repository));
    const gateway = new CareerToolGateway({ registry, executor: new AgentExecutor(registry) });
    const persistence = new AgentSessionStore(repository);
    const pendingSaves = vi.spyOn(persistence, "save");
    const initial = await persistence.save(AgentRuntime.createConversationSession("材料核对", await repository.getActiveCareerContext()));
    const file = new File([document()], "host-material.json", { type: "application/json" });
    const local = await store.register(file, { agentSessionId: initial.id });
    const ref = await agentAttachmentStore.register(file, { agentSessionId: initial.id });
    expect(ref.id).toBe(local.id);
    try {
      const host = new AgentHostStore({ repository, persistence, executor: new CareerToolGatewayExecutor(registry, gateway) }); host.adopt(initial);
      const shell = await host.beginRuntimeShell({ session: initial, userMessage: "将证书整理到当前资料库", runtimeId: "hermes" });
      const before = await formal();
      const result = await gateway.execute("career.workflow.material_intake", { attachmentId: ref.id, destination: "profile" }, {
        agentSessionId: initial.id, logicalTurnId: shell.turnId, operationId: "host-material", careerSessionBinding: {
          agentSessionId: initial.id, personId: p.personId!, profileId: p.id, profileVersionNumber: p.profileVersionNumber ?? 1, profileRevision: p.version
        }
      });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      await host.applyRuntimeEvent({ type: "tool_call_completed", sessionId: initial.id, turnId: shell.turnId, timestamp: new Date().toISOString(),
        toolName: "career.workflow.material_intake", operationId: "host-material", data: { result } }, shell.assistantMessageId);
      const persisted = (await persistence.get(initial.id))!;
      expect(persisted.activeTurn?.status).toBe("running"); expect(persisted.taskState?.workflowId).toBe("resume_import");
      expect(persisted.taskState).toEqual(host.getSnapshot().activeSession?.taskState);
      const sources = await repository.getMaterialIntake(ref.id, initial.id);
      expect(JSON.stringify(persisted.taskState)).toContain(sources!.importId!);
      const reloaded = new AgentHostStore({ repository, persistence, executor: new CareerToolGatewayExecutor(registry, gateway) }); reloaded.adopt(persisted);
      expect(reloaded.getSnapshot().activeSession?.taskState).toEqual(persisted.taskState);
      expect((await new AgentAttachmentStore(repository).restore(ref.id, initial.id)).ref.hash).toBe(ref.hash);
      expect(await formal()).toEqual(before);
      // adopt may persist an orphaned-turn recovery projection asynchronously.
      // Drain the actual writes before this isolated test database is closed.
      await Promise.all(pendingSaves.mock.results.filter((entry) => entry.type === "return").map((entry) => entry.value));
    } finally { agentAttachmentStore.release(ref.id); }
  });
});
