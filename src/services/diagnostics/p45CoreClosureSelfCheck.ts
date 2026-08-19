import { AgentTaskStateSchema, type AgentSession, type AgentTaskState } from "@/agent/contracts/agentSession";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { deriveWorkflowUserInputCheckpoint } from "@/agent/runtime/workflowUserInputCheckpoint";
import { prepareCareerWorkflowInvocation } from "@/agent/workflows/CareerWorkflowFacade";
import { createTurnScopedTargetContext } from "@/agent/runtime/turnScopedTargetContext";
import type { CareerToolContract, CareerToolExecutionContext } from "@/agent/tools/CareerToolGateway";
import { runCareerToolContractSelfTest } from "@/agent/tools/careerToolContract";
import type { RuntimeStatusSnapshot } from "@/agent/runtime/runtimeStatus";
import type { CareerProfile, ImportedResumeDraft, ResumeBranch } from "@/domain/schemas";
import {
  buildLiveProfileContentIntegrity,
  type LiveProfileContentIntegrity,
  type LiveProfileContentIntegrityResult,
  type LiveProfileIntegrityStatus,
  type ProfileIntegrityClassification
} from "@/domain/profile/profileContentIntegrity";
import { buildProfileRecoveryCandidates, profileRecoveryCandidatePreview } from "@/domain/profile/profileContentRecovery";
import { getLiveProfileProjection } from "@/domain/profile/profileProjectionRegistry";
import type { WorkspaceRepository } from "@/services/storage/repositories";

export type CoreClosureCheckStatus = LiveProfileIntegrityStatus;

export type CoreClosureCheck = {
  status: CoreClosureCheckStatus;
  reason?: string;
  details?: Record<string, unknown>;
};

export type CoreClosureSelfCheckResult = {
  schemaVersion: "p4.5-core-closure-self-check-v1";
  overallStatus: CoreClosureCheckStatus;
  runId: string;
  checkedAt: string;
  logicalTurnId: string;
  logicalToolOperationId: string;
  turnTargetContextId?: string;
  profileId?: string;
  profileRevision?: number;
  profileContentIntegrity?: LiveProfileContentIntegrity;
  profileIntegrityClassification?: ProfileIntegrityClassification;
  liveProjectionAvailable: boolean;
  repairRequired: boolean;
  repairCandidates: Array<ReturnType<typeof profileRecoveryCandidatePreview>>;
  checks: {
    hermesRuntime: CoreClosureCheck;
    careerMcp: CoreClosureCheck;
    careerContract: CoreClosureCheck;
    activeProfileReadability: CoreClosureCheck;
    generalResumeReadability: CoreClosureCheck;
    profileContentIntegrity: CoreClosureCheck;
    browserMcpRoundTrip: CoreClosureCheck;
    logicalToolOperationIdCorrelation: CoreClosureCheck;
    turnTargetContext: CoreClosureCheck;
    workflowCheckpointInvariants: CoreClosureCheck;
    repositoryReadback: CoreClosureCheck;
  };
  workflow: {
    activeSessionId?: string;
    activeTurnId?: string;
    runId?: string;
    checkpointSequence: Array<{
      checkpointId: string;
      kind: string;
      revision: number;
      stage: string;
      turnId?: string;
    }>;
    stageSequence: Array<{ turnId?: string; workflowId: string; stage: string; completionStatus?: string }>;
  };
};

type CoreClosureSelfCheckInput = {
  repository: WorkspaceRepository;
  runtimeSnapshot: RuntimeStatusSnapshot;
  contracts: CareerToolContract[];
  activeSession?: AgentSession;
  fetcher?: typeof fetch;
  importedDraft?: ImportedResumeDraft;
};

let latestSelfCheck: CoreClosureSelfCheckResult | undefined;

export function getLatestCoreClosureSelfCheck() {
  return latestSelfCheck;
}

export function recordCoreClosureSelfCheck(result: CoreClosureSelfCheckResult) {
  latestSelfCheck = result;
  return result;
}

export async function runP45CoreClosureSelfCheck(input: CoreClosureSelfCheckInput): Promise<CoreClosureSelfCheckResult> {
  const runId = diagnosticId("core-check");
  const logicalTurnId = diagnosticId("diagnostic-turn");
  const logicalToolOperationId = diagnosticId("diagnostic-tool");
  const checkedAt = new Date().toISOString();
  const activeContext = await input.repository.getActiveCareerContext();
  const profile = activeContext ? await input.repository.getProfile(activeContext.profileId) : undefined;
  const generalResume = profile ? await activeGeneralResume(input.repository, profile.id) : undefined;
  const importedDraft = input.importedDraft ?? await input.repository.getLatestImportedResumeDraft();
  const liveProjection = profile ? getLiveProfileProjection(profile.id, profile.version) : undefined;
  const integrity = profile
    ? buildLiveProfileContentIntegrity({ profile, generalResume, liveProjection })
    : undefined;
  const recoveryCandidates = profile
    ? buildProfileRecoveryCandidates({ profile, importedDraft, generalResume })
    : [];
  const preferredRecovery = recoveryCandidates.find((candidate) => candidate.affectedEntityCount > 0);
  const contractSelfTest = runCareerToolContractSelfTest(input.contracts);
  const runtimeReady = runtimeReadyForSelfCheck(input.runtimeSnapshot);
  const mcpReady = input.runtimeSnapshot.mcpConnected === true
    && (input.runtimeSnapshot.discoveredToolCount ?? 0) > 0;
  const targetCheck = runTurnTargetSelfCheck(logicalTurnId);
  const checkpointCheck = workflowCheckpointInvariant(input.activeSession?.taskState);
  const browser = profile && activeContext
    ? await runBrowserMcpRoundTrip({
        profile,
        activeContext,
        runId,
        logicalTurnId,
        logicalToolOperationId,
        fetcher: input.fetcher ?? fetch
      })
    : undefined;
  const readback = profile
    ? await verifyRepositoryReadback(input.repository, profile, generalResume, integrity)
    : undefined;

  const checks = {
    hermesRuntime: check(runtimeReady, runtimeReady ? undefined : "hermes_not_ready"),
    careerMcp: check(mcpReady, mcpReady ? undefined : "career_mcp_not_connected"),
    careerContract: check(contractSelfTest.ready, contractSelfTest.ready ? undefined : "career_tool_contract_mismatch", {
      contractVersion: contractSelfTest.contractVersion,
      mismatches: contractSelfTest.mismatches.map((mismatch) => ({
        toolName: mismatch.toolName,
        reason: mismatch.reason,
        publishedContractVersion: mismatch.publishedContractVersion,
        publishedSchemaHash: mismatch.publishedSchemaHash,
        expectedSchemaHash: mismatch.expectedSchemaHash
      }))
    }),
    activeProfileReadability: check(Boolean(activeContext && profile && activeContext.profileId === profile.id), profile ? undefined : "active_profile_unreadable", profile ? {
      profileId: profile.id,
      revision: profile.version,
      profileVersionNumber: profile.profileVersionNumber
    } : undefined),
    generalResumeReadability: generalResume
      ? check(Boolean(generalResume.currentRevisionId), generalResume.currentRevisionId ? undefined : "general_resume_revision_missing", {
          branchId: generalResume.id,
          revision: generalResume.revision,
          revisionId: generalResume.currentRevisionId
        })
      : { status: "NOT_APPLICABLE" as const, reason: profile ? "general_resume_not_created" : "active_profile_unreadable" },
    profileContentIntegrity: integrity
      ? {
          status: integrity.status,
          reason: integrity.status === "PASS" ? undefined : integrity.classification,
          details: {
            classification: integrity.classification,
            liveProjectionAvailable: integrity.liveProjectionAvailable,
            generalResumeContentMissingFromRepository: integrity.generalResumeContentMissingFromRepository
          }
        }
      : { status: "NOT_APPLICABLE" as const, reason: "active_profile_unreadable" },
    browserMcpRoundTrip: browser?.check ?? { status: "NOT_APPLICABLE" as const, reason: "active_profile_unreadable" },
    logicalToolOperationIdCorrelation: browser?.correlationCheck ?? { status: "NOT_APPLICABLE" as const, reason: "browser_mcp_roundtrip_not_run" },
    turnTargetContext: targetCheck.check,
    workflowCheckpointInvariants: checkpointCheck,
    repositoryReadback: readback ?? { status: "NOT_APPLICABLE" as const, reason: "active_profile_unreadable" }
  };
  const overallStatus = overallCheckStatus(Object.values(checks));
  const result: CoreClosureSelfCheckResult = {
    schemaVersion: "p4.5-core-closure-self-check-v1",
    overallStatus,
    runId,
    checkedAt,
    logicalTurnId,
    logicalToolOperationId,
    ...(targetCheck.targetContextId ? { turnTargetContextId: targetCheck.targetContextId } : {}),
    ...(profile ? { profileId: profile.id, profileRevision: profile.version } : {}),
    ...(integrity ? {
      profileContentIntegrity: integrity.profileContentIntegrity,
      profileIntegrityClassification: integrity.classification,
      liveProjectionAvailable: integrity.liveProjectionAvailable
    } : { liveProjectionAvailable: false }),
    repairRequired: Boolean(preferredRecovery),
    repairCandidates: recoveryCandidates.map(profileRecoveryCandidatePreview),
    checks,
    workflow: workflowDiagnostics(input.activeSession)
  };
  return recordCoreClosureSelfCheck(result);
}

function check(
  pass: boolean,
  reason?: string,
  details?: Record<string, unknown>
): CoreClosureCheck {
  return {
    status: pass ? "PASS" : "FAIL",
    ...(reason ? { reason } : {}),
    ...(details ? { details } : {})
  };
}

function overallCheckStatus(checks: CoreClosureCheck[]) {
  if (checks.some((item) => item.status === "FAIL")) return "FAIL" as const;
  if (checks.every((item) => item.status === "NOT_APPLICABLE")) return "NOT_APPLICABLE" as const;
  return "PASS" as const;
}

function runtimeReadyForSelfCheck(snapshot: RuntimeStatusSnapshot) {
  return snapshot.activeRuntime === "hermes"
    && snapshot.status === "ready"
    && snapshot.processReady !== false
    && snapshot.apiReady !== false
    && snapshot.providerReady !== false
    && snapshot.careerMcpReady !== false
    && snapshot.toolSurfaceReady !== false
    && snapshot.runReady !== false;
}

async function activeGeneralResume(repository: WorkspaceRepository, profileId: string) {
  const branches = await repository.listResumeBranches(profileId);
  return branches
    .filter((branch) => branch.branchPurpose === "general" && branch.lifecycleStatus === "active")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

async function verifyRepositoryReadback(
  repository: WorkspaceRepository,
  profile: CareerProfile,
  generalResume: ResumeBranch | undefined,
  beforeIntegrity: LiveProfileContentIntegrityResult | undefined
): Promise<CoreClosureCheck> {
  const profileReadback = await repository.getProfile(profile.id);
  const generalReadback = generalResume ? await repository.getResumeBranch(generalResume.id) : undefined;
  if (!profileReadback || profileReadback.version !== profile.version) {
    return { status: "FAIL", reason: "profile_readback_mismatch" };
  }
  if (generalResume && (!generalReadback || generalReadback.revision !== generalResume.revision || generalReadback.currentRevisionId !== generalResume.currentRevisionId)) {
    return { status: "FAIL", reason: "general_resume_readback_mismatch" };
  }
  if (!beforeIntegrity) return { status: "PASS", details: { profileId: profileReadback.id, profileRevision: profileReadback.version } };
  const afterIntegrity = buildLiveProfileContentIntegrity({ profile: profileReadback, generalResume: generalReadback });
  const sameCounts = JSON.stringify(beforeIntegrity.profileContentIntegrity.repository) === JSON.stringify(afterIntegrity.profileContentIntegrity.repository)
    && JSON.stringify(beforeIntegrity.profileContentIntegrity.generalResume) === JSON.stringify(afterIntegrity.profileContentIntegrity.generalResume);
  return sameCounts
    ? { status: "PASS", details: { profileId: profileReadback.id, profileRevision: profileReadback.version } }
    : { status: "FAIL", reason: "profile_content_readback_count_mismatch" };
}

function runTurnTargetSelfCheck(logicalTurnId: string) {
  const operationId = diagnosticId("target-preparation");
  const targetText = [
    "岗位职责 Responsibilities：负责跨团队交付、TypeScript 平台建设与质量闭环。",
    "任职要求 Requirements：熟悉 TypeScript、React、测试和证据链。",
    "补充信息：",
    "x".repeat(260),
  ].join("\n");
  const capturedAt = new Date().toISOString();
  const initial = AgentTaskStateSchema.parse({
    rootGoal: "conversation",
    workflowId: "conversation",
    stage: "collecting_intent",
    completionType: "conversational",
    updatedAt: capturedAt
  });
  const reducer = new AgentTaskStateReducer();
  const task = reducer.reduce(initial, {
    type: "new_root_task",
    goal: "generate_job_specific_resume",
    workflowId: "tailor_resume",
    stage: "choose_resume_source"
  });
  const withMessage = reducer.reduce(task, {
    type: "user_message",
    message: targetText,
    sessionId: `diagnostic-session-${logicalTurnId}`,
    turnId: logicalTurnId,
    capturedAt
  });
  const target = withMessage.knownSlots.turnTargetContext ?? withMessage.knownSlots.turnScopedTargetContext;
  const targetContext = target && typeof target === "object" && !Array.isArray(target)
    ? target as ReturnType<typeof createTurnScopedTargetContext>
    : undefined;
  const context: CareerToolExecutionContext = {
    operationId,
    logicalTurnId,
    logicalToolOperationId: diagnosticId("target-tool"),
    authoritativeTaskState: withMessage,
    ...(targetContext ? { turnTargetContext: targetContext } : {})
  };
  try {
    const prepared = prepareCareerWorkflowInvocation(
      "career.workflow.tailor_resume",
      { profileId: "diagnostic-profile", sourceResumeId: "diagnostic-resume" },
      context,
      operationId
    );
    const preparedInput = prepared.input as Record<string, unknown>;
    const injected = preparedInput.targetText === targetText;
    const sameTurn = preparedInput.targetContextId === targetContext?.targetContextId
      && prepared.context.logicalTurnId === logicalTurnId;
    return {
      check: injected && sameTurn
        ? { status: "PASS" as const, details: { targetInjected: true, sameLogicalTurnId: true, historicalFallback: false, schemaAccepted: true } }
        : { status: "FAIL" as const, reason: injected ? "turn_target_identity_mismatch" : "turn_target_not_injected" },
      targetContextId: targetContext?.targetContextId
    };
  } catch {
    return { check: { status: "FAIL" as const, reason: "turn_target_schema_failure" }, targetContextId: targetContext?.targetContextId };
  }
}

function workflowCheckpointInvariant(state?: AgentTaskState): CoreClosureCheck {
  if (!state) return { status: "NOT_APPLICABLE", reason: "no_active_task" };
  const waiting = state.completionStatus === "waiting_for_user" || state.completionStatus === "waiting_for_confirmation";
  const stored = state.workflowUserInputCheckpoint;
  const derived = deriveWorkflowUserInputCheckpoint(state);
  if (waiting && !stored) return { status: "FAIL", reason: "waiting_without_checkpoint" };
  if (!waiting && stored) return { status: "FAIL", reason: "checkpoint_outside_waiting_state" };
  if (waiting && !derived) return { status: "FAIL", reason: "waiting_checkpoint_not_derivable" };
  if (stored && derived && (
    stored.checkpointId !== derived.checkpointId
    || stored.kind !== derived.kind
    || stored.workflowId !== derived.workflowId
    || stored.stage !== derived.stage
  )) return { status: "FAIL", reason: "checkpoint_projection_mismatch" };
  return { status: "PASS", details: { waiting, checkpointCount: stored ? 1 : 0, supportedKinds: true } };
}

async function runBrowserMcpRoundTrip(input: {
  profile: CareerProfile;
  activeContext: NonNullable<Awaited<ReturnType<WorkspaceRepository["getActiveCareerContext"]>>>;
  runId: string;
  logicalTurnId: string;
  logicalToolOperationId: string;
  fetcher: typeof fetch;
}) {
  const operationId = `${input.runId}:browser-profile-read`;
  const binding = {
    personId: input.profile.personId!,
    profileId: input.profile.id,
    profileVersionNumber: input.profile.profileVersionNumber ?? 1,
    profileRevision: input.profile.version,
    agentSessionId: `${input.runId}:session`
  };
  const requestBody = {
    jsonrpc: "2.0",
    id: `${input.runId}:mcp-request`,
    method: "tools/call",
    params: {
      name: "career.profile.get",
      arguments: { profileId: input.profile.id },
      _meta: {
        "careeradapt/operationId": operationId,
        "careeradapt/logicalToolOperationId": input.logicalToolOperationId,
        "careeradapt/logicalTurnId": input.logicalTurnId,
        "careeradapt/agentSessionId": binding.agentSessionId,
        "careeradapt/sessionBinding": binding
      }
    }
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await input.fetcher("/api/agent/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
      cache: "no-store",
      signal: controller.signal
    });
    const envelope = await response.json() as unknown;
    const result = record(record(envelope).result);
    const structured = record(result.structuredContent);
    const payload = structured;
    const diagnostics = record(payload.diagnostics);
    const trace = record(diagnostics.mcpCallTrace);
    const responseTrace = record(diagnostics.mcpResponseTrace);
    const returnedMeta = record(result._meta);
    const returnedProfile = record(record(payload.data).profile);
    const observedIds = [
      input.logicalToolOperationId,
      typeof trace.logicalToolOperationId === "string" ? trace.logicalToolOperationId : undefined,
      typeof returnedMeta["careeradapt/logicalToolOperationId"] === "string" ? returnedMeta["careeradapt/logicalToolOperationId"] : undefined
    ].filter((value): value is string => Boolean(value));
    const correlation = observedIds.length >= 3 && observedIds.every((value) => value === input.logicalToolOperationId);
    const roundTrip = Boolean(response.ok)
      && payload.ok === true
      && returnedProfile.id === input.profile.id
      && trace.browserMcpHandlerReached === true
      && trace.gatewayReached === true
      && responseTrace.responseSerialized === true
      && responseTrace.responseEnvelopeValid === true
      && responseTrace.responseSent === true;
    const safeDetails = {
      operationId,
      logicalToolOperationId: input.logicalToolOperationId,
      browserMcpHandlerReached: trace.browserMcpHandlerReached === true,
      gatewayReached: trace.gatewayReached === true,
      responseSerialized: responseTrace.responseSerialized === true,
      responseEnvelopeValid: responseTrace.responseEnvelopeValid === true,
      responseSent: responseTrace.responseSent === true,
      resultProfileId: typeof returnedProfile.id === "string" ? returnedProfile.id : undefined,
      resultProfileRevision: typeof returnedProfile.version === "number" ? returnedProfile.version : undefined
    } satisfies Record<string, unknown>;
    return {
      check: roundTrip
        ? { status: "PASS" as const, details: safeDetails }
        : { status: "FAIL" as const, reason: response.ok ? "browser_mcp_roundtrip_incomplete" : "browser_mcp_http_failed", details: safeDetails },
      correlationCheck: correlation
        ? { status: "PASS" as const, details: { observedStageCount: observedIds.length, logicalToolOperationId: input.logicalToolOperationId } }
        : { status: "FAIL" as const, reason: "logical_tool_operation_id_mismatch", details: { observedStageCount: observedIds.length, logicalToolOperationId: input.logicalToolOperationId } }
    };
  } catch (error) {
    return {
      check: { status: "FAIL" as const, reason: error instanceof DOMException && error.name === "AbortError" ? "browser_mcp_timeout" : "browser_mcp_transport_failed" },
      correlationCheck: { status: "FAIL" as const, reason: "logical_tool_operation_id_not_observed" }
    };
  } finally {
    clearTimeout(timeout);
  }
}

function workflowDiagnostics(session?: AgentSession) {
  const task = session?.taskState;
  const checkpoint = task?.workflowUserInputCheckpoint;
  return {
    ...(session?.id ? { activeSessionId: session.id } : {}),
    ...(session?.activeTurn?.id ? { activeTurnId: session.activeTurn.id } : {}),
    ...(session?.hermesRun?.runId ? { runId: session.hermesRun.runId } : {}),
    checkpointSequence: checkpoint ? [{
      checkpointId: checkpoint.checkpointId,
      kind: checkpoint.kind,
      revision: checkpoint.revision,
      stage: checkpoint.stage,
      ...(session?.activeTurn?.id ? { turnId: session.activeTurn.id } : {})
    }] : [],
    stageSequence: (session?.turnCheckpoints ?? []).map((item) => ({
      ...(item.turnId ? { turnId: item.turnId } : {}),
      workflowId: item.taskStateAfter?.workflowId ?? item.taskStateBefore.workflowId,
      stage: item.taskStateAfter?.stage ?? item.taskStateBefore.stage,
      completionStatus: item.taskStateAfter?.completionStatus ?? item.taskStateBefore.completionStatus
    }))
  };
}

function diagnosticId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
