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
import { groundMutationClaims, type AuthoritativeTurnObservation } from "./AgentMutationClaimGuard";

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
      taskState = taskReducer.reduce(taskState, {
        type: "user_message",
        message: input.userMessage,
        turnIntent: input.turnIntent
      });
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
    const unavailableToolNames = new Set<string>();
    const exhaustedEmptyReads = new Set<string>();
    const turnObservations: AuthoritativeTurnObservation[] =
      input.internalObservation?.reason === "tool_observation" && input.internalObservation.toolName
        ? [{ toolName: input.internalObservation.toolName, value: input.internalObservation.observation }]
        : [];
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
        if (
          taskState.workflowId === "guided_profile_intake"
          && taskState.stage === "profile_complete"
          && taskState.completionStatus === "waiting_for_user"
          && taskState.pendingDecision?.type === "profile_intake_resume"
          && taskState.knownSlots.profileCommitResult
        ) {
          const text = "资料已成功保存到个人资料库。你可以选择仅保存资料库，或继续生成一份通用简历。";
          await publishFinalStream(text, input, { turnId, iterationId });
          trajectory.finish("waiting_for_user");
          return {
            text,
            trajectory: trajectory.value(),
            conversationSummary: contextWindow.conversationSummary,
            taskState
          };
        }
        const nativeStreaming = this.dependencies.model.capabilities?.nativeToolStreaming === true
          && Boolean(this.dependencies.model.streamTurn);
        const boundaryTool = deterministicBoundaryTool(taskState, allowedTools);
        const rawResponse: AgentModelResult = boundaryTool
          ? {
              stopReason: "tool_calls",
              toolCalls: [{
                id: `${turnId}-${boundaryTool}-confirmation`,
                name: boundaryTool,
                arguments: {}
              }]
            }
          : nativeStreaming
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
        const response = normalizeTextualToolProtocol(rawResponse, modelTools);

        if (response.toolCalls?.length) {
          messages.push({ role: "assistant", content: response.text ?? "", toolCalls: response.toolCalls });
          if (response.toolCalls.length > 1) {
            const batchTools = response.toolCalls.map((call) => allowedTools.find((tool) => tool.name === call.name));
            if (batchTools.some((tool) => !tool || tool.risk !== "read")) {
              throw new AgentPolicyError("agent_parallel_write_rejected", "Only independent read tools may be called together.");
            }
          }

          for (const call of response.toolCalls) {
            if (exhaustedEmptyReads.has(call.name)) {
              const recovery = emptyReadRecovery(call.name, taskState);
              await publishFinalStream(recovery, input, { turnId, iterationId });
              trajectory.finish("waiting_for_user");
              return {
                text: recovery,
                trajectory: trajectory.value(),
                conversationSummary: contextWindow.conversationSummary,
                taskState: {
                  ...taskState,
                  completionStatus: "waiting_for_user",
                  updatedAt: new Date().toISOString()
                }
              };
            }
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
              if (result.ok) {
                canonicalEntities.observe(result.data);
                turnObservations.push({ toolName: result.toolName, value: result.data });
                if (isExhaustedEmptyRead(result)) {
                  exhaustedEmptyReads.add(result.toolName);
                }
              } else if (!result.error?.retryable) {
                unavailableToolNames.add(result.toolName);
              }
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
              allowedTools = allowedTools.filter((tool) =>
                !unavailableToolNames.has(tool.name)
                && !exhaustedEmptyReads.has(tool.name)
              );
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
          const text = groundMutationClaims({
            text: canonicalEntities.preserve(response.text?.trim() || "请补充继续这项任务所需的真实信息。"),
            userMessage: input.userMessage,
            observations: turnObservations
          });
          if (nativeStreaming) await publishFinalStream(text, input, { turnId, iterationId });
          else await streamFinal(this.dependencies.model, { systemPrompt, messages, tools: modelTools }, text, input, { turnId, iterationId });
          trajectory.finish("waiting_for_user");
          return { text, trajectory: trajectory.value(), conversationSummary: contextWindow.conversationSummary, taskState };
        }

        const text = response.text?.trim()
          ? groundMutationClaims({
              text: canonicalEntities.preserve(response.text.trim()),
              userMessage: input.userMessage,
              observations: turnObservations
            })
          : undefined;
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
              const exhaustedTool = exhaustedEmptyReads.values().next().value as string | undefined;
              const recovery = exhaustedTool
                ? emptyReadRecovery(exhaustedTool, taskState)
                : noProgressRecovery(completion.nextAction);
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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isExhaustedEmptyRead(result: AgentToolResult) {
  if (!result.ok) return false;
  const data = objectValue(result.data);
  if (result.toolName === "search_profile_facts") {
    return Array.isArray(data.results) && data.results.length === 0;
  }
  if (result.toolName === "search_agent_sessions") {
    return Array.isArray(data.sessions) && data.sessions.length === 0;
  }
  return false;
}

function emptyReadRecovery(
  toolName: string,
  taskState: NonNullable<AgentSession["taskState"]>
) {
  if (toolName === "search_agent_sessions") {
    return "没有找到匹配的历史任务。我不会重复查询；请直接描述你现在要继续完成的事情，我会按当前信息开始处理。";
  }
  if (taskState.rootGoal === "profile_intake") {
    return "资料库中没有找到与当前问题匹配的已有经历。我不会重复查询；请直接告诉我这段经历的项目名称、你做了什么和结果，我会从你的回答继续整理。";
  }
  if (["create_tailored_resume", "create_resume_from_profile", "analyze_job_fit", "apply_to_job"].includes(taskState.rootGoal)) {
    return "资料库中没有找到可用于当前步骤的已确认经历。我不会重复查询或编造内容；请补充一段与目标岗位相关的真实经历、职责或结果，我会据此继续完成当前流程。";
  }
  return "资料库中没有找到匹配的经历或事实。我不会重复查询；请直接补充你希望用于当前步骤的真实经历，我会从这条信息继续处理。";
}

function bindAuthoritativeTaskInput(
  call: AgentModelToolCall,
  taskState: NonNullable<AgentSession["taskState"]>
): AgentModelToolCall {
  const slots = taskState.knownSlots;
  if (call.name === "capture_profile_intake") {
    const source = objectValue(slots.latestIntakeSource);
    return {
      ...call,
      arguments: {
        ...call.arguments,
        sessionId: source.sessionId,
        messageId: source.messageId,
        turnId: source.turnId,
        text: source.exactSourceQuote,
        capturedAt: source.capturedAt,
        targetProfileId: slots.targetProfileId,
        expectedProfileVersion: slots.expectedProfileVersion,
        acknowledgedActiveProfileId: slots.acknowledgedActiveProfileId,
        ...(slots.profileCommitResult === undefined
          && typeof slots.intakeImportId === "string"
          && typeof slots.expectedIntakeDraftRevision === "number"
          ? {
              importId: slots.intakeImportId,
              expectedDraftRevision: slots.expectedIntakeDraftRevision
            }
          : {})
      }
    };
  }
  if (call.name === "review_profile_intake") {
    const clarification = objectValue(slots.latestIntakeClarification);
    const hasStructuredPatch = Object.keys(objectValue(call.arguments.structuredPatch)).length > 0;
    return {
      ...call,
      arguments: {
        ...call.arguments,
        importId: slots.intakeImportId,
        expectedDraftRevision: slots.expectedIntakeDraftRevision,
        ...(hasStructuredPatch ? {
          evidence: {
            sessionId: clarification.sessionId,
            messageId: clarification.messageId,
            turnId: clarification.turnId,
            capturedAt: clarification.capturedAt,
            sourceQuote: clarification.exactSourceQuote
          }
        } : {})
      }
    };
  }
  if (call.name === "reconcile_profile_intake") {
    return {
      ...call,
      arguments: {
        ...call.arguments,
        importId: slots.intakeImportId,
        expectedDraftRevision: slots.expectedIntakeDraftRevision,
        targetProfileId: slots.targetProfileId,
        expectedProfileVersion: slots.expectedProfileVersion,
        acknowledgedActiveProfileId: slots.acknowledgedActiveProfileId
      }
    };
  }
  if (call.name === "resolve_profile_intake_conflict") {
    return {
      ...call,
      arguments: {
        ...call.arguments,
        importId: slots.intakeImportId,
        expectedPlanRevision: slots.expectedIntakeReconciliationRevision,
        targetProfileId: slots.targetProfileId
      }
    };
  }
  if (call.name === "commit_profile_intake") {
    return {
      ...call,
      arguments: {
        ...call.arguments,
        importId: slots.intakeImportId,
        expectedDraftRevision: slots.expectedIntakeDraftRevision,
        expectedReconciliationRevision: slots.expectedIntakeReconciliationRevision,
        targetProfileId: slots.targetProfileId,
        expectedProfileVersion: slots.expectedProfileVersion,
        acknowledgedActiveProfileId: slots.acknowledgedActiveProfileId
      }
    };
  }
  if (call.name === "commit_resume_import") {
    return {
      ...call,
      arguments: {
        ...call.arguments,
        importId: slots.importId,
        expectedDraftRevision: slots.expectedDraftRevision,
        ...(typeof slots.expectedReconciliationRevision === "number"
          ? { expectedReconciliationRevision: slots.expectedReconciliationRevision }
          : {}),
        target: slots.importTarget
      }
    };
  }
  if (call.name === "commit_job") {
    return {
      ...call,
      arguments: {
        ...call.arguments,
        title: slots.title,
        company: slots.company,
        rawText: slots.rawText,
        graph: slots.graph
      }
    };
  }
  if (call.name === "ensure_general_resume_from_profile") {
    return {
      ...call,
      arguments: {
        ...call.arguments,
        targetProfileId: slots.targetProfileId,
        expectedProfileVersion: slots.expectedProfileVersion,
        acknowledgedActiveProfileId: slots.acknowledgedActiveProfileId
      }
    };
  }
  if (call.name === "export_resume" && taskState.selectedEntities.resumeId) {
    return {
      ...call,
      arguments: {
        ...call.arguments,
        resumeId: taskState.selectedEntities.resumeId
      }
    };
  }
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
  if (!result.ok) {
    const actions: Record<string, string> = {
      get_agent_task_context: "读取指定任务的当前进度",
      search_agent_sessions: "检索历史任务",
      skills_list: "读取可用方法列表",
      skill_view: "读取任务方法",
      get_active_profile: "确认当前资料库",
      get_profile: "读取资料库",
      capture_profile_intake: "整理访谈中的经历"
    };
    const reason = result.error?.code === "agent_session_not_found"
      ? "指定会话不存在或已失效"
      : result.error?.retryable
        ? "服务暂时不可用，可以稍后重试"
        : "请求所需的信息不存在或未通过校验";
    return `${actions[result.toolName] ?? `执行 ${result.toolName}`}未完成：${reason}。任务信息已保留。`;
  }
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
  if (result.toolName === "search_agent_sessions") {
    const count = Array.isArray(data?.sessions) ? data.sessions.length : 0;
    return `已检索历史任务，找到 ${count} 条相关记录。`;
  }
  if (result.toolName === "get_agent_task_context") return "已读取指定任务的当前进度。";
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
    create_job_resume_from_profile: "已从资料库创建独立岗位简历。",
    capture_profile_intake: "已整理访谈中的经历候选。",
    review_profile_intake: "已记录这项经历的核对决定。",
    reconcile_profile_intake: "已完成经历与资料库的对账。",
    resolve_profile_intake_conflict: "已记录资料冲突处理决定。",
    commit_profile_intake: "已将确认事实保存到资料库。",
    ensure_general_resume_from_profile: "已从确认资料创建或同步通用简历。"
  };
  return labels[result.toolName] ?? `已完成工具步骤：${result.toolName}。`;
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
    export_resume: "正在准备简历导出",
    capture_profile_intake: "正在整理刚才的经历",
    review_profile_intake: "正在记录经历核对决定",
    reconcile_profile_intake: "正在与资料库对账",
    resolve_profile_intake_conflict: "正在处理资料冲突",
    commit_profile_intake: "正在保存确认的经历",
    ensure_general_resume_from_profile: "正在生成或同步通用简历",
    get_agent_task_context: "正在读取指定任务的当前进度",
    search_agent_sessions: "正在检索历史任务",
    skills_list: "正在读取可用方法列表",
    skill_view: "正在读取任务方法"
  };
  return labels[toolName] ?? `正在执行工具步骤：${toolName}`;
}

function thinkingLabel(message: string) {
  if (/岗位|JD|职位/i.test(message)) return "正在分析你的求职任务";
  if (/资料库|经历|我是谁|AI/i.test(message)) return "正在判断需要读取哪些真实资料";
  return "正在规划下一步";
}

function userErrorMessage(code: string) {
  if (code === "agent_duplicate_tool_call") return "我检测到重复步骤并已停止，现有任务信息仍然保留。";
  if (code === "provider_textual_tool_protocol") return "模型返回了不兼容的工具指令，已在写入前拦截；你的原始输入和当前进度仍然保留。请回复“重试刚才”，系统会从当前步骤继续。";
  if (code.includes("budget")) return "自动处理没有完成：连续步骤未能推进。你的原始输入和现有进度已保留，尚未写入资料库。回复“重试刚才”重新执行当前步骤，或回复“结束任务”退出。";
  if (/missing_ai_config|provider_protocol_mismatch|provider_http/i.test(code)) return "AI 服务当前不可用。请检查模型设置后重试，任务进度已保留。";
  if (/precondition|invalid_tool_arguments|schema/i.test(code)) return "继续任务所需的信息还不完整。我会保留当前进度并只询问缺少的内容。";
  if (/stale|revision/i.test(code)) return "检测到资料版本已更新。我会基于最新版本重新规划，不会覆盖新内容。";
  if (/fact_guard/i.test(code)) return "这项修改没有通过事实核验，因此未写入简历。请补充可确认的真实依据后继续。";
  if (/unsupported|not_allowed|unknown_agent_tool/i.test(code)) return "当前能力无法安全完成这一步。我会尝试可用路径；如确实需要额外信息再向你确认。";
  if (/tool.*unavailable|temporar|timeout/i.test(code)) return "所需步骤暂时不可用。可重试的进度已保留，我不会重复已完成的写入。";
  return "AI 任务暂时中断，当前进度和输入已保留。";
}

function normalizeTextualToolProtocol(
  response: AgentModelResult,
  allowedTools: Array<{ name: string }>
): AgentModelResult {
  if (response.toolCalls?.length || !containsTextualToolProtocol(response.text)) return response;
  const text = response.text ?? "";
  const allowed = new Set(allowedTools.map((tool) => tool.name));
  const calls = [...text.matchAll(/<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi)]
    .flatMap((match, index) => {
      const body = match[1] ?? "";
      const functionMatch = body.match(/<function=([A-Za-z_][\w.-]*)\s*>([\s\S]*?)(?:<\/function>|$)/i);
      if (!functionMatch) return [];
      const requestedName = functionMatch[1];
      const name = allowed.has(requestedName)
        ? requestedName
        : textualToolAlias(requestedName, allowed);
      if (!name) return [];
      const argumentsValue: Record<string, unknown> = {};
      for (const parameter of functionMatch[2].matchAll(
        /<parameter=([A-Za-z_][\w.-]*)\s*>([\s\S]*?)(?=<parameter=|<\/function>|<\/tool_call>|$)/gi
      )) {
        argumentsValue[parameter[1]] = parseTextualToolParameter(parameter[2]);
      }
      return [{
        id: `textual-tool-call-${index + 1}`,
        name,
        arguments: argumentsValue
      }];
    });
  if (!calls.length) {
    throw Object.assign(new Error("Provider returned a textual tool call that cannot be executed safely."), {
      code: "provider_textual_tool_protocol"
    });
  }
  const visibleText = text
    .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, "")
    .trim();
  return {
    ...response,
    text: visibleText || undefined,
    toolCalls: calls,
    stopReason: "tool_calls"
  };
}

function textualToolAlias(requestedName: string, allowed: Set<string>) {
  const aliases: Record<string, string> = {
    read_profile: "get_profile"
  };
  const canonical = aliases[requestedName];
  return canonical && allowed.has(canonical) ? canonical : undefined;
}

function containsTextualToolProtocol(text?: string) {
  return typeof text === "string"
    && /<tool_call\b|<function=|<parameter=/i.test(text);
}

function parseTextualToolParameter(value: string): unknown {
  const trimmed = value.replace(/<\/parameter>\s*$/i, "").trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
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

const RECOVERY_SLOT_LABELS: Record<string, string> = {
  profileId: "要使用的个人资料库",
  resumeId: "要比较的简历",
  jobId: "目标岗位",
  rawText: "岗位描述原文",
  title: "岗位名称",
  company: "公司名称",
  attachmentId: "要导入的简历文件",
  selectedFactIds: "要使用的经历范围",
  graph: "岗位解析结果"
};

const RECOVERY_STAGE_LABELS: Record<string, string> = {
  choose_resume_source: "请选择要使用的简历来源。",
  choose_job: "请选择要匹配的岗位。",
  clarify_unsupported_facts: "请回答当前待确认的事实问题。",
  import_review: "请先核对导入内容。",
  resolve_target: "请选择导入目标。",
  resolve_conflicts: "请处理仍有冲突的导入内容。",
  confirm_import: "导入已准备好，请确认后继续。",
  confirm_apply: "改动已准备好，请确认后应用。",
  select_resume: "请告诉我要处理哪一份简历，说名称即可。",
  select_source: "请先选择要导入的简历文件。",
  select_profile_scope: "请告诉我要使用哪一份资料库和经历范围。",
  resolve_profile_target: "请先确认要整理到哪一份资料库。",
  collect_job_identity: "请告诉我目标岗位的岗位名称和公司。",
  complete_job_identity: "请告诉我目标岗位的岗位名称和公司。",
  collect_job_description: "请粘贴目标岗位的招聘描述原文。",
  parse_job: "请粘贴目标岗位的招聘描述原文。",
  review_job: "请核对解析出的岗位信息。",
  review_job_semantics: "请核对解析出的岗位信息。",
  analyze_fit: "请确认要分析的简历和岗位。",
  preview_changes: "请先核对改动预览。",
  review_result: "请查看分析结果，并告诉我下一步。"
};

function noProgressRecovery(nextAction: {
  goal?: string;
  stage?: string;
  missingSlots: string[];
  requiredNextStage: string;
}) {
  const withExitPaths = (instruction: string) =>
    `${instruction}\n\n如果这一步仍然没有推进：回复“重试刚才”重新执行当前步骤；回复“结束任务”退出；也可以直接告诉我你想改做什么。`;
  if (nextAction.goal === "analyze_job_fit") {
    return withExitPaths("我可以帮你分析岗位匹配度。请告诉我要比较哪一份简历、哪一个目标岗位：已保存的直接说名称即可；如果是新岗位，也可以直接把岗位描述粘贴给我。");
  }
  if (nextAction.goal === "ingest_job") {
    return withExitPaths("请提供目标岗位信息：可以直接粘贴招聘描述原文，或告诉我岗位名称和公司。");
  }
  if (nextAction.missingSlots.length) {
    const labels = [...new Set(
      nextAction.missingSlots
        .map((slot) => RECOVERY_SLOT_LABELS[slot])
        .filter((label): label is string => Boolean(label))
    )];
    if (labels.length) {
      return withExitPaths(`要继续这项任务，请先补充：${labels.join("、")}。`);
    }
    return withExitPaths("我没能确定当前缺少哪项信息。请换一种说法补充你希望我使用的真实信息，我会按步骤和你核对。");
  }
  const instruction = RECOVERY_STAGE_LABELS[nextAction.requiredNextStage]
    ?? "当前步骤没有成功推进。你可以换一种说法告诉我下一步要完成什么。";
  return withExitPaths(instruction);
}

function deterministicBoundaryTool(
  taskState: NonNullable<AgentSession["taskState"]>,
  allowedTools: Array<{ name: string }>
) {
  if (
    taskState.workflowId === "guided_profile_intake"
    && taskState.stage === "structure_facts"
    && taskState.knownSlots.latestIntakeSource
    && allowedTools.some((tool) => tool.name === "capture_profile_intake")
  ) {
    return "capture_profile_intake";
  }
  if (
    taskState.workflowId === "guided_profile_intake"
    && taskState.stage === "reconcile_profile"
    && taskState.completionStatus === "active"
    && taskState.knownSlots.intakeImportId
    && allowedTools.some((tool) => tool.name === "reconcile_profile_intake")
  ) {
    return "reconcile_profile_intake";
  }
  if (
    taskState.completionStatus !== "active"
    || taskState.knownSlots.pendingConfirmation
  ) {
    return undefined;
  }
  const toolName = taskState.workflowId === "guided_profile_intake" && taskState.stage === "confirm_commit"
    ? "commit_profile_intake"
    : taskState.workflowId === "job_ingestion" && taskState.stage === "confirm_commit"
      ? "commit_job"
      : taskState.stage === "confirm_import"
        ? "commit_resume_import"
        : taskState.stage === "confirm_apply"
          ? "apply_tailoring_changes"
          : undefined;
  return toolName && allowedTools.some((tool) => tool.name === toolName)
    ? toolName
    : undefined;
}

async function emit(
  input: { emit?(event: AgentStreamEvent): void | Promise<void> },
  event: AgentStreamEvent
) {
  await input.emit?.(event);
}
