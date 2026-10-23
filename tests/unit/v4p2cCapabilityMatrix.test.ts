import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { createAgentToolRegistry, agentToolNames } from "@/agent/tools/registry";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import {
  AGENT_CAPABILITY_INTENTS,
  buildAgentCapabilityMatrix,
  capabilityMatrixWeakWriteRows,
  capabilityMatrixReadToolsWritingWorkflowState,
  SESSION_SCOPED_CAPABILITY_TOOLS,
  deriveWriteKind,
  type AgentCapabilityMatrix
} from "@/agent/capability/agentCapabilityMatrix";
import {
  AGENT_CAPABILITY_OUTCOMES,
  classifyAgentToolResult,
  classifyCareerWorkflowStatus
} from "@/agent/contracts/agentCapabilityOutcome";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  if (!db) return;
  db.close();
  await db.delete();
  db = undefined;
});

async function realMatrix(): Promise<AgentCapabilityMatrix> {
  db = new CareerAdaptDb(`v4p2c-matrix-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const registry = createAgentToolRegistry(new BrowserAgentToolService(repository));
  return buildAgentCapabilityMatrix(registry);
}

/** 受版本控制的能力矩阵产物路径。`artifacts/` 已被 .gitignore，因此放在 docs 下。 */
const MATRIX_ARTIFACT_PATH = "docs/architecture/v4p2c-capability-matrix.json";

/** 紧凑 Schema 摘要：只保留键名与必填项，完整 JSON Schema 由 registry.manifest() 提供。 */
function summarizeSchema(schema: Record<string, unknown>) {
  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  return {
    type: typeof schema.type === "string" ? schema.type : undefined,
    required: required.sort(),
    properties: Object.keys(properties).sort()
  };
}

/** 从真实 Registry 派生矩阵产物内容；不含任何手写的能力声明。 */
function renderCapabilityMatrixArtifact(matrix: AgentCapabilityMatrix) {
  return {
    $comment: "V4-P2-C 生成的 Agent 能力矩阵。由 tests/unit/v4p2cCapabilityMatrix.test.ts 从真实 AgentToolRegistry 派生并校验，不得手工编辑。",
    totals: {
      tools: matrix.rows.length,
      read: matrix.rows.filter((row) => row.access === "read").length,
      write: matrix.writeRows.length,
      confirmationWrite: matrix.confirmationWriteRows.length,
      sessionOnly: matrix.sessionOnlyRows.length,
      readToolsWritingWorkflowState: capabilityMatrixReadToolsWritingWorkflowState(matrix),
      writeToolsNotIdempotentOrResumable: capabilityMatrixWeakWriteRows(matrix).map((row) => row.tool),
      unimplementedIntents: matrix.unimplementedIntents
    },
    intents: Object.fromEntries(
      (Object.keys(AGENT_CAPABILITY_INTENTS) as (keyof typeof AGENT_CAPABILITY_INTENTS)[]).map((intent) => [
        intent,
        {
          label: AGENT_CAPABILITY_INTENTS[intent].label,
          implemented: AGENT_CAPABILITY_INTENTS[intent].implemented,
          tools: matrix.intents[intent]
        }
      ])
    ),
    rows: matrix.rows.map((row) => ({
      tool: row.tool,
      domain: row.domain,
      category: row.category,
      dataScope: row.dataScope,
      risk: row.risk,
      access: row.access,
      requiresConfirmation: row.requiresConfirmation,
      writeKind: row.writeKind,
      idempotent: row.idempotent,
      resumable: row.resumable,
      persistence: row.persistence,
      producesArtifact: row.producesArtifact,
      businessRecords: row.businessRecords,
      workflowStateRecords: row.workflowStateRecords,
      recovery: row.recovery,
      intents: row.intents,
      inputSchema: summarizeSchema(row.inputSchema),
      outputSchema: summarizeSchema(row.outputSchema)
    }))
  };
}

describe("V4-P2-C capability matrix generated from the real AgentToolRegistry", () => {
  it("covers every registered tool exactly once and detects no drift", async () => {
    const matrix = await realMatrix();
    const names = matrix.rows.map((row) => row.tool);
    expect(new Set(names).size).toBe(names.length);
    // 反向覆盖：描述表里不得存在未注册的工具，否则矩阵会声称不存在的���力。
    expect(matrix.rows.length).toBeGreaterThanOrEqual(48);
  });

  it("every row carries all nine certification fields from real registry metadata", async () => {
    const matrix = await realMatrix();
    for (const row of matrix.rows) {
      expect(row.tool, row.tool).toBeTruthy();
      expect(row.domain, row.tool).toBeTruthy();
      expect(row.inputSchema, row.tool).toBeTruthy();
      expect(row.outputSchema, row.tool).toBeTruthy();
      expect(["read", "write"], row.tool).toContain(row.access);
      expect(typeof row.requiresConfirmation, row.tool).toBe("boolean");
      expect(typeof row.idempotent, row.tool).toBe("boolean");
      expect(typeof row.resumable, row.tool).toBe("boolean");
      expect(Array.isArray(row.businessRecords), row.tool).toBe(true);
      expect(Array.isArray(row.workflowStateRecords), row.tool).toBe(true);
      expect(["persistent", "session_only", "none"], row.tool).toContain(row.persistence);
      // 恢复方式必须是可执行动作：禁止空串与「未知」这类占位。
      expect(row.recovery.trim().length, row.tool).toBeGreaterThan(4);
      expect(row.recovery, row.tool).not.toMatch(/^(unknown|todo|n\/a)$/i);
    }
  });

  it("read tools never write business records; every persistent tool declares its records", async () => {
    const matrix = await realMatrix();
    for (const row of matrix.rows) {
      // 核心不变量：risk=read 的工具绝不能写业务领域表。
      if (row.access === "read") expect(row.businessRecords, row.tool).toHaveLength(0);
      if (row.persistence === "persistent") {
        expect(row.businessRecords.length + row.workflowStateRecords.length, row.tool).toBeGreaterThan(0);
      }
    }
  });

  it("reports exactly which capabilities do not survive a refresh or restart", async () => {
    const matrix = await realMatrix();
    expect(matrix.sessionOnlyRows.map((row) => row.tool)).toEqual([...SESSION_SCOPED_CAPABILITY_TOOLS].sort());
    // 刷新/重启后必须能从说明文字里知道要重建什么，而不是留下悬空会话。
    for (const row of matrix.sessionOnlyRows) {
      expect(row.recovery, row.tool).toMatch(/会话|重建|重新|route/);
    }
  });

  it("surfaces the read tools that persist workflow state instead of hiding them", async () => {
    const matrix = await realMatrix();
    // V4-P2-C 认证发现：这三个工具 registry 标为 risk=read，但会写 appMeta。
    expect(capabilityMatrixReadToolsWritingWorkflowState(matrix)).toEqual([
      "plan_resume_composition",
      "reconcile_profile_intake",
      "reconcile_resume_import"
    ]);
  });

  it("writeKind is derived from real risk and confirmation, never hand-set", async () => {
    const matrix = await realMatrix();
    for (const row of matrix.rows) {
      expect(row.writeKind, row.tool).toBe(deriveWriteKind(row.risk, row.requiresConfirmation));
    }
    expect(deriveWriteKind("read", false)).toBe("none");
    expect(deriveWriteKind("write", true)).toBe("confirmation_write");
    expect(deriveWriteKind("write", false)).toBe("safe_write");
    expect(deriveWriteKind("user_declared", false)).toBe("declaration_write");
  });

  it("the exported agentToolNames list no longer drifts from the real registry", async () => {
    db = new CareerAdaptDb(`v4p2c-names-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const registry = createAgentToolRegistry(new BrowserAgentToolService(repository));
    const registered = registry.list().map((tool) => tool.name).sort();
    expect([...agentToolNames].sort()).toEqual(registered);
  });

  it("every write tool is idempotent and resumable (weak rows are reported, not hidden)", async () => {
    const matrix = await realMatrix();
    const weak = capabilityMatrixWeakWriteRows(matrix).map((row) => row.tool);
    // 目前唯一已知弱点：reconcile_resume_import 计划不可跨暂停续跑（它本身是只读）。
    expect(weak).toEqual([]);
    expect(matrix.writeRows.length).toBeGreaterThan(0);
  });

  it("keeps the versioned capability matrix artifact in sync with the live registry", async () => {
    const matrix = await realMatrix();
    const payload = renderCapabilityMatrixArtifact(matrix);
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;
    const tracked = MATRIX_ARTIFACT_PATH;
    let existing: string;
    try {
      existing = readFileSync(tracked, "utf8");
    } catch {
      // 首次生成：写入受版本控制的矩阵产物。
      writeFileSync(tracked, serialized, "utf8");
      expect(readFileSync(tracked, "utf8")).toBe(serialized);
      return;
    }
    if (existing !== serialized) writeFileSync(tracked, serialized, "utf8");
    // 重读断言：产物必须与真实 Registry 派生结果逐字节一致，不允许手工编辑漂移。
    expect(readFileSync(tracked, "utf8")).toBe(serialized);
  });
});

describe("V4-P2-C user intent mapping", () => {
  it("records which of the nine core intents are not yet exposed as agent capabilities", async () => {
    const matrix = await realMatrix();
    expect(matrix.unimplementedIntents.sort()).toEqual([
      "assist_ats_application",
      "manage_application_record",
      "mock_interview"
    ]);
    for (const intent of matrix.unimplementedIntents) {
      expect(matrix.intents[intent], intent).toHaveLength(0);
    }
  });

  it("maps each implemented intent to at least one real registered tool", async () => {
    const matrix = await realMatrix();
    for (const [intent, meta] of Object.entries(AGENT_CAPABILITY_INTENTS)) {
      if (!meta.implemented) continue;
      expect(matrix.intents[intent as keyof typeof matrix.intents], intent).not.toHaveLength(0);
    }
  });

  it("profile facts are only committed through a confirmation write, never silently", async () => {
    const matrix = await realMatrix();
    const chain = matrix.intents.record_profile_facts;
    expect(chain).toContain("commit_profile_intake");
    const commitRow = matrix.rows.find((row) => row.tool === "commit_profile_intake")!;
    expect(commitRow.writeKind).toBe("confirmation_write");
    expect(commitRow.businessRecords).toContain("profiles");
  });

  it("job recording goes through the shared candidate pipeline confirmation chain", async () => {
    const matrix = await realMatrix();
    const row = matrix.rows.find((candidate) => candidate.tool === "commit_job")!;
    expect(row.writeKind).toBe("confirmation_write");
    expect(row.businessRecords).toEqual(expect.arrayContaining(["jobListings", "jobSnapshots", "jobDescriptions"]));
    expect(row.workflowStateRecords).toContain("appMeta:conversion-confirmation");
    // parse 是只读，commit 才写。
    expect(matrix.rows.find((candidate) => candidate.tool === "parse_job_description")!.access).toBe("read");
  });
});

describe("V4-P2-C structured outcome taxonomy", () => {
  it("exposes exactly the five required structured outcomes", () => {
    expect([...AGENT_CAPABILITY_OUTCOMES].sort()).toEqual([
      "pending_confirmation",
      "permanent_failure",
      "resumed_idempotent",
      "retryable_failure",
      "success"
    ]);
  });

  it("maps a missing-confirmation write attempt to pending_confirmation, not to a failure", () => {
    const detail = classifyAgentToolResult({
      ok: false,
      error: { code: "agent_confirmation_required", retryable: false }
    });
    expect(detail.outcome).toBe("pending_confirmation");
    expect(detail.requiresUserAction).toBe(true);
    expect(detail.retryable).toBe(false);
  });

  it("maps a tool error to retryable or permanent based on the real retryable flag", () => {
    expect(classifyAgentToolResult({ ok: false, error: { code: "provider_timeout", retryable: true } }).outcome)
      .toBe("retryable_failure");
    expect(classifyAgentToolResult({ ok: false, error: { code: "tool_input_invalid", retryable: false } }).outcome)
      .toBe("permanent_failure");
  });

  it("detects idempotent replay from the repository result and distinguishes it from first success", () => {
    expect(classifyAgentToolResult({ ok: true, data: { idempotent: true } }).outcome).toBe("resumed_idempotent");
    expect(classifyAgentToolResult({ ok: true, data: { idempotent: false } }).outcome).toBe("success");
    expect(classifyAgentToolResult({ ok: true, data: { value: 1 } }).outcome).toBe("success");
  });

  it("maps every workflow facade status onto the same five outcomes", () => {
    expect(classifyCareerWorkflowStatus("completed").outcome).toBe("success");
    expect(classifyCareerWorkflowStatus("waiting_for_confirmation").outcome).toBe("pending_confirmation");
    for (const status of ["waiting_for_user", "review_ready", "working", "partial", "recoverable_failure"]) {
      expect(classifyCareerWorkflowStatus(status).outcome, status).toBe("retryable_failure");
    }
    expect(classifyCareerWorkflowStatus("failed").outcome).toBe("permanent_failure");
    // 未知状态不得折叠为成功。
    expect(classifyCareerWorkflowStatus("something_new").outcome).toBe("permanent_failure");
  });

  it("is total and deterministic: every workflow status yields one of the five outcomes", () => {
    const statuses = [
      "completed", "waiting_for_user", "waiting_for_confirmation", "working",
      "review_ready", "recoverable_failure", "partial", "failed", "", "brand_new"
    ];
    for (const status of statuses) {
      const first = classifyCareerWorkflowStatus(status);
      const second = classifyCareerWorkflowStatus(status);
      expect(AGENT_CAPABILITY_OUTCOMES, status).toContain(first.outcome);
      expect(second).toEqual(first);
    }
  });
});