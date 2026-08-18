import { nanoid } from "nanoid";
import type {
  CareerToolContract,
  CareerToolExecutionContext,
  CareerToolResult
} from "@/agent/tools/CareerToolGateway";
import type { CareerSessionBinding } from "../runtime/careerSessionBinding";
import {
  CareerToolFailureDiagnosticsSchema,
  type CareerMcpCallTrace,
  type CareerToolFailureDiagnostics
} from "../tools/careerToolDiagnostics";

/**
 * The MCP adapter is deliberately narrower than the Career domain.  It only
 * translates MCP tool discovery/calls into the existing gateway contract.
 * Repository access, validation, confirmation and idempotency stay behind the
 * gateway supplied by the host.
 */
export type CareerAdaptMcpGateway = {
  listContracts(): CareerToolContract[];
  execute(
    name: string,
    input: unknown,
    context?: CareerToolExecutionContext
  ): Promise<CareerToolResult<unknown>>;
};

export type McpToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type CareerAdaptMcpTool = {
  name: string;
  description: string;
  contractVersion: string;
  contractSchemaHash: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations: McpToolAnnotations;
  _meta: {
    "careeradapt/namespace": string;
    "careeradapt/sourceToolName": string;
    "careeradapt/safetyClass": CareerToolContract["safetyClass"];
    "careeradapt/confirmationPolicy": CareerToolContract["confirmationPolicy"];
    "careeradapt/idempotencyKeyPolicy": CareerToolContract["idempotencyKeyPolicy"];
    "careeradapt/personProfileBinding": CareerToolContract["personProfileBinding"];
    "careeradapt/artifactBehavior": CareerToolContract["artifactBehavior"];
    "careeradapt/contractVersion": string;
    "careeradapt/contractSchemaHash": string;
  };
};

export type CareerAdaptMcpCallMeta = {
  operationId?: string;
  /** One logical ID shared by the Hermes call, MCP bridge and Gateway. */
  logicalToolOperationId?: string;
  logicalTurnId?: string;
  taskId?: string;
  incidentTraceId?: string;
  agentSessionId?: string;
  careerSessionBinding?: CareerSessionBinding;
  requireSessionBinding?: boolean;
  /**
   * Confirmation is intentionally not accepted from an MCP caller.  MCP is
   * an autonomous client boundary; authoritative writes still require the
   * host's explicit confirmation flow.  The field is retained as a typed
   * diagnostic so a future host approval capability can be added without
   * changing the wire adapter shape.
   */
  confirmationRequested?: boolean;
};

export type CareerAdaptMcpCallResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

export class CareerAdaptMcpAdapter {
  constructor(private readonly gateway: CareerAdaptMcpGateway) {}

  listTools(): CareerAdaptMcpTool[] {
    return this.gateway.listContracts().map(toMcpTool);
  }

  async callTool(
    name: string,
    input: unknown,
    meta: CareerAdaptMcpCallMeta = {},
    signal?: AbortSignal
  ): Promise<CareerAdaptMcpCallResult> {
    const contract = this.gateway.listContracts().find((candidate) => candidate.name === name);
    const operationId = normalizeOperationId(meta.operationId);
    const requestStartedAt = new Date().toISOString();
    // The Browser handler may carry forward an upstream ID or reuse the
    // existing MCP operation ID for legacy direct callers. It must not mint a
    // second logical ID from the turn and tool name.
    const logicalToolOperationId = meta.logicalToolOperationId?.trim() || operationId;
    if (!contract) {
      return toolErrorResult(
        "unknown_career_tool",
        "当前 Career 工具不可用。",
        operationId,
        name,
        logicalToolOperationId,
        requestStartedAt
      );
    }

    const context: CareerToolExecutionContext = {
      operationId,
      logicalToolOperationId,
      logicalTurnId: meta.logicalTurnId,
      taskId: meta.taskId,
      incidentTraceId: meta.incidentTraceId,
      agentSessionId: meta.agentSessionId,
      signal,
      // MCP clients must never autonomously bypass a CareerAdapt
      // confirmation boundary. Safe reads and explicitly safe writes still
      // execute normally; confirmation writes return the gateway's typed
      // confirmation_required result.
      confirmed: false,
      confirmationCount: 0,
      careerSessionBinding: meta.careerSessionBinding,
      requireSessionBinding: meta.requireSessionBinding === true
    };
    const result = await this.gateway.execute(name, input, context);
    return toCallResult(result, contract, logicalToolOperationId, {
      toolName: name,
      logicalToolOperationId,
      requestStartedAt,
      jsonRpcStatus: "response_received",
      toolResponseIsError: !result.ok,
      browserMcpHandlerReached: true,
      gatewayReached: true,
      completedAt: new Date().toISOString()
    });
  }
}

export function toMcpTool(contract: CareerToolContract): CareerAdaptMcpTool {
  return {
    name: contract.name,
    description: contract.description,
    contractVersion: contract.contractVersion ?? "unknown",
    contractSchemaHash: contract.contractSchemaHash ?? "unknown",
    inputSchema: contract.inputSchema,
    outputSchema: contract.outputSchema,
    annotations: {
      readOnlyHint: contract.safetyClass === "READ",
      destructiveHint: contract.safetyClass === "DESTRUCTIVE",
      idempotentHint: contract.idempotencyKeyPolicy !== "none",
      openWorldHint: false
    },
    _meta: {
      "careeradapt/namespace": contract.namespace,
      "careeradapt/sourceToolName": contract.sourceToolName,
      "careeradapt/safetyClass": contract.safetyClass,
      "careeradapt/confirmationPolicy": contract.confirmationPolicy,
      "careeradapt/idempotencyKeyPolicy": contract.idempotencyKeyPolicy,
      "careeradapt/personProfileBinding": contract.personProfileBinding,
      "careeradapt/artifactBehavior": contract.artifactBehavior,
      "careeradapt/contractVersion": contract.contractVersion ?? "unknown",
      "careeradapt/contractSchemaHash": contract.contractSchemaHash ?? "unknown"
    }
  };
}

function toCallResult(
  result: CareerToolResult,
  contract: CareerToolContract,
  logicalToolOperationId: string,
  mcpCallTrace: CareerMcpCallTrace
): CareerAdaptMcpCallResult {
  const baseDiagnostics = result.diagnostics ?? result.error?.diagnostics;
  const diagnostics = baseDiagnostics
    ? CareerToolFailureDiagnosticsSchema.parse({
        ...baseDiagnostics,
        mcpCallTrace: baseDiagnostics.mcpCallTrace
          ? {
              ...mcpCallTrace,
              requestStartedAt: baseDiagnostics.mcpCallTrace.requestStartedAt,
              browserMcpHandlerReached: baseDiagnostics.mcpCallTrace.browserMcpHandlerReached,
              gatewayReached: baseDiagnostics.mcpCallTrace.gatewayReached
            }
          : mcpCallTrace
      })
    : undefined;
  const payload: Record<string, unknown> = result.ok
    ? {
        ok: true,
        data: result.data,
        artifacts: result.artifacts,
        receipt: result.receipt,
        ...(diagnostics ? { diagnostics } : {})
      }
    : {
        ok: false,
        error: result.error
          ? {
              code: result.error.code,
              category: result.error.category,
              message: result.error.message,
              recoverable: result.error.recoverable,
              retryHint: result.error.retryHint,
              ...(result.error.scope ? { scope: result.error.scope } : {}),
              ...(result.error.invalidFields ? { invalidFields: result.error.invalidFields } : {}),
              ...(result.error.acceptedShapeHint ? { acceptedShapeHint: result.error.acceptedShapeHint } : {}),
              ...(diagnostics ? { diagnostics } : {})
            }
          : {
              code: "career_tool_failed",
              category: "internal",
              message: "工具执行没有完成。",
              recoverable: false
            },
        receipt: result.receipt,
        ...(diagnostics ? { diagnostics } : {})
      };
  return {
    content: [{ type: "text", text: safeJson(payload) }],
    ...(result.ok ? {} : { isError: true }),
    structuredContent: payload,
    _meta: {
      "careeradapt/tool": contract.name,
      "careeradapt/operationId": result.receipt.operationId,
      ...(logicalToolOperationId ? { "careeradapt/logicalToolOperationId": logicalToolOperationId } : {}),
      "careeradapt/safetyClass": contract.safetyClass,
      "careeradapt/contractVersion": contract.contractVersion ?? "unknown",
      "careeradapt/contractSchemaHash": contract.contractSchemaHash ?? "unknown",
      ...(diagnostics ? {
        "careeradapt/toolFailureLayer": diagnostics.toolFailureLayer,
        "careeradapt/safeDomainErrorCode": diagnostics.safeDomainErrorCode,
        "careeradapt/failureKind": diagnostics.failureKind ?? "workflow_failed"
      } : {})
    }
  };
}

function toolErrorResult(
  code: string,
  message: string,
  operationId: string,
  toolName: string,
  logicalToolOperationId: string,
  requestStartedAt: string
): CareerAdaptMcpCallResult {
  const diagnostics: CareerToolFailureDiagnostics = {
    toolFailureLayer: "gateway_validation",
    failureKind: "gateway_validation_failed",
    failureScope: "career_workflow",
    safeDomainErrorCode: code,
    toolResultIsError: true,
    failedStage: "gateway_validation",
    durationMs: 0,
    retryable: false,
    operationId,
    logicalToolOperationId,
    mcpCallTrace: {
      toolName,
      logicalToolOperationId,
      requestStartedAt,
      jsonRpcStatus: "response_received",
      toolResponseIsError: true,
      safeMcpErrorCode: code,
      browserMcpHandlerReached: true,
      gatewayReached: false,
      completedAt: new Date().toISOString()
    },
    completedAt: new Date().toISOString()
  };
  const payload = {
    ok: false,
    error: {
      code,
      category: "not_found",
      message,
      recoverable: false,
      diagnostics
    },
    receipt: {
      operationId,
      toolName,
      status: "failed",
      completedAt: new Date().toISOString()
    },
    diagnostics
  } satisfies Record<string, unknown>;
  return {
    content: [{ type: "text", text: safeJson(payload) }],
    isError: true,
    structuredContent: payload,
    _meta: {
      "careeradapt/operationId": operationId,
      "careeradapt/logicalToolOperationId": logicalToolOperationId,
      "careeradapt/failureKind": "gateway_validation_failed"
    }
  };
}

function normalizeOperationId(operationId?: string) {
  return operationId && operationId.trim().length >= 8
    ? operationId.trim().slice(0, 160)
    : `mcp-career-${nanoid(16)}`;
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, (_key, candidate) =>
      typeof candidate === "bigint" ? candidate.toString() : candidate
    );
  } catch {
    return JSON.stringify({ ok: false, error: { code: "mcp_result_not_serializable", message: "工具结果无法安全序列化。" } });
  }
}
