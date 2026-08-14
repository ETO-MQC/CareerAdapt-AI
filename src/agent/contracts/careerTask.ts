/**
 * The two public Career Agent task classes.  A conversational task can use
 * read-only context, while a transactional workflow owns checkpoints,
 * receipts, stale guards and writes.  Keeping this distinction explicit
 * prevents ordinary career questions from being treated as hidden writes.
 */
export type ConversationalCareerTask = {
  kind: "conversational";
  taskClass: "ConversationalCareerTask";
  readOnly: true;
  contextTool: "career.context.retrieve";
  writes: false;
};

export type TransactionalCareerWorkflow = {
  kind: "transactional";
  taskClass: "TransactionalCareerWorkflow";
  readOnly: false;
  workflowId: string;
  checkpointRequired: true;
  receiptRequired: true;
  staleGuardsRequired: true;
};

export type CareerAgentTask = ConversationalCareerTask | TransactionalCareerWorkflow;

export const CONVERSATIONAL_CAREER_TASK: ConversationalCareerTask = {
  kind: "conversational",
  taskClass: "ConversationalCareerTask",
  readOnly: true,
  contextTool: "career.context.retrieve",
  writes: false
};

export function transactionalCareerWorkflow(workflowId: string): TransactionalCareerWorkflow {
  return {
    kind: "transactional",
    taskClass: "TransactionalCareerWorkflow",
    readOnly: false,
    workflowId,
    checkpointRequired: true,
    receiptRequired: true,
    staleGuardsRequired: true
  };
}
