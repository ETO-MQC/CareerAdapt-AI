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

export type TurnTargetContextDiagnostics = {
  targetContextId: string;
  logicalTurnId: string;
  sourceMessageId: string;
  targetPresent: boolean;
  targetLengthBucket: string;
  targetHashPrefix: string;
  createdAt: string;
  resolvedForTool: boolean;
};

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

export function turnTargetContextDiagnostics(
  context: TurnScopedTargetContext | undefined,
  resolvedForTool: boolean
): TurnTargetContextDiagnostics | undefined {
  if (!context) return undefined;
  return {
    targetContextId: context.targetContextId,
    logicalTurnId: context.logicalTurnId,
    sourceMessageId: context.sourceMessageId,
    targetPresent: context.targetText.length > 0,
    targetLengthBucket: targetLengthBucket(context.targetText.length),
    targetHashPrefix: context.targetTextHash.slice(0, 16),
    createdAt: context.createdAt,
    resolvedForTool
  };
}

function targetLengthBucket(length: number) {
  if (length === 0) return "length:0";
  if (length <= 20) return "length:1-20";
  if (length <= 200) return "length:21-200";
  if (length <= 2_000) return "length:201-2000";
  if (length <= 24_000) return "length:2001-24000";
  return "length:24001+";
}
