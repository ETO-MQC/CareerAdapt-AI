import { nanoid } from "nanoid";
import type { AgentSession, AgentConfirmation, AgentMessageReference } from "@/agent/contracts/agentSession";
import type { AgentPageContext } from "@/agent/contracts/agentContext";
import type { AgentToolResult } from "@/agent/contracts/agentTool";
import type { AgentModel, AgentModelMessage, AgentModelResult, AgentModelToolCall } from "@/agent/model/agentModel";
import type { AgentStreamEvent } from "@/agent/runtime/agentSse";
import { AgentConfirmationRequiredError, AgentExecutor } from "@/agent/runtime/agentExecutor";
import { AgentContextAssembler } from "./AgentContextAssembler";
import { AgentCanonicalEntityGuard } from "./AgentCanonicalEntityGuard";
import { AgentContextWindow } from "./AgentContextWindow";
import { AgentMemoryManager } from "./AgentMemoryManager";
import { AgentObservationCache } from "./AgentObservationCache";
import { AgentPolicyError, AgentPolicyGuard } from "./AgentPolicyGuard";
import { AgentReflection, type AgentReflectionResult } from "./AgentReflection";
import { agentSkillRegistry, type AgentSkillRegistry } from "./AgentSkillRegistry";
import { AgentToolResolver } from "./AgentToolResolver";
import { AgentTrajectory, type AgentTrajectorySnapshot } from "./AgentTrajectory";
import {
  AgentTaskStateReducer,
  dependencySnapshot
} from "@/agent/runtime/AgentTaskStateReducer";
import { AgentTaskCompletionGuard } from "./AgentTaskCompletionGuard";
import {
  projectTaskStateIntoSession,
  projectTaskStateToWorkflowState
} from "@/agent/runtime/projectTaskStateToWorkflowState";
import type { TurnIntent, TurnToolScope } from "@/agent/runtime/AgentTurnIntent";
import { capabilityManifestForPrompt } from "@/agent/capabilities/AgentProductCapabilityManifest";

export type AgentKernelResult = {
  text?: string;
  pendingConfirmation?: AgentConfirmation;
  pendingCall?: { toolName: string; operationId: string; input: Record<string, unknown> };
  trajectory: AgentTrajectorySnapshot;
  reflection?: AgentReflectionResult;
  conversationSummary?: string;
  taskState?: AgentSession["taskState"];
};

export class AgentKernel {
  private readonly observationCache: AgentObservationCache;

  constructor(private readonly dependencies: {
    model: AgentModel;
    executor: AgentExecutor;
    toolResolver: AgentToolResolver;
    skillRegistry?: AgentSkillRegistry;
    contextAssembler?: AgentContextAssembler;
    contextWindow?: AgentContextWindow;
    observationCache?: AgentObservationCache;
    memoryManager?: AgentMemoryManager;
    reflection?: AgentReflection;
    maxIterations?: number;
    maxToolCalls?: number;
  }) {
    this.observationCache = dependencies.observationCache ?? new AgentObservationCache();
  }

  invalidateObservationsAfter(toolName: string) {
    this.observationCache.invalidateAfter(toolName);
  }

  async runTurn(input: {
    session: AgentSession;
    pageContext: AgentPageContext;
    userMessage: string;
    references?: AgentMessageReference[];
    turnId?: string;
    turnIntent?: TurnIntent;
    toolScope?: TurnToolScope;
    signal?: AbortSignal;
    emit?(event: AgentStreamEvent): void | Promise<void>;
    internalObservation?: {
      reason: "tool_observation" | "confirmation_rejected" | "external_event";
      toolName?: string;
      observation: unknown;
    };
    taskEventAlreadyReduced?: boolean;
  }): Promise<AgentKernelResult> {
    const maxIterations = this.dependencies.maxIterations ?? 8;
    const maxToolCalls = this.dependencies.maxToolCalls ?? 12;
    const guard = new AgentPolicyGuard();
    const canonicalEntities = new AgentCanonicalEntityGuard();
    const taskReducer = new AgentTaskStateReducer();
    let taskState = input.session.taskState ?? taskReducer.create(input.session);
    if (!input.taskEventAlreadyReduced && input.turnIntent !== "casual_side_turn" && input.turnIntent !== "reference_followup") {
      taskState = taskReducer.reduce(taskState, { type: "user_message", message: input.userMessage });
    }
    if (input.internalObservation?.reason === "tool_observation" && input.internalObservation.toolName) {
      taskState = taskReducer.reduce(taskState, {
        type: "tool_observation",
        toolName: input.internalObservation.toolName,
        observation: input.internalObservation.observation
      });
    }
    if (input.internalObservation?.reason === "confirmation_rejected" && input.internalObservation.toolName) {
      taskState = taskReducer.reduce(taskState, {
        type: "confirmation_rejected",
        toolName: input.internalObservation.toolName
      });
    }
    const trajectory = new AgentTrajectory(`agent-task-${nanoid(12)}`, taskState.workflowId);
    const authoritativeSession = projectTaskStateIntoSession(input.session, taskState);
    const skillRegistry = this.dependencies.skillRegistry ?? agentSkillRegistry;
    let skills = skillRegistry.discover({
      workflowId: taskState.workflowId,
      step: taskState.stage,
      selectedEntities: taskState.selectedEntities,
      userMessage: input.userMessage
    });
    const memoryManager = this.dependencies.memoryManager ?? new AgentMemoryManager();
    const contextAssembler = this.dependencies.contextAssembler ?? new AgentContextAssembler();
    const memory = memoryManager.retrieve(authoritativeSession);
    let systemPrompt = contextAssembler.assemble({
      session: authoritativeSession,
      pageContext: input.pageContext,
      userMessage: input.userMessage,
      memory,
      activeSkills: skills,
      references: resolveReferences(authoritativeSession, input.references),
      turnIntent: input.turnIntent
    });
    let allowedTools = this.dependencies.toolResolver.allowedTools({
      workflowId: taskState.workflowId,
      step: taskState.stage,
      skills,
      session: authoritativeSession,
      userMessage: input.userMessage
    });
    allowedTools = toolsForTurnScope(this.dependencies.toolResolver, allowedTools, input.toolScope);
    let modelTools = this.dependencies.toolResolver.modelManifest(allowedTools);
    const contextWindow = (this.dependencies.contextWindow ?? new AgentContextWindow()).build(
      input.session,
      input.userMessage
    );
    const messages = contextWindow.messages;
    if (input.internalObservation) {
      messages.push({
        role: input.internalObservation.reason === "tool_observation" ? "tool" : "system",
        name: input.internalObservation.toolName,
        toolCallId: input.internalObservation.reason === "tool_observation" ? `resume-${input.internalObservation.toolName ?? "event"}` : undefined,
        content: boundedObservationJson({
          reason: input.internalObservation.reason,
          observation: input.internalObservation.observation
        })
      });
    }
    let toolCallCount = 0;
    const turnId = input.turnId ?? input.session.activeTurn?.id ?? `agent-turn-${nanoid(12)}`;
    let previousNoProgressFingerprint: string | undefined;

    await emit(input, { type: "turn_ack", sessionId: input.session.id });
    await emit(input, {
      type: "workflow_updated",
      workflowState: projectTaskStateToWorkflowState(taskState, input.session.workflowState)
    });
    for (const skill of skills) {
      trajectory.skill(skill.id);
      await emit(input, { type: "skill_loaded", skillId: skill.id, label: `已加载${skill.name}方法` });
    }

    try {
      const capabilityAnswer = deterministicCapabilityAnswer(input.userMessage);
      if (capabilityAnswer && (input.turnIntent === "casual_side_turn" || input.toolScope === "none")) {
        const iterationId = `${turnId}:iteration:1`;
        await publishFinalStream(capabilityAnswer, input, { turnId, iterationId });
        trajectory.finish("completed");
        return {
          text: capabilityAnswer,
          trajectory: trajectory.value(),
          conversationSummary: contextWindow.conversationSummary,
          taskState
        };
      }
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        const iterationId = `${turnId}:iteration:${iteration + 1}`;
        throwIfAborted(input.signal);
        await emit(input, {
          type: "thinking",
          stage: iteration ? "observing" : "planning",
          label: iteration ? "正在根据已读取的信息继续分析" : thinkingLabel(input.userMessage)
        });
        const nativeStreaming = this.dependencies.model.capabilities?.nativeToolStreaming === true
          && Boolean(this.dependencies.model.streamTurn);
        const response = nativeStreaming
          ? await consumeNativeTurn(this.dependencies.model, {
              systemPrompt,
              messages,
              tools: modelTools,
              signal: input.signal
            }, input)
          : await this.dependencies.model.completeWithTools({
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
            let validated;
            try {
              validated = guard.validate({
                call: bindAuthoritativeTaskInput(call, taskState),
                allowedTools,
                toolCallCount,
                maxToolCalls
              });
            } catch (error) {
              if (error instanceof AgentPolicyError && error.code === "agent_duplicate_tool_call") {
                await emit(input, {
                  type: "tool_result",
                  toolName: call.name,
                  operationId: stableOperationId(call),
                  ok: true,
                  summary: "Equivalent result already available.",
                  artifactIds: []
                });
                messages.push({
                  role: "tool",
                  name: call.name,
                  toolCallId: call.id,
                  content: JSON.stringify({ observation: "Equivalent result already available." })
                });
                continue;
              }
              throw error;
            }
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
              const cached = this.observationCache.get(validated.tool.name, validated.input);
              const result = cached ?? await this.dependencies.executor.execute({
                  toolName: validated.tool.name,
                  toolInput: validated.input,
                  operationId,
                  signal: input.signal
                });
              if (!cached) this.observationCache.set(validated.tool.name, validated.input, result);
              this.observationCache.invalidateAfter(validated.tool.name);
              if (result.ok) canonicalEntities.observe(result.data);
              if (result.ok) {
                const selection = validated.input as Record<string, unknown>;
                for (const [entityType, key] of [["profile", "profileId"], ["resume", "resumeId"], ["job", "jobId"]] as const) {
                  const entityId = selection[key];
                  if (typeof entityId === "string" && entityId) {
                    taskState = taskReducer.reduce(taskState, {
                      type: "entity_revision",
                      entityType,
                      entityId
                    });
                  }
                }
                taskState = taskReducer.reduce(taskState, {
                  type: "tool_observation",
                  toolName: result.toolName,
                  observation: result.data,
                  artifactIds: result.artifactIds
                });
                const transitionedSession = projectTaskStateIntoSession(input.session, taskState);
                skills = skillRegistry.discover({
                  workflowId: taskState.workflowId,
                  step: taskState.stage,
                  selectedEntities: taskState.selectedEntities,
                  userMessage: input.userMessage
                });
                systemPrompt = contextAssembler.assemble({
                  session: transitionedSession,
                  pageContext: input.pageContext,
                  userMessage: input.userMessage,
                  memory: memoryManager.retrieve(transitionedSession),
                  activeSkills: skills,
                  references: resolveReferences(transitionedSession, input.references),
                  turnIntent: input.turnIntent
                });
              }
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
              allowedTools = this.dependencies.toolResolver.allowedTools({
                workflowId: taskState.workflowId,
                step: taskState.stage,
                skills,
                session: projectTaskStateIntoSession(input.session, taskState),
                userMessage: input.userMessage
              });
              allowedTools = toolsForTurnScope(this.dependencies.toolResolver, allowedTools, input.toolScope);
              modelTools = this.dependencies.toolResolver.modelManifest(allowedTools);
            } catch (error) {
              if (error instanceof AgentConfirmationRequiredError) {
                trajectory.confirmation(validated.tool.name, operationId);
                const confirmation: AgentConfirmation = {
                  ...error.confirmation,
                  validatedInput: validated.input as Record<string, unknown>,
                  dependencyExpectation: dependencySnapshot(taskState)
                };
                await emit(input, { type: "confirmation_required", confirmation });
                return {
                  pendingConfirmation: confirmation,
                  pendingCall: { toolName: validated.tool.name, operationId, input: validated.input as Record<string, unknown> },
                  trajectory: trajectory.value(),
                  conversationSummary: contextWindow.conversationSummary,
                  taskState: taskReducer.reduce(taskState, {
                    type: "confirmation_requested",
                    toolName: validated.tool.name,
                    operationId
                  })
                };
              }
              throw error;
            }
          }
          continue;
        }

        if (response.stopReason === "ask_user") {
          const text = canonicalEntities.preserve(response.text?.trim() || "请补充继续这项任务所需的真实信息。");
          if (nativeStreaming) await publishFinalStream(text, input, { turnId, iterationId });
          else await streamFinal(this.dependencies.model, { systemPrompt, messages, tools: modelTools }, text, input, { turnId, iterationId });
          trajectory.finish("waiting_for_user");
          return { text, trajectory: trajectory.value(), conversationSummary: contextWindow.conversationSummary, taskState };
        }

        const text = response.text?.trim() ? canonicalEntities.preserve(response.text.trim()) : undefined;
        if (text) {
          if (input.turnIntent === "casual_side_turn" || input.turnIntent === "reference_followup") {
            const visible = nativeStreaming
              ? await publishFinalStream(text, input, { turnId, iterationId })
              : await streamFinal(this.dependencies.model, { systemPrompt, messages, tools: modelTools }, text, input, { turnId, iterationId });
            trajectory.finish("completed");
            return {
              text: visible,
              trajectory: trajectory.value(),
              conversationSummary: contextWindow.conversationSummary,
              taskState
            };
          }
          const completion = new AgentTaskCompletionGuard().evaluate(taskState);
          if (!completion.canFinish) {
            const fingerprint = noProgressFingerprint({
              taskState,
              allowedToolNames: allowedTools.map((tool) => tool.name),
              stopReason: response.stopReason,
              requiredNextStage: completion.requiredNextStage
            });
            if (fingerprint === previousNoProgressFingerprint) {
              const recovery = noProgressRecovery(completion.nextAction);
              await publishFinalStream(recovery, input, { turnId, iterationId });
              trajectory.finish("waiting_for_user");
              return {
                text: recovery,
                trajectory: trajectory.value(),
                conversationSummary: contextWindow.conversationSummary,
                taskState: { ...taskState, completionStatus: "waiting_for_user", updatedAt: new Date().toISOString() }
              };
            }
            previousNoProgressFingerprint = fingerprint;
            messages.push({ role: "assistant", content: text });
            messages.push({
              role: "system",
              content: JSON.stringify({
                reason: completion.reason,
                plannerHint: completion.nextAction
              })
            });
            await emit(input, {
              type: "thinking",
              stage: "observing",
              label: "当前目标尚未完成，正在继续执行下一步"
            });
            continue;
          }
          const visible = nativeStreaming
            ? await publishFinalStream(text, input, { turnId, iterationId })
            : await streamFinal(this.dependencies.model, { systemPrompt, messages, tools: modelTools }, text, input, { turnId, iterationId });
          trajectory.finish("completed");
          const snapshot = trajectory.value();
          return {
            text: visible,
            trajectory: snapshot,
            reflection: (this.dependencies.reflection ?? new AgentReflection()).create(snapshot, {
              userMessage: input.userMessage,
              goal: taskState.rootGoal
            }),
            conversationSummary: contextWindow.conversationSummary,
            taskState
          };
        }
      }
      throw new AgentPolicyError("agent_iteration_budget_exceeded", `Agent exceeded ${maxIterations} model iterations.`);
    } catch (error) {
      const code = errorCode(error);
      if (code === "AbortError" || input.signal?.aborted) {
        trajectory.finish("aborted");
        return { trajectory: trajectory.value(), taskState };
      }
      trajectory.error(code, error instanceof Error ? error.message : "Agent turn failed.");
      trajectory.finish("failed");
      await emit(input, { type: "error", code, message: userErrorMessage(code) });
      return {
        trajectory: trajectory.value(),
        taskState: taskReducer.reduce(taskState, { type: "failed", errorCode: code })
      };
    }
  }

  resumeTurn(input: {
    session: AgentSession;
    pageContext: AgentPageContext;
    reason: "tool_observation" | "confirmation_rejected" | "external_event";
    observation: unknown;
    toolName?: string;
    signal?: AbortSignal;
    emit?(event: AgentStreamEvent): void | Promise<void>;
  }) {
    const userMessage = [...input.session.messages].reverse().find((message) => message.role === "user")?.content
      ?? input.session.memory?.currentGoal
      ?? input.session.title;
    return this.runTurn({
      session: input.session,
      pageContext: input.pageContext,
      userMessage,
      signal: input.signal,
      emit: input.emit,
      internalObservation: {
        reason: input.reason,
        toolName: input.toolName,
        observation: input.observation
      },
      taskEventAlreadyReduced: true
    });
  }
}

async function consumeNativeTurn(
  model: AgentModel,
  request: Parameters<NonNullable<AgentModel["streamTurn"]>>[0],
  input: { signal?: AbortSignal; emit?(event: AgentStreamEvent): void | Promise<void> }
) {
  let text = "";
  let stopReason: AgentModelResult["stopReason"] = "final";
  const calls = new Map<number, AgentModelToolCall>();
  for await (const event of model.streamTurn!(request)) {
    if (event.type === "assistant_text_delta") {
      text += event.delta;
    }
    if (event.type === "tool_call_complete") calls.set(event.index, event.call);
    if (event.type === "usage") {
      await emit(input, {
        type: "usage",
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens
      });
    }
    if (event.type === "finish") stopReason = event.stopReason;
  }
  return {
    text: text.trim() || undefined,
    toolCalls: calls.size ? [...calls.entries()].sort(([left], [right]) => left - right).map(([, call]) => call) : undefined,
    stopReason
  };
}

async function publishFinalStream(
  text: string,
  input: { emit?(event: AgentStreamEvent): void | Promise<void> },
  identity: { turnId: string; iterationId: string }
) {
  const streamId = `${identity.turnId}:final`;
  await emit(input, { type: "assistant_start", ...identity, streamId });
  await emit(input, { type: "assistant_delta", delta: text, ...identity, streamId });
  await emit(input, { type: "done", message: text, ...identity, streamId });
  return text;
}

async function streamFinal(
  model: AgentModel,
  request: { systemPrompt: string; messages: AgentModelMessage[]; tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> },
  draft: string,
  input: { signal?: AbortSignal; emit?(event: AgentStreamEvent): void | Promise<void> },
  identity: { turnId: string; iterationId: string }
) {
  const streamId = `${identity.turnId}:final`;
  await emit(input, { type: "assistant_start", ...identity, streamId });
  if (!model.streamFinalText) {
    await emit(input, { type: "assistant_delta", delta: draft, ...identity, streamId });
    await emit(input, { type: "done", message: draft, ...identity, streamId });
    return draft;
  }
  let visible = "";
  for await (const delta of model.streamFinalText({ ...request, draft, signal: input.signal })) {
    visible += delta;
    await emit(input, { type: "assistant_delta", delta, ...identity, streamId });
  }
  const final = visible.trim() || draft;
  await emit(input, { type: "done", message: final, ...identity, streamId });
  return final;
}

function toolObservation(call: AgentModelToolCall, result: AgentToolResult): AgentModelMessage {
  const value = result.ok ? result.data : { error: result.error };
  return {
    role: "tool",
    name: result.toolName,
    toolCallId: call.id,
    content: boundedObservationJson(value)
  };
}

function boundedObservationJson(value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized.length <= 16_000) return serialized;
  const compact = JSON.stringify(compactObservationValue(value, 0));
  return compact.length <= 16_000
    ? compact
    : JSON.stringify({ truncated: true, summary: "Authoritative result persisted; use task state pointers." });
}

function compactObservationValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return value.slice(0, 500);
  if (value === null || typeof value !== "object") return value;
  if (depth >= 3) {
    const record = value as Record<string, unknown>;
    return {
      id: record.id,
      revision: record.revision,
      currentRevisionId: record.currentRevisionId,
      status: record.status
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => compactObservationValue(item, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 40)
      .map(([key, item]) => [key, compactObservationValue(item, depth + 1)])
  );
}

function stableOperationId(call: AgentModelToolCall) {
  const candidate = call.id.replace(/[^\w-]/g, "-").slice(0, 120);
  return candidate.length >= 8 ? candidate : `agent-op-${candidate}-${nanoid(8)}`;
}

function bindAuthoritativeTaskInput(
  call: AgentModelToolCall,
  taskState: NonNullable<AgentSession["taskState"]>
): AgentModelToolCall {
  if (![
    "answer_tailoring_question",
    "preview_tailoring_changes",
    "apply_tailoring_changes"
  ].includes(call.name)) {
    return call;
  }
  const session = taskState.knownSlots.tailoringSession;
  if (!session) return call;
  if (call.name === "answer_tailoring_question") {
    return {
      ...call,
      arguments: {
        ...call.arguments,
        session
      }
    };
  }
  return {
    ...call,
    arguments: {
      ...call.arguments,
      session,
      selectedDiffs: Array.isArray(taskState.knownSlots.selectedDiffs)
        ? taskState.knownSlots.selectedDiffs
        : [],
      confirmedRequirementIds: Array.isArray(taskState.knownSlots.confirmedRequirementIds)
        ? taskState.knownSlots.confirmedRequirementIds
        : []
    }
  };
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
    preview_tailoring_changes: "已准备修改预览。",
    recommend_resume_source: "已完成简历来源路线评估。",
    create_job_resume_from_profile: "已从资料库创建独立岗位简历。"
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
    recommend_resume_source: "正在比较资料库与现有简历",
    create_job_resume_from_profile: "正在从资料库准备岗位简历",
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
  if (/missing_ai_config|provider_protocol_mismatch|provider_http/i.test(code)) return "AI 服务当前不可用。请检查模型设置后重试，任务进度已保留。";
  if (/precondition|invalid_tool_arguments|schema/i.test(code)) return "继续任务所需的信息还不完整。我会保留当前进度并只询问缺少的内容。";
  if (/stale|revision/i.test(code)) return "检测到资料版本已更新。我会基于最新版本重新规划，不会覆盖新内容。";
  if (/fact_guard/i.test(code)) return "这项修改没有通过事实核验，因此未写入简历。请补充可确认的真实依据后继续。";
  if (/unsupported|not_allowed|unknown_agent_tool/i.test(code)) return "当前能力无法安全完成这一步。我会尝试可用路径；如确实需要额外信息再向你确认。";
  if (/tool.*unavailable|temporar|timeout/i.test(code)) return "所需步骤暂时不可用。可重试的进度已保留，我不会重复已完成的写入。";
  return "AI 任务暂时中断，当前进度和输入已保留。";
}

function errorCode(error: unknown) {
  if (error instanceof AgentPolicyError) return error.code;
  return typeof error === "object" && error && "code" in error ? String(error.code) : error instanceof DOMException ? error.name : "agent_kernel_failed";
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw Object.assign(new DOMException("Aborted", "AbortError"), { code: "AbortError" });
}

function toolsForTurnScope<T extends { name: string }>(
  resolver: AgentToolResolver,
  tools: T[],
  scope?: TurnToolScope
) {
  if (!scope || scope === "domain") return tools;
  if (scope === "none") return [];
  return resolver.narrowReadTools(["get_active_profile", "get_profile", "search_profile_facts"]);
}

function resolveReferences(session: AgentSession, references?: AgentMessageReference[]) {
  if (!references?.length) return [];
  const byId = new Map(session.messages.map((message) => [message.id, message]));
  return references.slice(0, 4).flatMap((reference) => {
    const source = byId.get(reference.messageId);
    if (!source || source.role !== reference.role) return [];
    return [{
      ...reference,
      content: source.content.slice(0, 1_200)
    }];
  });
}

function deterministicCapabilityAnswer(userMessage: string) {
  const compact = userMessage.trim().replace(/\s+/g, "");
  const manifest = capabilityManifestForPrompt();
  if (/^(你好|您好|嗨|hi|hello|hey)[！!。.]?$/i.test(compact)) {
    return "你好！今天想处理哪项求职任务？";
  }
  if (/^(谢谢|感谢)[你呀啊！!。.]?$/i.test(compact)) {
    return "不客气。当前任务进度会保留，需要时可以明确说“继续刚才的任务”。";
  }
  if (/你能(联网|连接外网)|可以(联网|连接外网)/i.test(compact)) {
    return manifest.operation.externalTools === "availability_is_runtime_discovered"
      ? "当前工作区本身以本地数据为主；外部工具能力由运行时发现，只有实际可用并获准的工具才会显示和使用。我不会在未发现工具时假装已经联网。"
      : "当前运行时没有提供外部联网工具。";
  }
  if (/你(还)?能做什么|你可以做什么|支持什么能力/i.test(compact)) {
    return "我可以基于当前工作区处理职业资料、简历分析、岗位匹配、岗位简历定制、简历归档恢复与导出。需要资料事实时，我会先读取权威资料；涉及写入或应用变更时，会在确认边界停下来让你核对。";
  }
  return undefined;
}

function noProgressFingerprint(input: {
  taskState: NonNullable<AgentSession["taskState"]>;
  allowedToolNames: string[];
  stopReason: AgentModelResult["stopReason"];
  requiredNextStage: string;
}) {
  const state = input.taskState;
  return JSON.stringify({
    rootGoal: state.rootGoal,
    activeGoal: state.activeGoal,
    workflowId: state.workflowId,
    stage: state.stage,
    selectedEntities: state.selectedEntities,
    missingSlots: state.missingSlots,
    allowedToolNames: [...input.allowedToolNames].sort(),
    observation: compactIdentity(state.lastObservation),
    stopReason: input.stopReason,
    requiredNextStage: input.requiredNextStage
  });
}

function compactIdentity(value: unknown) {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  return serialized.length > 500 ? serialized.slice(0, 500) : serialized;
}

function noProgressRecovery(nextAction: {
  missingSlots: string[];
  requiredNextStage: string;
}) {
  if (nextAction.missingSlots.length) {
    return `要继续这项任务，请先补充：${nextAction.missingSlots.join("、")}。`;
  }
  const labels: Record<string, string> = {
    choose_resume_source: "请选择要使用的简历来源。",
    choose_job: "请选择要匹配的岗位。",
    clarify_unsupported_facts: "请回答当前待确认的事实问题。",
    import_review: "请先核对导入内容。",
    resolve_target: "请选择导入目标。",
    resolve_conflicts: "请处理仍有冲突的导入内容。",
    confirm_import: "导入已准备好，请确认后继续。",
    confirm_apply: "改动已准备好，请确认后应用。"
  };
  return labels[nextAction.requiredNextStage]
    ?? `这项任务停在“${nextAction.requiredNextStage}”，当前没有产生新进展。你可以补充所需信息，或明确要求重试。`;
}

async function emit(
  input: { emit?(event: AgentStreamEvent): void | Promise<void> },
  event: AgentStreamEvent
) {
  await input.emit?.(event);
}
