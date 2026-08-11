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

export function runtimeUserEventMessage(event: RuntimeUserEvent) {
  if (event.type === "text_message" || event.type === "quick_action_started") return event.text;
  return "";
}
