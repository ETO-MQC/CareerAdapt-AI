import { afterEach, expect, it } from "vitest";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { ProfileIntakeSemanticService } from "@/domain/profileIntake/ProfileIntakeSemanticService";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { CareerProfileSchema } from "@/domain/schemas";
let db: CareerAdaptDb;
afterEach(async () => { db?.close(); if (db) await db.delete(); });
it("identifies the historical failure before any award rename occurs", () => {
  const guard = runRuleFactGuard({ originalText: "我获得蓝桥杯河南省Python A组省级三等奖。",
    checkedText: "参加竞赛并获得省级三等奖。", usedEvidenceRefs: [] });
  expect(guard.status).toBe("blocked_high_risk");
  expect(guard.ruleFindings).toEqual(expect.arrayContaining([expect.objectContaining({ type: "participation_to_owner", allowed: false })]));
});
it.each(["负责接口开发，完成项目交付。", "独立完成接口开发和项目交付。"])("blocks unsupported responsibility or team-result upgrades: %s", async description => {
  db = new CareerAdaptDb(`ux011-award-contract-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const now = "2026-11-05T00:00:00.000Z";
  const profile = await repository.saveProfile(CareerProfileSchema.parse({ id: "anonymous", createdAt: now, updatedAt: now,
    name: "匿名", basics: { name: "匿名", links: [] }, preference: { targetRoles: [], targetCities: [], industries: [] },
    version: 1, schemaVersion: "career-profile-v2", experiences: [], skills: [], evidence: [] }));
  const raw = "我参与课程项目，协助接口开发，团队完成项目交付。";
  const guard = runRuleFactGuard({ originalText: raw, checkedText: description, usedEvidenceRefs: [] });
  expect(guard.status).toBe("blocked_high_risk");
  expect(guard.ruleFindings.some(row => row.type === "participation_to_owner" && !row.allowed)).toBe(true);
  const service = new BrowserAgentToolService(repository, new ProfileIntakeSemanticService(async () => ({ ok: true, data: {
    candidates: [{ candidateKey: "unsafe-project", sectionType: "project", title: "课程项目", role: "负责人", description,
      sourceQuote: raw, confidence: 0.99, needsConfirmation: false, current: false, highlights: [], tools: [], methods: [], outcomes: [],
      fieldEvidence: [{ field: "description", sourceQuote: raw, support: "derived", confidence: 0.99, needsConfirmation: false }] }]
  } })));
  const result = await service.captureProfileIntake({ sessionId: "ux011-award-session", messageId: "ux011-award-message",
    turnId: "ux011-award-turn", text: raw, capturedAt: now, targetProfileId: profile.id, expectedProfileVersion: profile.version });
  expect(result.candidates.every(row => !row.canAccept)).toBe(true);
  expect(await repository.getProfile(profile.id)).toEqual(profile);
  expect(await repository.listResumeBranches(profile.id)).toHaveLength(0);
});
