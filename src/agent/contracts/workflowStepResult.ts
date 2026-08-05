import { z } from "zod";

export const WorkflowChatBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assistant_text"), text: z.string().min(1) }).strict(),
  z.object({ type: z.literal("candidate_review_cards"), projection: z.unknown() }).strict(),
  z.object({ type: z.literal("compact_receipt"), text: z.string().min(1), candidateId: z.string().min(1).optional() }).strict(),
  z.object({ type: z.literal("progress"), stage: z.string().min(1), startedAt: z.string().datetime(), completedAt: z.string().datetime().optional() }).strict(),
  z.object({ type: z.literal("typed_options"), options: z.array(z.unknown()).max(12) }).strict(),
  z.object({ type: z.literal("error_recovery"), code: z.string().min(1), text: z.string().min(1), actions: z.array(z.string().min(1)).max(4) }).strict()
]);

export const WorkflowStepResultSchema = z.object({
  workflowId: z.string().min(1),
  stageBefore: z.string().min(1),
  stageAfter: z.string().min(1),
  chatBlocks: z.array(WorkflowChatBlockSchema),
  artifactProjection: z.unknown().optional(),
  statePatch: z.record(z.string(), z.unknown()),
  persistenceReceipt: z.unknown().optional(),
  nextAction: z.object({
    type: z.enum(["ask_follow_up", "ask_next_section", "wait_for_candidate_review", "offer_finish", "commit"]),
    question: z.string().min(1).optional(),
    section: z.string().min(1).optional(),
    candidateId: z.string().min(1).optional()
  }).strict().optional(),
  safeDiagnostics: z.object({
    code: z.string().min(1).optional(),
    provider: z.enum(["available", "failed", "invalid"]).optional(),
    latencyMs: z.number().int().min(0).optional()
  }).strict().default({})
}).strict();

export type WorkflowChatBlock = z.infer<typeof WorkflowChatBlockSchema>;
export type WorkflowStepResult = z.infer<typeof WorkflowStepResultSchema>;
