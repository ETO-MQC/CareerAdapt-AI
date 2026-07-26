import { NextRequest, NextResponse } from "next/server";
import { AgentTurnRequestSchema } from "@/agent/runtime/agentRuntime";
import { decodeAiSettingsFromHeader } from "@/services/storage/aiSettings";
import { OpenAiCompatibleProvider, type AiProviderError } from "@/ai/providers/openAiCompatibleProvider";
import { encodeAgentSseEvent, type AgentStreamEvent } from "@/agent/runtime/agentSse";
import { routeAgentIntent } from "@/agent/runtime/agentIntentRouter";
import { AgentModelRequestSchema, AgentModelResultSchema, type AgentModelMessage } from "@/agent/model/agentModel";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const assistantSystemPrompt = `You are CareerAdapt AI's assistant voice.
Visible output must be Simplified Chinese unless the final answer itself is clearly English.
Do not expose planner, repair, schema correction, JSON, action JSON, validation, or internal tool mechanics.
Do not invent resume facts. Ask for confirmation before using new user-declared facts.
When recentToolResults contains list_profiles, treat it as a read-only local profile-library inventory and answer the user's question from it. If it is insufficient, say what is missing instead of opening UI by default.
Be concise and concrete.`;

export async function POST(request: NextRequest) {
  const raw = await request.json();
  const mode = typeof raw === "object" && raw && "mode" in raw ? String(raw.mode) : undefined;
  if (mode === "decision") return modelDecision(request, raw);
  if (mode === "native_turn") return modelNativeTurn(request, raw);
  if (mode === "narration") return modelNarration(request, raw);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentStreamEvent) => controller.enqueue(encoder.encode(encodeAgentSseEvent(event)));
      try {
        const parsed = AgentTurnRequestSchema.safeParse(raw);
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
          send({ type: "thinking", stage: "routing", label: routed.label });
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

        send({ type: "thinking", stage: "narrating", label: "正在组织回复" });
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

async function modelNativeTurn(request: NextRequest, raw: unknown) {
  const parsed = AgentModelRequestSchema.safeParse(stripMode(raw));
  if (!parsed.success) return modelError("invalid_agent_model_request", "Agent model input failed validation.", 400);
  const encoder = new TextEncoder();
  const settings = settingsFrom(request);
  const effectiveProvider = settings?.provider || process.env.AI_PROVIDER || "openai-compatible";
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Parameters<typeof encodeAgentSseEvent>[0]) =>
        controller.enqueue(encoder.encode(encodeAgentSseEvent(event)));
      try {
        if (effectiveProvider === "mock") {
          const result = AgentModelResultSchema.parse(mockModelDecision(parsed.data.messages));
          if (result.text) send({ type: "model_text_delta", delta: result.text });
          for (const [index, call] of (result.toolCalls ?? []).entries()) {
            send({ type: "model_tool_call_start", index, id: call.id, name: call.name });
            send({ type: "model_tool_call_complete", index, call });
          }
          send({ type: "model_finish", stopReason: result.stopReason });
          return;
        }
        const provider = new OpenAiCompatibleProvider(settings);
        for await (const event of provider.streamTurn({
          ...parsed.data,
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)])
        })) {
          if (event.type === "assistant_text_delta") send({ type: "model_text_delta", delta: event.delta });
          if (event.type === "tool_call_start") send({ type: "model_tool_call_start", index: event.index, id: event.id, name: event.name });
          if (event.type === "tool_call_arguments_delta") send({ type: "model_tool_arguments_delta", index: event.index, id: event.id, delta: event.delta });
          if (event.type === "tool_call_complete") send({ type: "model_tool_call_complete", index: event.index, call: event.call });
          if (event.type === "usage") send({ type: "model_usage", inputTokens: event.inputTokens, outputTokens: event.outputTokens });
          if (event.type === "finish") send({ type: "model_finish", stopReason: event.stopReason });
        }
      } catch (cause) {
        const code = typeof cause === "object" && cause && "code" in cause ? String((cause as AiProviderError).code) : "agent_model_failed";
        send({ type: "error", code, message: "AI 流式响应暂时不可用，任务和输入已保留。" });
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

async function modelDecision(request: NextRequest, raw: unknown) {
  const parsed = AgentModelRequestSchema.safeParse(stripMode(raw));
  if (!parsed.success) return modelError("invalid_agent_model_request", "Agent model input failed validation.", 400);
  try {
    const settings = settingsFrom(request);
    const effectiveProvider = settings?.provider || process.env.AI_PROVIDER || "openai-compatible";
    if (effectiveProvider === "mock") return NextResponse.json(AgentModelResultSchema.parse(mockModelDecision(parsed.data.messages)));
    const provider = new OpenAiCompatibleProvider(settings);
    return NextResponse.json(await provider.completeWithTools({
      ...parsed.data,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)])
    }));
  } catch (cause) {
    const code = typeof cause === "object" && cause && "code" in cause ? String((cause as AiProviderError).code) : "agent_model_failed";
    return modelError(code, "Agent model could not decide the next safe action.", 502);
  }
}

async function modelNarration(request: NextRequest, raw: unknown) {
  const schema = AgentModelRequestSchema.extend({ draft: z.string().min(1).max(8000) });
  const parsed = schema.safeParse(stripMode(raw));
  if (!parsed.success) return modelError("invalid_agent_narration_request", "Agent narration input failed validation.", 400);
  const encoder = new TextEncoder();
  const settings = settingsFrom(request);
  const effectiveProvider = settings?.provider || process.env.AI_PROVIDER || "openai-compatible";
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentStreamEvent) => controller.enqueue(encoder.encode(encodeAgentSseEvent(event)));
      try {
        send({ type: "assistant_start" });
        if (effectiveProvider === "mock") {
          send({ type: "assistant_delta", delta: parsed.data.draft });
          send({ type: "done", message: parsed.data.draft });
          return;
        }
        const provider = new OpenAiCompatibleProvider(settings);
        let full = "";
        for await (const chunk of provider.streamText({
          systemPrompt: `You are CareerAdapt AI's final answer narrator.
Output only the supplied draft in the user's language. Preserve every fact, count, uncertainty, and conclusion. Do not add facts, explanations, headings about tools, or hidden reasoning.`,
          userPrompt: parsed.data.draft,
          maxOutputChars: 8000,
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)])
        })) {
          if (chunk.type === "delta") {
            full += chunk.delta;
            send({ type: "assistant_delta", delta: chunk.delta });
          }
        }
        send({ type: "done", message: full });
      } catch (cause) {
        const code = typeof cause === "object" && cause && "code" in cause ? String((cause as AiProviderError).code) : "agent_narration_failed";
        send({ type: "error", code, message: "AI 回复暂时不可用，任务和输入已保留。" });
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

function settingsFrom(request: NextRequest) {
  const header = request.headers.get("x-ai-config");
  return header ? decodeAiSettingsFromHeader(header) : undefined;
}

function stripMode(raw: unknown) {
  if (!raw || typeof raw !== "object") return raw;
  const value = { ...raw as Record<string, unknown> };
  delete value.mode;
  return value;
}

function modelError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function mockModelDecision(messages: AgentModelMessage[]) {
  const latestUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const observations = messages.filter((message) => message.role === "tool");
  const active = lastObservation(observations, "get_active_profile");
  const profile = lastObservation(observations, "get_profile");
  const search = lastObservation(observations, "search_profile_facts");
  if (/我是谁|知道我|资料库|经历|AI\s*相关/i.test(latestUser)) {
    if (!active) {
      return { stopReason: "tool_calls", toolCalls: [{ id: `mock-active-${Date.now()}`, name: "get_active_profile", arguments: {} }] };
    }
    const activeData = safeJson(active.content) as { selected?: boolean; profileId?: string | null; name?: string };
    if (!activeData.selected || !activeData.profileId) {
      return { stopReason: "final", text: "目前还没有选中的资料库。我不会据此判断资料库为空；请先选择一个资料库。" };
    }
    if (/AI\s*相关/i.test(latestUser) && !search) {
      return {
        stopReason: "tool_calls",
        toolCalls: [{ id: `mock-search-${Date.now()}`, name: "search_profile_facts", arguments: { profileId: activeData.profileId, query: "AI 人工智能 大模型 机器学习", limit: 12 } }]
      };
    }
    if (/AI\s*相关/i.test(latestUser) && search) {
      const data = safeJson(search.content) as { results?: Array<{ title?: string; body?: string }> };
      const results = data.results ?? [];
      return {
        stopReason: "final",
        text: results.length
          ? `我在当前资料库中找到 ${results.length} 条 AI 相关经历：${results.slice(0, 5).map((item) => item.title).filter(Boolean).join("、")}。这些结论只来自已保存资料。`
          : "我已检索当前资料库，但没有找到明确的 AI 相关事实；这不等于你没有相关能力，只表示资料库里还没有可引用的证据。"
      };
    }
    if (!profile) {
      return { stopReason: "tool_calls", toolCalls: [{ id: `mock-profile-${Date.now()}`, name: "get_profile", arguments: { profileId: activeData.profileId } }] };
    }
    const data = safeJson(profile.content) as { profile?: { name?: string; sectionCounts?: Record<string, number>; items?: Array<{ title?: string }> } };
    const detail = data.profile;
    const counts = detail?.sectionCounts ?? {};
    const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
    if (/我是谁|知道我/.test(latestUser)) {
      return { stopReason: "final", text: `我知道你当前选择的是“${detail?.name ?? activeData.name ?? "未命名"}”资料库。现有资料共 ${total} 项；我只会依据这些已保存内容描述你，不会补造未知信息。` };
    }
    return {
      stopReason: "final",
      text: `我已读取当前资料库：共 ${total} 项内容。代表经历包括 ${(detail?.items ?? []).slice(0, 4).map((item) => item.title).filter(Boolean).join("、") || "暂无可概括条目"}。优势是已有内容可追溯；明显空白应以各分类计数为 0 的部分为准，不能用推测补齐。`
    };
  }
  return { stopReason: "final", text: "我已收到。请告诉我你想查看资料、分析岗位，还是准备简历。" };
}

function lastObservation(messages: AgentModelMessage[], name: string) {
  return [...messages].reverse().find((message) => message.name === name);
}

function safeJson(value: string) {
  try { return JSON.parse(value); } catch { return {}; }
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
