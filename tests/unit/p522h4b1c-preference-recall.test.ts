import { afterEach, expect, it, vi } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { careerSessionCheckpoint } from "@/agent/runtime/careerSessionCheckpoint";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

let db: CareerAdaptDb;
afterEach(async () => { vi.restoreAllMocks(); db?.close(); if (db) await db.delete(); });

it("projects confirmed preferences into an independent new session without prior conversation", async () => {
  db = new CareerAdaptDb(`preference-recall-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const { profile } = await repository.createPerson("测试");
  const saved = await repository.saveProfile({ ...profile, version: profile.version + 1,
    preference: { targetRoles: ["供应链助理"], targetCities: ["郑州"], industries: [] } });
  await repository.updateCareerPreferences({ profileId: saved.id, expectedProfileRevision: saved.version, operationId: "confirmed",
    patch: { additions: { targetRoles: ["跨境电商运营"], targetCities: ["上海"] } } });
  const context = await repository.getActiveCareerContext();
  const session = AgentRuntime.createConversationSession("独立新会话", context);
  expect(session.messages).toEqual([]);
  const access = await new BrowserAgentToolService(repository).prepareAvailableRuntimeContext(session, false);
  expect(access.trustedCareerPreferences).toEqual({ profileId: saved.id, profileRevision: saved.version + 1,
    targetRoles: ["供应链助理", "跨境电商运营"], targetCities: ["郑州", "上海"], industries: [] });
  expect(careerSessionCheckpoint(undefined, access.trustedCareerPreferences)).toMatchObject({ workflowId: "conversation",
    careerPreferences: access.trustedCareerPreferences });
  expect(JSON.stringify(access.trustedCareerPreferences)).not.toContain("未保存的候选");
});
