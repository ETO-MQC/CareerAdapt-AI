import { NextRequest, NextResponse } from "next/server";
import { AgentTurnRequestSchema, AgentPlannerActionSchema } from "@/agent/runtime/agentRuntime";
import { OpenAiCompatibleProvider, type AiProviderError } from "@/ai/providers/openAiCompatibleProvider";
import { decodeAiSettingsFromHeader } from "@/services/storage/aiSettings";
import type { AgentModelTool } from "@/agent/model/agentModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Deprecated compatibility endpoint. AgentKernel production traffic uses
// /api/agent/stream in decision/narration mode.
const legacySystemPrompt = `You are CareerAdapt AI's legacy planner compatibility wrapper.
Choose only from the supplied tools. CareerProfile and FactProvenance are authoritative.
Never invent facts or expose hidden reasoning. Return a concise final answer in the user's language when no tool is needed.`;

export async function POST(request: NextRequest) {
  try {
    const parsed = AgentTurnRequestSchema.safeParse(await request.json());
    if (!parsed.success) return failure("invalid_agent_turn", "Agent turn input failed validation.", 400);
    const header = request.headers.get("x-ai-config");
    const settings = header ? decodeAiSettingsFromHeader(header) : undefined;
    const effectiveProvider = settings?.provider || process.env.AI_PROVIDER || "openai-compatible";
    if (effectiveProvider === "mock") {
      return NextResponse.json(AgentPlannerActionSchema.parse({
        type: "ask_user",
        message: "我已收到。请补充继续这项任务所需的真实材料。"
      }));
    }

    const provider = new OpenAiCompatibleProvider(settings);
    const tools = parsed.data.toolManifest.map((tool) => ({
      name: String(tool.name),
      description: String(tool.description),
      inputSchema: tool.inputSchema as Record<string, unknown>
    })) satisfies AgentModelTool[];
    const result = await provider.completeWithTools({
      systemPrompt: legacySystemPrompt,
      messages: [
        ...(parsed.data.sessionSummary ? [{ role: "system" as const, content: parsed.data.sessionSummary }] : []),
        { role: "user", content: JSON.stringify({
          userMessage: parsed.data.userMessage,
          workflowState: parsed.data.workflowState,
          pageContext: parsed.data.pageContext,
          recentToolResults: parsed.data.recentToolResults
        }) }
      ],
      tools,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)])
    });

    if (result.toolCalls?.length) {
      const manifest = new Map(parsed.data.toolManifest.map((tool) => [String(tool.name), tool]));
      const calls = result.toolCalls.map((call) => ({
        toolName: call.name,
        operationId: normalizeOperationId(call.id),
        input: call.arguments
      }));
      const confirmationCall = calls.find((call) => manifest.get(call.toolName)?.requiresConfirmation === true);
      if (confirmationCall) {
        return NextResponse.json(AgentPlannerActionSchema.parse({
          type: "request_confirmation",
          message: String(manifest.get(confirmationCall.toolName)?.description ?? "需要你的确认。"),
          call: confirmationCall
        }));
      }
      return NextResponse.json(AgentPlannerActionSchema.parse({ type: "tool_call", calls }));
    }
    return NextResponse.json(AgentPlannerActionSchema.parse({
      type: result.stopReason === "ask_user" ? "ask_user" : "assistant_message",
      message: result.text?.trim() || "请补充继续这项任务所需的真实信息。"
    }));
  } catch (cause) {
    const code = typeof cause === "object" && cause && "code" in cause ? String((cause as AiProviderError).code) : "planner_provider_failed";
    return failure(code, "Planner compatibility request failed.", 502);
  }
}

function normalizeOperationId(value: string) {
  const normalized = value.replace(/[^\w-]/g, "-").slice(0, 150);
  return normalized.length >= 8 ? normalized : `legacy-${normalized.padEnd(8, "0")}`;
}

function failure(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}
