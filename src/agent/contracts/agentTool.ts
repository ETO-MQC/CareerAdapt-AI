import { z } from "zod";

export const AgentToolRiskSchema = z.enum(["read", "write", "destructive", "user_declared"]);

export const AgentErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1).max(1000),
  retryable: z.boolean().default(false),
  details: z.record(z.string(), z.unknown()).optional()
}).strict();

export const AgentToolResultSchema = z.object({
  ok: z.boolean(),
  operationId: z.string().min(8).max(160),
  toolName: z.string().min(1),
  data: z.unknown().optional(),
  error: AgentErrorSchema.optional(),
  artifactIds: z.array(z.string()).default([]),
  completedAt: z.string().datetime({ offset: true })
}).strict().superRefine((value, context) => {
  if (value.ok === Boolean(value.error)) {
    context.addIssue({ code: "custom", message: "Successful results cannot contain an error and failed results must contain one." });
  }
});

export const AgentToolManifestItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).max(500),
  risk: AgentToolRiskSchema,
  requiresConfirmation: z.boolean(),
  idempotent: z.boolean(),
  resumable: z.boolean(),
  inputSchema: z.record(z.string(), z.unknown())
}).strict();

export type AgentError = z.infer<typeof AgentErrorSchema>;
export type AgentToolResult<T = unknown> = Omit<z.infer<typeof AgentToolResultSchema>, "data"> & { data?: T };
export type AgentToolRisk = z.infer<typeof AgentToolRiskSchema>;

export type AgentToolExecutionContext = {
  operationId: string;
  signal?: AbortSignal;
};

export type AgentToolDefinition<TInput = unknown, TOutput = unknown> = {
  name: string;
  description: string;
  risk: AgentToolRisk;
  requiresConfirmation: boolean;
  idempotent: boolean;
  resumable: boolean;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  execute(input: TInput, context: AgentToolExecutionContext): Promise<TOutput> | TOutput;
};
