"use client";

import { History, Pause, Play, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  getAgentSessionDisplayTitle,
  type AgentMessage,
  type AgentMessageReference,
  type AgentSession
} from "@/agent/contracts/agentSession";
import type { AgentArtifactAction, AgentOption, AgentUiAction, AgentWorkflowControl } from "@/agent/contracts/agentActions";
import { createQuickActionIntent, type AgentQuickActionId } from "@/agent/contracts/agentQuickAction";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import type { TailorWorkflowViewState } from "@/agent/workflows/tailorExistingResumeWorkflow";
import { useAgentHost } from "@/components/agent/runtime/AgentRuntimeProvider";
import {
  ACTIVE_SESSION_KEY,
  NEW_TASK_SESSION_VALUE
} from "@/components/agent/shell/AgentSidebar";
import { AgentArtifactDrawer, type AgentArtifactDrawerState } from "./artifacts/AgentArtifactDrawer";
import { AgentComposer, type ComposerAttachmentDraft, type ComposerSubmit } from "./AgentComposer";
import { AgentConversationTimeline, normalizeAgentMessageText } from "./AgentConversation";
import { activeBranchMessages } from "@/agent/runtime/activeBranchContext";
import { AgentHistoryDialog } from "./AgentHistoryDialog";
import { AgentZeroState } from "./workspace/AgentZeroState";
import { AgentWorkspaceLayout } from "./workspace/AgentWorkspaceLayout";
import { ImportReviewDialog } from "@/components/resume/import/ImportReviewDialog";
import { ResumeImportWizard } from "@/components/resume/import/ResumeImportWizard";
import { WorkspaceRepository } from "@/services/storage/repositories";
import type { CareerProfile } from "@/domain/schemas";
import { ProfileIntakeReviewProjectionSchema } from "@/domain/profileIntake/ProfileIntakeReviewProjection";
import {
  readResumeImportSemanticPreference,
  writeResumeImportSemanticPreference
} from "@/services/preferences/resumeImportAi";
import type { ActiveCareerContext } from "@/domain/schemas";
import { CareerContextSelector } from "@/components/career/CareerContextSelector";
import { notify } from "@/services/notifications/store";
import {
  openHermesLogs,
  getHermesLogs,
  requestHermesRecover,
  requestHermesRestart,
  requestHermesStop
} from "@/services/agent/hermesControl";
import { agentAttachmentStore, type AgentAttachmentRef } from "@/services/agent/AgentAttachmentStore";
import { allowedToolManifestForStep } from "@/agent/workflows/workflowRegistry";
import { agentToolNames } from "@/agent/tools/registry";
import { HermesCareerToolCatalog, hermesProductionToolNames } from "@/agent/runtime/hermes/HermesCareerToolCatalog";
import { isRoadshowReady } from "@/agent/runtime/runtimeHealth";
import { createRunStopReason } from "@/agent/runtime/hermes/hermesIncidentTrace";
import { getActiveTailoringQuestionProjection } from "@/agent/runtime/AgentHostStore";
import { buildProfileContentIntegrity } from "@/domain/profile/profileContentIntegrity";

type ResumeSummary = { id: string; profileId: string; name: string; purpose: string; revision: number };
type SessionComposerDrafts = Record<string, string>;
type SessionComposerAttachments = Record<string, ComposerAttachmentDraft[]>;
type PendingContextRequest = {
  context: ActiveCareerContext;
  resolve: (allowed: boolean) => void;
};

const AGENT_COMPOSER_DRAFTS_KEY = "careerad-agent-composer-drafts:v1";
const AGENT_ARTIFACT_STATE_KEY = "careerad-agent-artifact-state:v1";
const agentImportRepository = new WorkspaceRepository();

function isWorkflowControlAction(action: AgentUiAction | AgentWorkflowControl): action is AgentWorkflowControl {
  return ["start_workflow", "switch_workflow", "pause_workflow", "resume_workflow", "cancel_workflow", "go_back"].includes(action.type);
}

function isPresentationOptionAction(action: AgentOption["action"]) {
  return action.type.startsWith("open_")
    || action.type === "select_tailoring_question"
    || action.type === "profile_intake_section_select";
}

export function AgentWorkspace() {
  const host = useAgentHost();
  const snapshot = useSyncExternalStore(host.state.subscribe, host.state.getSnapshot, host.state.getSnapshot);
  const runtimeStatus = useSyncExternalStore(host.runtimeStatus.subscribe, host.runtimeStatus.getSnapshot, host.runtimeStatus.getSnapshot);
  const [session, setSession] = useState<AgentSession>(() =>
    snapshot.activeSession ?? AgentRuntime.create("agent_quick_action", "collecting_intent", "AI 求职任务")
  );
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [resumes, setResumes] = useState<ResumeSummary[]>([]);
  const [profiles, setProfiles] = useState<CareerProfile[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [drawerState, setDrawerState] = useState<AgentArtifactDrawerState>(() => {
    if (typeof window === "undefined") return "split";
    const stored = window.localStorage.getItem(AGENT_ARTIFACT_STATE_KEY);
    const compact = window.matchMedia("(max-width: 860px)").matches;
    if (stored === "pinned") return "split";
    if (stored === "open") return compact ? "overlay" : "split";
    return stored === "closed" || stored === "split" || stored === "overlay" || stored === "collapsed"
      ? stored
      : compact ? "overlay" : "split";
  });
  const [draftsBySession, setDraftsBySession] = useState<SessionComposerDrafts>(readSessionComposerDrafts);
  const draftsBySessionRef = useRef(draftsBySession);
  const mountedRef = useRef(true);
  const userInteractedRef = useRef(false);
  const restoreRequestRef = useRef(0);
  const reattachedHermesRunsRef = useRef(new Set<string>());
  const [draftReferencesBySession, setDraftReferencesBySession] = useState<Record<string, AgentMessageReference | undefined>>({});
  const [lastUserMessage, setLastUserMessage] = useState("");
  const [floatingAction, setFloatingAction] = useState<AgentUiAction>();
  const [uploadFocusSignal, setUploadFocusSignal] = useState(0);
  const [attachmentsBySession, setAttachmentsBySession] = useState<SessionComposerAttachments>({});
  const [pendingResumeImportAttachmentId, setPendingResumeImportAttachmentId] = useState<string>();
  const [pendingHermesAttachmentTurn, setPendingHermesAttachmentTurn] = useState<{
    sessionId: string;
    text: string;
    attachments: AgentAttachmentRef[];
  }>();
  const [pendingContextRequest, setPendingContextRequest] = useState<PendingContextRequest>();
  const quickActionDispatchRef = useRef<Promise<AgentSession | undefined> | undefined>(undefined);
  const running = snapshot.turnStatus === "running";
  const workflowCheckpoint = session.taskState?.workflowUserInputCheckpoint;
  const checkpointTurnStatus = workflowCheckpoint
    ? session.taskState?.completionStatus === "waiting_for_confirmation"
      ? "waiting_for_confirmation" as const
      : "waiting_for_user" as const
    : snapshot.turnStatus;
  const liveHermesRun = ["queued", "running", "waiting_for_approval", "stopping"].includes(session.hermesRun?.status ?? "");
  const paused = snapshot.turnStatus === "paused";
  const draft = draftsBySession[session.id] ?? "";
  const draftReference = draftReferencesBySession[session.id];
  const attachments = attachmentsBySession[session.id] ?? [];
  const intakeProjectionResult = ProfileIntakeReviewProjectionSchema.safeParse(session.taskState?.knownSlots.profileIntakeReviewProjection);
  const intakeProjection = intakeProjectionResult.success ? intakeProjectionResult.data : undefined;
  const intakeCandidates = intakeProjection?.candidates
    ?? (Array.isArray(session.taskState?.knownSlots.intakeCandidates) ? session.taskState.knownSlots.intakeCandidates : []);
  const canFinishIntake = session.taskState?.workflowId === "guided_profile_intake"
    && ["collect_experience", "review_facts"].includes(session.taskState.stage)
    && ["collecting", "clarifying", undefined].includes(
      typeof session.taskState.knownSlots.profileIntakePhase === "string"
        ? session.taskState.knownSlots.profileIntakePhase
        : undefined
    )
    && intakeCandidates.some((candidate) => {
      const item = candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? candidate as Record<string, unknown>
        : {};
      return item.status !== "failed" && item.decision !== "reject" && item.included !== false;
    });

  const updateDrawerState = useCallback((next: AgentArtifactDrawerState) => {
    setDrawerState(next);
    window.localStorage.setItem(AGENT_ARTIFACT_STATE_KEY, next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 860px)");
    const normalize = () => setDrawerState((current) => {
      if (current === "split" && media.matches) return "overlay";
      if (current === "overlay" && !media.matches) return "split";
      return current;
    });
    media.addEventListener("change", normalize);
    return () => media.removeEventListener("change", normalize);
  }, []);

  const setSessionDraft = useCallback((value: string) => {
    userInteractedRef.current = true;
    const next = { ...draftsBySessionRef.current };
    if (value) next[session.id] = value;
    else delete next[session.id];
    draftsBySessionRef.current = next;
    setDraftsBySession(next);
    persistSessionComposerDrafts(next);
  }, [session.id]);

  const setSessionDraftReference = useCallback((reference?: AgentMessageReference) => {
    setDraftReferencesBySession((current) => {
      const next = { ...current };
      if (reference) next[session.id] = reference;
      else delete next[session.id];
      return next;
    });
  }, [session.id]);

  const setSessionAttachments = useCallback((updater: (current: ComposerAttachmentDraft[]) => ComposerAttachmentDraft[]) => {
    setAttachmentsBySession((current) => ({ ...current, [session.id]: updater(current[session.id] ?? []) }));
  }, [session.id]);

  const stageComposerFiles = useCallback((files: File[]) => {
    // Selecting or dropping a file is a user interaction in its own right.
    // Mark it before mutating the draft so the initial session hydration cannot
    // replace the session and strand the staged chips under another ID.
    userInteractedRef.current = true;
    restoreRequestRef.current += 1;
    window.localStorage.setItem(ACTIVE_SESSION_KEY, session.id);
    setSessionAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        clientId: `composer-file-${crypto.randomUUID()}`,
        file,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        status: "staged" as const
      }))
    ]);
  }, [session.id, setSessionAttachments]);

  const removeComposerAttachment = useCallback((clientId: string) => {
    setSessionAttachments((current) => current.filter((attachment) => attachment.clientId !== clientId));
  }, [setSessionAttachments]);

  const pageContext = useCallback(() => ({
    pathname: window.location.pathname,
    route: window.location.pathname,
    title: "AI 工作台",
    activeProfileId: session.activeProfileId,
    activeResumeId: session.activeResumeId,
    activeJobId: session.activeJobId,
    query: {}
  }), [session.activeJobId, session.activeProfileId, session.activeResumeId]);

  const taskHasUsedAssetsOrWrites = Boolean(
    session.artifactRefs.length
    || session.taskState?.attachment
    || session.messages.some((message) => message.role === "tool" || message.metadata?.writeOperationId)
    || session.activeTurn?.status === "running"
  );

  const submitComposer = useCallback(async (input: ComposerSubmit) => {
    userInteractedRef.current = true;
    restoreRequestRef.current += 1;
    setLastUserMessage(input.text);
    // A quick card may still be finishing its deterministic context read when
    // the user starts typing. Wait for that boundary so the reply cannot race
    // against the card result or be sent with the pre-card task state.
    const pendingQuickAction = quickActionDispatchRef.current;
    if (pendingQuickAction) await pendingQuickAction.catch(() => undefined);
    const liveSession = host.state.getSnapshot().activeSession;
    const submitSession = liveSession?.id === session.id ? liveSession : session;
    window.localStorage.setItem(ACTIVE_SESSION_KEY, submitSession.id);
    setSessionAttachments((current) => current.map((attachment) => ({ ...attachment, status: "registering" as const, errorCode: undefined })));
    // Clear the controlled composer immediately after the submit event. Host
    // execution may continue streaming for a while; the sent instruction must
    // not remain visually editable during that period.
    setSessionDraft("");
    const registeredAttachments: AgentAttachmentRef[] = [];
    try {
      const hermesAttachmentRequested = input.attachments.length > 0
        && runtimeStatus.preferredRuntime === "hermes";
      if (hermesAttachmentRequested && (runtimeStatus.status !== "ready" || !runtimeStatus.health || !isRoadshowReady(runtimeStatus.health))) {
        throw Object.assign(new Error("Hermes 尚未准备好接收附件。"), { code: "hermes_attachment_runtime_not_ready" });
      }
      const hermesAttachmentTurn = hermesAttachmentRequested;
      if (hermesAttachmentTurn) {
        for (const attachment of input.attachments) {
          registeredAttachments.push(await agentAttachmentStore.register(attachment.file));
        }
        if (readResumeImportSemanticPreference() === "unset" && registeredAttachments.some((attachment) => attachment.mimeType !== "application/json")) {
          setPendingHermesAttachmentTurn({ sessionId: submitSession.id, text: input.text, attachments: registeredAttachments });
          setPendingResumeImportAttachmentId(registeredAttachments[0]?.id);
          setAttachmentsBySession((current) => ({ ...current, [submitSession.id]: [] }));
          return;
        }
      }
      const tailoringQuestionAnswer = input.attachments.length === 0
        && Boolean(input.text.trim())
        && Boolean(getActiveTailoringQuestionProjection(submitSession));
      const result = tailoringQuestionAnswer
        ? await host.runUserEvent(
            { type: "text_message", text: input.text },
            { session: submitSession, pageContext: pageContext() }
          )
        : (input.attachments.length === 0 && input.text.trim()) || hermesAttachmentTurn
        ? await host.runTurn({
            sessionId: submitSession.id,
            userMessage: input.text,
            pageContext: pageContext(),
            session: submitSession,
            attachments: registeredAttachments.map((attachment) => ({
              id: attachment.id,
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
              size: attachment.size,
              purpose: submitSession.taskState?.workflowId === "resume_import" ? "resume_import" : "career_evidence"
            }))
          })
        : await host.state.dispatch(
            { type: "composer_submit", text: input.text || undefined, files: input.attachments.map((attachment) => attachment.file) },
            { session: submitSession, pageContext: pageContext() }
          );
      if (!result) throw new Error("composer_turn_not_accepted");
      if (!["queued", "running", "waiting_for_approval", "stopping"].includes(result.hermesRun?.status ?? "completed")) {
        agentAttachmentStore.releaseMany(registeredAttachments.filter((attachment) => agentAttachmentStore.has(attachment.id)).map((attachment) => attachment.id));
      }
      setAttachmentsBySession((current) => ({ ...current, [session.id]: [] }));
      setSessionDraftReference(undefined);
      setSession(result);
      window.localStorage.setItem(ACTIVE_SESSION_KEY, result.id);
      window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));
    } catch (error) {
      agentAttachmentStore.releaseMany(registeredAttachments.map((attachment) => attachment.id));
      const errorCode = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "composer_submit_failed";
      setSessionDraft(input.text);
      setSessionAttachments((current) => current.map((attachment) => ({ ...attachment, status: "failed" as const, errorCode })));
      notify({
        type: "error",
        title: input.attachments.length ? "附件发送失败" : "消息发送失败",
        message: input.attachments.length ? "附件仍保留在编辑区，可以重试或移除。" : "消息仍保留在编辑区，可以重试。"
      });
    }
  }, [host, pageContext, runtimeStatus.health, runtimeStatus.preferredRuntime, runtimeStatus.status, session, setSessionAttachments, setSessionDraft, setSessionDraftReference]);

  const handleBeforeContextSelect = useCallback(async (next: ActiveCareerContext) => {
    if (!taskHasUsedAssetsOrWrites) {
      if (session.personId !== next.personId || session.activeProfileId !== next.profileId) {
        const rebound = await host.state.rebindSessionCareerContext(session.id, next, true);
        setSession(rebound);
      }
      return true;
    }
    return new Promise<boolean>((resolve) => {
      setPendingContextRequest({ context: next, resolve });
    });
  }, [host.state, session.activeProfileId, session.id, session.personId, taskHasUsedAssetsOrWrites]);

  const resolvePendingContextRequest = useCallback(async (action: "new_task" | "switch" | "cancel") => {
    const pending = pendingContextRequest;
    if (!pending) return;
    if (action === "new_task") {
      const created = AgentRuntime.create("agent_quick_action", "collecting_intent", "新的 AI 任务", pending.context);
      const saved = await host.state.adoptDurably(created);
      if (saved) {
        setSession(saved);
        window.localStorage.setItem(ACTIVE_SESSION_KEY, saved.id);
      }
      setDrawerState("closed");
    } else if (action === "switch") {
      const rebound = await host.state.rebindSessionCareerContext(session.id, pending.context, true);
      setSession(rebound);
    }
    setPendingContextRequest(undefined);
    pending.resolve(action !== "cancel");
  }, [host.state, pendingContextRequest, session.id]);

  useEffect(() => host.state.subscribe(() => {
    const current = host.state.getSnapshot();
    const stagedAttachments = attachmentsBySession[session.id] ?? [];
    // Initial repository hydration can publish an older active session after
    // the user has already selected a file. Do not strand that staged File by
    // switching the controlled composer to another session mid-interaction.
    if (current.activeSession && (current.activeSession.id === session.id || !stagedAttachments.length)) {
      setSession(current.activeSession);
    }
    if (current.uiAction) {
      if (current.uiAction.type === "open_artifact") updateDrawerState(window.matchMedia("(max-width: 860px)").matches ? "overlay" : "split");
      else if (current.uiAction.type === "open_resume_upload") setUploadFocusSignal((value) => value + 1);
      else if (current.uiAction.type === "request_resume_import_consent") setPendingResumeImportAttachmentId(current.uiAction.attachmentId);
      else setFloatingAction(current.uiAction);
      host.state.clearUiAction();
    }
  }), [attachmentsBySession, host.state, session.id, updateDrawerState]);

  useEffect(() => {
    const handleBackgroundCompletion = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; title?: string; status?: string }>).detail;
      if (!detail.sessionId || detail.sessionId === session.id) return;
      notify({
        type: detail.status === "failed" ? "warning" : "info",
        title: detail.status === "failed" ? "后台任务需要处理" : "后台任务已完成",
        message: detail.title ? `“${detail.title}”已更新，可从任务列表打开。` : "后台任务状态已更新，可从任务列表打开。"
      });
      void host.store.list().then(setSessions);
    };
    window.addEventListener("careeradapt-agent-background-complete", handleBackgroundCompletion);
    return () => window.removeEventListener("careeradapt-agent-background-complete", handleBackgroundCompletion);
  }, [host.store, session.id]);

  useEffect(() => {
    let active = true;
    const refreshCareerContext = async () => {
      const [nextProfiles, nextContext] = await Promise.all([
        agentImportRepository.listProfiles(),
        agentImportRepository.getActiveCareerContext()
      ]);
      if (!active) return;
      setProfiles(nextProfiles);
      if (!nextContext || taskHasUsedAssetsOrWrites) return;
      const current = host.state.getSnapshot().activeSession ?? session;
      if (current.id !== session.id || (current.personId === nextContext.personId && current.activeProfileId === nextContext.profileId)) return;
      const rebound = await host.state.rebindSessionCareerContext(current.id, nextContext, true);
      if (active) setSession(rebound);
    };
    const listener = () => { void refreshCareerContext(); };
    window.addEventListener("careeradapt-career-context-change", listener);
    return () => {
      active = false;
      window.removeEventListener("careeradapt-career-context-change", listener);
    };
  }, [host.state, session, session.id, taskHasUsedAssetsOrWrites]);

  const restoreSession = useCallback((selected: AgentSession | string, options: { initial?: boolean } = {}) => {
    if (!options.initial) userInteractedRef.current = true;
    const requestId = ++restoreRequestRef.current;
    const selectedId = typeof selected === "string" ? selected : selected.id;
    const apply = (resolved?: AgentSession) => {
      if (requestId !== restoreRequestRef.current || !resolved) return;
      host.state.adopt(resolved);
      setPendingResumeImportAttachmentId(undefined);
      setSession(host.state.getSnapshot().activeSession ?? resolved);
      setHistoryOpen(false);
      window.localStorage.setItem(ACTIVE_SESSION_KEY, resolved.id);
    };
    if (typeof selected !== "string") {
      apply(selected);
      return;
    }
    void host.store.get(selectedId).then(apply).catch(() => undefined);
  }, [host.state, host.store]);

  const createSessionWithCurrentContext = useCallback(async (title: string, options: { allowAfterInteraction?: boolean } = {}) => {
    const context = await agentImportRepository.getActiveCareerContext();
    if (!mountedRef.current || (!options.allowAfterInteraction && userInteractedRef.current)) return undefined;
    const created = AgentRuntime.create("agent_quick_action", "collecting_intent", title, context);
    const saved = await host.state.adoptDurably(created);
    if (!saved) return undefined;
    setSession(saved);
    window.localStorage.setItem(ACTIVE_SESSION_KEY, saved.id);
    return saved;
  }, [host.state]);

  useEffect(() => {
    let active = true;
    const requested = window.localStorage.getItem(ACTIVE_SESSION_KEY);
    const requestedSession = requested && requested !== NEW_TASK_SESSION_VALUE
      ? host.store.get(requested).catch(() => undefined)
      : Promise.resolve(undefined);
    void Promise.all([
      host.executor.execute({
        toolName: "list_resumes",
        toolInput: {},
        operationId: `list-resumes-${crypto.randomUUID()}`
      }),
      host.store.list(),
      agentImportRepository.listProfiles(),
      agentImportRepository.getActiveCareerContext(),
      requestedSession
    ]).then(async ([resumeResult, storedSessions, storedProfiles, activeContext, requestedStoredSession]) => {
      if (!active) return;
      setResumes(readArray(resumeResult.data, "resumes") as ResumeSummary[]);
      setSessions(storedSessions);
      setProfiles(storedProfiles);
      if (userInteractedRef.current) return;
      const live = host.state.getSnapshot();
      if (
        activeContext
        && live.activeSession
        && (!requested || requested === live.activeSession.id)
        && !live.activeSession.activeProfileId
        && !live.activeSession.messages.length
        && !live.activeSession.artifactRefs.length
      ) {
        const rebound = await host.state.rebindSessionCareerContext(live.activeSession.id, activeContext, true);
        if (!active) return;
        setSession(rebound);
        window.localStorage.setItem(ACTIVE_SESSION_KEY, rebound.id);
        return;
      }
      if (live.activeSession && live.turnStatus === "running" && (!requested || requested === live.activeSession.id)) {
        setSession(live.activeSession);
        window.localStorage.setItem(ACTIVE_SESSION_KEY, live.activeSession.id);
        return;
      }
      if (requested === NEW_TASK_SESSION_VALUE) {
        await createSessionWithCurrentContext("新的 AI 任务", { allowAfterInteraction: true });
        return;
      }
      const restored = requestedStoredSession ?? storedSessions.find((item) => item.id === requested) ?? storedSessions[0];
      if (restored) {
        if (
          activeContext
          && !restored.activeProfileId
          && !restored.messages.length
          && !restored.artifactRefs.length
          && restored.activeTurn?.status !== "running"
        ) {
          const rebound = await host.state.rebindSessionCareerContext(restored.id, activeContext, true);
          if (!active) return;
          setSessions((current) => current.map((item) => item.id === rebound.id ? rebound : item));
          setSession(rebound);
        } else {
          restoreSession(restored, { initial: true });
        }
      } else await createSessionWithCurrentContext("AI 求职任务");
    });
    return () => { active = false; };
  }, [createSessionWithCurrentContext, host.executor, host.state, host.store, restoreSession]);

  useEffect(() => {
    const run = session.hermesRun;
    if (!run || !["queued", "running", "waiting_for_approval", "stopping"].includes(run.status)) return;
    if (runtimeStatus.activeRuntime !== "hermes" || runtimeStatus.status !== "ready") return;
    if (reattachedHermesRunsRef.current.has(run.runId)) return;
    reattachedHermesRunsRef.current.add(run.runId);
    void host.runTurn({
      sessionId: session.id,
      userMessage: "",
      pageContext: pageContext(),
      session,
      metadata: { reattachRunId: run.runId }
    }).then((result) => {
      if (result) setSession(result);
    }).catch(() => {
      reattachedHermesRunsRef.current.delete(run.runId);
    });
  }, [host, pageContext, runtimeStatus.activeRuntime, runtimeStatus.status, session]);

  useEffect(() => {
    const selectSession = (event: Event) => {
      const id = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
      if (id) void restoreSession(id);
    };
    const newTask = () => {
      userInteractedRef.current = true;
      restoreRequestRef.current += 1;
      void createSessionWithCurrentContext("新的 AI 任务", { allowAfterInteraction: true });
      setPendingResumeImportAttachmentId(undefined);
      setDrawerState("closed");
    };
    const openHistory = () => void host.store.list().then((items) => {
      setSessions(items);
      setHistoryOpen(true);
    });
    window.addEventListener("careeradapt-agent-session-select", selectSession);
    window.addEventListener("careeradapt-agent-new-task", newTask);
    window.addEventListener("careeradapt-agent-history-open", openHistory);
    return () => {
      window.removeEventListener("careeradapt-agent-session-select", selectSession);
      window.removeEventListener("careeradapt-agent-new-task", newTask);
      window.removeEventListener("careeradapt-agent-history-open", openHistory);
    };
  }, [createSessionWithCurrentContext, host.store, restoreSession]);

  async function dispatchMessage(text: string) {
    userInteractedRef.current = true;
    restoreRequestRef.current += 1;
    setLastUserMessage(text);
    window.localStorage.setItem(ACTIVE_SESSION_KEY, session.id);
    const result = await host.runUserEvent({
      type: "text_message",
      text,
      references: draftReference ? [draftReference] : undefined
    }, {
      session,
      pageContext: pageContext()
    });
    if (result) {
      setSessionDraftReference(undefined);
      setSession(result);
      window.localStorage.setItem(ACTIVE_SESSION_KEY, result.id);
      window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));
    }
  }

  function dispatchUi(action: AgentUiAction | AgentWorkflowControl) {
    if (isWorkflowControlAction(action)) {
      void host.runUserEvent({ type: "workflow_control", action }, { session, pageContext: pageContext() });
      return;
    }
    void host.state.dispatch({ type: "ui_control", action }, { session, pageContext: pageContext() });
  }

  function dispatchArtifactAction(action: AgentArtifactAction) {
    return host.runUserEvent({ type: "artifact_action", action }, { session, pageContext: pageContext() }).then((result) => {
      if (!result) return;
      setSession(result);
      window.localStorage.setItem(ACTIVE_SESSION_KEY, result.id);
      window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));
      return result;
    });
  }

  function dispatchQuickAction(actionId: AgentQuickActionId) {
    userInteractedRef.current = true;
    restoreRequestRef.current += 1;
    const intent = createQuickActionIntent(actionId);
    setLastUserMessage(intent.intent);
    const pending = host.runUserEvent({
      type: "quick_action_started",
      actionId: intent.actionId,
      text: intent.intent,
      task: intent.task
    }, { session, pageContext: pageContext() });
    quickActionDispatchRef.current = pending;
    void pending.then((result) => {
      if (!result) return;
      setSession(result);
      window.localStorage.setItem(ACTIVE_SESSION_KEY, result.id);
      window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));
    }).finally(() => {
      if (quickActionDispatchRef.current === pending) quickActionDispatchRef.current = undefined;
    });
  }

  function dispatchOption(option: AgentOption) {
    userInteractedRef.current = true;
    restoreRequestRef.current += 1;
    window.localStorage.setItem(ACTIVE_SESSION_KEY, session.id);
    if (isPresentationOptionAction(option.action)) {
      void host.state.dispatch({ type: "option", action: option.action }, { session, pageContext: pageContext() });
      return;
    }
    const event = option.action.type === "select_entity"
      ? { type: "entity_selected" as const, action: option.action }
      : option.action.type === "retry_current_step"
        ? { type: "retry" as const, action: option.action }
        : { type: "option_selected" as const, optionId: option.id, action: option.action };
    void host.runUserEvent(event, { session, pageContext: pageContext() }).then((result) => {
      if (!result) return;
      setSession(result);
      window.localStorage.setItem(ACTIVE_SESSION_KEY, result.id);
      window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));
    });
  }

  const workflowView = useMemo(() => taskToWorkflowView(session), [session]);
  const pinnedProfile = profiles.find((profile) => profile.id === session.activeProfileId);
  const pinnedContextLabel = pinnedProfile
    ? `${pinnedProfile.name} · V${pinnedProfile.profileVersionNumber ?? 1}`
    : session.personId && session.profileVersionNumber
      ? `人物已固定 · V${session.profileVersionNumber}`
      : undefined;
  const artifacts = snapshot.activeSessionId === session.id ? snapshot.artifacts : session.artifactRefs;
  const showZeroState = session.messages.length === 0 && !running;
  const intakeSession = session.taskState?.knownSlots.intakeSession;
  const hasAutosavedIntake = Boolean(
    intakeSession && typeof intakeSession === "object" && !Array.isArray(intakeSession)
      && typeof (intakeSession as Record<string, unknown>).autosavedAt === "string"
  );
  const exportTechnicalDiagnostics = useCallback(async () => {
    const sourceTurns = await host.store.listProfileIntakeSourceTurns(session.id);
    const task = session.taskState;
    const slots = task?.knownSlots ?? {};
    const recordValue = (value: unknown): Record<string, unknown> =>
      value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const latestAssistant = session.messages.findLast((message) =>
      message.role === "assistant"
      && message.metadata?.retracted !== true
      && message.kind !== "assistant_thinking"
      && message.kind !== "assistant_streaming"
      && message.status !== "thinking"
      && message.status !== "streaming"
    );
    const workflowDefinition = task
      ? allowedToolManifestForStep(task.workflowId, task.stage, agentToolNames.map((name) => ({ name })))
      : [];
    const toolActivities = session.messages
      .filter((message) => message.role === "tool" && message.toolName)
      .map((message) => ({
        toolName: message.toolName,
        status: message.status,
        safeErrorCode: typeof message.metadata?.safeErrorCode === "string" ? message.metadata.safeErrorCode : undefined,
        operationId: message.operationId,
        logicalToolOperationId: typeof message.metadata?.logicalToolOperationId === "string" ? message.metadata.logicalToolOperationId : undefined,
        transportOperationIds: Array.isArray(message.metadata?.transportOperationIds)
          ? message.metadata.transportOperationIds.filter((value): value is string => typeof value === "string")
          : undefined,
        requestedHermesToolName: typeof message.metadata?.requestedHermesToolName === "string" ? message.metadata.requestedHermesToolName : undefined,
        stableCareerToolName: typeof message.metadata?.stableCareerToolName === "string" ? message.metadata.stableCareerToolName : undefined
      }));
    const deniedActivity = toolActivities.findLast((activity) => activity.safeErrorCode === "agent_tool_not_allowed");
    const pendingInformationNeed = recordValue(slots.resumeCompositionPendingInformationNeed);
    const latestCheckpoint = session.turnCheckpoints.findLast((checkpoint) => checkpoint.completedAt ?? true);
    const safeCheckpoint = latestCheckpoint ? {
      turnId: latestCheckpoint.turnId,
      createdAt: latestCheckpoint.createdAt,
      completedAt: latestCheckpoint.completedAt,
      workflowBefore: {
        workflowId: latestCheckpoint.taskStateBefore.workflowId,
        rootGoal: latestCheckpoint.taskStateBefore.rootGoal,
        stage: latestCheckpoint.taskStateBefore.stage,
        completionStatus: latestCheckpoint.taskStateBefore.completionStatus,
        selectedEntities: latestCheckpoint.selectedEntitiesBefore
      },
      workflowAfter: latestCheckpoint.taskStateAfter ? {
        workflowId: latestCheckpoint.taskStateAfter.workflowId,
        rootGoal: latestCheckpoint.taskStateAfter.rootGoal,
        stage: latestCheckpoint.taskStateAfter.stage,
        completionStatus: latestCheckpoint.taskStateAfter.completionStatus,
        selectedEntities: latestCheckpoint.taskStateAfter.selectedEntities
      } : undefined
    } : undefined;
    const artifactFeedback = slots.artifactActionFeedback && typeof slots.artifactActionFeedback === "object" && !Array.isArray(slots.artifactActionFeedback)
      ? slots.artifactActionFeedback as Record<string, unknown>
      : undefined;
    const safeArtifactActionFeedback = artifactFeedback ? {
      actionType: artifactFeedback.actionType,
      id: artifactFeedback.id ?? artifactFeedback.entityId,
      operationId: artifactFeedback.operationId,
      hash: artifactFeedback.hash,
      safeErrorCode: artifactFeedback.safeErrorCode,
      fieldNames: Array.isArray(artifactFeedback.fieldNames) ? artifactFeedback.fieldNames : undefined,
      stage: artifactFeedback.stage,
      timestamp: artifactFeedback.timestamp ?? artifactFeedback.updatedAt,
      result: artifactFeedback.result,
      retryable: artifactFeedback.retryable
    } : undefined;
    const safeTaskState = task ? {
      workflowId: task.workflowId,
      stage: task.stage,
      completionStatus: task.completionStatus,
      updatedAt: task.updatedAt,
      selectedEntities: {
        profileId: task.selectedEntities.profileId,
        resumeId: task.selectedEntities.resumeId,
        jobId: task.selectedEntities.jobId,
        profileVersion: task.selectedEntities.profileVersion
      },
      knownSlots: {
        targetProfileId: slots.targetProfileId,
        intakeImportId: slots.intakeImportId,
        expectedIntakeDraftRevision: slots.expectedIntakeDraftRevision,
        expectedProfileVersion: slots.expectedProfileVersion,
        activeQuestionId: slots.activeQuestionId,
        profileIntakePhase: slots.profileIntakePhase,
        finalReviewRevision: slots.finalReviewRevision,
        artifactActionFeedback: safeArtifactActionFeedback
      }
    } : undefined;
    const activeQuestionProjection = getActiveTailoringQuestionProjection(session);
    const activeQuestionMessage = activeQuestionProjection
      ? session.messages.find((message) => message.id === activeQuestionProjection.messageId)
      : undefined;
    const pendingAnswer = session.messages.findLast((message) =>
      message.role === "user"
      && message.metadata?.answerPayload === true
      && ["queued", "running"].includes(String(message.metadata.executionState))
    );
    const clarificationState = activeQuestionProjection ? {
      questionPlanId: activeQuestionProjection.questionPlanId,
      questionPlanRevision: activeQuestionProjection.questionPlanRevision,
      activeQuestionId: activeQuestionProjection.questionId,
      activeQuestionProjected: Boolean(activeQuestionMessage && activeQuestionMessage.metadata?.tailoringQuestionProjection === true),
      activeQuestionMessageId: activeQuestionMessage?.id,
      taskCompletionStatus: task?.completionStatus,
      composerEnabled: !paused,
      composerBlockReason: paused ? "workflow_paused" : undefined,
      userAnswerPending: Boolean(pendingAnswer),
      lastAnswerTurnId: pendingAnswer?.turnId
    } : {
      questionPlanId: undefined,
      questionPlanRevision: undefined,
      activeQuestionId: undefined,
      activeQuestionProjected: false,
      activeQuestionMessageId: undefined,
      taskCompletionStatus: task?.completionStatus,
      composerEnabled: !paused,
      composerBlockReason: paused ? "workflow_paused" : undefined,
      userAnswerPending: false,
      lastAnswerTurnId: undefined
    };
    const careerContracts = host.careerToolGateway.listContracts();
    const careerCatalog = new HermesCareerToolCatalog(careerContracts);
    const workspaceRepository = host.store.getWorkspaceRepository();
    const diagnosticProfile = session.activeProfileId
      ? await workspaceRepository.getProfile(session.activeProfileId)
      : undefined;
    const diagnosticGeneralResume = diagnosticProfile
      ? (await workspaceRepository.listResumeBranches(diagnosticProfile.id)).find((branch) =>
          branch.branchPurpose === "general" && branch.lifecycleStatus === "active"
        )
      : undefined;
    const profileContentIntegrity = diagnosticProfile
      ? buildProfileContentIntegrity({ profile: diagnosticProfile, generalResume: diagnosticGeneralResume })
      : undefined;
    const runtimeHealth = runtimeStatus.health;
    const runtimeEnvironment = window.careerAdaptDesktop ? "electron" : "web";
    const supervisorExpected = runtimeEnvironment === "electron";
    const safeRuntimeFailureDiagnostics = sanitizeRuntimeFailureDiagnostics(
      session.activeTurn?.runtimeFailureDiagnostics ?? runtimeHealth?.runtimeFailureDiagnostics
    );
    const productionCareerContracts = careerContracts.filter((contract) => hermesProductionToolNames().has(contract.name));
    const hermesLogs = await getHermesLogs();
    const activeTurn = session.activeTurn;
    const failureSnapshot = activeTurn?.runtimeFailureSnapshot ?? runtimeStatus.runtimeFailureSnapshot;
    const currentSupervisorSnapshot = runtimeStatus.supervisorSnapshot ?? hermesLogs?.currentSnapshot;
    const failureTimeSupervisorSnapshot = runtimeStatus.failureTimeSupervisorSnapshot
      ?? hermesLogs?.failureTimeSnapshot;
    const careerToolsExecuted = toolActivities.length > 0;
    const exportRunReady = runtimeHealth?.runReady ?? currentSupervisorSnapshot?.runReady;
    const recoveredAtExport = Boolean(failureSnapshot && exportRunReady === true);
    const primaryErrorCode = safeRuntimeFailureDiagnostics?.safeErrorCode
      ?? activeTurn?.fallbackReasonCode
      ?? activeTurn?.lastSafeErrorCode;
    const cancellationOwner = activeTurn?.cancellation?.requestedBy
      ?? (typeof safeRuntimeFailureDiagnostics?.cancellationOwner === "string" ? safeRuntimeFailureDiagnostics.cancellationOwner : undefined)
      ?? (primaryErrorCode === "hermes_run_cancelled_upstream" ? "upstream" : undefined);
    const bundle = {
      schemaVersion: "agent-technical-diagnostics-v3",
      exportedAt: new Date().toISOString(),
      incidentSummary: {
        traceId: activeTurn?.incidentTraceId,
        incidentAt: activeTurn?.runtimeFailureAt ?? activeTurn?.firstEventAt ?? activeTurn?.startedAt,
        primaryLayer: safeRuntimeFailureDiagnostics?.failureLayer ?? (activeTurn?.hermesRunId || activeTurn?.firstEventAt ? "runtime" : undefined),
        primaryErrorCode,
        cancellationOwner,
        careerToolsExecuted,
        recoveryAttempted: activeTurn?.recoveryAttempted === true,
        recoveredAtExport
      },
      pinnedContext: {
        personId: session.personId,
        profileId: session.activeProfileId,
        versionNumber: session.profileVersionNumber,
        profileRevision: session.profileRevision
      },
      profileContentIntegrity,
      taskState: safeTaskState,
      clarificationState,
      runtime: {
        runtimeId: activeTurn?.runtimeId ?? runtimeStatus.activeRuntime,
        executionOwner: activeTurn?.executionOwner,
        preferredRuntime: activeTurn?.preferredRuntime,
        attemptedRuntime: activeTurn?.attemptedRuntime,
        finalRuntime: activeTurn?.finalRuntime,
        fallbackUsed: activeTurn?.fallbackUsed,
        fallbackReasonCode: activeTurn?.fallbackReasonCode,
        incidentTraceId: activeTurn?.incidentTraceId,
        hermesRunId: activeTurn?.hermesRunId,
        nextHermesRunId: activeTurn?.nextHermesRunId,
        firstEventAt: activeTurn?.firstEventAt,
        runtimeFailureAt: activeTurn?.runtimeFailureAt,
        runtimeAttempts: sanitizeRuntimeAttempts(activeTurn?.runtimeAttempts),
        recoveryAttempted: activeTurn?.recoveryAttempted === true,
        transportReattachAttempted: activeTurn?.transportReattachAttempted === true,
        semanticRetryAttempted: activeTurn?.semanticRetryAttempted === true,
        runtimeRestartAttempted: activeTurn?.runtimeRestartAttempted === true,
        primaryCausalChain: sanitizePrimaryCausalChain(activeTurn?.primaryCausalChain),
        secondaryRecoveryFailures: sanitizeSecondaryRecoveryFailures(activeTurn?.secondaryRecoveryFailures),
        cancellation: sanitizeRunStopReason(activeTurn?.cancellation),
        abortTraces: sanitizeAbortTraces(activeTurn?.abortTraces ?? runtimeStatus.abortTraces ?? []),
        eventStream: activeTurn?.eventStream,
        runtimeFailureDiagnostics: safeRuntimeFailureDiagnostics,
        runtimeFailureSnapshot: sanitizeRuntimeFailureSnapshot(failureSnapshot),
        readinessSnapshots: {
          turnStart: sanitizeRuntimeFailureSnapshot(activeTurn?.turnStartSnapshot),
          failure: sanitizeRuntimeFailureSnapshot(failureSnapshot),
          export: currentSupervisorSnapshot ? {
            capturedAt: new Date().toISOString(),
            runReady: currentSupervisorSnapshot.runReady,
            overallState: currentSupervisorSnapshot.overallState,
            reasonCode: currentSupervisorSnapshot.reasonCode,
            activeRunId: currentSupervisorSnapshot.activeRunId
          } : runtimeHealth ? {
            capturedAt: new Date().toISOString(),
            runReady: runtimeHealth.runReady,
            overallState: runtimeStatus.status,
            reasonCode: runtimeHealth.runReadySafeErrorCode ?? runtimeHealth.safeErrorCode,
            activeRunId: runtimeStatus.activeRunId
          } : undefined
        }
      },
      runLifecycle: {
        careerToolsExecuted,
        careerToolCount: toolActivities.length,
        recoveryAttempted: activeTurn?.recoveryAttempted === true,
        recoveredAtExport
      },
      hermesSupervisor: {
        runtimeEnvironment,
        supervisorExpected,
        supervisorUnavailable: supervisorExpected && !currentSupervisorSnapshot,
        currentSnapshot: sanitizeSupervisorSnapshot(currentSupervisorSnapshot),
        failureTimeSnapshot: sanitizeSupervisorSnapshot(failureTimeSupervisorSnapshot),
        latestLifecycleEntries: currentSupervisorSnapshot?.latestLifecycleEntries ?? hermesLogs?.latestLifecycleEntries ?? [],
        logPath: hermesLogs?.logPath,
        recentLogLines: hermesLogs?.recentLogLines ?? []
      },
      runtimeEnvironment,
      supervisorExpected,
      bridgeRequestTraces: runtimeStatus.bridgeRequestTraces ?? host.hermesRuntime.getDiagnostics().bridgeRequestTraces,
      nativeAllowedSourceTools: workflowDefinition.map((tool) => String(tool.name)),
      careerGatewayContracts: careerContracts.map((contract) => contract.name).sort(),
      careerMcpExposedTools: (runtimeHealth?.careerMcpExposedTools ?? productionCareerContracts.map((contract) => contract.name)).sort(),
      hermesRegisteredToolsets: runtimeHealth?.hermesRegisteredToolsets ?? [],
      hermesVisibleTools: runtimeHealth?.hermesVisibleTools ?? [],
      missingRequiredCareerTools: runtimeHealth?.missingRequiredCareerTools ?? careerCatalog.coverage([]).requiredCareerFacadesMissing,
      roadshowReady: runtimeHealth ? isRoadshowReady(runtimeHealth) : false,
      requestedTool: toolActivities.findLast((activity) => activity.toolName)?.toolName,
      requestedHermesToolName: toolActivities.findLast((activity) => activity.requestedHermesToolName)?.requestedHermesToolName,
      requestedCareerToolName: toolActivities.findLast((activity) => activity.stableCareerToolName)?.stableCareerToolName,
      deniedTool: deniedActivity?.toolName,
      workflowTransitionHistory: session.turnCheckpoints.map((checkpoint) => ({
        turnId: checkpoint.turnId,
        createdAt: checkpoint.createdAt,
        completedAt: checkpoint.completedAt,
        workflowBefore: checkpoint.taskStateBefore.workflowId,
        stageBefore: checkpoint.taskStateBefore.stage,
        workflowAfter: checkpoint.taskStateAfter?.workflowId,
        stageAfter: checkpoint.taskStateAfter?.stage,
        completionStatusAfter: checkpoint.taskStateAfter?.completionStatus
      })),
      workflowCheckpoint: safeCheckpoint,
      pendingInformationNeed: Object.keys(pendingInformationNeed).length ? {
        informationNeedId: pendingInformationNeed.informationNeedId,
        status: pendingInformationNeed.status,
        question: pendingInformationNeed.question
      } : undefined,
      terminalState: typeof latestAssistant?.metadata?.terminalState === "string" ? latestAssistant.metadata.terminalState : undefined,
      deadEndDetected: latestAssistant?.metadata?.deadEndDetected === true,
      toolActivityDiagnostics: toolActivities,
      sourceTurnDiagnostics: sourceTurns.map((turn) => ({
        sessionId: turn.sessionId,
        messageId: turn.messageId,
        turnId: turn.turnId,
        capturedAt: turn.capturedAt,
        processingStatus: turn.processingStatus,
        extractionStatus: turn.extractionStatus,
        provider: turn.provider,
        model: turn.model,
        attempt: turn.attempt,
        latencyMs: turn.latencyMs,
        safeErrorCode: turn.safeErrorCode,
        candidateCount: turn.candidateCount,
        quarantinedCount: turn.quarantinedCount,
        operationId: turn.operationId
      })),
      captureObservations: session.messages
        .filter((message) => message.toolName === "capture_profile_intake" || message.kind === "tool_status" || message.kind === "error_status")
        .map((message) => ({
          messageId: message.id,
          turnId: message.turnId,
          toolName: message.toolName,
          status: message.status,
          errorCode: message.errorCode,
          operationId: message.metadata?.operationId ?? message.metadata?.writeOperationId
        })),
      extractionStatus: intakeProjection?.extractionStatus,
      profileIntakePhase: slots.profileIntakePhase ?? intakeProjection?.phase,
      safeOperationReceipts: session.messages
        .flatMap((message) => {
          const operationId = message.metadata?.operationId ?? message.metadata?.writeOperationId;
          return typeof operationId === "string" ? [{ operationId, status: message.status, turnId: message.turnId }] : [];
        })
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `agent-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [host.careerToolGateway, host.hermesRuntime, host.store, intakeProjection, paused, runtimeStatus.activeRunId, runtimeStatus.activeRuntime, runtimeStatus.abortTraces, runtimeStatus.bridgeRequestTraces, runtimeStatus.failureTimeSupervisorSnapshot, runtimeStatus.health, runtimeStatus.runtimeFailureSnapshot, runtimeStatus.status, runtimeStatus.supervisorSnapshot, session]);

  const restartHermes = useCallback(async () => {
    const activeRun = Boolean(
      session.hermesRun
      && ["queued", "running", "waiting_for_approval", "stopping"].includes(session.hermesRun.status)
    ) || session.activeTurn?.status === "running";
    if (activeRun && !window.confirm("当前 AI 任务正在执行。重启 Hermes 会中断当前运行，但会保留任务进度；确定继续吗？")) return;
    if (activeRun) {
      await host.interruptRun(session.id, createRunStopReason({
        requestedBy: "user",
        reasonCode: "runtime_restart",
        sourceComponent: "AgentWorkspace.restartHermes",
        sessionId: session.id,
        logicalTurnId: session.activeTurn?.id,
        runId: session.hermesRun?.runId,
        incidentTraceId: session.activeTurn?.incidentTraceId
      }));
    }
    await requestHermesRestart({ reason: "user_explicit_restart" });
  }, [host, session]);

  return (
    <AgentWorkspaceLayout
      sessionTitle={getAgentSessionDisplayTitle(session)}
      status={statusLabel(checkpointTurnStatus)}
      runtimeStatus={runtimeStatus}
      onStartHermes={host.startHermes}
      onStopHermes={async () => {
        if (session.activeTurn?.status === "running" || ["queued", "running", "waiting_for_approval", "stopping"].includes(session.hermesRun?.status ?? "")) {
          await host.interruptRun(session.id, createRunStopReason({
            requestedBy: "user",
            reasonCode: "user_stop",
            sourceComponent: "AgentWorkspace.stopHermes",
            sessionId: session.id,
            logicalTurnId: session.activeTurn?.id,
            runId: session.hermesRun?.runId,
            incidentTraceId: session.activeTurn?.incidentTraceId
          }));
        }
        await requestHermesStop();
      }}
      onRestartHermes={restartHermes}
      onRecoverHermes={async () => { await requestHermesRecover(); }}
      onOpenHermesLogs={async () => { await openHermesLogs(); }}
      contextSelector={<CareerContextSelector onBeforeSelect={handleBeforeContextSelect} />}
      pinnedContextLabel={pinnedContextLabel}
      artifactCount={artifacts.length}
      onOpenArtifacts={() => updateDrawerState(window.matchMedia("(max-width: 860px)").matches ? "overlay" : "split")}
      onOpenHistory={() => setHistoryOpen(true)}
    >
      <div
        className={`agent-workspace-body is-drawer-${drawerState}`}
        data-agent-workflow-id={session.taskState?.workflowId ?? session.workflowState.workflowId}
        data-agent-task-stage={session.taskState?.stage ?? ""}
        data-agent-completion-status={session.taskState?.completionStatus ?? ""}
        data-agent-checkpoint-id={workflowCheckpoint?.checkpointId ?? ""}
        data-agent-checkpoint-kind={workflowCheckpoint?.kind ?? ""}
        data-agent-branch-id={session.activeBranchId}
      >
        <section className="agent-conversation-panel">
          {showZeroState ? (
            <AgentZeroState onSelect={dispatchQuickAction} />
          ) : (
            <>
              <div className="agent-conversation-toolbar">
                {snapshot.turnStatus === "failed" ? <span><WifiOff aria-hidden="true" />任务已中断，可重试</span> : null}
                {hasAutosavedIntake ? <span className="agent-autosave-receipt" aria-live="polite">已自动保存到本地</span> : null}
                <button
                  type="button"
                  onClick={() => {
                    const messages = session.messages.filter((m) => m.role !== "system");
                    if (!messages.length) return;
                    const blob = new Blob([JSON.stringify(messages, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `ai-conversation-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  导出对话
                </button>
                <button type="button" onClick={() => void exportTechnicalDiagnostics()}>
                  导出技术诊断
                </button>
                <button
                  type="button"
                  onClick={() => dispatchUi({ type: paused ? "resume_workflow" : "pause_workflow", workflowId: session.workflowState.workflowId })}
                >
                  {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                  {paused ? "继续任务" : "暂停任务"}
                </button>
                <button type="button" onClick={() => setHistoryOpen(true)}>
                  <History aria-hidden="true" />历史
                </button>
              </div>
              {snapshot.stalled ? (
                <div className="agent-stall-watchdog" role="status">
                  <span>{liveHermesRun ? "Hermes 正在处理较长内容，仍在运行…" : "这一步响应时间较长"}</span>
                  <div>
                    <button type="button" onClick={() => host.state.continueWaiting()}>继续等待</button>
                    <button type="button" onClick={() => host.state.interrupt()}>停止任务</button>
                    {!liveHermesRun ? <button
                        type="button"
                        disabled={!lastUserMessage || Boolean(session.pendingConfirmation)}
                        onClick={() => void dispatchMessage(lastUserMessage)}
                      >
                        重试
                      </button> : null}
                  </div>
                </div>
              ) : null}
              <AgentConversationTimeline
                key={session.id}
                 messages={activeBranchMessages(session)}
                 onRegenerate={async (message) => {
                   const result = await host.runUserEvent(
                     { type: "regenerate", messageId: message.id },
                     { session, pageContext: pageContext() }
                   );
                  if (!result) return;
                  setSession(result);
                  window.localStorage.setItem(ACTIVE_SESSION_KEY, result.id);
                  window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));
                }}
                 onEditUserMessage={async (message, content) => {
                   setLastUserMessage(content);
                   const result = await host.runUserEvent(
                     { type: "edit_message", messageId: message.id, text: content },
                     { session, pageContext: pageContext() }
                   );
                  if (!result) return;
                  setSession(result);
                  window.localStorage.setItem(ACTIVE_SESSION_KEY, result.id);
                  window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));
                }}
                onContinueFromMessage={(message) => {
                  setSessionDraft("");
                  setSessionDraftReference({
                    messageId: message.id,
                    role: message.role,
                    type: "assistant_message",
                    excerpt: referenceExcerpt(normalizeAgentMessageText(message.content))
                  });
                }}
                onCopyMessage={(message) => void navigator.clipboard?.writeText(normalizeAgentMessageText(message.content))}
                onOption={dispatchOption}
                confirmation={session.pendingToolCall ? session.pendingConfirmation : undefined}
                confirmationBusy={running}
                profileIntakeProjection={intakeProjection}
                tailoringTaskState={session.taskState}
                 onArtifactAction={dispatchArtifactAction}
                 onConfirmation={(confirmed) => void (async () => {
                   const next = await host.runUserEvent(
                     { type: "confirmation", confirmed },
                     { session, pageContext: pageContext() }
                   );
                   if (next) setSession(next);
                 })()}
              />
            </>
          )}
          <AgentComposer
            disabled={paused}
            running={running}
            checkpoint={workflowCheckpoint}
            queuedCount={snapshot.pendingInputCount}
            draft={draft}
            reference={draftReference}
            onRemoveReference={() => setSessionDraftReference(undefined)}
            onDraftChange={setSessionDraft}
            attachments={attachments}
            onFilesSelected={stageComposerFiles}
            onRemoveAttachment={removeComposerAttachment}
            onSubmit={submitComposer}
            canFinish={canFinishIntake}
            onFinish={() => dispatchMessage("完成整理")}
            onUiAction={dispatchUi}
            uploadFocusSignal={uploadFocusSignal}
            onStop={() => host.state.interrupt()}
          />
        </section>
        <AgentArtifactDrawer
          artifacts={artifacts}
          state={drawerState}
          workflowState={workflowView}
          taskState={session.taskState}
          onImportAction={(message) => void dispatchMessage(message)}
          onArtifactAction={dispatchArtifactAction}
          onUiAction={dispatchUi}
          onStateChange={updateDrawerState}
        />
      </div>
      <ImportReviewDialog
        open={Boolean(pendingResumeImportAttachmentId)}
        title="选择简历识别方式"
        description="此选择会保存；AI 服务配置变化后会再次询问。"
        variant="agent"
        testId="agent-import-ai-consent"
        onClose={cancelPendingResumeConsent}
      >
        <section className="ai-mapping-consent">
          <p>
            AI 智能识别会将本地提取并脱敏后的简历内容发送给当前配置的 AI 服务。
            原始 PDF/DOCX 文件不会发送。电话、邮箱、身份证号、可识别的详细地址，
            以及高置信姓名会优先在本地替换为占位符。
          </p>
          <div className="action-row">
            <button className="primary-button compact" type="button" onClick={() => {
              void continuePendingResumeImport("ai");
            }}>
              使用 AI 智能识别
            </button>
            <button className="secondary-button compact" type="button" onClick={() => {
              void continuePendingResumeImport("local");
            }}>
              仅本地解析
            </button>
          </div>
        </section>
      </ImportReviewDialog>
      {pendingContextRequest ? (
        <div className="career-context-switch-dialog-backdrop" role="presentation">
          <section className="career-context-switch-dialog" role="dialog" aria-modal="true" aria-labelledby="career-context-switch-title">
            <h2 id="career-context-switch-title">当前任务已固定人物与版本</h2>
            <p>这项任务已经使用了资料或执行过写入，不能静默改变目标。</p>
            <div className="career-context-switch-actions">
              <button type="button" className="primary-button compact" onClick={() => void resolvePendingContextRequest("new_task")}>新建任务使用此人物</button>
              <button type="button" className="secondary-button compact" onClick={() => void resolvePendingContextRequest("switch")}>切换当前任务并重新读取</button>
              <button type="button" className="section-action-button compact" onClick={() => void resolvePendingContextRequest("cancel")}>取消</button>
            </div>
          </section>
        </div>
      ) : null}
      <AgentHistoryDialog
        key={historyOpen ? "open" : "closed"}
        open={historyOpen}
        sessions={sessions}
        onClose={() => setHistoryOpen(false)}
        onSelect={restoreSession}
      />
      <AgentFloatingAction
        action={floatingAction?.type === "open_import_review" ? undefined : floatingAction}
        resumes={resumes}
        onClose={() => setFloatingAction(undefined)}
        onSend={(message) => {
          setFloatingAction(undefined);
          void dispatchMessage(message);
        }}
      />
      <ImportReviewDialog
        open={floatingAction?.type === "open_import_review"}
        title="核对并编辑导入内容"
        description="核对来源、结构与目标；关闭后会回到当前 AI 对话。"
        variant="agent"
        testId="agent-import-review-dialog"
        onClose={() => setFloatingAction(undefined)}
      >
        {floatingAction?.type === "open_import_review" ? (
          <ResumeImportWizard
            key={floatingAction.importId}
            repository={agentImportRepository}
            profile={profiles.find((item) => item.id === session.activeProfileId)}
            profiles={profiles}
            initialImportId={floatingAction.importId}
            initialTargetMode={floatingAction.targetMode}
            variant="agent"
            onImported={async (result) => {
              const action = floatingAction;
              setFloatingAction(undefined);
              setProfiles(await agentImportRepository.listProfiles());
              const updated = await host.state.dispatch({
                type: "external_event",
                toolName: "confirm_resume_import",
                observation: {
                  importId: action.importId,
                  profileId: result.profileId,
                  branchId: result.branchId,
                  status: "completed"
                }
              }, { session: host.state.getSnapshot().activeSession ?? session, pageContext: pageContext() });
              if (updated) setSession(updated);
            }}
          />
        ) : null}
      </ImportReviewDialog>
    </AgentWorkspaceLayout>
  );

  async function continuePendingResumeImport(mode: "ai" | "local") {
    const attachmentId = pendingResumeImportAttachmentId;
    if (!attachmentId) return;
    writeResumeImportSemanticPreference(mode);
    setPendingResumeImportAttachmentId(undefined);
    if (pendingHermesAttachmentTurn?.sessionId === session.id) {
      const pending = pendingHermesAttachmentTurn;
      setPendingHermesAttachmentTurn(undefined);
      try {
        const current = host.state.getSnapshot().activeSession ?? session;
        const next = await host.runTurn({
          sessionId: current.id,
          userMessage: pending.text,
          pageContext: pageContext(),
          session: current,
          attachments: pending.attachments.map((attachment) => ({
            id: attachment.id,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            size: attachment.size,
            purpose: "resume_import"
          }))
        });
        if (next) setSession(next);
      } catch (error) {
        notify({ type: "error", title: "简历导入未启动", message: error instanceof Error ? error.message : "请重新选择附件后重试。" });
      } finally {
        agentAttachmentStore.releaseMany(pending.attachments.filter((attachment) => agentAttachmentStore.has(attachment.id)).map((attachment) => attachment.id));
      }
      return;
    }
    await host.state.dispatch(
      { type: "resume_import_consent", attachmentId, mode },
      { session: host.state.getSnapshot().activeSession ?? session, pageContext: pageContext() }
    );
  }

  function cancelPendingResumeConsent() {
    setPendingResumeImportAttachmentId(undefined);
    const pending = pendingHermesAttachmentTurn;
    if (!pending) return;
    const restored = pending.attachments.flatMap((attachment) => {
      try {
        const { file } = agentAttachmentStore.resolve(attachment.id);
        return [{
          clientId: `composer-file-${crypto.randomUUID()}`,
          file,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          size: attachment.size,
          status: "staged" as const
        }];
      } catch {
        return [];
      }
    });
    agentAttachmentStore.releaseMany(pending.attachments.map((attachment) => attachment.id));
    setAttachmentsBySession((current) => ({ ...current, [pending.sessionId]: restored }));
    setPendingHermesAttachmentTurn(undefined);
  }
}

export function readSessionComposerDrafts(): SessionComposerDrafts {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AGENT_COMPOSER_DRAFTS_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] =>
          Boolean(entry[0]) && typeof entry[1] === "string" && entry[1].length <= 8000
        )
        .slice(-100)
    );
  } catch {
    return {};
  }
}

function persistSessionComposerDrafts(drafts: SessionComposerDrafts) {
  try {
    window.localStorage.setItem(AGENT_COMPOSER_DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    // Draft persistence is best-effort; the in-memory per-session draft remains.
  }
}

function referenceExcerpt(content: string) {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}…` : compact;
}

function AgentFloatingAction(props: {
  action?: AgentUiAction;
  resumes: ResumeSummary[];
  onClose(): void;
  onSend(message: string): void;
}) {
  const [query, setQuery] = useState("");
  const [job, setJob] = useState({ title: "", company: "", rawText: "" });
  if (!props.action) return null;
  const filtered = props.resumes.filter((resume) =>
    `${resume.name} ${resume.purpose}`.toLowerCase().includes(query.trim().toLowerCase())
  );
  return (
    <div className="agent-modal-backdrop" role="presentation">
      <section className="agent-floating-panel" role="dialog" aria-modal="true" aria-label={floatingTitle(props.action)}>
        <header>
          <h2>{floatingTitle(props.action)}</h2>
          <button type="button" aria-label="关闭" onClick={props.onClose}>×</button>
        </header>
        {props.action.type === "open_resume_picker" ? (
          <div className="agent-picker-stack">
            <input aria-label="搜索简历" value={query} onChange={(event) => setQuery(event.target.value)} />
            <div className="agent-picker-list">
              {filtered.map((resume) => (
                <button key={resume.id} type="button" onClick={() => props.onSend(`使用简历“${resume.name}”（ID: ${resume.id}）继续当前任务`)}>
                  <strong>{resume.name || "未命名简历"}</strong>
                  <span>{resume.purpose} · v{resume.revision}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {props.action.type === "open_job_import_dialog" ? (
          <form className="agent-picker-stack" onSubmit={(event) => {
            event.preventDefault();
            props.onSend(`录入岗位：${job.title}\n公司：${job.company}\n${job.rawText}`);
          }}>
            <input aria-label="岗位名称" placeholder="例如：高级产品经理" value={job.title} onChange={(event) => setJob({ ...job, title: event.target.value })} />
            <input aria-label="公司" placeholder="例如：CareerAdapt AI" value={job.company} onChange={(event) => setJob({ ...job, company: event.target.value })} />
            <textarea aria-label="岗位描述" placeholder="粘贴完整岗位描述，AI 会提取职责与要求…" value={job.rawText} onChange={(event) => setJob({ ...job, rawText: event.target.value })} />
            <button className="primary-button" type="submit" disabled={!job.title.trim() || !job.company.trim() || job.rawText.trim().length < 20}>
              交给 AI 处理
            </button>
          </form>
        ) : null}
        {props.action.type === "open_profile_browser" ? (
          <button className="primary-button" type="button" onClick={() => props.onSend("打开资料库并基于已确认资料继续当前任务")}>打开资料库</button>
        ) : null}
        {props.action.type === "open_tool_palette" ? (
          <div className="agent-picker-list">
            {["选择简历", "打开岗位录入窗口", "打开资料库", "导出简历"].map((label) => (
              <button key={label} type="button" onClick={() => props.onSend(label)}>{label}</button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function taskToWorkflowView(session: AgentSession): TailorWorkflowViewState {
  const task = session.taskState;
  const slots = task?.knownSlots ?? {};
  const tailoringPlan = readRecord(readRecord(slots.tailoringSession).plan);
  const allowedSteps = new Set([
    "select_resume", "collect_job", "analyze_job", "review_job", "analyze_fit",
    "generate_plan", "answer_questions", "generate_changes", "preview_changes", "confirm_apply", "completed"
  ]);
  const stage = task?.stage === "clarify_unsupported_facts"
    ? "answer_questions"
    : task?.stage === "quality_result"
      ? "completed"
      : task?.stage;
  return {
    step: allowedSteps.has(stage ?? "") ? stage as TailorWorkflowViewState["step"] : "select_resume",
    busy: session.activeTurn?.status === "running",
    profileId: task?.selectedEntities.profileId,
    resumeId: task?.selectedEntities.resumeId,
    jobId: task?.selectedEntities.jobId,
    jobGraph: slots.graph,
    fitAnalysis: slots.fitAnalysis,
    tailoringSession: slots.tailoringSession,
    diffs: Array.isArray(tailoringPlan.diffs)
      ? tailoringPlan.diffs
      : Array.isArray(slots.selectedDiffs) ? slots.selectedDiffs : [],
    confirmedRequirementIds: Array.isArray(slots.confirmedRequirementIds)
      ? slots.confirmedRequirementIds.filter((id): id is string => typeof id === "string")
      : [],
    pendingConfirmation: session.pendingToolCall?.toolName as TailorWorkflowViewState["pendingConfirmation"],
    appliedRevisionId: task?.selectedEntities.revisionId
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sanitizeRunStopReason(value: unknown) {
  const source = readRecord(value);
  if (typeof source.requestedBy !== "string" || typeof source.reasonCode !== "string" || typeof source.sourceComponent !== "string") return undefined;
  return {
    requestedBy: source.requestedBy.slice(0, 80),
    reasonCode: source.reasonCode.slice(0, 160),
    sourceComponent: source.sourceComponent.slice(0, 160),
    ...(typeof source.sessionId === "string" ? { sessionId: source.sessionId.slice(0, 160) } : {}),
    ...(typeof source.logicalTurnId === "string" ? { logicalTurnId: source.logicalTurnId.slice(0, 160) } : {}),
    ...(typeof source.runId === "string" ? { runId: source.runId.slice(0, 160) } : {}),
    ...(typeof source.requestedAt === "string" ? { requestedAt: source.requestedAt } : {}),
    ...(typeof source.incidentTraceId === "string" ? { incidentTraceId: source.incidentTraceId.slice(0, 200) } : {})
  };
}

function sanitizeAbortTraces(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const source = readRecord(entry);
    if (typeof source.abortSource !== "string" || typeof source.abortedAt !== "string") return [];
    return [{
      abortSource: source.abortSource.slice(0, 80),
      ...(typeof source.abortReason === "string" ? { abortReason: source.abortReason.slice(0, 240) } : {}),
      abortedAt: source.abortedAt,
      ...(typeof source.incidentTraceId === "string" ? { incidentTraceId: source.incidentTraceId.slice(0, 200) } : {}),
      ...(typeof source.sessionId === "string" ? { sessionId: source.sessionId.slice(0, 160) } : {}),
      ...(typeof source.turnId === "string" ? { turnId: source.turnId.slice(0, 160) } : {}),
      ...(typeof source.runId === "string" ? { runId: source.runId.slice(0, 160) } : {})
    }];
  }).slice(-32);
}

function sanitizeRuntimeAttempts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const source = readRecord(entry);
    if (typeof source.attemptNumber !== "number" || typeof source.traceId !== "string" || typeof source.sessionId !== "string" || typeof source.turnId !== "string" || typeof source.status !== "string") return [];
    return [{
      attemptNumber: Math.max(1, Math.round(source.attemptNumber)),
      traceId: source.traceId.slice(0, 240),
      sessionId: source.sessionId.slice(0, 160),
      turnId: source.turnId.slice(0, 160),
      ...(typeof source.hermesSessionId === "string" ? { hermesSessionId: source.hermesSessionId.slice(0, 160) } : {}),
      ...(typeof source.runId === "string" ? { runId: source.runId.slice(0, 160) } : {}),
      ...(typeof source.startRequestedAt === "string" ? { startRequestedAt: source.startRequestedAt } : {}),
      ...(typeof source.runStartedAt === "string" ? { runStartedAt: source.runStartedAt } : {}),
      ...(typeof source.runStartStatus === "string" ? { runStartStatus: source.runStartStatus.slice(0, 40) } : {}),
      ...(typeof source.firstEventAt === "string" ? { firstEventAt: source.firstEventAt } : {}),
      ...(typeof source.terminalAt === "string" ? { terminalAt: source.terminalAt } : {}),
      ...(typeof source.terminalStatus === "string" ? { terminalStatus: source.terminalStatus.slice(0, 40) } : {}),
      status: source.status.slice(0, 80),
      ...(typeof source.lastEventType === "string" ? { lastEventType: source.lastEventType.slice(0, 120) } : {}),
      ...(typeof source.failureCode === "string" ? { failureCode: source.failureCode.slice(0, 160) } : {}),
      ...(typeof source.failureLayer === "string" ? { failureLayer: source.failureLayer.slice(0, 80) } : {}),
      ...(typeof source.retryable === "boolean" ? { retryable: source.retryable } : {}),
      ...(typeof source.recoveryReason === "string" ? { recoveryReason: source.recoveryReason.slice(0, 160) } : {}),
      ...(typeof source.recoveryKind === "string" ? { recoveryKind: source.recoveryKind.slice(0, 40) } : {}),
      ...(typeof source.cancellationOwner === "string" ? { cancellationOwner: source.cancellationOwner.slice(0, 120) } : {}),
      ...(source.stopReason ? { stopReason: sanitizeRunStopReason(source.stopReason) } : {})
    }];
  }).slice(-8);
}

function sanitizePrimaryCausalChain(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const source = readRecord(entry);
    if (typeof source.event !== "string" || typeof source.component !== "string" || typeof source.at !== "string") return [];
    return [{
      event: source.event.slice(0, 120),
      component: source.component.slice(0, 160),
      at: source.at,
      ...(typeof source.runId === "string" ? { runId: source.runId.slice(0, 160) } : {}),
      ...(typeof source.attemptTraceId === "string" ? { attemptTraceId: source.attemptTraceId.slice(0, 240) } : {}),
      ...(typeof source.detail === "string" ? { detail: redactRuntimeDiagnosticText(source.detail).slice(0, 360) } : {})
    }];
  }).slice(-48);
}

function sanitizeSecondaryRecoveryFailures(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const source = readRecord(entry);
    if (typeof source.code !== "string" || typeof source.message !== "string" || typeof source.operation !== "string" || typeof source.capturedAt !== "string") return [];
    return [{
      code: source.code.slice(0, 160),
      message: redactRuntimeDiagnosticText(source.message).slice(0, 360),
      operation: source.operation.slice(0, 80),
      capturedAt: source.capturedAt,
      ...(typeof source.runId === "string" ? { runId: source.runId.slice(0, 160) } : {}),
      ...(typeof source.attemptTraceId === "string" ? { attemptTraceId: source.attemptTraceId.slice(0, 240) } : {}),
      ...(typeof source.httpStatus === "number" ? { httpStatus: Math.round(source.httpStatus) } : {})
    }];
  }).slice(-16);
}

function sanitizeSupervisorSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ["overallState", "reasonCode", "runtimeUrl", "appUrl", "version", "model", "provider", "activeRunId", "providerStatus", "maintenanceReasonCode"]) {
    if (typeof source[key] === "string" && source[key].trim()) result[key] = (source[key] as string).slice(0, 240);
  }
  for (const key of ["processReady", "apiReady", "providerReady", "careerMcpReady", "toolSurfaceReady", "runReady", "careerSkillsReady", "maintenancePending"]) {
    if (typeof source[key] === "boolean") result[key] = source[key];
  }
  for (const key of ["restartAttempt", "uptimeMs", "careerDomainToolCount", "hermesCareerToolCount", "requiredCareerFacadesReady", "requiredCareerFacadesTotal"]) {
    if (typeof source[key] === "number" && Number.isFinite(source[key])) result[key] = Math.max(0, Math.round(source[key] as number));
  }
  if (typeof source.updatedAt === "string") result.updatedAt = source.updatedAt;
  if (typeof source.capturedAt === "string") result.capturedAt = source.capturedAt;
  const lifecycle = Array.isArray(source.latestLifecycleEntries) ? source.latestLifecycleEntries : [];
  result.latestLifecycleEntries = lifecycle.slice(-80).flatMap((entry) => {
    const item = readRecord(entry);
    return typeof item.at === "string" && typeof item.message === "string"
      ? [{ at: item.at, message: item.message.slice(0, 240), state: typeof item.state === "string" ? item.state : undefined, reasonCode: typeof item.reasonCode === "string" ? item.reasonCode.slice(0, 160) : undefined }]
      : [];
  });
  return result;
}

function sanitizeRuntimeFailureSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const supervisor = sanitizeSupervisorSnapshot(source.supervisor);
  if (!supervisor) return undefined;
  const run = readRecord(source.run);
  return {
    capturedAt: typeof source.capturedAt === "string" ? source.capturedAt : new Date().toISOString(),
    supervisor,
    ...(source.runtimeHealth && typeof source.runtimeHealth === "object" && !Array.isArray(source.runtimeHealth)
      ? { runtimeHealth: sanitizeRuntimeHealth(source.runtimeHealth) }
      : {}),
    run: {
      ...(typeof run.runId === "string" ? { runId: run.runId.slice(0, 160) } : {}),
      ...(typeof run.status === "string" ? { status: run.status.slice(0, 80) } : {}),
      ...(typeof run.lastEvent === "string" ? { lastEvent: run.lastEvent.slice(0, 120) } : {}),
      ...(typeof run.createdAt === "string" ? { createdAt: run.createdAt } : {}),
      ...(typeof run.updatedAt === "string" ? { updatedAt: run.updatedAt } : {})
    }
  };
}

function sanitizeRuntimeHealth(value: unknown) {
  const source = readRecord(value);
  const result: Record<string, unknown> = {};
  for (const key of ["runtimeId", "activeRunId", "hermesRunId", "providerStatus", "model", "runReadySafeErrorCode", "safeErrorCode", "lastCheckedAt"]) {
    if (typeof source[key] === "string") result[key] = (source[key] as string).slice(0, 240);
  }
  for (const key of ["runtimeAvailable", "companionReady", "providerConfigured", "providerReachable", "providerReady", "toolCallingAvailable", "toolCallInFlight", "mcpConnected", "mcpReady", "runReady", "careerSkillsLoaded"]) {
    if (typeof source[key] === "boolean") result[key] = source[key];
  }
  if (typeof source.toolCallingCapability === "string") result.toolCallingCapability = source.toolCallingCapability.slice(0, 40);
  return result;
}

export function sanitizeRuntimeFailureDiagnostics(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  const stringKeys = ["failureLayer", "safeErrorCode", "safeErrorMessage", "upstreamErrorCode", "hermesSessionId", "hermesRunId", "requestedTurnId", "runStartKind", "runPhase", "providerStatus", "incidentTraceId", "attemptTraceId", "recoveryReason", "cancellationOwner"];
  const numberKeys = ["httpStatus", "latencyMs"];
  const booleanKeys = ["companionConnected", "mcpConnected", "retryable"];
  for (const key of stringKeys) {
    if (typeof source[key] === "string" && source[key].trim()) {
      result[key] = key === "safeErrorMessage"
        ? redactRuntimeDiagnosticText(source[key] as string)
        : (source[key] as string).slice(0, 240);
    }
  }
  for (const key of numberKeys) {
    if (typeof source[key] === "number" && Number.isFinite(source[key])) result[key] = Math.max(0, Math.round(source[key] as number));
  }
  for (const key of booleanKeys) {
    if (typeof source[key] === "boolean") result[key] = source[key];
  }
  for (const key of ["initialFailure", "recoveryFailure"]) {
    const nested = sanitizeRuntimeFailureDiagnostics(source[key]);
    if (nested) result[key] = nested;
  }
  const causalChain = sanitizePrimaryCausalChain(source.primaryCausalChain);
  if (causalChain.length) result.primaryCausalChain = causalChain;
  const secondaryFailures = sanitizeSecondaryRecoveryFailures(source.secondaryRecoveryFailures);
  if (secondaryFailures.length) result.secondaryRecoveryFailures = secondaryFailures;
  const cancellation = sanitizeRunStopReason(source.cancellation ?? source.stopReason);
  if (cancellation) result.cancellation = cancellation;
  const attempts = sanitizeRuntimeAttempts(source.runtimeAttempts);
  if (attempts.length) result.runtimeAttempts = attempts;
  const abortTraces = sanitizeAbortTraces(source.abortTraces);
  if (abortTraces.length) result.abortTraces = abortTraces;
  const failureSnapshot = sanitizeRuntimeFailureSnapshot(source.failureSnapshot ?? source.runtimeFailureSnapshot);
  if (failureSnapshot) result.failureSnapshot = failureSnapshot;
  const artifactWrite = source.lastArtifactWrite;
  if (artifactWrite && typeof artifactWrite === "object" && !Array.isArray(artifactWrite)) {
    const artifact = artifactWrite as Record<string, unknown>;
    const safeArtifact: Record<string, unknown> = {};
    for (const key of ["operationId", "checkpointId", "status", "sourceResumeId", "resultResumeId", "resultResumeRevisionId", "resultRevisionId", "safeErrorCode"]) {
      if (typeof artifact[key] === "string" && artifact[key].trim()) safeArtifact[key] = (artifact[key] as string).slice(0, 240);
    }
    if (typeof artifact.acceptedDiffCount === "number" && Number.isFinite(artifact.acceptedDiffCount)) {
      safeArtifact.acceptedDiffCount = Math.max(0, Math.round(artifact.acceptedDiffCount));
    }
    if (Array.isArray(artifact.changedFieldPaths)) {
      safeArtifact.changedFieldPaths = artifact.changedFieldPaths
        .filter((path): path is string => typeof path === "string")
        .map((path) => path.slice(0, 240))
        .slice(0, 128);
    }
    for (const key of ["repositoryReadBackVerified", "resumeListVisibilityVerified"]) {
      if (typeof artifact[key] === "boolean") safeArtifact[key] = artifact[key];
    }
    if (Object.keys(safeArtifact).length) result.lastArtifactWrite = safeArtifact;
  }
  return Object.keys(result).length ? result : undefined;
}

function redactRuntimeDiagnosticText(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/Bearer\s+[^\s,;]+/giu, "Bearer [redacted]")
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/gu, "[redacted-key]")
    .replace(/\b(?:x-api-key|api[_ -]?key|authorization|token|secret|password)\s*[:=]\s*[^\s,;]+/giu, "[redacted-secret]")
    .slice(0, 360);
}

function readArray(value: unknown, key: string) {
  if (!value || typeof value !== "object") return [];
  const found = (value as Record<string, unknown>)[key];
  return Array.isArray(found) ? found : [];
}

function floatingTitle(action: AgentUiAction) {
  if (action.type === "open_resume_picker") return "选择简历";
  if (action.type === "open_job_import_dialog") return "导入岗位";
  if (action.type === "open_profile_browser") return "资料库";
  if (action.type === "open_tool_palette") return "可用工具";
  return "任务产物";
}

function statusLabel(status: ReturnType<ReturnType<typeof useAgentHost>["state"]["getSnapshot"]>["turnStatus"]) {
  const labels = {
    idle: "等待开始",
    running: "处理中…",
    paused: "已暂停",
    waiting_for_confirmation: "等待确认",
    waiting_for_user: "等待输入",
    completed: "已完成",
    failed: "需要处理"
  };
  return labels[status];
}

export function upsertAgentErrorStatus(
  session: AgentSession,
  input: {
    userMessageId: string;
    errorCode: string;
    status: "failed" | "retrying" | "recovered";
    content: string;
  }
): AgentSession {
  const now = new Date().toISOString();
  const existing = session.messages.findIndex((message) =>
    message.kind === "error_status"
    && message.userMessageId === input.userMessageId
    && message.errorCode === input.errorCode
  );
  const errorMessage: AgentMessage = {
    id: existing >= 0 ? session.messages[existing].id : `agent-error-${crypto.randomUUID()}`,
    role: "assistant",
    kind: "error_status",
    type: "error",
    status: input.status,
    errorCode: input.errorCode,
    userMessageId: input.userMessageId,
    content: input.content,
    createdAt: existing >= 0 ? session.messages[existing].createdAt : now,
    updatedAt: now
  };
  return {
    ...session,
    messages: existing >= 0
      ? session.messages.map((message, index) => index === existing ? errorMessage : message)
      : [...session.messages, errorMessage],
    updatedAt: now
  };
}

export function replaceErrorForRegenerate(session: AgentSession): AgentSession {
  const error = [...session.messages].reverse().find((message) => message.kind === "error_status");
  if (!error?.userMessageId) return session;
  return {
    ...session,
    messages: session.messages.filter((message) => message.id !== error.id && message.id !== error.userMessageId),
    updatedAt: new Date().toISOString()
  };
}
