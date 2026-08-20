import type { AgentTaskState } from "@/agent/contracts/agentSession";
import { stableHashText } from "@/services/security/text";

/**
 * Durable input authority for one logical turn.  `inputReference` is the
 * exact text of the persisted UserMessage; diagnostics must use `inputHash`
 * and never copy the reference into a transport payload.
 */
export type TurnInputContext = {
  logicalTurnId: string;
  sourceMessageId: string;
  inputReference: string;
  inputHash: string;
  createdAt: string;
};

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

export function createTurnInputContext(input: {
  logicalTurnId: string;
  inputReference: string;
  sourceMessageId?: string;
  createdAt: string;
}): TurnInputContext {
  const inputReference = input.inputReference.trim();
  const inputHash = stableHashText(inputReference);
  const sourceMessageId = input.sourceMessageId
    ?? `agent-user-source-${stableHashText(`${input.logicalTurnId}:${inputHash}`)}`;
  return {
    logicalTurnId: input.logicalTurnId,
    sourceMessageId,
    inputReference,
    inputHash,
    createdAt: input.createdAt
  };
}

/** Capture exactly one durable input context for a persisted UserMessage. */
export function captureTurnInputContext(
  state: AgentTaskState,
  input: {
    logicalTurnId?: string;
    sourceMessageId?: string;
    inputReference: string;
    createdAt: string;
  }
) {
  if (!input.logicalTurnId) return state;
  const existing = currentTurnInputContext(state, input.logicalTurnId);
  if (existing) return state;
  return {
    ...state,
    knownSlots: {
      ...state.knownSlots,
      turnInputContext: createTurnInputContext({
        logicalTurnId: input.logicalTurnId,
        sourceMessageId: input.sourceMessageId,
        inputReference: input.inputReference,
        createdAt: input.createdAt
      })
    }
  };
}

export function currentTurnInputContext(
  state: AgentTaskState | undefined,
  logicalTurnId: string | undefined
): TurnInputContext | undefined {
  if (!state || !logicalTurnId) return undefined;
  const value = state.knownSlots.turnInputContext;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<TurnInputContext>;
  if (
    candidate.logicalTurnId !== logicalTurnId
    || typeof candidate.sourceMessageId !== "string"
    || typeof candidate.inputReference !== "string"
    || typeof candidate.inputHash !== "string"
    || typeof candidate.createdAt !== "string"
    || stableHashText(candidate.inputReference.trim()) !== candidate.inputHash
  ) return undefined;
  return {
    logicalTurnId: candidate.logicalTurnId,
    sourceMessageId: candidate.sourceMessageId,
    inputReference: candidate.inputReference,
    inputHash: candidate.inputHash,
    createdAt: candidate.createdAt
  };
}

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
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as Partial<TurnScopedTargetContext>;
    if (
      candidate.sourceType === "pasted_jd"
      && candidate.logicalTurnId === logicalTurnId
      && typeof candidate.targetContextId === "string"
      && typeof candidate.sourceMessageId === "string"
      && typeof candidate.targetText === "string"
      && typeof candidate.targetTextHash === "string"
    ) return candidate as TurnScopedTargetContext;
  }

  // Legacy callers still receive a target projection, but the production
  // authority is now the universal input context captured for the UserMessage.
  const input = currentTurnInputContext(state, logicalTurnId);
  if (!input || !isCredibleExternalTargetText(input.inputReference)) return undefined;
  return createTurnScopedTargetContext({
    logicalTurnId,
    sourceMessageId: input.sourceMessageId,
    targetText: input.inputReference.trim(),
    createdAt: input.createdAt
  });
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

export function isCredibleExternalTargetText(value: string) {
  return value.trim().length >= 240
    && /职责|工作内容|responsibilit/i.test(value)
    && /要求|任职资格|qualification|requirement/i.test(value);
}
