import type { AgentTaskState } from "@/agent/contracts/agentSession";
import { stableHashText } from "@/services/security/text";

export type TurnScopedTargetContext = {
  targetContextId: string;
  logicalTurnId: string;
  sourceType: "pasted_jd";
  targetText: string;
  sourceContentHash: string;
  createdAt: string;
};

export function createTurnScopedTargetContext(input: {
  logicalTurnId: string;
  targetText: string;
  createdAt: string;
}): TurnScopedTargetContext {
  const sourceContentHash = stableHashText(input.targetText);
  return {
    targetContextId: `target-context-${stableHashText(`${input.logicalTurnId}:${sourceContentHash}`)}`,
    logicalTurnId: input.logicalTurnId,
    sourceType: "pasted_jd",
    targetText: input.targetText,
    sourceContentHash,
    createdAt: input.createdAt
  };
}

export function currentTurnScopedTargetContext(
  state: AgentTaskState | undefined,
  logicalTurnId: string | undefined
): TurnScopedTargetContext | undefined {
  if (!state || !logicalTurnId) return undefined;
  const value = state.knownSlots.turnScopedTargetContext;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<TurnScopedTargetContext>;
  if (
    candidate.sourceType !== "pasted_jd"
    || candidate.logicalTurnId !== logicalTurnId
    || typeof candidate.targetContextId !== "string"
    || typeof candidate.targetText !== "string"
  ) return undefined;
  return candidate as TurnScopedTargetContext;
}

export function targetContextForId(
  state: AgentTaskState | undefined,
  logicalTurnId: string | undefined,
  targetContextId: string | undefined
): TurnScopedTargetContext | undefined {
  const current = currentTurnScopedTargetContext(state, logicalTurnId);
  return current && targetContextId === current.targetContextId ? current : undefined;
}
