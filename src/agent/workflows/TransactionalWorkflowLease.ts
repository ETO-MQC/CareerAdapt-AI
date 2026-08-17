export type TransactionalWorkflowLease = {
  leaseId: string;
  workflowName: string;
  logicalTurnId: string;
  taskId?: string;
  operationId: string;
  acquiredAt: string;
};

export class TransactionalWorkflowBusyError extends Error {
  readonly code = "career_workflow_in_progress";
  readonly retryable = true;

  constructor(readonly activeLease: TransactionalWorkflowLease) {
    super("当前 Career 工作流正在另一个事务中执行。请等待当前 checkpoint 完成后再继续。");
  }
}

/**
 * Process-local serialization for one LogicalTurn/Task.  Repository writes
 * remain the authoritative transaction boundary; this lease only prevents
 * two facade executions from interleaving their checkpoints and writes.
 */
export class TransactionalWorkflowLeaseManager {
  private readonly active = new Map<string, TransactionalWorkflowLease>();

  acquire(input: {
    workflowName: string;
    logicalTurnId?: string;
    taskId?: string;
    operationId: string;
  }) {
    const logicalTurnId = input.logicalTurnId ?? input.taskId;
    if (!logicalTurnId) return undefined;
    const key = leaseKey(logicalTurnId, input.taskId);
    const current = this.active.get(key);
    if (current) throw new TransactionalWorkflowBusyError(current);
    const lease: TransactionalWorkflowLease = {
      leaseId: `${input.workflowName}:${input.operationId}`,
      workflowName: input.workflowName,
      logicalTurnId,
      taskId: input.taskId,
      operationId: input.operationId,
      acquiredAt: new Date().toISOString()
    };
    this.active.set(key, lease);
    return lease;
  }

  release(lease?: TransactionalWorkflowLease) {
    if (!lease) return;
    const key = leaseKey(lease.logicalTurnId, lease.taskId);
    if (this.active.get(key)?.leaseId === lease.leaseId) this.active.delete(key);
  }

  get(logicalTurnId: string, taskId?: string) {
    return this.active.get(leaseKey(logicalTurnId, taskId));
  }
}

function leaseKey(logicalTurnId: string, taskId?: string) {
  return `${logicalTurnId}\u001f${taskId ?? ""}`;
}

