import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { ResumeImportOrchestrator } from "@/services/resumeImport/ResumeImportOrchestrator";
import { ProfileReconciliationEngine } from "@/domain/profileReconciliation/ProfileReconciliationEngine";
import type { ImportMergeDecision } from "@/domain/schemas";

// V4-P2-C：JSON 简历导入分支问题（v4-plan.md §2 第 2 条）的回归认证。
// 历史缺陷：JSON 导入走到确认流程但 resumeBranches 无记录且无原因。
// 修复后：
// 1. profile-only 结果必须携带显式 branchDisposition（不再静默缺失）；
// 2. commit_resume_import 的 existing 模式支持显式请求创建通用简历分支；
// 3. 未决对账是结构化失败（profile_reconciliation_unresolved），不产生半提交。

const CANONICAL_JSON = readFileSync("tests/fixtures/resume-import/reconciliation-v2.json", "utf8");

async function prepareJsonImport(database: CareerAdaptDb, repository: WorkspaceRepository, op: string) {
  const orchestrator = new ResumeImportOrchestrator(repository);
  const file = new File([CANONICAL_JSON], `resume-${op}.json`, { type: "application/json" });
  return orchestrator.prepare({
    fileName: `resume-${op}.json`,
    mimeType: "application/json",
    size: file.size,
    file
  }, { semanticMode: "local" });
}

/**
 * UI 向导的等价逻辑：确认因对账未决失败时，用引擎现场重建计划（首次失败时
 * 计划尚未持久化）、把基本信息待决项逐个解决（use_imported）后重试确认。
 */
async function confirmWithReconciliationResolved(
  database: CareerAdaptDb,
  repository: WorkspaceRepository,
  prepared: { importId: string; draftRevision: number },
  operationId: string,
  target: { mode: "existing"; profileId: string; createGeneralResume?: true } | { mode: "new"; profileName: string; createGeneralResume: true }
) {
  try {
    return await repository.confirmImportedResume({
      importId: prepared.importId,
      expectedDraftRevision: prepared.draftRevision,
      operationId,
      target
    });
  } catch (error) {
    if ((error as Error).message !== "profile_reconciliation_unresolved") throw error;
    const storedDraft = await database.appMeta.get(`importedResumeDraft:${prepared.importId}`);
    const plan = new ProfileReconciliationEngine().createPlan({
      draft: storedDraft?.value as never,
      profile: await database.profiles.get((target as { profileId: string }).profileId) as never,
      now: new Date().toISOString()
    });
    const mergeDecisions: ImportMergeDecision[] = [];
    for (const pending of plan.decisions.filter((d) => d.requiresUserConfirmation && !d.resolution)) {
      const candidate = plan.candidates.find((c) => c.incomingItemId === pending.incomingItemId);
      if (candidate?.entityType !== "basic") continue;
      mergeDecisions.push({
        target: candidate.normalizedFields.field as ImportMergeDecision["target"],
        importedValue: candidate.factStatements[0],
        action: "use_imported"
      });
    }
    // expectedReconciliationRevision 只在存在持久化权威计划时才传；
    // 首次失败重试时计划尚未持久化，传现场重建值会被视为不一致。
    return repository.confirmImportedResume({
      importId: prepared.importId,
      expectedDraftRevision: prepared.draftRevision,
      operationId,
      mergeDecisions,
      target
    });
  }
}

async function seedProfileWithBranch(database: CareerAdaptDb, repository: WorkspaceRepository) {
  const first = await prepareJsonImport(database, repository, "seed");
  await repository.confirmImportedResume({
    importId: first.importId,
    expectedDraftRevision: first.draftRevision,
    operationId: `op-json-${first.importId}`,
    target: { mode: "new", profileName: "JSON 用户", createGeneralResume: true }
  });
  return (await database.profiles.toArray())[0].id;
}

describe("V4-P2-C: JSON resume import branch certification", () => {
  it("mode new with createGeneralResume creates a general branch", async () => {
    const database = new CareerAdaptDb(`v4p2c-json-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(database);
    const prepared = await prepareJsonImport(database, repository, "new");

    const result = await repository.confirmImportedResume({
      importId: prepared.importId,
      expectedDraftRevision: prepared.draftRevision,
      operationId: "op-json-new",
      target: { mode: "new", profileName: "JSON 用户", createGeneralResume: true }
    });

    expect(result.branchId).toBeTruthy();
    const branches = await database.resumeBranches.toArray();
    expect(branches).toHaveLength(1);
    expect(branches[0].branchPurpose).toBe("general");
    await database.delete();
  });

  it("mode existing with createGeneralResume creates a second branch after reconciliation is resolved", async () => {
    const database = new CareerAdaptDb(`v4p2c-json-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(database);
    const profileId = await seedProfileWithBranch(database, repository);

    const second = await prepareJsonImport(database, repository, "existing");
    const result = await confirmWithReconciliationResolved(database, repository, second, "op-json-existing", {
      mode: "existing", profileId, createGeneralResume: true
    });

    expect(result.branchId).toBeTruthy();
    const branches = await database.resumeBranches.toArray();
    expect(branches).toHaveLength(2);
    await database.delete();
  });

  it("mode existing without flag: profile-only result with explicit branchDisposition (no silent missing branch)", async () => {
    const database = new CareerAdaptDb(`v4p2c-json-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(database);
    const profileId = await seedProfileWithBranch(database, repository);

    const second = await prepareJsonImport(database, repository, "agent");
    const result = await confirmWithReconciliationResolved(database, repository, second, "op-json-agent", {
      mode: "existing", profileId
    });

    // 不再有静默的无分支结果：profile-only 必须携带显式原因。
    expect(result.branchId).toBeUndefined();
    expect((result as { branchDisposition?: string }).branchDisposition).toBe("merged_into_existing_general_resume");
    const branches = await database.resumeBranches.toArray();
    expect(branches).toHaveLength(1);
    await database.delete();
  });

  it("unresolved reconciliation is a structured failure, not a silent partial commit", async () => {
    const database = new CareerAdaptDb(`v4p2c-json-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(database);
    const profileId = await seedProfileWithBranch(database, repository);

    const second = await prepareJsonImport(database, repository, "unresolved");
    await expect(repository.confirmImportedResume({
      importId: second.importId,
      expectedDraftRevision: second.draftRevision,
      operationId: "op-json-unresolved",
      target: { mode: "existing", profileId }
    })).rejects.toThrow("profile_reconciliation_unresolved");

    // 失败不得产生半提交：分支数量不变、本次操作没有留下确认结果记录、草稿保持 reviewing。
    // 注意只检查本次 operationId：seed 导入自身已合法写入一条幂等结果记录。
    expect(await database.resumeBranches.toArray()).toHaveLength(1);
    expect(await database.appMeta.get("resumeImportOperation:v1:op-json-unresolved")).toBeUndefined();
    const storedDraft = await database.appMeta.get(`importedResumeDraft:${second.importId}`);
    expect((storedDraft?.value as { status?: string }).status).toBe("reviewing");
    void profileId;
    await database.delete();
  });

  it("the commit_resume_import tool schema accepts createGeneralResume for existing profiles", async () => {
    const database = new CareerAdaptDb(`v4p2c-json-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(database);
    const { createAgentToolRegistry } = await import("@/agent/tools/registry");
    const { BrowserAgentToolService } = await import("@/services/agent/agentToolService");
    const registry = createAgentToolRegistry(new BrowserAgentToolService(repository));
    const tool = registry.require("commit_resume_import");
    const parsed = tool.inputSchema.parse({
      importId: "import-1",
      expectedDraftRevision: 0,
      target: { mode: "existing", profileId: "profile-1", createGeneralResume: true }
    });
    expect((parsed as { target: unknown }).target).toEqual({ mode: "existing", profileId: "profile-1", createGeneralResume: true });
    await database.delete();
  });
});
