import { z } from "zod";
import { stableHashText } from "@/services/security/text";
import type { TurnTargetContextDiagnostics } from "../runtime/turnScopedTargetContext";

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
  "career_context",
  "career_workflow",
  "repository",
  "policy"
]);

export type CareerToolFailureScope = z.infer<typeof CareerToolFailureScopeSchema>;

export const CareerToolFailureKindSchema = z.enum([
  "tool_schema_rejected_by_hermes_or_mcp",
  "mcp_jsonrpc_failed",
  "mcp_handler_not_reached",
  "gateway_validation_failed",
  "workflow_failed"
]);

export type CareerToolFailureKind = z.infer<typeof CareerToolFailureKindSchema>;

export const CareerToolSchemaIssueSchema = z.object({
  path: z.string().min(1),
  code: z.string().min(1),
  expectedType: z.string().min(1).optional(),
  receivedType: z.string().min(1).optional(),
  key: z.string().min(1).optional()
}).strict();

export type CareerToolSchemaIssue = z.infer<typeof CareerToolSchemaIssueSchema>;

export const CareerToolAcceptedShapeHintSchema = z.object({
  requiredOneOf: z.array(z.string().min(1)).min(1),
  note: z.string().min(1).optional()
}).strict();

export type CareerToolAcceptedShapeHint = z.infer<typeof CareerToolAcceptedShapeHintSchema>;

export const CareerMcpCallTraceSchema = z.object({
  toolName: z.string().min(1),
  logicalToolOperationId: z.string().min(1),
  requestStartedAt: z.string().datetime({ offset: true }),
  jsonRpcStatus: z.enum(["not_started", "request_sent", "response_received", "error"]).optional(),
  jsonRpcErrorCode: z.union([z.number().int(), z.string()]).optional(),
  toolResponseIsError: z.boolean().optional(),
  safeMcpErrorCode: z.string().min(1).optional(),
  browserMcpHandlerReached: z.boolean(),
  gatewayReached: z.boolean(),
  completedAt: z.string().datetime({ offset: true }).optional()
}).strict();

export type CareerMcpCallTrace = z.infer<typeof CareerMcpCallTraceSchema>;

export const CareerMcpResponseBytesBucketSchema = z.enum([
  "0",
  "1-255",
  "256-1023",
  "1-4kb",
  "4-16kb",
  "16kb+"
]);

export const CareerMcpResponseTraceSchema = z.object({
  handlerResultCreated: z.boolean(),
  responseSerialized: z.boolean(),
  responseBytesBucket: CareerMcpResponseBytesBucketSchema,
  responseEnvelopeValid: z.boolean(),
  responseSent: z.boolean(),
  hermesResultObserved: z.boolean().optional(),
  officialHermesToolTerminalEvent: z.enum(["completed", "failed"]).optional()
}).strict();

export type CareerMcpResponseTrace = z.infer<typeof CareerMcpResponseTraceSchema>;

export const CareerToolStringArgumentShapeSchema = z.object({
  present: z.boolean(),
  lengthBucket: z.string().min(1),
  hashPrefix: z.string().min(1).optional()
}).strict();

export const CareerToolArgumentShapeSchema = z.record(z.string(), z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  CareerToolStringArgumentShapeSchema
]));

export type CareerToolArgumentShape = z.infer<typeof CareerToolArgumentShapeSchema>;

export const CareerToolFailureDiagnosticsSchema = z.object({
  toolFailureLayer: CareerToolFailureLayerSchema,
  failureKind: CareerToolFailureKindSchema.optional(),
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
  hermesToolCallArgumentShape: CareerToolArgumentShapeSchema.optional(),
  preparedInvocationShape: CareerToolArgumentShapeSchema.optional(),
  mcpJsonRpcArgumentShape: CareerToolArgumentShapeSchema.optional(),
  mcpHttpArgumentShape: CareerToolArgumentShapeSchema.optional(),
  browserHandlerArgumentShape: CareerToolArgumentShapeSchema.optional(),
  gatewayArgumentShape: CareerToolArgumentShapeSchema.optional(),
  facadeArgumentShape: CareerToolArgumentShapeSchema.optional(),
  targetContext: z.object({
    targetContextId: z.string().min(1),
    logicalTurnId: z.string().min(1),
    sourceMessageId: z.string().min(1),
    targetPresent: z.boolean(),
    targetLengthBucket: z.string().min(1),
    targetHashPrefix: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
    resolvedForTool: z.boolean()
  }).strict().optional(),
  runtimeHealthy: z.boolean().optional(),
  mcpHealthy: z.boolean().optional(),
  schemaIssues: z.array(CareerToolSchemaIssueSchema).optional(),
  schemaIssueFingerprint: z.string().min(1).optional(),
  duplicateOfOperationId: z.string().min(1).optional(),
  previousSchemaFingerprint: z.string().min(1).optional(),
  previousArgumentShapeFingerprint: z.string().min(1).optional(),
  invalidFields: z.array(z.string().min(1)).optional(),
  acceptedShapeHint: CareerToolAcceptedShapeHintSchema.optional(),
  publishedContractVersion: z.string().min(1).optional(),
  publishedSchemaHash: z.string().min(1).optional(),
  gatewayContractVersion: z.string().min(1).optional(),
  gatewaySchemaHash: z.string().min(1).optional(),
  careerToolContractVersion: z.string().min(1).optional(),
  appBuildCommit: z.string().min(1).optional(),
  appBuildTimestamp: z.string().min(1).optional(),
  mcpCallTrace: CareerMcpCallTraceSchema.optional(),
  mcpResponseTrace: CareerMcpResponseTraceSchema.optional(),
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

export type { TurnTargetContextDiagnostics };

export function safeZodSchemaIssues(error: unknown): CareerToolSchemaIssue[] {
  if (!(error instanceof z.ZodError)) return [];
  const issues: CareerToolSchemaIssue[] = [];
  const collect = (issue: unknown) => {
    if (!issue || typeof issue !== "object" || Array.isArray(issue)) return;
    const issueRecord = issue as Record<string, unknown>;
    if (Array.isArray(issueRecord.errors)) {
      for (const branch of issueRecord.errors) {
        if (Array.isArray(branch)) {
          for (const nested of branch) collect(nested);
        }
      }
      return;
    }
    const pathSegments = Array.isArray(issueRecord.path) ? issueRecord.path : [];
    const pathText = pathSegments.length
      ? pathSegments.map((segment) => typeof segment === "number" ? `[${segment}]` : String(segment)).join(".").replaceAll(".[", "[")
      : "$";
    const issueKeys = Array.isArray(issueRecord.keys)
      ? issueRecord.keys.filter((key): key is string => typeof key === "string")
      : [];
    const lastPathSegment = pathSegments.at(-1);
    const key = typeof lastPathSegment === "string" ? lastPathSegment : issueKeys[0];
    const path = pathText === "$" && key ? key : pathText;
    const code = typeof issueRecord.code === "string" ? issueRecord.code : "schema_issue";
    const expectedType = typeof issueRecord.expected === "string" ? issueRecord.expected : undefined;
    const receivedType = typeof issueRecord.received === "string" ? issueRecord.received : undefined;
    issues.push({
      path,
      code,
      ...(expectedType ? { expectedType } : {}),
      ...(receivedType ? { receivedType } : {}),
      ...(key ? { key } : {})
    });
  };
  for (const issue of error.issues) collect(issue);
  return issues;
}

export function safeCareerToolArgumentShape(input: unknown): CareerToolArgumentShape {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { input: "non_object" };
  const shape: CareerToolArgumentShape = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") {
      shape[key] = {
        present: true,
        lengthBucket: lengthBucket(value.length),
        ...(value.length ? { hashPrefix: stableHashText(value).slice(0, 16) } : {})
      };
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
