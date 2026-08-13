import type {
  AgentArtifactAction,
  AgentOptionAction,
  AgentWorkflowControl
} from "@/agent/contracts/agentActions";
import type { AgentMessageReference } from "@/agent/contracts/agentSession";
import type { AgentQuickActionId, QuickActionIntent } from "@/agent/contracts/agentQuickAction";

/**
 * The semantic input protocol shared by every career runtime.
 *
 * Values in this union are authoritative UI/domain events. They are not
 * natural-language hints for a model to reinterpret. In particular, entity
 * and option selections carry the validated action that the host persisted
 * before the runtime is asked to continue.
 */
export type RuntimeUserEvent =
  | {
      type: "text_message";
      text: string;
      references?: AgentMessageReference[];
    }
  | {
      type: "quick_action_started";
      actionId: AgentQuickActionId;
      text: string;
      task: QuickActionIntent["task"];
    }
  | {
      type: "entity_selected";
      action: Extract<AgentOptionAction, { type: "select_entity" }>;
    }
  | {
      type: "option_selected";
      optionId?: string;
      action: AgentOptionAction;
    }
  | ConfirmResumeCompositionCommand
  | {
      type: "confirmation";
      confirmed: boolean;
    }
  | {
      type: "retry";
      action?: Extract<AgentOptionAction, { type: "retry_current_step" }>;
      sourceMessageId?: string;
    }
  | {
      type: "regenerate";
      messageId: string;
    }
  | {
      type: "edit_message";
      messageId: string;
      text: string;
    }
  | {
      type: "artifact_action";
      action: AgentArtifactAction;
    }
  | {
      type: "workflow_control";
      action: AgentWorkflowControl;
    };

export type ConfirmResumeCompositionCommand = {
  /**
   * Host-only terminal command. It is deliberately not a natural-language
   * continuation for Hermes/Native to reinterpret.
   */
  type: "confirm_resume_composition";
  sessionId: string;
  checkpointId: string;
  contentHash: string;
  profileId: string;
  expectedProfileRevision: number;
  mode: "general" | "job_specific";
  branchMode: "create_new" | "update_existing";
  jobId?: string;
  sourceResumeId?: string;
  sourceFingerprint?: {
    branchId: string;
    revisionId: string;
    contentHash: string;
    presentationHash: string;
  };
};

export function normalizeResumeCompositionConfirmationText(value: unknown) {
  const compact = String(value ?? "").trim().replace(/[\s。！!？?，,、：:；;]+$/gu, "");
  if (/^(?:更新现有简历|更新当前简历)$/u.test(compact)) return "update_existing" as const;
  if (/^(?:直接生成|生成吧|按这个生成|确认生成|就按这个生成)$/u.test(compact)) return "create_new" as const;
  return undefined;
}

export function runtimeUserEventMessage(event: RuntimeUserEvent) {
  if (event.type === "text_message" || event.type === "quick_action_started") return event.text;
  return "";
}
