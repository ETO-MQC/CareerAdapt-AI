import type { AgentTaskState, WorkflowInteraction } from "@/agent/contracts/agentSession";
import type { AgentToolResult } from "@/agent/contracts/agentTool";
import { AgentTaskStateReducer, normalizeAgentTaskState } from "@/agent/runtime/AgentTaskStateReducer";
import { activeWorkflowInteractionFor } from "@/agent/runtime/workflowUserInputCheckpoint";
import { isTailoringWorkflowId } from "@/agent/workflows/workflowRegistry";
import type { TailoringSession } from "@/services/jobs/tailoringCommands";

export type TailoringWorkflowBoundary =
  | {
      kind: "WAITING_FOR_USER";
      interactionKind: "clarification" | "review_decision" | "target_persistence_choice";
      taskState: AgentTaskState;
    }
  | {
      kind: "WAITING_FOR_CONFIRMATION";
      interactionKind: "confirmation";
      taskState: AgentTaskState;
    }
  | {
      kind: "COMPLETED";
      taskState: AgentTaskState;
      artifactReceipt: Record<string, unknown>;
    }
  | {
      kind: "RECOVERABLE_FAILURE";
      taskState: AgentTaskState;
      error: { code: string; message: string; operationId: string; stage: string };
    };

export type TailoringWorkflowDriverInput = {
  taskState: AgentTaskState;
  tailoringSession?: TailoringSession;
  operationId: string;
  resolvedInteraction?: WorkflowInteraction;
  signal?: AbortSignal;
  execute(input: {
    toolName: string;
    toolInput: Record<string, unknown>;
    operationId: string;
    signal?: AbortSignal;
  }): Promise<AgentToolResult>;
};

/**
 * The deterministic Tailoring progression owner after a user interaction is
 * consumed. Semantic runtimes may produce observations, but they do not
 * choose whether the next boundary is another question, review, confirmation
 * or a verified completion.
 */
export async function advanceTailoringWorkflow(
  input: TailoringWorkflowDriverInput
): Promise<TailoringWorkflowBoundary> {
  let taskState = normalizeAgentTaskState(input.taskState);
  if (!isTailoringWorkflowId(taskState.workflowId)) {
    return recoverableFailure(taskState, input.operationId, "tailoring_workflow_not_active", "当前任务不是岗位定制流程。", taskState.stage);
  }

  const activeInteraction = activeWorkflowInteractionFor(taskState);
  if (input.resolvedInteraction?.interactionId === activeInteraction?.interactionId) {
    return recoverableFailure(
      taskState,
      input.operationId,
      "tailoring_interaction_not_consumed",
      "上一条用户回答还没有完成结算，请从当前问题重试。",
      taskState.stage
    );
  }
  if (activeInteraction?.kind === "clarification") {
    return {
      kind: "WAITING_FOR_USER",
      interactionKind: "clarification",
      taskState
    };
  }
  if (taskState.completionStatus === "waiting_for_confirmation") {
    return {
      kind: "WAITING_FOR_CONFIRMATION",
      interactionKind: "confirmation",
      taskState
    };
  }

  if (taskState.stage === "generate_changes") {
    const generated = await input.execute({
      toolName: "generate_tailoring_changes",
      toolInput: { session: input.tailoringSession ?? taskState.knownSlots.tailoringSession as TailoringSession },
      operationId: input.operationId,
      signal: input.signal
    });
    if (!generated.ok) {
      return recoverableFailure(
        taskState,
        input.operationId,
        generated.error?.code ?? "tailoring_generation_failed",
        generated.error?.message ?? "生成岗位修改建议没有完成，请重试当前步骤。",
        taskState.stage
      );
    }
    taskState = new AgentTaskStateReducer().reduce(taskState, {
      type: "tool_observation",
      toolName: generated.toolName,
      observation: generated.data,
      artifactIds: generated.artifactIds
    });
  }

  if (taskState.stage === "preview_changes" && taskState.completionStatus === "active") {
    const remainingDiffCount = numberValue(taskState.knownSlots.remainingDiffCount) ?? 0;
    const acceptedDiffCount = numberValue(taskState.knownSlots.acceptedDiffCount) ?? 0;
    if (remainingDiffCount === 0 && acceptedDiffCount === 0) {
      taskState = {
        ...taskState,
        completionStatus: "waiting_for_user",
        updatedAt: new Date().toISOString()
      };
    } else if (remainingDiffCount === 0) {
      const tailoringSession = input.tailoringSession ?? taskState.knownSlots.tailoringSession as TailoringSession;
      const selectedDiffs = arrayRecords(taskState.knownSlots.selectedDiffs);
      const confirmedRequirementIds = Array.isArray(taskState.knownSlots.confirmedRequirementIds)
        ? taskState.knownSlots.confirmedRequirementIds.filter((value): value is string => typeof value === "string")
        : [];
      const previewOperationId = `${input.operationId}-preview`.slice(0, 160);
      const previewed = await input.execute({
        toolName: "preview_tailoring_changes",
        toolInput: { session: tailoringSession, selectedDiffs, confirmedRequirementIds },
        operationId: previewOperationId,
        signal: input.signal
      });
      if (!previewed.ok) {
        return recoverableFailure(
          taskState,
          input.operationId,
          previewed.error?.code ?? "tailoring_preview_failed",
          previewed.error?.message ?? "岗位修改预览没有完成，请重试当前步骤。",
          taskState.stage
        );
      }
      taskState = new AgentTaskStateReducer().reduce(taskState, {
        type: "tool_observation",
        toolName: previewed.toolName,
        observation: previewed.data,
        artifactIds: previewed.artifactIds
      });
      const applyOperationId = `${input.operationId}-apply`.slice(0, 160);
      const applyInput = {
        session: taskState.knownSlots.tailoringSession ?? tailoringSession,
        selectedDiffs: taskState.knownSlots.selectedDiffs ?? selectedDiffs,
        confirmedRequirementIds: taskState.knownSlots.confirmedRequirementIds ?? confirmedRequirementIds
      };
      const targetSnapshot = record(
        taskState.knownSlots.targetSnapshot
          ?? record(taskState.knownSlots.tailoringSession).targetSnapshot
      );
      const persistenceDecision = stringValue(taskState.knownSlots.jobPersistenceDecision) ?? "ask";
      taskState = {
        ...taskState,
        knownSlots: {
          ...taskState.knownSlots,
          pendingTargetApplyInput: applyInput,
          pendingTargetApplyOperationId: applyOperationId
        },
        updatedAt: new Date().toISOString()
      };
      if (Object.keys(targetSnapshot).length && persistenceDecision === "ask") {
        taskState = {
          ...taskState,
          pendingDecision: { type: "job_target_persistence", options: ["session_only", "save_job"] },
          completionStatus: "waiting_for_user",
          stage: "confirm_apply",
          updatedAt: new Date().toISOString()
        };
      } else {
        taskState = new AgentTaskStateReducer().reduce(taskState, {
          type: "confirmation_requested",
          toolName: "apply_tailoring_changes",
          operationId: applyOperationId
        });
      }
    }
  }

  taskState = normalizeAgentTaskState(taskState);
  const checkpoint = activeWorkflowInteractionFor(taskState);
  if (taskState.completionStatus === "waiting_for_confirmation") {
    return {
      kind: "WAITING_FOR_CONFIRMATION",
      interactionKind: "confirmation",
      taskState
    };
  }
  if (checkpoint?.kind === "clarification") {
    return {
      kind: "WAITING_FOR_USER",
      interactionKind: "clarification",
      taskState
    };
  }
  if (checkpoint?.kind === "target_persistence_choice") {
    return {
      kind: "WAITING_FOR_USER",
      interactionKind: "target_persistence_choice",
      taskState
    };
  }
  if (taskState.stage === "preview_changes" && taskState.completionStatus === "waiting_for_user") {
    return {
      kind: "WAITING_FOR_USER",
      interactionKind: "review_decision",
      taskState
    };
  }

  const receipt = artifactReceiptFromTaskState(taskState);
  if (taskState.completionStatus === "completed" && receipt) {
    return { kind: "COMPLETED", taskState, artifactReceipt: receipt };
  }

  return recoverableFailure(
    taskState,
    input.operationId,
    "tailoring_driver_no_boundary",
    "岗位定制没有留下可继续的用户边界，请重试当前步骤。",
    taskState.stage
  );
}

function artifactReceiptFromTaskState(state: AgentTaskState) {
  const quality = record(state.knownSlots.qualityResult);
  const receipt = record(quality.artifactReceipt ?? quality.receipt ?? state.knownSlots.artifactReceipt);
  return Object.keys(receipt).length ? receipt : undefined;
}

function recoverableFailure(
  state: AgentTaskState,
  operationId: string,
  code: string,
  message: string,
  stage: string
): TailoringWorkflowBoundary {
  const updatedAt = new Date().toISOString();
  const taskState: AgentTaskState = {
    ...state,
    completionStatus: "failed",
    knownSlots: {
      ...state.knownSlots,
      canonicalWorkflowFailure: { code, message, operationId, stage, recoverable: true }
    },
    updatedAt
  };
  return {
    kind: "RECOVERABLE_FAILURE",
    taskState,
    error: { code, message, operationId, stage }
  };
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
