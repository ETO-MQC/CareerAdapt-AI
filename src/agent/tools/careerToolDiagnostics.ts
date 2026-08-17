import { z } from "zod";

/**
 * Safe, transport-neutral failure layers.  These values are intentionally
 * narrower than the internal exception graph: they are suitable for Host,
 * MCP and Hermes projections without exposing JD/resume/profile contents.
 */
export const CareerToolFailureLayerSchema = z.enum([
  "hermes_tool_protocol",
  "mcp_transport",
  "mcp_jsonrpc",
  "mcp_handler",
  "gateway_validation",
  "gateway_policy",
  "workflow_precondition",
  "workflow_execution",
  "provider",
  "repository",
  "fact_guard",
  "completion_guard",
  "timeout",
  "unknown"
]);

export type CareerToolFailureLayer = z.infer<typeof CareerToolFailureLayerSchema>;

export const CareerToolFailureScopeSchema = z.enum([
  "runtime",
  "provider",
  "mcp_transport",
  "mcp_tool",
  "career_workflow",
  "repository",
  "policy"
]);

export type CareerToolFailureScope = z.infer<typeof CareerToolFailureScopeSchema>;

export const CareerToolArgumentShapeSchema = z.record(z.string(), z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string())
]));

export type CareerToolArgumentShape = z.infer<typeof CareerToolArgumentShapeSchema>;

export const CareerToolFailureDiagnosticsSchema = z.object({
  toolFailureLayer: CareerToolFailureLayerSchema,
  failureScope: CareerToolFailureScopeSchema.optional(),
  safeDomainErrorCode: z.string().min(1),
  httpStatus: z.number().int().optional(),
  jsonRpcErrorCode: z.union([z.number().int(), z.string()]).optional(),
  toolResultIsError: z.boolean(),
  failedStage: z.string().min(1),
  durationMs: z.number().int().min(0),
  retryable: z.boolean(),
  workflowStageBefore: z.string().optional(),
  workflowStageAfter: z.string().optional(),
  operationId: z.string().min(1),
  logicalToolOperationId: z.string().min(1),
  logicalTurnId: z.string().optional(),
  taskId: z.string().optional(),
  argumentShape: CareerToolArgumentShapeSchema.optional(),
  startedAt: z.string().datetime({ offset: true }).optional(),
  enteredGatewayAt: z.string().datetime({ offset: true }).optional(),
  enteredFacadeAt: z.string().datetime({ offset: true }).optional(),
  firstInternalOperationAt: z.string().datetime({ offset: true }).optional(),
  providerStartedAt: z.string().datetime({ offset: true }).optional(),
  providerCompletedAt: z.string().datetime({ offset: true }).optional(),
  repositoryStartedAt: z.string().datetime({ offset: true }).optional(),
  repositoryCompletedAt: z.string().datetime({ offset: true }).optional(),
  completedAt: z.string().datetime({ offset: true }).optional(),
  duplicateProjection: z.boolean().optional()
}).strict();

export type CareerToolFailureDiagnostics = z.infer<typeof CareerToolFailureDiagnosticsSchema>;

export function safeCareerToolArgumentShape(input: unknown): CareerToolArgumentShape {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { input: "non_object" };
  const shape: CareerToolArgumentShape = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") {
      shape[key] = key.toLowerCase().includes("text") || key.toLowerCase().includes("jd")
        ? lengthBucket(value.length)
        : value.length > 160 ? lengthBucket(value.length) : "present";
    } else if (typeof value === "number") {
      shape[key] = "number";
    } else if (typeof value === "boolean") {
      shape[key] = value;
    } else if (Array.isArray(value)) {
      shape[key] = [`count:${value.length}`];
    } else if (value === null || value === undefined) {
      shape[key] = "absent";
    } else {
      shape[key] = "object";
    }
  }
  return shape;
}

function lengthBucket(length: number) {
  if (length === 0) return "length:0";
  if (length <= 20) return "length:1-20";
  if (length <= 200) return "length:21-200";
  if (length <= 2_000) return "length:201-2000";
  if (length <= 24_000) return "length:2001-24000";
  return "length:24001+";
}

