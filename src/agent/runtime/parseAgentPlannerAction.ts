import type { ZodError } from "zod";
import {
  AgentPlannerActionSchema,
  type AgentPlannerAction
} from "./agentRuntime";
import { normalizeAgentPlannerAction } from "./normalizeAgentPlannerAction";

export type AgentPlannerParseResult =
  | { success: true; data: AgentPlannerAction; attempt: 1 | 2 }
  | { success: false; error: ZodError; attempt: 1 | 2 };

export async function parseAgentPlannerAction(
  raw: unknown,
  repair?: (normalized: unknown, error: ZodError) => Promise<unknown>
): Promise<AgentPlannerParseResult> {
  const normalized = normalizeAgentPlannerAction(raw);
  const first = AgentPlannerActionSchema.safeParse(normalized);
  if (first.success) return { success: true, data: first.data, attempt: 1 };
  if (!repair) return { success: false, error: first.error, attempt: 1 };

  const repaired = normalizeAgentPlannerAction(await repair(normalized, first.error));
  const second = AgentPlannerActionSchema.safeParse(repaired);
  return second.success
    ? { success: true, data: second.data, attempt: 2 }
    : { success: false, error: second.error, attempt: 2 };
}
