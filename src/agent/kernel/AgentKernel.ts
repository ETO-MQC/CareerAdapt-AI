import { nanoid } from "nanoid";
import type { AgentSession, AgentConfirmation } from "@/agent/contracts/agentSession";
import type { AgentPageContext } from "@/agent/contracts/agentContext";
import type { AgentToolResult } from "@/agent/contracts/agentTool";
import type { AgentModel, AgentModelMessage, AgentModelToolCall } from "@/agent/model/agentModel";
import type { AgentStreamEvent } from "@/agent/runtime/agentSse";
import { AgentConfirmationRequiredError, AgentExecutor } from "@/agent/runtime/agentExecutor";
import { AgentContextAssembler } from "./AgentContextAssembler";
import { AgentMemoryManager } from "./AgentMemoryManager";
import { AgentPolicyError, AgentPolicyGuard } from "./AgentPolicyGuard";
import { AgentReflection, type AgentReflectionResult } from "./AgentReflection";
import { agentSkillRegistry, type AgentSkillRegistry } from "./AgentSkillRegistry";
import { AgentToolResolver } from "./AgentToolResolver";
import { AgentTrajectory, type AgentTrajectorySnapshot } from "./AgentTrajectory";

export type AgentKernelResult = {
  text?: string;
  pendingConfirmation?: AgentConfirmation;
  pendingCall?: { toolName: string; operationId: string; input: Record<string, unknown> };
  trajectory: AgentTrajectorySnapshot;
  reflection?: AgentReflectionResult;
};

export class AgentKernel {
  constructor(private readonly dependencies: {
    model: AgentModel;
    executor: AgentExecutor;
    toolResolver: AgentToolResolver;
    skillRegistry?: AgentSkillRegistry;
    contextAssembler?: AgentContextAssembler;
    memoryManager?: AgentMemoryManager;
    reflection?: AgentReflection;
    maxIterations?: number;
    maxToolCalls?: number;
  }) {}

  async runTurn(input: {
    session: AgentSession;
    pageContext: AgentPageContext;
    userMessage: string;
    signal?: AbortSignal;
    emit?(event: AgentStreamEvent): void | Promise<void>;
  }): Promise<AgentKernelResult> {
    const maxIterations = this.dependencies.maxIterations ?? 8;
    const maxToolCalls = this.dependencies.maxToolCalls ?? 12;
    const trajectory = new AgentTrajectory(`agent-task-${nanoid(12)}`, input.session.workflowState.workflowId);
    const guard = new AgentPolicyGuard();
    const skills = (this.dependencies.skillRegistry ?? agentSkillRegistry).discover({
      workflowId: input.session.workflowState.workflowId,
      userMessage: input.userMessage
    });
    const memory = (this.dependencies.memoryManager ?? new AgentMemoryManager()).retrieve(input.session);
    const systemPrompt = (this.dependencies.contextAssembler ?? new AgentContextAssembler()).assemble({
      session: input.session,
      pageContext: input.pageContext,
      userMessage: input.userMessage,
      memory,
      activeSkills: skills
    });
    const allowedTools = this.dependencies.toolResolver.allowedTools({
      workflowId: input.session.workflowState.workflowId,
      step: input.session.workflowState.step,
      skills
    });
    const modelTools = this.dependencies.toolResolver.modelManifest(allowedTools);
    const messages = toModelMessages(input.session, input.userMessage);
    let toolCallCount = 0;

    await emit(input, { type: "turn_ack", sessionId: input.session.id });
    await emit(input, { type: "workflow_updated", workflowState: input.session.workflowState });
    for (const skill of skills) {
      trajectory.skill(skill.id);
      await emit(input, { type: "skill_loaded", skillId: skill.id, label: `已加载${skill.name}方法` });
    }

    try {
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        throwIfAborted(input.signal);
        await emit(input, {
          type: "thinking",
          stage: iteration ? "observing" : "planning",
          label: iteration ? "正在根据已读取的信息继续分析" : thinkingLabel(input.userMessage)
        });
        const response = await this.dependencies.model.completeWithTools({
          systemPrompt,
          messages,
          tools: modelTools,
          signal: input.signal
        });

        if (response.toolCalls?.length) {
          messages.push({ role: "assistant", content: response.text ?? "", toolCalls: response.toolCalls });
          if (response.toolCalls.length > 1) {
            const batchTools = response.toolCalls.map((call) => allowedTools.find((tool) => tool.name === call.name));
            if (batchTools.some((tool) => !tool || tool.risk !== "read")) {
              throw new AgentPolicyError("agent_parallel_write_rejected", "Only independent read tools may be called together.");
            }
          }

          for (const call of response.toolCalls) {
            const validated = guard.validate({ call, allowedTools, toolCallCount, maxToolCalls });
            toolCallCount += 1;
            const operationId = stableOperationId(call);
            trajectory.toolStarted(validated.tool.name, operationId);
            await emit(input, {
              type: "tool_started",
              toolName: validated.tool.name,
              operationId,
              userLabel: toolActivityLabel(validated.tool.name)
            });
            try {
              const result = await this.dependencies.executor.execute({
                toolName: validated.tool.name,
                toolInput: validated.input,
                operationId,
                signal: input.signal
              });
              trajectory.toolCompleted(operationId, result.ok, result.artifactIds);
              await emit(input, {
                type: "tool_result",
                toolName: result.toolName,
                operationId,
                ok: result.ok,
                summary: summarizeToolResult(result),
                artifactIds: result.artifactIds
              });
              messages.push(toolObservation(call, result));
            } catch (error) {
              if (error instanceof AgentConfirmationRequiredError) {
                trajectory.confirmation(validated.tool.name, operationId);
                await emit(input, { type: "confirmation_required", confirmation: error.confirmation });
                return {
                  pendingConfirmation: error.confirmation,
                  pendingCall: { toolName: validated.tool.name, operationId, input: validated.input as Record<string, unknown> },
                  trajectory: trajectory.value()
                };
              }
              throw error;
            }
          }
          continue;
        }

        if (response.stopReason === "ask_user") {
          const text = response.text?.trim() || "请补充继续这项任务所需的真实信息。";
          await streamFinal(this.dependencies.model, { systemPrompt, messages, tools: modelTools }, text, input);
          trajectory.finish("waiting_for_user");
          return { text, trajectory: trajectory.value() };
        }

        const text = response.text?.trim();
        if (text) {
          const visible = await streamFinal(this.dependencies.model, { systemPrompt, messages, tools: modelTools }, text, input);
          trajectory.finish("completed");
          const snapshot = trajectory.value();
          return {
            text: visible,
            trajectory: snapshot,
            reflection: (this.dependencies.reflection ?? new AgentReflection()).create(snapshot)
          };
        }
      }
      throw new AgentPolicyError("agent_iteration_budget_exceeded", `Agent exceeded ${maxIterations} model iterations.`);
    } catch (error) {
      const code = errorCode(error);
      if (code === "AbortError" || input.signal?.aborted) {
        trajectory.finish("aborted");
        return { trajectory: trajectory.value() };
      }
      trajectory.error(code, error instanceof Error ? error.message : "Agent turn failed.");
      trajectory.finish("failed");
      await emit(input, { type: "error", code, message: userErrorMessage(code) });
      return { trajectory: trajectory.value() };
    }
  }
}

async function streamFinal(
  model: AgentModel,
  request: { systemPrompt: string; messages: AgentModelMessage[]; tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> },
  draft: string,
  input: { signal?: AbortSignal; emit?(event: AgentStreamEvent): void | Promise<void> }
) {
  await emit(input, { type: "assistant_start" });
  if (!model.streamFinalText) {
    await emit(input, { type: "assistant_delta", delta: draft });
    await emit(input, { type: "done", message: draft });
    return draft;
  }
  let visible = "";
  for await (const delta of model.streamFinalText({ ...request, draft, signal: input.signal })) {
    visible += delta;
    await emit(input, { type: "assistant_delta", delta });
  }
  const final = visible.trim() || draft;
  await emit(input, { type: "done", message: final });
  return final;
}

function toModelMessages(session: AgentSession, userMessage: string): AgentModelMessage[] {
  const messages = session.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-20)
    .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));
  if (!messages.length || messages.at(-1)?.role !== "user" || messages.at(-1)?.content !== userMessage) {
    messages.push({ role: "user", content: userMessage });
  }
  return messages;
}

function toolObservation(call: AgentModelToolCall, result: AgentToolResult): AgentModelMessage {
  return {
    role: "tool",
    name: result.toolName,
    toolCallId: call.id,
    content: JSON.stringify(result.ok ? result.data : { error: result.error }).slice(0, 16_000)
  };
}

function stableOperationId(call: AgentModelToolCall) {
  const candidate = call.id.replace(/[^\w-]/g, "-").slice(0, 120);
  return candidate.length >= 8 ? candidate : `agent-op-${candidate}-${nanoid(8)}`;
}

function summarizeToolResult(result: AgentToolResult) {
  if (!result.ok) return "这一步未能完成，任务信息已保留。";
  const data = result.data as Record<string, unknown> | undefined;
  if (result.toolName === "get_active_profile") return data?.selected ? "已找到当前资料库。" : "尚未选择当前资料库。";
  if (result.toolName === "get_profile") {
    const profile = data?.profile as Record<string, unknown> | undefined;
    const counts = profile?.sectionCounts as Record<string, number> | undefined;
    const total = counts ? Object.values(counts).reduce((sum, value) => sum + value, 0) : undefined;
    return total === undefined ? "已读取资料库详情。" : `已读取资料库中的 ${total} 项内容。`;
  }
  if (result.toolName === "search_profile_facts") {
    const count = Array.isArray(data?.results) ? data.results.length : 0;
    return `已找到 ${count} 条相关经历或事实。`;
  }
  const labels: Record<string, string> = {
    list_profiles: "已读取资料库列表。",
    list_resumes: "已读取简历列表。",
    list_jobs: "已读取岗位列表。",
    get_resume: "已读取简历详情。",
    get_resume_revision: "已读取简历版本。",
    get_job: "已读取岗位详情。",
    analyze_job_fit: "已完成岗位匹配分析。",
    parse_job_description: "已完成岗位要求分析。",
    create_tailoring_session: "已准备简历改写方案。",
    preview_tailoring_changes: "已准备修改预览。"
  };
  return labels[result.toolName] ?? "这一步已完成。";
}

function toolActivityLabel(toolName: string) {
  const labels: Record<string, string> = {
    get_active_profile: "正在确认你当前选择的资料库",
    get_profile: "正在读取你的资料库",
    search_profile_facts: "正在匹配真实经历",
    list_profiles: "正在查看你的资料库",
    list_resumes: "正在查看可用简历",
    get_resume: "正在读取简历内容",
    get_resume_revision: "正在核对简历版本",
    list_jobs: "正在查看目标岗位",
    get_job: "正在读取目标岗位",
    parse_job_description: "正在分析目标岗位",
    analyze_job_fit: "正在分析岗位匹配",
    create_tailoring_session: "正在准备改写方案",
    preview_tailoring_changes: "正在核对改写内容",
    apply_tailoring_changes: "正在创建新的简历版本",
    export_resume: "正在准备简历导出"
  };
  return labels[toolName] ?? "正在处理这一步";
}

function thinkingLabel(message: string) {
  if (/岗位|JD|职位/i.test(message)) return "正在分析你的求职任务";
  if (/资料库|经历|我是谁|AI/i.test(message)) return "正在判断需要读取哪些真实资料";
  return "正在规划下一步";
}

function userErrorMessage(code: string) {
  if (code === "agent_duplicate_tool_call") return "我检测到重复步骤并已停止，现有任务信息仍然保留。";
  if (code.includes("budget")) return "这项任务的自动步骤已达到安全上限，现有进度已保留。";
  return "AI 任务暂时中断，当前进度和输入已保留。";
}

function errorCode(error: unknown) {
  if (error instanceof AgentPolicyError) return error.code;
  return typeof error === "object" && error && "code" in error ? String(error.code) : error instanceof DOMException ? error.name : "agent_kernel_failed";
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw Object.assign(new DOMException("Aborted", "AbortError"), { code: "AbortError" });
}

async function emit(
  input: { emit?(event: AgentStreamEvent): void | Promise<void> },
  event: AgentStreamEvent
) {
  await input.emit?.(event);
}
