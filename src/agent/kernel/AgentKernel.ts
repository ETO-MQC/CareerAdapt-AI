import { nanoid } from "nanoid";
import type { AgentSession, AgentConfirmation, AgentMessageReference, AgentTaskState } from "@/agent/contracts/agentSession";
import type { AgentPageContext } from "@/agent/contracts/agentContext";
import type { AgentToolResult } from "@/agent/contracts/agentTool";
import type { AgentModel, AgentModelMessage, AgentModelResult, AgentModelToolCall } from "@/agent/model/agentModel";
import {
  AgentToolProtocolError,
  normalizeAgentToolProtocol,
  type AgentToolProtocolDiagnostics
} from "@/agent/model/AgentToolProtocolAdapter";
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
import type { ProfileIntakeTurnKind, TurnIntent, TurnToolScope } from "@/agent/runtime/AgentTurnIntent";
import { capabilityManifestForPrompt } from "@/agent/capabilities/AgentProductCapabilityManifest";
import { groundMutationClaims, type AuthoritativeTurnObservation } from "./AgentMutationClaimGuard";
import { buildActiveBranchContext } from "@/agent/runtime/activeBranchContext";
import { AuthoritativeConversationAlignmentGuard } from "./AuthoritativeConversationAlignmentGuard";

export type AgentKernelResult = {
  text?: string;
  pendingConfirmation?: AgentConfirmation;
  pendingCall?: { toolName: string; operationId: string; input: Record<string, unknown> };
  trajectory: AgentTrajectorySnapshot;
  reflection?: AgentReflectionResult;
  conversationSummary?: string;
  taskState?: AgentSession["taskState"];
  contextDiagnostics?: ReturnType<typeof buildActiveBranchContext>["diagnostics"];
  protocolDiagnostics?: AgentToolProtocolDiagnostics[];
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
    profileIntakeTurnKind?: ProfileIntakeTurnKind;
    toolScope?: TurnToolScope;
    narrationOnly?: boolean;
    signal?: AbortSignal;
    emit?(event: AgentStreamEvent): void | Promise<void>;
    internalObservation?: {
      reason: "tool_observation" | "confirmation_rejected" | "external_event";
      toolName?: string;
      observation: unknown;
    };
    taskEventAlreadyReduced?: boolean;
    profileIntakeSourceTurns?: Array<{ processingStatus: string }>;
  }): Promise<AgentKernelResult> {
    const maxIterations = this.dependencies.maxIterations ?? 8;
    const maxToolCalls = this.dependencies.maxToolCalls ?? 12;
    const guard = new AgentPolicyGuard();
    const alignmentGuard = new AuthoritativeConversationAlignmentGuard();
    const canonicalEntities = new AgentCanonicalEntityGuard();
    const taskReducer = new AgentTaskStateReducer();
    let taskState = input.session.taskState ?? taskReducer.create(input.session);
    if (!input.narrationOnly && !input.taskEventAlreadyReduced && input.turnIntent !== "casual_side_turn" && input.turnIntent !== "reference_followup") {
      taskState = taskReducer.reduce(taskState, {
        type: "user_message",
        message: input.userMessage,
        turnIntent: input.turnIntent,
        profileIntakeTurnKind: input.profileIntakeTurnKind
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
    const activeBranchContext = buildActiveBranchContext(authoritativeSession);
    const contextualSession = {
      ...authoritativeSession,
      messages: activeBranchContext.messages,
      conversationSummary: activeBranchContext.conversationSummary
    };
    const skillRegistry = this.dependencies.skillRegistry ?? agentSkillRegistry;
    let skills = skillRegistry.discover({
      workflowId: taskState.workflowId,
      step: taskState.stage,
      selectedEntities: taskState.selectedEntities,
      userMessage: input.userMessage
    });
    const memoryManager = this.dependencies.memoryManager ?? new AgentMemoryManager();
    const contextAssembler = this.dependencies.contextAssembler ?? new AgentContextAssembler();
    const memory = memoryManager.retrieve(contextualSession);
    let systemPrompt = contextAssembler.assemble({
      session: contextualSession,
      pageContext: input.pageContext,
      userMessage: input.userMessage,
      memory,
      activeSkills: skills,
      references: resolveReferences(contextualSession, input.references),
      turnIntent: input.turnIntent
    });
    if (input.narrationOnly) {
      systemPrompt += "\n\n本轮是历史回答重生成的叙述修订：只根据当前分支已记录的消息、工具回执和任务快照重新组织文字；不要调用工具，不要新增事实，不要改变任务状态或实体。";
    }
    let allowedTools = this.dependencies.toolResolver.allowedTools({
      workflowId: taskState.workflowId,
      step: taskState.stage,
      skills,
      session: contextualSession,
      userMessage: input.userMessage
    });
    allowedTools = toolsForTurnScope(this.dependencies.toolResolver, allowedTools, input.narrationOnly ? "none" : input.toolScope);
    allowedTools = limitTailoringContextTools(taskState, allowedTools);
    let modelTools = this.dependencies.toolResolver.modelManifest(allowedTools);
    const contextWindow = (this.dependencies.contextWindow ?? new AgentContextWindow()).build(
      contextualSession,
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
    let protocolRepairUsed = false;
    const protocolDiagnostics: AgentToolProtocolDiagnostics[] = [];
    const unavailableToolNames = new Set<string>();
    const exhaustedEmptyReads = new Set<string>();
    const turnObservations: AuthoritativeTurnObservation[] =
      input.internalObservation?.reason === "tool_observation" && input.internalObservation.toolName
        ? [{ toolName: input.internalObservation.toolName, value: input.internalObservation.observation }]
        : [];
    const turnId = input.turnId ?? input.session.activeTurn?.id ?? `agent-turn-${nanoid(12)}`;
    let previousNoProgressFingerprint: string | undefined;
    const alignAnswer = (candidate: string) => {
      const alignment = alignmentGuard.validate({
        text: candidate,
        taskState,
        observations: turnObservations,
        reviewProjection: taskState.knownSlots.profileIntakeReviewProjection,
        persistenceReceipt: taskState.knownSlots.profileIntakePersistenceReceipt
          ?? taskState.knownSlots.profilePersistenceReceipt,
        sourceTurns: input.profileIntakeSourceTurns,
        narrationOnly: input.narrationOnly
      });
      if (alignment.aligned) return candidate;
      protocolDiagnostics.push({
        markerKinds: [],
        allowedToolNames: allowedTools.map((tool) => tool.name),
        nativeToolCallsPresent: false,
        safeErrorCode: alignment.safeErrorCode
      });
      return deterministicAlignmentRecovery(taskState);
    };

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
      const capabilityAnswer = input.narrationOnly ? undefined : deterministicCapabilityAnswer(input.userMessage);
      if (capabilityAnswer && (input.turnIntent === "casual_side_turn" || input.toolScope === "none" || isDirectIdentityQuestion(input.userMessage))) {
        const iterationId = `${turnId}:iteration:1`;
        const alignedCapabilityAnswer = alignAnswer(capabilityAnswer);
        await publishFinalStream(alignedCapabilityAnswer, input, { turnId, iterationId });
        trajectory.finish("completed");
        return {
          text: alignedCapabilityAnswer,
          trajectory: trajectory.value(),
          conversationSummary: contextWindow.conversationSummary,
          taskState,
          contextDiagnostics: contextWindow.diagnostics,
          protocolDiagnostics
        };
      }
      if (!input.narrationOnly && this.dependencies.model.negotiateToolProtocol) {
        // Negotiation is cached by the model adapter. A failed probe is not a
        // reason to lose the user's turn; the normal adapter/fallback remains
        // authoritative for this request.
        try { await this.dependencies.model.negotiateToolProtocol(); } catch { /* best effort */ }
      }
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        const iterationId = `${turnId}:iteration:${iteration + 1}`;
        throwIfAborted(input.signal);
        await emit(input, {
          type: "thinking",
          stage: iteration ? "observing" : "planning",
          label: iteration ? "正在根据已读取的信息继续处理" : thinkingLabel(input.userMessage),
          workflowStage: workflowStageForTask(taskState)
        });
        if (
          taskState.workflowId === "guided_profile_intake"
          && taskState.stage === "profile_complete"
          && taskState.knownSlots.profileCommitResult
          && (
            taskState.knownSlots.profileCommitVerification
            || !taskState.selectedEntities.profileId
          )
        ) {
          const verifiedContext = objectValue(taskState.knownSlots.profileCommitVerification);
          const verifiedProfileName = stringValue(verifiedContext.profileName) ?? "当前人物";
          const verifiedVersion = numberValue(verifiedContext.profileVersion);
          const text = taskState.completionStatus === "waiting_for_user"
            ? `已写入‘${verifiedProfileName} · V${verifiedVersion ?? "当前版本"}’个人资料库。你可以生成一份通用简历，也可以暂时完成。`
            : `已写入‘${verifiedProfileName} · V${verifiedVersion ?? "当前版本"}’个人资料库。个人资料库已更新，未自动创建其他简历。`;
          const alignedText = !taskState.selectedEntities.profileId && !taskState.knownSlots.targetProfileId
            ? text
            : alignAnswer(text);
          await publishFinalStream(alignedText, input, { turnId, iterationId });
          trajectory.finish(taskState.completionStatus === "completed" ? "completed" : "waiting_for_user");
          return {
            text: alignedText,
            trajectory: trajectory.value(),
            conversationSummary: contextWindow.conversationSummary,
            contextDiagnostics: contextWindow.diagnostics,
            taskState,
            protocolDiagnostics
          };
        }
        const workflowPause = input.narrationOnly ? undefined : deterministicWorkflowPause(
          taskState,
          toolCallCount > 0
            || !input.userMessage
            || Boolean(taskState.knownSlots.compoundAnswerResolution)
            || input.internalObservation?.reason === "tool_observation"
        );
        if (workflowPause) {
          const alignedPause = alignAnswer(workflowPause);
          await publishFinalStream(alignedPause, input, { turnId, iterationId });
          const terminal = taskState.workflowId === "tailor_existing_resume"
            && taskState.stage === "quality_result"
            && taskState.completionStatus === "completed";
          trajectory.finish(terminal ? "completed" : "waiting_for_user");
          return {
            text: alignedPause,
            trajectory: trajectory.value(),
            conversationSummary: contextWindow.conversationSummary,
            contextDiagnostics: contextWindow.diagnostics,
            taskState: terminal
              ? taskState
              : {
                  ...taskState,
                  completionStatus: "waiting_for_user",
                  updatedAt: new Date().toISOString()
                },
            protocolDiagnostics
          };
        }
        const nativeStreaming = this.dependencies.model.capabilities?.nativeToolStreaming === true
          && Boolean(this.dependencies.model.streamTurn);
        const boundaryTool = input.narrationOnly ? undefined : deterministicBoundaryTool(taskState, allowedTools, turnId);
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
        let response;
        try {
          response = normalizeAgentToolProtocol(rawResponse, modelTools);
        } catch (error) {
          if (error instanceof AgentToolProtocolError && !protocolRepairUsed && this.dependencies.model.completeWithStructuredActions) {
            protocolRepairUsed = true;
            protocolDiagnostics.push(error.diagnostics);
            const repairedRaw = await this.dependencies.model.completeWithStructuredActions({
              systemPrompt,
              messages,
              tools: modelTools,
              signal: input.signal
            });
            response = normalizeAgentToolProtocol(repairedRaw, modelTools, { repairApplied: true });
          } else {
            throw error;
          }
        }
        if (
          response.diagnostics.markerKinds.length
          || response.diagnostics.unknownToolNames?.length
          || response.diagnostics.providerResponseShape?.length
        ) {
          protocolDiagnostics.push(response.diagnostics);
        }

        if (input.narrationOnly && response.toolCalls?.length) {
          const text = response.text?.trim() || "我已根据这一轮已记录的结果重新整理了回答。";
          await publishFinalStream(text, input, { turnId, iterationId });
          trajectory.finish("completed");
          return {
            text,
            trajectory: trajectory.value(),
            conversationSummary: contextWindow.conversationSummary,
            taskState,
            contextDiagnostics: contextWindow.diagnostics,
            protocolDiagnostics
          };
        }

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
                contextDiagnostics: contextWindow.diagnostics,
                taskState: {
                  ...taskState,
                  completionStatus: "waiting_for_user",
                  updatedAt: new Date().toISOString()
                },
                protocolDiagnostics
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
            const workflowStage = workflowStageForTool(validated.tool.name);
            trajectory.toolStarted(validated.tool.name, operationId);
            await emit(input, {
              type: "tool_started",
              toolName: validated.tool.name,
              operationId,
              userLabel: toolActivityLabel(validated.tool.name),
              workflowStage
            });
            try {
              const cached = this.observationCache.get(validated.tool.name, validated.input);
              const result = cached ?? await this.dependencies.executor.execute({
                  toolName: validated.tool.name,
                  toolInput: validated.input,
                  operationId,
                  confirmed: validated.tool.name === "commit_profile_intake"
                    && taskState.knownSlots.profileIntakeExplicitCommit === true,
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
                if (
                  input.profileIntakeTurnKind === "profile_state_question"
                  && result.toolName === "get_profile"
                ) {
                  const text = profileStateQuestionAnswer(result.data);
                  await publishFinalStream(text, input, { turnId, iterationId });
                  trajectory.finish("completed");
                  return {
                    text,
                    trajectory: trajectory.value(),
                    conversationSummary: contextWindow.conversationSummary,
                    contextDiagnostics: contextWindow.diagnostics,
                    taskState,
                    protocolDiagnostics
                  };
                }
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
                artifactIds: result.artifactIds,
                workflowStage: completeWorkflowStage(workflowStage)
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
              allowedTools = limitTailoringContextTools(taskState, allowedTools);
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
                  contextDiagnostics: contextWindow.diagnostics,
                  protocolDiagnostics,
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
          const text = alignAnswer(groundMutationClaims({
            text: canonicalEntities.preserve(response.text?.trim() || "请补充继续这项任务所需的真实信息。"),
            userMessage: input.userMessage,
            observations: turnObservations
          }));
          if (nativeStreaming) await publishFinalStream(text, input, { turnId, iterationId });
          else await streamFinal(this.dependencies.model, { systemPrompt, messages, tools: modelTools }, text, input, { turnId, iterationId });
          trajectory.finish("waiting_for_user");
          return { text, trajectory: trajectory.value(), conversationSummary: contextWindow.conversationSummary, contextDiagnostics: contextWindow.diagnostics, taskState, protocolDiagnostics };
        }

          const text = response.text?.trim()
            ? groundMutationClaims({
              text: canonicalEntities.preserve(response.text.trim()),
              userMessage: input.userMessage,
              observations: turnObservations
            })
            : undefined;
        const alignedText = text ? alignAnswer(text) : undefined;
        if (alignedText) {
          if (input.turnIntent === "casual_side_turn" || input.turnIntent === "reference_followup") {
            const visible = nativeStreaming
              ? await publishFinalStream(alignedText, input, { turnId, iterationId })
              : await streamFinal(this.dependencies.model, { systemPrompt, messages, tools: modelTools }, alignedText, input, { turnId, iterationId });
            trajectory.finish("completed");
            return {
              text: visible,
              trajectory: trajectory.value(),
              conversationSummary: contextWindow.conversationSummary,
              contextDiagnostics: contextWindow.diagnostics,
              taskState,
              protocolDiagnostics
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
                : noProgressRecovery(completion.nextAction, taskState);
              await publishFinalStream(recovery, input, { turnId, iterationId });
              trajectory.finish("waiting_for_user");
              return {
                text: recovery,
                trajectory: trajectory.value(),
                conversationSummary: contextWindow.conversationSummary,
                contextDiagnostics: contextWindow.diagnostics,
                taskState: { ...taskState, completionStatus: "waiting_for_user", updatedAt: new Date().toISOString() },
                protocolDiagnostics
              };
            }
            previousNoProgressFingerprint = fingerprint;
          messages.push({ role: "assistant", content: alignedText });
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
            ? await publishFinalStream(alignedText, input, { turnId, iterationId })
            : await streamFinal(this.dependencies.model, { systemPrompt, messages, tools: modelTools }, alignedText, input, { turnId, iterationId });
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
            contextDiagnostics: contextWindow.diagnostics,
            taskState,
            protocolDiagnostics
          };
        }
      }
      throw new AgentPolicyError("agent_iteration_budget_exceeded", `Agent exceeded ${maxIterations} model iterations.`);
    } catch (error) {
      const code = errorCode(error);
      if (code === "AbortError" || input.signal?.aborted) {
        trajectory.finish("aborted");
        return { trajectory: trajectory.value(), taskState, protocolDiagnostics };
      }
      const localIntakeRecovery = await recoverProfileIntakeAfterProviderFailure({
        executor: this.dependencies.executor,
        taskState,
        sessionId: input.session.id,
        turnId,
        signal: input.signal
      });
      if (localIntakeRecovery) {
        const operationId = `local-intake-fallback-${turnId}`.slice(0, 160);
        const workflowStage = workflowStageForTool("capture_profile_intake");
        trajectory.toolStarted("capture_profile_intake", operationId);
        await emit(input, {
          type: "tool_started",
          toolName: "capture_profile_intake",
          operationId,
          userLabel: toolActivityLabel("capture_profile_intake"),
          workflowStage
        });
        if (localIntakeRecovery.ok) {
          taskState = taskReducer.reduce(taskState, {
            type: "tool_observation",
            toolName: "capture_profile_intake",
            observation: localIntakeRecovery.data,
            artifactIds: localIntakeRecovery.artifactIds
          });
          trajectory.toolCompleted(operationId, true, localIntakeRecovery.artifactIds);
          await emit(input, {
            type: "tool_result",
            toolName: "capture_profile_intake",
            operationId,
            ok: true,
            summary: summarizeToolResult(localIntakeRecovery),
            artifactIds: localIntakeRecovery.artifactIds,
            workflowStage: completeWorkflowStage(workflowStage)
          });
          const text = summarizeToolResult(localIntakeRecovery);
          await publishFinalStream(text, input, {
            turnId,
            iterationId: `${turnId}:local-fallback`
          });
          trajectory.finish("waiting_for_user");
          return {
            text,
            trajectory: trajectory.value(),
            conversationSummary: contextWindow.conversationSummary,
            contextDiagnostics: contextWindow.diagnostics,
            taskState,
            protocolDiagnostics
          };
        }
        trajectory.toolCompleted(operationId, false);
      }
      trajectory.error(code, error instanceof Error ? error.message : "Agent turn failed.");
      trajectory.finish("failed");
      await emit(input, { type: "error", code, message: userErrorMessage(code) });
      return {
        trajectory: trajectory.value(),
        taskState: taskReducer.reduce(taskState, { type: "failed", errorCode: code }),
        protocolDiagnostics
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
    profileIntakeSourceTurns?: Array<{ processingStatus: string }>;
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
      taskEventAlreadyReduced: true,
      profileIntakeSourceTurns: input.profileIntakeSourceTurns
    });
  }
}

async function recoverProfileIntakeAfterProviderFailure(input: {
  executor: AgentExecutor;
  taskState: AgentTaskState;
  sessionId: string;
  turnId: string;
  signal?: AbortSignal;
}) {
  if (input.taskState.workflowId !== "guided_profile_intake" || input.taskState.stage !== "structure_facts") {
    return undefined;
  }
  const source = objectValue(input.taskState.knownSlots.latestIntakeSource);
  const sessionId = stringValue(source.sessionId) ?? input.sessionId;
  const messageId = stringValue(source.messageId);
  const sourceTurnId = stringValue(source.turnId) ?? input.turnId;
  const text = stringValue(source.exactSourceQuote);
  const capturedAt = stringValue(source.capturedAt);
  const targetProfileId = stringValue(input.taskState.knownSlots.targetProfileId)
    ?? stringValue(source.targetProfileId);
  const expectedProfileVersion = numberValue(input.taskState.knownSlots.expectedProfileVersion)
    ?? numberValue(source.expectedProfileVersion);
  if (!messageId || !text || !capturedAt || !targetProfileId || expectedProfileVersion === undefined) return undefined;
  try {
    return await input.executor.execute({
      toolName: "capture_profile_intake",
      toolInput: {
        sessionId,
        messageId,
        turnId: sourceTurnId,
        text,
        capturedAt,
        targetProfileId,
        expectedProfileVersion,
        acknowledgedActiveProfileId: stringValue(input.taskState.knownSlots.acknowledgedActiveProfileId),
        sourceContentHash: stringValue(source.sourceContentHash)
      },
      operationId: `local-intake-fallback-${input.turnId}`.slice(0, 160),
      signal: input.signal
    });
  } catch {
    return undefined;
  }
}

async function consumeNativeTurn(
  model: AgentModel,
  request: Parameters<NonNullable<AgentModel["streamTurn"]>>[0],
  input: { signal?: AbortSignal; emit?(event: AgentStreamEvent): void | Promise<void> }
) {
  let text = "";
  let stopReason: AgentModelResult["stopReason"] = "final";
  let provider: string | undefined;
  let providerModel: string | undefined;
  let providerResponseShape: string[] | undefined;
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
    if (event.type === "finish") {
      stopReason = event.stopReason;
      provider = event.provider;
      providerModel = event.model;
      providerResponseShape = event.providerResponseShape;
    }
  }
  return {
    text: text.trim() || undefined,
    toolCalls: calls.size ? [...calls.entries()].sort(([left], [right]) => left - right).map(([, call]) => call) : undefined,
    stopReason,
    provider,
    model: providerModel,
    providerResponseShape
  };
}

async function publishFinalStream(
  text: string,
  input: { emit?(event: AgentStreamEvent): void | Promise<void> },
  identity: { turnId: string; iterationId: string }
) {
  const visible = sanitizeVisibleAgentText(text);
  const streamId = `${identity.turnId}:final`;
  await emit(input, { type: "assistant_start", ...identity, streamId });
  await emit(input, { type: "assistant_delta", delta: visible, ...identity, streamId });
  await emit(input, { type: "done", message: visible, ...identity, streamId });
  return visible;
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
    const visibleDraft = sanitizeVisibleAgentText(draft);
    await emit(input, { type: "assistant_delta", delta: visibleDraft, ...identity, streamId });
    await emit(input, { type: "done", message: visibleDraft, ...identity, streamId });
    return visibleDraft;
  }
  let streamed = "";
  for await (const delta of model.streamFinalText({ ...request, draft, signal: input.signal })) {
    streamed += delta;
  }
  const final = sanitizeVisibleAgentText(streamed.trim() || draft);
  await emit(input, { type: "assistant_delta", delta: final, ...identity, streamId });
  await emit(input, { type: "done", message: final, ...identity, streamId });
  return final;
}

function sanitizeVisibleAgentText(text: string) {
  const normalized = text.trim();
  if (!normalized) return "我已经收到。请继续补充你的真实情况，我会按步骤和你核对。";
  if (looksLikeInternalAgentPayload(normalized)) {
    return "我已完成必要的内部核对，但不会展示内部工具或 JSON。请直接告诉我想处理的求职任务。";
  }
  return normalized;
}

function looksLikeInternalAgentPayload(text: string) {
  const candidate = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    return typeof record.tool === "string"
      || typeof record.toolName === "string"
      || typeof record.tool_name === "string"
      || (typeof record.input === "object" && record.input !== null && ("tool" in record || "name" in record));
  } catch {
    return /(?:^|\n)\s*[\[{]\s*["'](?:tool|toolName|tool_name|function)["']\s*:/i.test(text);
  }
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

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
  if (
    taskState.workflowId === "guided_profile_intake"
    && ["get_profile", "search_profile_facts"].includes(call.name)
  ) {
    const argumentsValue = { ...call.arguments };
    if (typeof slots.targetProfileId === "string") argumentsValue.profileId = slots.targetProfileId;
    return { ...call, arguments: argumentsValue };
  }
  if (
    taskState.workflowId === "tailor_existing_resume"
    && ["get_profile", "get_resume", "get_resume_revision", "get_job", "analyze_job_fit", "create_tailoring_session"].includes(call.name)
  ) {
    const argumentsValue = { ...call.arguments };
    if (taskState.selectedEntities.profileId) argumentsValue.profileId = taskState.selectedEntities.profileId;
    if (taskState.selectedEntities.resumeId) argumentsValue.resumeId = taskState.selectedEntities.resumeId;
    if (taskState.selectedEntities.resumeRevisionId && call.name === "get_resume_revision") {
      argumentsValue.revisionId = taskState.selectedEntities.resumeRevisionId;
    }
    if (taskState.selectedEntities.jobId) argumentsValue.jobId = taskState.selectedEntities.jobId;
    return { ...call, arguments: argumentsValue };
  }
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
        sourceContentHash: source.sourceContentHash,
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
            sourceQuote: clarification.exactSourceQuote,
            sourceContentHash: clarification.sourceContentHash
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
  if (call.name === "review_resume_import") {
    return {
      ...call,
      arguments: {
        ...call.arguments,
        importId: slots.importId,
        expectedDraftRevision: slots.expectedDraftRevision,
        decision: slots.reviewDecision
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
    "generate_tailoring_changes",
    "review_tailoring_diff",
    "preview_tailoring_changes",
    "apply_tailoring_changes"
  ].includes(call.name)) {
    return call;
  }
  const session = taskState.knownSlots.tailoringSession;
  if (!session) return call;
  if (call.name === "answer_tailoring_question") {
    const activeQuestionId = typeof taskState.knownSlots.activeQuestionId === "string"
      ? taskState.knownSlots.activeQuestionId
      : undefined;
    return {
      ...call,
      arguments: {
        ...call.arguments,
        session,
        questionId: activeQuestionId
      }
    };
  }
  if (call.name === "create_resume_from_profile") {
    const profileVersion = taskState.selectedEntities.profileVersion ?? slots.expectedProfileVersion;
    return {
      ...call,
      arguments: {
        ...call.arguments,
        targetProfileId: slots.targetProfileId ?? taskState.selectedEntities.profileId,
        ...(typeof profileVersion === "number" ? { expectedProfileVersion: profileVersion } : {}),
        ...(Array.isArray(slots.selectedFactIds) && slots.selectedFactIds.length > 0
          ? { selectedFactIds: slots.selectedFactIds }
          : {}),
        ...(slots.acknowledgedActiveProfileId ? { acknowledgedActiveProfileId: slots.acknowledgedActiveProfileId } : {})
      }
    };
  }
  if (call.name === "generate_tailoring_changes") {
    return { ...call, arguments: { session } };
  }
  if (call.name === "review_tailoring_diff") {
    return { ...call, arguments: { ...call.arguments, session } };
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
  if (result.toolName === "capture_profile_intake") {
    const extractionStatus = data?.extractionStatus;
    const usableCandidateCount = typeof data?.usableCandidateCount === "number" ? data.usableCandidateCount : 0;
    const candidateCount = typeof data?.candidateCount === "number" ? data.candidateCount : usableCandidateCount;
    if (extractionStatus === "structured_local") {
      return `AI 服务暂不可用，已用本地规则整理出 ${usableCandidateCount} 项候选，请核对。`;
    }
    if (extractionStatus === "failed" || candidateCount === 0) {
      return "没有生成可用候选，原始回答已保留，可重新解析。";
    }
    if (extractionStatus === "partial") {
      return `已生成 ${candidateCount} 项候选，其中部分字段需要核对。`;
    }
    return `AI 已整理出 ${candidateCount} 项经历候选，请核对来源。`;
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
    create_resume_from_profile: "已从确认资料创建独立通用简历。",
    capture_profile_intake: "已生成经历核对卡片。",
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
    get_active_profile: "正在读取当前资料库",
    get_profile: "正在读取当前资料库",
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
    create_resume_from_profile: "正在从确认资料创建独立通用简历",
    apply_tailoring_changes: "正在创建新的简历版本",
    export_resume: "正在准备简历导出",
    capture_profile_intake: "正在识别经历结构",
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
  if (/资料库|经历|我是谁|AI/i.test(message)) return "正在读取当前资料库";
  return "正在准备当前步骤";
}

function workflowStageForTask(taskState: AgentTaskState) {
  if (taskState.workflowId === "guided_profile_intake") {
    if (taskState.stage === "resolve_profile_target" || taskState.stage === "collect_experience") {
      return workflowProgressStage("read-profile", "正在读取当前资料库");
    }
    if (taskState.stage === "structure_facts") return workflowProgressStage("recognize-structure", "正在识别经历结构");
    if (taskState.stage === "review_facts") return workflowProgressStage("generate-review-cards", "正在生成核对卡片");
    if (taskState.stage === "reconcile_profile" || taskState.stage === "confirm_commit") {
      return workflowProgressStage("autosave", "已自动保存");
    }
  }
  if (taskState.workflowId === "resume_import") {
    if (taskState.stage === "prepare_import") return workflowProgressStage("extract-file", "正在提取文件内容");
    if (taskState.stage === "import_review") return workflowProgressStage("generate-review-cards", "正在生成核对卡片");
  }
  return workflowProgressStage("current-step", "正在处理当前步骤");
}

function workflowStageForTool(toolName: string) {
  const stages: Record<string, { id: string; label: string }> = {
    get_active_profile: { id: "read-profile", label: "正在读取当前资料库" },
    get_profile: { id: "read-profile", label: "正在读取当前资料库" },
    prepare_resume_import: { id: "extract-file", label: "正在提取文件内容" },
    capture_profile_intake: { id: "recognize-structure", label: "正在识别经历结构" },
    review_profile_intake: { id: "save-review", label: "正在校验字段来源" },
    reconcile_profile_intake: { id: "save-review", label: "正在校验字段来源" },
    commit_profile_intake: { id: "autosave", label: "已自动保存" }
  };
  const stage = stages[toolName] ?? { id: "current-step", label: toolActivityLabel(toolName) };
  return workflowProgressStage(stage.id, stage.label);
}

function completeWorkflowStage(stage: ReturnType<typeof workflowStageForTool>) {
  const completed = stage.id === "recognize-structure"
    ? { id: "generate-review-cards", label: "正在生成核对卡片" }
    : stage.id === "save-review"
      ? { id: "autosave", label: "已自动保存" }
      : stage.id === "extract-file"
        ? { id: "generate-review-cards", label: "正在生成核对卡片" }
        : { id: stage.id, label: stage.label };
  return {
    id: completed.id,
    label: completed.label,
    startedAt: stage.startedAt,
    completedAt: new Date().toISOString()
  };
}

function workflowProgressStage(id: string, label: string, completed = false) {
  const startedAt = new Date().toISOString();
  return {
    id,
    label,
    startedAt,
    ...(completed ? { completedAt: new Date().toISOString() } : {})
  };
}

function userErrorMessage(code: string) {
  if (code === "agent_duplicate_tool_call") return "我检测到重复步骤并已停止，现有任务信息仍然保留。";
  if (code === "tool_input_invalid") return "当前访谈状态不完整，未执行资料整理。现有输入已保留。";
  if (code === "provider_textual_tool_protocol") return "模型返回的工具指令没有通过安全校验；你的原始输入和当前进度仍然保留，可以重新执行当前步骤。";
  if (code.includes("budget")) return "自动处理没有完成：连续步骤未能推进。你的原始输入和现有进度已保留，尚未写入资料库，可以重新执行当前步骤或结束任务。";
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

function limitTailoringContextTools<T extends { name: string }>(
  taskState: NonNullable<AgentSession["taskState"]>,
  tools: T[]
) {
  if (
    taskState.workflowId !== "tailor_existing_resume"
    || !["choose_resume_source", "choose_job"].includes(taskState.stage)
  ) {
    return tools;
  }
  const cheapContextReads = new Set(["get_active_profile", "list_resumes", "list_jobs"]);
  return tools.filter((tool) => cheapContextReads.has(tool.name));
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
  if (/^(你是谁|你是什么|介绍一下你自己|你是做什么的)[？?!。.]?$/i.test(compact)) {
    return "我是职适AI里的本地求职助手，不是求职者本人。我可以帮你整理个人资料、分析岗位、匹配和定制简历、管理求职进度；需要读取资料时，我会在内部完成，不会把工具调用或 JSON 展示出来。";
  }
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

function isDirectIdentityQuestion(userMessage: string) {
  return /^(你是谁|你是什么|介绍一下你自己|你是做什么的)[？?!。.]?$/i.test(userMessage.trim().replace(/\s+/g, ""));
}

function deterministicAlignmentRecovery(taskState: NonNullable<AgentSession["taskState"]>) {
  if (taskState.workflowId === "guided_profile_intake") {
    if (taskState.stage === "structure_facts") return "原始回答已经保留，结构化整理尚未完成；我会停留在当前步骤，不会把未确认内容当作进展。";
    if (taskState.stage === "review_facts" || taskState.stage === "final_review") return "经历核对卡片已经保留，请先确认或忽略其中的候选内容。";
    if (taskState.stage === "resolve_conflicts") return "资料对账发现需要你确认的冲突，我会停留在冲突核对步骤。";
    if (taskState.stage === "confirm_commit") return "保存前核验尚未完成，我会停留在保存确认步骤。";
    if (taskState.stage === "profile_complete") return "资料库写入核验尚未完成，因此我不会宣称档案已经保存。";
  }
  return "当前步骤的可见回答与权威任务状态不一致，我会保留现有进度并停留在当前步骤。";
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
  clarify_unsupported_facts: "请回答当前问题，或回复“跳过”。",
  generate_changes: "正在综合全部资料生成总体优化方案。",
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
}, taskState?: NonNullable<AgentSession["taskState"]>) {
  const withExitPaths = (instruction: string) =>
    `${instruction}\n\n如果这一步仍然没有推进，可以使用“重新执行当前步骤”按钮，或选择“结束任务”；也可以直接告诉我你想改做什么。`;
  const tailoringGoal = ["create_tailored_resume", "apply_to_job", "analyze_job_fit"].includes(nextAction.goal ?? "");
  const missingSlots = taskState && tailoringGoal
    ? (["profileId", "resumeId", "jobId"] as const).filter((slot) => !taskState.selectedEntities[slot])
    : nextAction.missingSlots;
  if (taskState && tailoringGoal && missingSlots.length === 1 && missingSlots[0] === "jobId") {
    const resumeName = typeof taskState.knownSlots.selectedResumeName === "string"
      ? taskState.knownSlots.selectedResumeName
      : "通用简历";
    const candidates = Array.isArray(taskState.knownSlots.jobCandidates)
      ? taskState.knownSlots.jobCandidates.map(objectValue)
      : [];
    const options = candidates.flatMap((candidate, index) => {
      const title = typeof candidate.title === "string" ? candidate.title : "未命名岗位";
      const company = typeof candidate.company === "string" && candidate.company ? ` · ${candidate.company}` : "";
      return [`${index + 1}. ${title}${company}`];
    });
    return withExitPaths(`我会使用当前资料库和《${resumeName}》。\n要针对哪个岗位定制？${options.length ? `\n${options.join("\n")}` : ""}`);
  }
  if (nextAction.goal === "analyze_job_fit") {
    return withExitPaths(missingSlots.length === 1 && missingSlots[0] === "jobId"
      ? "请告诉我想针对哪个已保存岗位；直接说岗位名称、公司或序号即可。"
      : "我可以帮你分析岗位匹配度。请告诉我要比较哪一份简历、哪一个目标岗位：已保存的直接说名称即可；如果是新岗位，也可以直接把岗位描述粘贴给我。");
  }
  if (nextAction.goal === "ingest_job") {
    return withExitPaths("请提供目标岗位信息：可以直接粘贴招聘描述原文，或告诉我岗位名称和公司。");
  }
  if (missingSlots.length) {
    const labels = [...new Set(
      missingSlots
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
  allowedTools: Array<{ name: string }>,
  turnId: string
) {
  if (
    taskState.workflowId === "guided_profile_intake"
    && taskState.stage === "profile_complete"
    && taskState.knownSlots.profileCommitResult
    && taskState.selectedEntities.profileId
    && !taskState.knownSlots.profileCommitVerification
    && allowedTools.some((tool) => tool.name === "get_profile")
  ) {
    return "get_profile";
  }
  if (
    taskState.workflowId === "guided_profile_intake"
    && taskState.stage === "structure_facts"
    && isAuthorizedIntakeSource(taskState.knownSlots.latestIntakeSource, taskState, turnId)
    && allowedTools.some((tool) => tool.name === "capture_profile_intake")
  ) {
    return "capture_profile_intake";
  }
  if (
    taskState.workflowId === "guided_profile_intake"
    && taskState.stage === "reconcile_profile"
    && taskState.completionStatus === "active"
    && taskState.knownSlots.profileIntakeFinishRequested === true
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
  const toolName = taskState.workflowId === "resume_import"
    && taskState.stage === "import_review"
    && ["accept_all", "ignore_uncertain"].includes(String(taskState.knownSlots.reviewDecision))
    ? "review_resume_import"
    : taskState.workflowId === "guided_profile_intake" && taskState.stage === "confirm_commit"
      && taskState.knownSlots.profileIntakeExplicitCommit === true
    ? "commit_profile_intake"
    : taskState.workflowId === "guided_profile_intake" && taskState.stage === "optional_resume_decision"
      ? "ensure_general_resume_from_profile"
    : taskState.workflowId === "job_ingestion" && taskState.stage === "confirm_commit"
      ? "commit_job"
      : taskState.stage === "confirm_import"
        ? "commit_resume_import"
        : taskState.stage === "generate_changes"
          ? "generate_tailoring_changes"
        : taskState.stage === "confirm_apply"
          ? "apply_tailoring_changes"
          : undefined;
  return toolName && allowedTools.some((tool) => tool.name === toolName)
    ? toolName
    : undefined;
}

function isAuthorizedIntakeSource(
  value: unknown,
  taskState: NonNullable<AgentSession["taskState"]>,
  turnId: string
) {
  const source = objectValue(value);
  return (source.sourceKind === "career_narrative" || source.sourceKind === "follow_up_answer")
    && source.classifiedAsEvidence === true
    && source.retracted !== true
    && typeof source.sessionId === "string"
    && typeof source.messageId === "string"
    && source.turnId === turnId
    && typeof source.exactSourceQuote === "string"
    && typeof source.capturedAt === "string"
    && source.targetProfileId === taskState.knownSlots.targetProfileId
    && source.expectedProfileVersion === taskState.knownSlots.expectedProfileVersion;
}

function profileStateQuestionAnswer(value: unknown) {
  const data = objectValue(value);
  const profile = objectValue(data.profile);
  const items = Array.isArray(profile.items) ? profile.items.map(objectValue) : [];
  const hasEducation = items.some((item) => item.sectionType === "education" || item.category === "education");
  return hasEducation
    ? "我刚刚重新读取了当前活动资料库，仍返回了教育经历；我暂不把它用于整理。请先修复资料状态后继续。"
    : "我刚刚重新读取了当前活动资料库，本次返回的活动条目中没有这条教育经历。我不会把回收站内容用于匹配、简历生成或访谈上下文。我们可以继续从新的经历开始。";
}

function deterministicWorkflowPause(
  taskState: NonNullable<AgentSession["taskState"]>,
  afterToolOrResume = true
) {
  if (
    taskState.workflowId === "guided_profile_intake"
    && taskState.stage === "review_facts"
    && taskState.knownSlots.intakeInterviewPlan
    && (Array.isArray(taskState.knownSlots.intakeCandidates) || taskState.knownSlots.profileIntakeReviewProjection)
  ) {
    const projection = objectValue(taskState.knownSlots.profileIntakeReviewProjection);
    if (projection.extractionStatus === "failed") {
      return "这段内容没有完成结构化，但原文已经保留。你可以重新解析、手动整理，或保留为来源。";
    }
    const candidates = Array.isArray(projection.candidates)
      ? projection.candidates
      : Array.isArray(taskState.knownSlots.intakeCandidates) ? taskState.knownSlots.intakeCandidates : [];
    const count = candidates.length;
    return count > 1
      ? `我从这段描述中整理出 ${count} 项经历。请在下面逐项采用、编辑或忽略；对话和经历核对会保持同一份来源。`
      : "我整理出 1 项经历。请在下面直接核对、编辑、采用或忽略，这个决定会保留原始来源。";
  }
  if (
    taskState.workflowId === "guided_profile_intake"
    && taskState.stage === "final_review"
  ) {
    return "本次整理已进入最终批量审核。请在右侧确认将要合并的事实；确认无误后点击“完成整理并保存到资料库”。";
  }
  if (
    taskState.workflowId === "guided_profile_intake"
    && taskState.stage === "collect_experience"
    && (Array.isArray(taskState.knownSlots.intakeCandidates) || taskState.knownSlots.profileIntakeReviewProjection)
  ) {
    const interviewPlan = objectValue(taskState.knownSlots.intakeInterviewPlan);
    const requestedSection = typeof taskState.knownSlots.intakeRequestedSection === "string"
      ? taskState.knownSlots.intakeRequestedSection
      : undefined;
    if (requestedSection) {
      return `好的，我们继续补充${profileIntakeSectionLabel(requestedSection)}。请告诉我这段经历的名称、你承担的角色、主要工作和结果。`;
    }
    const activeQuestion = objectValue(interviewPlan.activeQuestion);
    const question = typeof activeQuestion.question === "string"
      ? activeQuestion.question
      : Array.isArray(interviewPlan.questions)
        ? objectValue(interviewPlan.questions.find((item) => objectValue(item).status === "pending")).question
        : undefined;
    if (typeof question === "string" && question) {
      return `这项经历已记录到本次整理草稿中。为了让它更适合真实复用，我先问一个高价值细节：\n\n${question}`;
    }
    const projection = objectValue(taskState.knownSlots.profileIntakeReviewProjection);
    const followUp = typeof projection.followUpQuestion === "string" ? projection.followUpQuestion : undefined;
    return followUp
      ? `当前经历已核对完成。为了让它更适合真实复用，我先问一个高价值细节：\n\n${followUp}\n\n回答后你可以继续补充其他经历，或完成整理。`
      : "已更新临时整理，接下来我会继续确认一项关键信息。";
  }
  if (
    afterToolOrResume
    &&
    taskState.workflowId === "tailor_existing_resume"
    && taskState.stage === "clarify_unsupported_facts"
  ) {
    const question = objectValue(taskState.knownSlots.currentClarification);
    const questionId = typeof taskState.knownSlots.activeQuestionId === "string"
      ? taskState.knownSlots.activeQuestionId
      : undefined;
    if (questionId && question.id === questionId && typeof question.question === "string") {
      const questionPlan = objectValue(taskState.knownSlots.questionPlan);
      const questionIds = Array.isArray(questionPlan.questionIds) ? questionPlan.questionIds : [];
      const position = Math.max(0, questionIds.indexOf(questionId));
      const options = Array.isArray(question.options)
        ? question.options.map(objectValue).flatMap((option, index) => typeof option.label === "string" ? [`${index + 1}. ${option.label}`] : [])
        : [];
      return [
        position === 0 ? `为了更准确地优化简历，我还需要确认 ${questionIds.length} 个细节。` : "已记录。",
        `问题 ${position + 1}/${questionIds.length}：`,
        question.question,
        options.length ? options.join("\n") : "",
        "你可以直接补充说明，或回复“跳过”。"
      ].filter(Boolean).join("\n\n");
    }
  }
  if (
    afterToolOrResume
    && taskState.workflowId === "tailor_existing_resume"
    && taskState.stage === "preview_changes"
    && typeof taskState.knownSlots.remainingDiffCount === "number"
    && taskState.knownSlots.remainingDiffCount > 0
  ) {
    return `总体优化方案已生成。请在右侧逐项采用、编辑或忽略；还剩 ${taskState.knownSlots.remainingDiffCount} 项需要核对。`;
  }
  if (
    afterToolOrResume
    && taskState.workflowId === "tailor_existing_resume"
    && taskState.stage === "quality_result"
    && taskState.completionStatus === "completed"
    && taskState.knownSlots.qualityResult
  ) {
    return "新的岗位定制简历版本已创建，原简历和个人资料库保持不变。";
  }
  if (
    taskState.workflowId === "tailor_existing_resume"
    && taskState.stage === "choose_resume_source"
    && taskState.selectedEntities.profileId
    && !taskState.selectedEntities.resumeId
    && taskState.knownSlots.resumeSelectionRequired
  ) {
    const candidates = Array.isArray(taskState.knownSlots.resumeCandidates)
      ? taskState.knownSlots.resumeCandidates.map(objectValue)
      : [];
    const options = candidates.flatMap((candidate, index) => {
      const name = typeof candidate.name === "string" ? candidate.name : "未命名简历";
      return [`${index + 1}. ${name}`];
    });
    const prefix = taskState.knownSlots.resumeSelectionError === "not_found"
      ? "我没有找到这份简历。有效选项如下：\n"
      : taskState.knownSlots.resumeSelectionError === "ambiguous"
        ? "有多份简历符合这句话，请选择其中一份：\n"
        : "";
    return `${prefix}当前资料库已确定。请先选择要使用的简历：${options.length ? `\n${options.join("\n")}` : ""}`;
  }
  if (
    taskState.workflowId === "tailor_existing_resume"
    && taskState.stage === "choose_job"
    && taskState.selectedEntities.profileId
    && taskState.selectedEntities.resumeId
    && !taskState.selectedEntities.jobId
  ) {
    const resumeName = typeof taskState.knownSlots.selectedResumeName === "string"
      && taskState.knownSlots.selectedResumeName.trim()
      ? taskState.knownSlots.selectedResumeName
      : "通用简历";
    const ambiguity = Array.isArray(taskState.knownSlots.jobSelectionAmbiguity)
      ? taskState.knownSlots.jobSelectionAmbiguity
      : undefined;
    const candidates = (ambiguity?.length ? ambiguity : taskState.knownSlots.jobCandidates);
    const options = Array.isArray(candidates)
      ? candidates.map(objectValue).flatMap((candidate, index) => {
          const title = typeof candidate.title === "string" ? candidate.title : "未命名岗位";
          const company = typeof candidate.company === "string" && candidate.company ? ` · ${candidate.company}` : "";
          return [`${index + 1}. ${title}${company}`];
        })
      : [];
    const prefix = taskState.knownSlots.jobSelectionError === "not_found"
      ? "我没有在当前已保存岗位中找到这个名称。有效选项如下：\n"
      : taskState.knownSlots.jobSelectionError === "ambiguous"
        ? "有多个岗位符合这句话，请选择其中一个：\n"
        : "";
    return `${prefix}我会使用当前资料库和《${resumeName}》。\n要针对哪个岗位定制？${options.length ? `\n${options.join("\n")}` : ""}`;
  }
  if (
    taskState.workflowId !== "resume_import"
    || taskState.stage !== "import_review"
    || taskState.knownSlots.reviewStatus === "reviewed"
    || taskState.knownSlots.reviewDecision
  ) {
    return undefined;
  }
  const target = objectValue(taskState.knownSlots.importTarget);
  const targetLabel = target.mode === "new" && typeof target.profileName === "string"
    ? `导入目标已记录为新建“${target.profileName}”职业资料库。`
    : taskState.knownSlots.importTargetIntent === "new"
      ? "导入目标已记录为新建职业资料库；完成核对后我会再确认资料库名称。"
      : "";
  return `${targetLabel}请在导入核对卡中审核待确认资料；只有你明确作出采用或忽略决定后，流程才会继续，当前不会写入资料库。`;
}

function profileIntakeSectionLabel(section: string) {
  return ({
    internship: "实习经历",
    project: "项目经历",
    campus: "校园经历",
    skills: "技能或证书",
    awards: "奖项经历",
    certificates: "证书经历"
  } as Record<string, string>)[section] ?? "下一段经历";
}

async function emit(
  input: { emit?(event: AgentStreamEvent): void | Promise<void> },
  event: AgentStreamEvent
) {
  await input.emit?.(event);
}
