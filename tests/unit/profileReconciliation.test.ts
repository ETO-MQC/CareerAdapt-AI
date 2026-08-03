import { afterEach, describe, expect, it } from "vitest";
import { buildResumeImportConfirmation } from "@/domain/resumeImport/confirm";
import { createImportedResumeDraftFromStructuredJson } from "@/domain/resumeImport/parser";
import { ProfileReconciliationEngine } from "@/domain/profileReconciliation/ProfileReconciliationEngine";
import type { CareerAdaptResumeJsonV2, ImportedResumeDraft, ResumeItemV2 } from "@/domain/schemas";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";

const NOW = "2026-07-27T08:00:00.000Z";
let database: CareerAdaptDb | undefined;

afterEach(async () => {
  if (!database) return;
  await database.delete();
  database.close();
  database = undefined;
});

describe("ProfileReconciliationEngine deterministic matching", () => {
  it("A/J classifies the exact same fact and source as an idempotent exact duplicate", () => {
    const existingDraft = draft("same", "resume-a.json", [
      work("work-a", { highlights: ["Built deterministic import pipeline."] })
    ]);
    const profile = profileFrom(existingDraft);
    const plan = reconcile(existingDraft, profile);

    expect(plan.decisions).toHaveLength(1);
    expect(plan.decisions[0]).toMatchObject({
      state: "exact_duplicate",
      existingEntityId: expect.any(String),
      requiresUserConfirmation: false,
      reasonCode: "same_source_already_represented"
    });
  });

  it("B recognizes the same experience with changed narrative as a compatible update", () => {
    const profile = profileFrom(draft("wording-a", "resume-a.json", [
      work("work-a", { highlights: ["Implemented the AI Command Stream."] })
    ]));
    const plan = reconcile(draft("wording-b", "resume-b.json", [
      work("work-b", { highlights: ["Built and shipped an AI command streaming workflow."] })
    ]), profile);

    expect(plan.decisions[0]).toMatchObject({
      state: "compatible_update",
      existingEntityId: expect.any(String),
      requiresUserConfirmation: false
    });
  });

  it("C ignores reordered structured bullet text while retaining new evidence", () => {
    const profile = profileFrom(draft("bullets-a", "resume-a.json", [
      project("project-a", { highlights: ["React 19", "Tauri 2", "AI Command Stream"] })
    ]));
    const plan = reconcile(draft("bullets-b", "resume-b.json", [
      project("project-b", { highlights: ["AI Command Stream", "Tauri 2", "React 19"] })
    ]), profile);

    expect(plan.decisions[0]).toMatchObject({
      state: "evidence_extension",
      existingEntityId: expect.any(String),
      requiresUserConfirmation: false
    });
  });

  it("D/F splits skills before identity matching without unsafe substring matches", () => {
    const profile = profileFrom(draft("skills-a", "resume-a.json", [
      skill("python-a", "Python"),
      skill("sql-a", "SQL"),
      skill("c-a", "C"),
      skill("cpp-a", "C++")
    ]));
    const plan = reconcile(draft("skills-b", "resume-b.json", [
      skill("skills-b", "Python、SQL、Stata"),
      skill("csharp-b", "C#")
    ]), profile);

    expect(plan.candidates.map((candidate) => candidate.normalizedFields.name)).toEqual([
      "python", "sql", "stata", "c#"
    ]);
    expect(plan.decisions.map((decision) => decision.state)).toEqual([
      "evidence_extension", "evidence_extension", "new_fact", "new_fact"
    ]);
  });

  it("F reconciles a repeated combined skill item after the initial import split", () => {
    const original = draft("combined-skills-a", "resume-a.json", [
      skill("combined-a", "Python、SQL、Stata")
    ]);
    const profile = profileFrom(original);
    const plan = reconcile(repeatDraft(original, "combined-skills-repeat"), profile);

    expect(profile.skills.map((item) => item.name)).toEqual(["Python", "SQL", "Stata"]);
    expect(plan.decisions.map((decision) => decision.state)).toEqual([
      "exact_duplicate", "exact_duplicate", "exact_duplicate"
    ]);
  });

  it("E normalizes harmless project-title formatting", () => {
    const profile = profileFrom(draft("project-format-a", "resume-a.json", [
      project("project-a", { title: "示例任务系统" })
    ]));
    const plan = reconcile(draft("project-format-b", "resume-b.json", [
      project("project-b", { title: "示例任务 系统" })
    ]), profile);

    expect(plan.decisions[0].state).toBe("evidence_extension");
  });

  it("F creates a real conflict for materially different dates", () => {
    const profile = profileFrom(draft("date-a", "resume-a.json", [
      work("work-a", { startDate: "2024-09" })
    ]));
    const plan = reconcile(draft("date-b", "resume-b.json", [
      work("work-b", { startDate: "2024-10" })
    ]), profile);

    expect(plan.decisions[0]).toMatchObject({
      state: "conflict",
      requiresUserConfirmation: true,
      conflictId: expect.any(String)
    });
    expect(plan.conflicts[0].fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "startDate", relation: "conflicting" })
    ]));
    expect(plan.summary.requiresReview).toBe(1);
  });

  it("keeps a materially different basic identity behind explicit confirmation", () => {
    const profile = profileFrom(draft("basic-a", "resume-a.json", [skill("skill-a", "Python")]));
    const incoming = {
      ...draft("basic-b", "resume-b.json", [skill("skill-b", "Python")]),
      basics: {
        ...draft("basic-b-source", "resume-b.json", []).basics,
        name: {
          value: "Different Person",
          confidence: "high" as const,
          sourceBlockIds: ["basic-name"],
          sourcePaths: ["basics.name"],
          pageRefs: [],
          sourceStatus: "located" as const,
          userEdited: false
        }
      }
    };
    const withExistingName = {
      ...profile,
      name: "Original Person",
      basics: { ...profile.basics, name: "Original Person" }
    };
    const plan = reconcile(incoming, withExistingName);

    expect(plan.decisions.find((decision) => decision.incomingItemId === "basic:name")).toMatchObject({
      state: "conflict",
      requiresUserConfirmation: true
    });
  });

  it("G/I keeps one fact identity while a second file extends evidence", () => {
    const profile = profileFrom(draft("source-a", "resume-a.json", [
      project("project-a", { highlights: ["Built AI Command Stream."] })
    ]));
    const plan = reconcile(draft("source-b", "resume-b.json", [
      project("project-b", { highlights: ["Built AI Command Stream."] })
    ]), profile);

    expect(plan.decisions[0]).toMatchObject({
      state: "evidence_extension",
      existingFactIds: [expect.any(String)]
    });
    expect(plan.decisions[0].sourceProvenance[0].fileName).toBe("resume-b.json");
  });

  it("E detects a compatible additional field without fabricating a conflict", () => {
    const profile = profileFrom(draft("location-a", "resume-a.json", [
      work("work-a", { location: undefined })
    ]));
    const plan = reconcile(draft("location-b", "resume-b.json", [
      work("work-b", { location: "Remote" })
    ]), profile);

    expect(plan.decisions[0]).toMatchObject({
      state: "compatible_update",
      requiresUserConfirmation: false
    });
    expect(plan.decisions[0].fieldComparisons).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "location", relation: "missing_existing" })
    ]));
  });

  it("G uses certificate credential ID before fallback identity", () => {
    const profile = profileFrom(draft("cert-a", "resume-a.json", [
      certificate("cert-a", { name: "Cloud Professional", issuer: "Vendor A", credentialId: "ABC-123" })
    ]));
    const plan = reconcile(draft("cert-b", "resume-b.json", [
      certificate("cert-b", { name: "Cloud Professional", issuer: "Vendor A", credentialId: "abc123", issuedAt: "2026-03" })
    ]), profile);

    expect(plan.decisions[0]).toMatchObject({
      state: "compatible_update",
      existingEntityId: expect.any(String),
      requiresUserConfirmation: false
    });
  });

  it("does not let a matching credential ID hide a conflicting issuer", () => {
    const profile = profileFrom(draft("cert-conflict-a", "resume-a.json", [
      certificate("cert-a", { name: "Cloud Professional", issuer: "Vendor A", credentialId: "ABC-123" })
    ]));
    const plan = reconcile(draft("cert-conflict-b", "resume-b.json", [
      certificate("cert-b", { name: "Cloud Professional", issuer: "Vendor B", credentialId: "ABC-123" })
    ]), profile);

    expect(plan.decisions[0]).toMatchObject({ state: "conflict", requiresUserConfirmation: true });
  });

  it("H matches a structured project entity while reconciling facts independently", () => {
    const profile = profileFrom(draft("structured-a", "resume-a.json", [
      project("project-a", {
        title: "示例任务系统",
        highlights: ["Tauri", "React", "AI Command Stream"]
      })
    ]));
    const plan = reconcile(draft("structured-b", "resume-b.json", [
      project("project-b", {
        title: "示例任务 系统",
        highlights: ["React 19", "Tauri 2", "implemented AI Command Stream"]
      })
    ]), profile);

    expect(plan.decisions[0]).toMatchObject({
      state: "compatible_update",
      existingEntityId: expect.any(String),
      existingFactIds: [expect.any(String)]
    });
  });

  it("K keeps materially distinct similar projects out of automatic merge", () => {
    const profile = profileFrom(draft("distinct-a", "resume-a.json", [
      project("project-a", { title: "示例任务系统", startDate: "2025-01", endDate: "2025-12", current: false })
    ]));
    const plan = reconcile(draft("distinct-b", "resume-b.json", [
      project("project-b", { title: "示例任务系统 Enterprise", startDate: "2026-01", endDate: "2026-12", current: false })
    ]), profile);

    expect(plan.decisions[0].state).toBe("new_fact");
    expect(plan.decisions[0].requiresUserConfirmation).toBe(false);
  });

  it("L keeps unresolved conflicts as one stable blocking review unit", () => {
    const engine = new ProfileReconciliationEngine();
    const profile = profileFrom(draft("blocking-a", "resume-a.json", [
      work("work-a", { startDate: "2024-09" })
    ]));
    const plan = engine.createPlan({
      draft: draft("blocking-b", "resume-b.json", [work("work-b", { startDate: "2024-10" })]),
      profile,
      now: NOW
    });
    const deferred = engine.resolve({
      plan,
      incomingItemId: plan.decisions[0].incomingItemId,
      resolution: "defer",
      now: NOW
    });
    const resolved = engine.resolve({
      plan,
      incomingItemId: plan.decisions[0].incomingItemId,
      resolution: "keep_existing",
      now: NOW
    });

    expect(plan.reviewUnits).toHaveLength(1);
    expect(deferred.status).toBe("needs_review");
    expect(deferred.summary.requiresReview).toBe(1);
    expect(resolved.status).toBe("resolved");
    expect(resolved.summary.requiresReview).toBe(0);
  });

  it("I/J fuses two sources once and keeps the same source fully idempotent", async () => {
    const repository = createRepository();
    const original = located(draft("repository-source-a", "resume-a.json", [
      project("project-a", { highlights: ["Built AI Command Stream."] }),
      skill("python-a", "Python")
    ]));
    const savedOriginal = await repository.saveImportedResumeDraft(original, 0);
    const first = await repository.confirmImportedResume({
      importId: savedOriginal.importId,
      expectedDraftRevision: savedOriginal.revision,
      operationId: "reconciliation-first-import",
      target: { mode: "new", profileName: "测试用户", createGeneralResume: true }
    });
    const before = (await repository.getProfile(first.profileId))!;
    const branchesBefore = await repository.listResumeBranches(first.profileId);

    const secondSource = located(draft("repository-source-b", "resume-b.json", [
      project("project-b", { highlights: ["Built AI Command Stream."] }),
      skill("python-b", "Python")
    ]));
    const savedSecond = await repository.saveImportedResumeDraft(secondSource, 0);
    const evidencePlan = await repository.reconcileImportedResume({
      importId: savedSecond.importId,
      expectedDraftRevision: savedSecond.revision,
      profileId: first.profileId
    });
    expect(evidencePlan.decisions.every((decision) => decision.state === "evidence_extension")).toBe(true);
    const second = await repository.confirmImportedResume({
      importId: savedSecond.importId,
      expectedDraftRevision: savedSecond.revision,
      expectedReconciliationRevision: evidencePlan.revision,
      operationId: "reconciliation-second-source",
      target: { mode: "existing", profileId: first.profileId }
    });
    expect(second.branchId).toBeUndefined();
    const afterEvidence = (await repository.getProfile(first.profileId))!;
    expect(afterEvidence.version).toBe(before.version + 1);
    expect(afterEvidence.experiences).toHaveLength(before.experiences.length);
    expect(afterEvidence.skills).toHaveLength(before.skills.length);
    expect(afterEvidence.experiences[0].facts[0].provenance.map((item) => item.fileName)).toEqual([
      "resume-a.json", "resume-b.json"
    ]);

    const repeated = repeatDraft(secondSource, "repository-source-b-repeat");
    const savedRepeated = await repository.saveImportedResumeDraft(repeated, 0);
    const repeatedPlan = await repository.reconcileImportedResume({
      importId: savedRepeated.importId,
      expectedDraftRevision: savedRepeated.revision,
      profileId: first.profileId
    });
    expect(repeatedPlan.decisions.every((decision) => decision.state === "exact_duplicate")).toBe(true);
    const repeatedResult = await repository.confirmImportedResume({
      importId: savedRepeated.importId,
      expectedDraftRevision: savedRepeated.revision,
      expectedReconciliationRevision: repeatedPlan.revision,
      operationId: "reconciliation-same-source-repeat",
      target: { mode: "existing", profileId: first.profileId }
    });
    const afterRepeat = (await repository.getProfile(first.profileId))!;
    expect(repeatedResult.branchId).toBeUndefined();
    expect(afterRepeat).toEqual(afterEvidence);
    expect(await repository.listResumeBranches(first.profileId)).toHaveLength(branchesBefore.length);
  });

  it("L blocks repository commit until the conflict has an explicit non-deferred resolution", async () => {
    const repository = createRepository();
    const original = await repository.saveImportedResumeDraft(located(draft("repository-conflict-a", "resume-a.json", [
      work("work-a", { startDate: "2024-09" })
    ])), 0);
    const first = await repository.confirmImportedResume({
      importId: original.importId,
      expectedDraftRevision: original.revision,
      operationId: "conflict-first",
      target: { mode: "new", profileName: "测试用户", createGeneralResume: true }
    });
    const revised = await repository.saveImportedResumeDraft(located(draft("repository-conflict-b", "resume-b.json", [
      work("work-b", { startDate: "2024-10" })
    ])), 0);
    const plan = await repository.reconcileImportedResume({
      importId: revised.importId,
      expectedDraftRevision: revised.revision,
      profileId: first.profileId
    });

    await expect(repository.confirmImportedResume({
      importId: revised.importId,
      expectedDraftRevision: revised.revision,
      expectedReconciliationRevision: plan.revision,
      operationId: "conflict-blocked",
      target: { mode: "existing", profileId: first.profileId }
    })).rejects.toThrow("profile_reconciliation_unresolved");

    const resolved = await repository.resolveProfileReconciliation({
      importId: revised.importId,
      expectedPlanRevision: plan.revision,
      incomingItemId: plan.decisions[0].incomingItemId,
      resolution: "keep_existing"
    });
    await expect(repository.confirmImportedResume({
      importId: revised.importId,
      expectedDraftRevision: revised.revision,
      expectedReconciliationRevision: resolved.revision,
      operationId: "conflict-resolved",
      target: { mode: "existing", profileId: first.profileId }
    })).resolves.toMatchObject({ profileId: first.profileId, branchId: undefined });
  });

  it("uses imported conflicting fields as one authoritative update with provenance after reload", async () => {
    const repository = createRepository();
    const original = await repository.saveImportedResumeDraft(located(draft("use-imported-a", "resume-a.json", [
      work("work-a", { startDate: "2024-09" })
    ])), 0);
    const first = await repository.confirmImportedResume({
      importId: original.importId,
      expectedDraftRevision: original.revision,
      operationId: "use-imported-first",
      target: { mode: "new", profileName: "测试用户", createGeneralResume: true }
    });
    const before = (await repository.getProfile(first.profileId))!;
    const existingId = before.experiences[0].id;
    const incoming = await repository.saveImportedResumeDraft(located(draft("use-imported-b", "resume-b.json", [
      work("work-b", { startDate: "2024-10" })
    ])), 0);
    const plan = await repository.reconcileImportedResume({
      importId: incoming.importId,
      expectedDraftRevision: incoming.revision,
      profileId: first.profileId
    });
    const resolved = await repository.resolveProfileReconciliation({
      importId: incoming.importId,
      expectedPlanRevision: plan.revision,
      incomingItemId: plan.decisions[0].incomingItemId,
      resolution: "use_imported"
    });
    await repository.confirmImportedResume({
      importId: incoming.importId,
      expectedDraftRevision: incoming.revision,
      expectedReconciliationRevision: resolved.revision,
      operationId: "use-imported-commit",
      target: { mode: "existing", profileId: first.profileId }
    });

    const reloaded = (await new WorkspaceRepository(database!).getProfile(first.profileId))!;
    expect(reloaded.experiences).toHaveLength(before.experiences.length);
    expect(reloaded.experiences[0]).toMatchObject({ id: existingId, startDate: "2024-10" });
    expect(reloaded.experiences[0].facts[0].provenance.map((item) => item.fileName)).toEqual([
      "resume-a.json", "resume-b.json"
    ]);
  });

  it("keeps a reviewed similar item as a distinct canonical asset with unique provenance after reload", async () => {
    const repository = createRepository();
    const original = await repository.saveImportedResumeDraft(located(draft("keep-both-a", "resume-a.json", [
      project("project-a", { title: "示例任务系统", startDate: "2025-01", endDate: "2025-12", current: false })
    ])), 0);
    const first = await repository.confirmImportedResume({
      importId: original.importId,
      expectedDraftRevision: original.revision,
      operationId: "keep-both-first",
      target: { mode: "new", profileName: "测试用户", createGeneralResume: true }
    });
    const incoming = await repository.saveImportedResumeDraft(located(draft("keep-both-b", "resume-b.json", [
      project("project-b", { title: "示例任务系统", startDate: "2026-01", endDate: "2026-12", current: false })
    ])), 0);
    const plan = await repository.reconcileImportedResume({
      importId: incoming.importId,
      expectedDraftRevision: incoming.revision,
      profileId: first.profileId
    });
    expect(plan.decisions[0].requiresUserConfirmation).toBe(true);
    const resolved = await repository.resolveProfileReconciliation({
      importId: incoming.importId,
      expectedPlanRevision: plan.revision,
      incomingItemId: plan.decisions[0].incomingItemId,
      resolution: "keep_both_as_distinct"
    });
    await repository.confirmImportedResume({
      importId: incoming.importId,
      expectedDraftRevision: incoming.revision,
      expectedReconciliationRevision: resolved.revision,
      operationId: "keep-both-commit",
      target: { mode: "existing", profileId: first.profileId }
    });

    const reloaded = (await new WorkspaceRepository(database!).getProfile(first.profileId))!;
    const projects = reloaded.experiences.filter((item) => item.type === "project");
    expect(projects).toHaveLength(2);
    expect(new Set(projects.map((item) => item.id)).size).toBe(2);
    expect(projects.map((item) => item.facts[0].provenance[0].fileName).sort()).toEqual([
      "resume-a.json", "resume-b.json"
    ]);
  });

  it("R invalidates a reconciliation plan when the authoritative Profile version changes", async () => {
    const repository = createRepository();
    const original = await repository.saveImportedResumeDraft(located(draft("repository-stale-a", "resume-a.json", [
      project("project-a")
    ])), 0);
    const first = await repository.confirmImportedResume({
      importId: original.importId,
      expectedDraftRevision: original.revision,
      operationId: "stale-first",
      target: { mode: "new", profileName: "测试用户", createGeneralResume: true }
    });
    const revised = await repository.saveImportedResumeDraft(located(draft("repository-stale-b", "resume-b.json", [
      project("project-b")
    ])), 0);
    const plan = await repository.reconcileImportedResume({
      importId: revised.importId,
      expectedDraftRevision: revised.revision,
      profileId: first.profileId
    });
    const profile = (await repository.getProfile(first.profileId))!;
    await repository.saveProfile({ ...profile, version: profile.version + 1, updatedAt: "2026-07-27T09:00:00.000Z" });

    await expect(repository.confirmImportedResume({
      importId: revised.importId,
      expectedDraftRevision: revised.revision,
      expectedReconciliationRevision: plan.revision,
      operationId: "stale-blocked",
      target: { mode: "existing", profileId: first.profileId }
    })).rejects.toThrow();
  });

  it("P exposes the same persisted plan to Manual Wizard and Agent clients", async () => {
    const repository = createRepository();
    const firstDraft = await repository.saveImportedResumeDraft(located(draft("parity-a", "resume-a.json", [
      project("project-a"), skill("skill-a", "Python")
    ])), 0);
    const first = await repository.confirmImportedResume({
      importId: firstDraft.importId,
      expectedDraftRevision: firstDraft.revision,
      operationId: "parity-first",
      target: { mode: "new", profileName: "Parity", createGeneralResume: true }
    });
    const incoming = await repository.saveImportedResumeDraft(located(draft("parity-b", "resume-b.json", [
      project("project-b"), skill("skill-b", "Python、SQL")
    ])), 0);
    const manualPlan = await repository.reconcileImportedResume({
      importId: incoming.importId,
      expectedDraftRevision: incoming.revision,
      profileId: first.profileId
    });
    const agentResult = await new BrowserAgentToolService(repository).reconcileResumeImport({
      importId: incoming.importId,
      expectedDraftRevision: incoming.revision,
      profileId: first.profileId
    }) as Record<string, unknown>;

    expect(agentResult.summary).toEqual(manualPlan.summary);
    expect(agentResult.expectedPlanRevision).toBe(manualPlan.revision);
    expect(await repository.getProfileReconciliationPlan(incoming.importId)).toEqual(manualPlan);
  });

  it("Q reload preserves unresolved reconciliation decisions and revision", async () => {
    const repository = createRepository();
    const original = await repository.saveImportedResumeDraft(located(draft("reload-a", "resume-a.json", [
      work("work-a", { startDate: "2024-09" })
    ])), 0);
    const first = await repository.confirmImportedResume({
      importId: original.importId,
      expectedDraftRevision: original.revision,
      operationId: "reload-first",
      target: { mode: "new", profileName: "Reload", createGeneralResume: true }
    });
    const revised = await repository.saveImportedResumeDraft(located(draft("reload-b", "resume-b.json", [
      work("work-b", { startDate: "2024-10" })
    ])), 0);
    const plan = await repository.reconcileImportedResume({
      importId: revised.importId,
      expectedDraftRevision: revised.revision,
      profileId: first.profileId
    });
    const reloadedRepository = new WorkspaceRepository(database!);

    expect(await reloadedRepository.getProfileReconciliationPlan(revised.importId)).toEqual(plan);
    expect(plan.status).toBe("needs_review");
    expect(plan.reviewUnits).toEqual([expect.objectContaining({ resolved: false })]);
  });
});

function reconcile(incoming: ImportedResumeDraft, profile: ReturnType<typeof profileFrom>) {
  return new ProfileReconciliationEngine().createPlan({ draft: incoming, profile, now: NOW });
}

function profileFrom(source: ImportedResumeDraft) {
  return buildResumeImportConfirmation({
    draft: located(source),
    newProfileName: "测试用户",
    operationId: `confirm-${source.importId}`,
    now: NOW
  }).profile;
}

function draft(id: string, fileName: string, items: ResumeItemV2[]) {
  const sections = Array.from(new Set(items.map((item) => item.sectionType))).map((sectionType, index) => ({
    id: `section-${id}-${sectionType}`,
    sectionType,
    title: sectionType,
    order: index,
    visible: true,
    items: items.filter((item) => item.sectionType === sectionType)
  }));
  const canonicalResume: CareerAdaptResumeJsonV2 = {
    schemaVersion: "careeradapt-resume-v2",
    locale: "zh-CN",
    basics: { portfolioLinks: [], otherLinks: [], customFields: [] },
    sections,
    unclassifiedBlocks: []
  };
  return createImportedResumeDraftFromStructuredJson({
    importId: `import-${id}`,
    source: {
      fileName,
      mimeType: "application/json",
      fileHash: `hash-${id}-0123456789abcdef`,
      normalizedTextHash: `content-${id}-0123456789abcdef`,
      pageCount: 1,
      extractedAt: NOW
    },
    structuredDraft: { schemaVersion: "structured-resume-draft-v1", basics: {}, sections: [] },
    canonicalResume,
    now: NOW
  });
}

function located<T extends ImportedResumeDraft>(source: T): T {
  return {
    ...source,
    sections: source.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        sourceStatus: "located" as const
      }))
    }))
  } as T;
}

function work(id: string, patch: Partial<Extract<ResumeItemV2, { sectionType: "work" }>> = {}): ResumeItemV2 {
  return {
    id,
    sectionType: "work",
    organization: "Talents AI",
    role: "AI Trainer",
    startDate: "2024-09",
    current: true,
    highlights: ["Built deterministic workflows."],
    customFields: [],
    ...patch
  };
}

function project(id: string, patch: Partial<Extract<ResumeItemV2, { sectionType: "project" }>> = {}): ResumeItemV2 {
  return {
    id,
    sectionType: "project",
    title: "示例任务系统",
    organization: "CareerAdapt",
    startDate: "2025-01",
    current: true,
    tools: [],
    outcomes: [],
    highlights: ["AI Command Stream"],
    customFields: [],
    ...patch
  };
}

function skill(id: string, name: string): ResumeItemV2 {
  return { id, sectionType: "skills", name, customFields: [] };
}

function certificate(
  id: string,
  patch: Partial<Extract<ResumeItemV2, { sectionType: "certificates" }>>
): ResumeItemV2 {
  return { id, sectionType: "certificates", name: "Certificate", customFields: [], ...patch };
}

function createRepository() {
  database = new CareerAdaptDb(`ProfileReconciliation-${crypto.randomUUID()}`);
  return new WorkspaceRepository(database);
}

function repeatDraft(source: ImportedResumeDraft, id: string): ImportedResumeDraft {
  return {
    ...source,
    id: `import-${id}`,
    importId: `import-${id}`,
    revision: 0,
    status: "reviewing",
    confirmedProfileId: undefined,
    confirmedBranchId: undefined,
    confirmedRevisionId: undefined,
    confirmedAt: undefined,
    createdAt: NOW,
    updatedAt: NOW
  };
}
