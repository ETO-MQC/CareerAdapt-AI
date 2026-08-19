import type { AgentTaskState } from "@/agent/contracts/agentSession";
import { stableHashText } from "@/services/security/text";

export type TurnScopedTargetContext = {
  targetContextId: string;
  logicalTurnId: string;
  sourceType: "pasted_jd";
  sourceMessageId: string;
  targetText: string;
  targetTextHash: string;
  /** Compatibility alias for the existing source-evidence vocabulary. */
  sourceContentHash: string;
  createdAt: string;
};

/** Canonical P4.5c.1.20 name; the scoped alias preserves prior callers. */
export type TurnTargetContext = TurnScopedTargetContext;

export function createTurnScopedTargetContext(input: {
  logicalTurnId: string;
  targetText: string;
  sourceMessageId?: string;
  createdAt: string;
}): TurnScopedTargetContext {
  const targetTextHash = stableHashText(input.targetText);
  const sourceMessageId = input.sourceMessageId
    ?? `agent-user-source-${stableHashText(`${input.logicalTurnId}:${targetTextHash}`)}`;
  return {
    targetContextId: `target-context-${stableHashText(`${input.logicalTurnId}:${targetTextHash}`)}`,
    logicalTurnId: input.logicalTurnId,
    sourceType: "pasted_jd",
    sourceMessageId,
    targetText: input.targetText,
    targetTextHash,
    sourceContentHash: targetTextHash,
    createdAt: input.createdAt
  };
}

export function currentTurnScopedTargetContext(
  state: AgentTaskState | undefined,
  logicalTurnId: string | undefined
): TurnScopedTargetContext | undefined {
  if (!state || !logicalTurnId) return undefined;
  const value = state.knownSlots.turnTargetContext ?? state.knownSlots.turnScopedTargetContext;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<TurnScopedTargetContext>;
  if (
    candidate.sourceType !== "pasted_jd"
    || candidate.logicalTurnId !== logicalTurnId
    || typeof candidate.targetContextId !== "string"
    || typeof candidate.sourceMessageId !== "string"
    || typeof candidate.targetText !== "string"
    || typeof candidate.targetTextHash !== "string"
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
