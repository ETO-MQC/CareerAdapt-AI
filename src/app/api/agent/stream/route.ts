import { NextRequest } from "next/server";
import { AgentTurnRequestSchema } from "@/agent/runtime/agentRuntime";
import { decodeAiSettingsFromHeader } from "@/services/storage/aiSettings";
import { OpenAiCompatibleProvider, type AiProviderError } from "@/ai/providers/openAiCompatibleProvider";
import { encodeAgentSseEvent, type AgentStreamEvent } from "@/agent/runtime/agentSse";
import { routeAgentIntent } from "@/agent/runtime/agentIntentRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const assistantSystemPrompt = `You are CareerAdapt AI's assistant voice.
Visible output must be Simplified Chinese unless the final answer itself is clearly English.
Do not expose planner, repair, schema correction, JSON, action JSON, validation, or internal tool mechanics.
Do not invent resume facts. Ask for confirmation before using new user-declared facts.
Be concise and concrete.`;

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentStreamEvent) => controller.enqueue(encoder.encode(encodeAgentSseEvent(event)));
      try {
        const parsed = AgentTurnRequestSchema.safeParse(await request.json());
        if (!parsed.success) {
          send({ type: "error", code: "invalid_agent_turn", message: "请求内容无效。" });
          controller.close();
          return;
        }

        send({ type: "turn_ack" });
        const routed = routeAgentIntent(parsed.data.userMessage, {
          activeWorkflowId: parsed.data.workflowState.workflowId
        });
        if (routed.kind === "ui_action") {
          send({ type: "ui_action", action: routed.action });
          send({ type: "done", message: routed.label });
          controller.close();
          return;
        }
        if (routed.kind === "workflow_control") {
          send({ type: "status", message: routed.label });
          if (routed.action.type === "switch_workflow" && routed.action.workflowId === "job_ingestion") {
            send({ type: "ui_action", action: { type: "open_job_import_dialog" } });
          }
          send({ type: "done", action: routed.action, message: routed.label });
          controller.close();
          return;
        }

        const aiConfigHeader = request.headers.get("x-ai-config");
        const customSettings = aiConfigHeader ? decodeAiSettingsFromHeader(aiConfigHeader) : undefined;
        const effectiveProvider = customSettings?.provider || process.env.AI_PROVIDER || "openai-compatible";
        const prompt = JSON.stringify({
          userMessage: parsed.data.userMessage,
          workflowState: parsed.data.workflowState,
          pageContext: parsed.data.pageContext,
          recentToolResults: parsed.data.recentToolResults
        });

        send({ type: "status", message: "正在组织回复" });
        send({ type: "assistant_start" });
        if (effectiveProvider === "mock") {
          const text = "我已收到。请先补充这项任务需要的真实材料，我会按步骤和你核对。";
          send({ type: "assistant_delta", delta: text });
          send({ type: "done", message: text });
          controller.close();
          return;
        }

        const provider = new OpenAiCompatibleProvider(customSettings);
        let full = "";
        for await (const chunk of provider.streamText({
          systemPrompt: assistantSystemPrompt,
          userPrompt: prompt,
          maxOutputChars: 4000,
          signal: request.signal
        })) {
          if (chunk.type === "delta") {
            if (containsInternalRecoveryText(chunk.delta)) continue;
            full += chunk.delta;
            send({ type: "assistant_delta", delta: chunk.delta });
          }
        }
        const guarded = guardVisibleAssistantText(full);
        send({ type: "done", message: guarded });
      } catch (cause) {
        const sourceCode = typeof cause === "object" && cause && "code" in cause ? String((cause as AiProviderError).code) : "agent_stream_failed";
        send({ type: "error", code: sourceCode, message: "AI 回复暂时不可用，任务和输入已保留。" });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}

function guardVisibleAssistantText(text: string) {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned || containsInternalRecoveryText(cleaned)) {
    return "我已收到。请继续补充真实材料，我会按当前任务一步步和你核对。";
  }
  return cleaned;
}

function containsInternalRecoveryText(text: string) {
  return /provide action json|repair the action|planner issue|schema correction|json correction|validation error/i.test(text);
}

