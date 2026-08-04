import type {
  AgentMessage,
  AgentSession,
  ConversationBranch
} from "@/agent/contracts/agentSession";

export type ActiveBranchContextDiagnostics = {
  branchId: string;
  headMessageId?: string;
  includedMessageIds: string[];
  excludedMessageIds: string[];
  includedToolOperationIds: string[];
};

export type ActiveBranchContext = {
  branchId: string;
  headMessageId?: string;
  messages: AgentMessage[];
  conversationSummary: string;
  diagnostics: ActiveBranchContextDiagnostics;
};

/**
 * The only message projection that is allowed to become active model context.
 * Branches are embedded in the session so the append-only message table does
 * not need a second Dexie table.
 */
export function buildActiveBranchContext(session: AgentSession): ActiveBranchContext {
  const normalized = ensureConversationBranches(session);
  const activeBranchId = normalized.activeBranchId;
  const activeBranch = normalized.conversationBranches.find((branch) => branch.id === activeBranchId)
    ?? normalized.conversationBranches[0];
  const branchIds = activeBranch ? branchChain(normalized.conversationBranches, activeBranch.id) : [activeBranchId];
  const included = new Set<string>();
  const branchById = new Map(normalized.conversationBranches.map((branch) => [branch.id, branch]));

  for (let index = 0; index < branchIds.length; index += 1) {
    const branchId = branchIds[index];
    const branch = branchById.get(branchId);
    if (!branch) continue;
    const childBranch = index < branchIds.length - 1
      ? branchById.get(branchIds[index + 1])
      : undefined;
    const boundary = index === branchIds.length - 1
      ? normalized.activeHeadMessageId
      : childBranch?.forkedFromMessageId;
    const branchMessages = normalized.messages.filter((message) => message.branchId === branchId);
    const boundaryIndex = boundary
      ? branchMessages.findIndex((message) => message.id === boundary)
      : -1;
    const upperBound = boundaryIndex >= 0
      ? boundaryIndex
      : childBranch
        ? -1
        : branchMessages.length - 1;
    branchMessages.slice(0, upperBound + 1).forEach((message) => {
      if (message.metadata?.retracted === true) return;
      if (message.metadata?.branchMessageState === "superseded") return;
      included.add(message.id);
    });
  }

  const messages = normalized.messages.filter((message) => included.has(message.id));
  const includedToolOperationIds = messages
    .filter((message) => message.role === "tool" && message.operationId)
    .map((message) => message.operationId!);
  const excludedMessageIds = normalized.messages
    .filter((message) => !included.has(message.id))
    .map((message) => message.id);
  const summaryIsCurrent = !normalized.conversationSummaryBranchId
    || normalized.conversationSummaryBranchId === activeBranchId;

  return {
    branchId: activeBranchId,
    headMessageId: normalized.activeHeadMessageId,
    messages,
    conversationSummary: summaryIsCurrent ? normalized.conversationSummary : "",
    diagnostics: {
      branchId: activeBranchId,
      headMessageId: normalized.activeHeadMessageId,
      includedMessageIds: messages.map((message) => message.id),
      excludedMessageIds,
      includedToolOperationIds
    }
  };
}

export function activeBranchMessages(session: AgentSession) {
  return buildActiveBranchContext(session).messages;
}

export function ensureConversationBranches(session: AgentSession): AgentSession {
  const now = new Date().toISOString();
  const activeBranchId = session.activeBranchId || "legacy-branch";
  const existing = session.conversationBranches.length
    ? session.conversationBranches
    : [{ id: activeBranchId, status: "active" as const, createdAt: session.createdAt || now }];
  const knownIds = new Set(existing.map((branch) => branch.id));
  const branchId = knownIds.has(activeBranchId) ? activeBranchId : existing[0].id;
  const previousMessageByBranch = new Map<string, string>();
  const messages = session.messages.map((message) => {
    const nextBranchId = message.branchId || branchId;
    const next = {
      ...message,
      branchId: nextBranchId,
      parentMessageId: message.parentMessageId ?? previousMessageByBranch.get(nextBranchId)
    };
    previousMessageByBranch.set(nextBranchId, next.id);
    return next;
  });
  const headMessageId = session.activeHeadMessageId
    ?? messages.findLast((message) => message.branchId === branchId)?.id;
  const branches = existing.map((branch) => branch.id === branchId
    ? { ...branch, headMessageId: branch.headMessageId ?? headMessageId }
    : branch);
  return {
    ...session,
    conversationBranches: branches,
    activeBranchId: branchId,
    activeHeadMessageId: headMessageId,
    messages
  };
}

export function forkConversationBranch(
  session: AgentSession,
  input: { forkedFromMessageId?: string; headMessageId?: string; createdAt?: string }
) {
  const normalized = ensureConversationBranches(session);
  const parentBranchId = normalized.activeBranchId;
  const branchId = `conversation-branch-${crypto.randomUUID()}`;
  const now = input.createdAt ?? new Date().toISOString();
  const nextBranch: ConversationBranch = {
    id: branchId,
    parentBranchId,
    forkedFromMessageId: input.forkedFromMessageId,
    headMessageId: input.headMessageId,
    status: "active",
    createdAt: now
  };
  return {
    ...normalized,
    conversationBranches: normalized.conversationBranches.map((branch) =>
      branch.id === parentBranchId ? { ...branch, status: "superseded" as const } : branch
    ).concat(nextBranch),
    activeBranchId: branchId,
    activeHeadMessageId: input.headMessageId ?? input.forkedFromMessageId,
    conversationSummary: "",
    conversationSummaryBranchId: branchId,
    updatedAt: now
  };
}

export function withActiveBranchHead(session: AgentSession, messageId: string): AgentSession {
  const branchId = session.activeBranchId || "legacy-branch";
  return {
    ...session,
    activeHeadMessageId: messageId,
    conversationBranches: session.conversationBranches.map((branch) =>
      branch.id === branchId ? { ...branch, headMessageId: messageId } : branch
    )
  };
}

function branchChain(branches: ConversationBranch[], activeBranchId: string) {
  const byId = new Map(branches.map((branch) => [branch.id, branch]));
  const chain: string[] = [];
  let current = byId.get(activeBranchId);
  while (current && !chain.includes(current.id)) {
    chain.unshift(current.id);
    current = current.parentBranchId ? byId.get(current.parentBranchId) : undefined;
  }
  return chain.length ? chain : [activeBranchId];
}
