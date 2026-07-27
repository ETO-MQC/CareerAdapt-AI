import type { AgentSession, AgentTaskState } from "@/agent/contracts/agentSession";
import { getWorkflowDefinition } from "@/agent/workflows/workflowRegistry";
import {
  deriveNextLegalStage,
  TaskContinuationResolver
} from "./TaskContinuationResolver";

export type AgentTaskEvent =
  | { type: "user_message"; message: string; goal?: string }
  | { type: "slot_answer"; slot: string; value: unknown }
  | { type: "decision_selected"; decisionType: "resume_source_route"; option: "profile" | "existing_resume" }
  | { type: "tool_observation"; toolName: string; observation: unknown; artifactIds?: string[] }
  | { type: "confirmation_requested"; toolName: string; operationId: string }
  | { type: "confirmation_accepted"; toolName: string }
  | { type: "confirmation_rejected"; toolName: string }
  | {
      type: "entity_revision";
      entityType: "profile" | "resume" | "job";
      entityId: string;
      revisionId?: string;
      version?: string | number;
      hash?: string;
    }
  | { type: "dependencies_invalidated" }
  | { type: "failed"; errorCode: string };

export class AgentTaskStateReducer {
  create(
    session: AgentSession,
    goal = session.taskState?.rootGoal ?? session.memory?.currentGoal ?? "conversation"
  ): AgentTaskState {
    const now = new Date().toISOString();
    const knownSlots = { ...session.workflowState.data };
    const state: AgentTaskState = {
      goal,
      rootGoal: goal,
      activeGoal: goal,
      workflowId: session.workflowState.workflowId,
      stage: session.workflowState.step,
      requiredSlots: [],
      knownSlots,
      missingSlots: [],
      selectedEntities: {
        profileId: session.activeProfileId,
        resumeId: session.activeResumeId,
        jobId: session.activeJobId,
        revisionId: stringValue(knownSlots.revisionId)
      },
      dependencySnapshots: {},
      artifacts: session.artifactRefs.map((artifact) => artifact.id),
      completionStatus: workflowStatus(session.workflowState.status),
      computeTier: computeTier(goal),
      updatedAt: now
    };
    return normalize(state);
  }

  reduce(previous: AgentTaskState, event: AgentTaskEvent): AgentTaskState {
    const state = structuredClone(previous);
    const previouslyFinished = isFinishedRootTask(state);
    state.updatedAt = new Date().toISOString();
    if (event.type === "user_message") {
      const continuation = new TaskContinuationResolver().resolve(state, event.message);
      if (continuation.consumed) {
        if (
          continuation.goal
          && !["apply_to_job", "create_tailored_resume"].includes(state.rootGoal)
        ) {
          setUserRootGoal(state, continuation.goal);
        }
        Object.assign(state.knownSlots, continuation.slotUpdates);
        if (continuation.intent === "continue") {
          state.stage = deriveNextLegalStage(state);
        }
        state.completionStatus = "active";
        state.computeTier = computeTier(state.rootGoal, event.message);
        return normalize(state);
      }
      if (event.goal) setUserRootGoal(state, event.goal);
      if (state.completionStatus !== "waiting_for_confirmation") state.completionStatus = "active";
      if (/基于现有简历.*岗位定制|定制简历|创建.*岗位简历|创建.*定制简历/i.test(event.message)) {
        setUserRootGoal(state, "create_tailored_resume");
        state.workflowId = "tailor_existing_resume";
      } else if (/分析.*(岗位|职位).*(匹配|适配)|匹配度/i.test(event.message)) {
        setUserRootGoal(state, "analyze_job_fit");
        state.workflowId = "analyze_job_fit";
      } else if (/导入.*简历|上传.*简历/i.test(event.message)) {
        setUserRootGoal(state, "import_resume");
      } else if (/从资料库.*(生成|创建).*简历/i.test(event.message)) {
        setUserRootGoal(state, "create_resume_from_profile");
      } else if (/导出.*简历/i.test(event.message)) {
        setUserRootGoal(state, "export_resume");
      } else if (/归档.*简历/i.test(event.message)) {
        setUserRootGoal(state, "archive_resume");
      } else if (/恢复.*简历/i.test(event.message)) {
        setUserRootGoal(state, "restore_resume");
      } else if (/录入.*岗位|导入.*岗位|新增.*岗位/i.test(event.message)) {
        setUserRootGoal(state, "ingest_job");
        state.workflowId = "job_ingestion";
        state.stage = "collect_job_description";
      }
      captureEntityReferences(state, event.message);
      const applicationIntent = /应聘|申请.*岗位|想投.*岗位|这工作.*试试|想试试.*岗位/i.test(event.message);
      if (applicationIntent) setUserRootGoal(state, "apply_to_job");
      if (looksLikeJd(event.message)) {
        if (state.rootGoal === "conversation" || (previouslyFinished && !applicationIntent)) {
          setUserRootGoal(state, "ingest_job");
        } else {
          state.activeGoal = "ingest_job";
        }
        state.workflowId = "job_ingestion";
        state.stage = "parse_job";
        state.knownSlots.rawText = event.message.trim();
      }
      const sourceSelectionAllowed = ["apply_to_job", "create_tailored_resume"].includes(state.rootGoal);
      if (sourceSelectionAllowed && /从资料库|资料库生成|路线\s*A/i.test(event.message)) {
        selectResumeSourceRoute(state, "profile");
      } else if (sourceSelectionAllowed && /已有简历|现有简历|通用简历|路线\s*B/i.test(event.message)) {
        selectResumeSourceRoute(state, "existing_resume");
      }
      state.computeTier = computeTier(state.rootGoal, event.message);
    }
    if (event.type === "slot_answer") {
      state.knownSlots[event.slot] = event.value;
      state.completionStatus = "active";
    }
    if (event.type === "decision_selected") {
      if (
        state.pendingDecision?.type === event.decisionType
        && state.pendingDecision.options.includes(event.option)
      ) {
        selectResumeSourceRoute(state, event.option);
      }
    }
    if (event.type === "tool_observation") {
      state.lastObservation = { toolName: event.toolName, value: event.observation };
      state.artifacts = unique([...state.artifacts, ...(event.artifactIds ?? [])]);
      mergeObservationSlots(state, event.toolName, event.observation);
      if (event.toolName === "commit_job") {
        if (state.rootGoal === "ingest_job") {
          state.activeGoal = "ingest_job";
          state.stage = "completed";
          state.completionStatus = "completed";
        } else {
          state.activeGoal = "resolve_resume_source";
          state.workflowId = "tailor_existing_resume";
          state.stage = "choose_resume_source";
          state.completionStatus = "active";
        }
      } else if (event.toolName === "recommend_resume_source") {
        state.activeGoal = "resolve_resume_source";
        const value = objectValue(event.observation);
        state.knownSlots.sourceRecommendation = value.recommendation;
        state.knownSlots.recommendedResumeId = value.recommendedResumeId;
        state.pendingDecision = {
          type: "resume_source_route",
          options: ["profile", "existing_resume"]
        };
        state.stage = "choose_resume_source";
        state.completionStatus = "waiting_for_user";
      } else if (event.toolName === "create_job_resume_from_profile") {
        const value = objectValue(event.observation);
        const resumeId = stringValue(value.resumeId);
        const revisionId = stringValue(value.revisionId);
        if (resumeId) state.selectedEntities.resumeId = resumeId;
        if (revisionId) state.selectedEntities.revisionId = revisionId;
        state.activeGoal = "analyze_job_fit";
        state.stage = "analyze_fit";
        state.completionStatus = "active";
      } else if (event.toolName === "analyze_job_fit") {
        state.knownSlots.fitAnalysis = objectValue(event.observation).analysis ?? event.observation;
        state.dependencySnapshots.fitResult = dependencySnapshot(state, event.observation);
        if (state.rootGoal === "analyze_job_fit") {
          state.activeGoal = "analyze_job_fit";
          state.stage = "completed";
          state.completionStatus = "completed";
        } else {
          state.activeGoal = "create_tailored_resume";
          state.stage = "generate_plan";
          state.completionStatus = "active";
        }
      } else if (event.toolName === "create_tailoring_session") {
        state.activeGoal = "create_tailored_resume";
        captureTailoringTruth(state, event.observation);
        state.dependencySnapshots.tailoringSession = dependencySnapshot(state, event.observation);
      } else if (event.toolName === "answer_tailoring_question") {
        captureTailoringTruth(state, event.observation);
        state.dependencySnapshots.clarificationAnswers = dependencySnapshot(state, event.observation);
      } else if (event.toolName === "preview_tailoring_changes") {
        state.knownSlots.previewComplete = true;
        state.dependencySnapshots.preview = dependencySnapshot(state, event.observation);
        state.stage = "confirm_apply";
        state.completionStatus = "waiting_for_confirmation";
      } else if (event.toolName === "apply_tailoring_changes") {
        const value = objectValue(event.observation);
        state.knownSlots.qualityResult = value.qualityResult ?? {
          status: "passed",
          factGuard: "passed",
          revisionCreated: Boolean(value.revision ?? value.revisionId)
        };
        state.dependencySnapshots.qualityResult = dependencySnapshot(state, event.observation);
        state.activeGoal = "quality_result";
        state.stage = "quality_result";
        state.completionStatus = "completed";
      } else if (event.toolName === "archive_resume" || event.toolName === "restore_resume") {
        state.stage = "lifecycle_result";
        state.knownSlots.lifecycleResult = event.observation;
        state.completionStatus = "completed";
      }
    }
    if (event.type === "confirmation_requested") {
      state.completionStatus = "waiting_for_confirmation";
      state.knownSlots.pendingConfirmation = {
        toolName: event.toolName,
        operationId: event.operationId
      };
      if (event.toolName === "apply_tailoring_changes") {
        state.dependencySnapshots.pendingApplyConfirmation = dependencySnapshot(state);
      }
    }
    if (event.type === "confirmation_accepted") {
      state.completionStatus = "active";
      if (event.toolName === "apply_tailoring_changes") {
        state.knownSlots.confirmationAccepted = true;
      }
      delete state.knownSlots.pendingConfirmation;
    }
    if (event.type === "confirmation_rejected") {
      state.completionStatus = "waiting_for_user";
      delete state.knownSlots.pendingConfirmation;
      delete state.dependencySnapshots.pendingApplyConfirmation;
    }
    if (event.type === "entity_revision") {
      updateAuthoritativeEntity(state, event);
    }
    if (event.type === "dependencies_invalidated") {
      invalidateDerivedState(state);
    }
    if (event.type === "failed") {
      state.completionStatus = "failed";
      state.lastObservation = { errorCode: event.errorCode };
    }
    return normalize(state);
  }
}

function normalize(state: AgentTaskState): AgentTaskState {
  state.goal = state.rootGoal;
  if (state.workflowId === "tailor_existing_resume") {
    if (state.stage === "select_resume") state.stage = "choose_resume_source";
    if (state.stage === "answer_questions") state.stage = "clarify_unsupported_facts";
    if (state.stage === "completed") state.stage = "quality_result";
  }
  if (
    state.workflowId === "job_ingestion"
    && (
      !["collect_job_identity", "collect_job_description", "parse_job", "confirm_commit", "completed"].includes(state.stage)
      || (state.stage === "parse_job" && hasValue(state.knownSlots.graph))
    )
  ) {
    const hasRawText = hasValue(state.knownSlots.rawText);
    const hasGraph = hasValue(state.knownSlots.graph);
    const identity = ["title", "company"];
    if (!hasRawText) {
      state.stage = "collect_job_description";
      state.requiredSlots = ["rawText"];
    } else if (!hasGraph) {
      state.stage = "parse_job";
      state.requiredSlots = ["rawText"];
    } else {
      const missingIdentity = identity.filter((slot) => !hasValue(state.knownSlots[slot]));
      state.stage = missingIdentity.length ? "complete_job_identity" : "review_job";
      state.requiredSlots = identity;
      if (!missingIdentity.length && state.completionStatus === "active") {
        state.completionStatus = "waiting_for_confirmation";
      }
    }
  } else if (state.workflowId !== "job_ingestion") {
    const workflow = getWorkflowDefinition(state.workflowId);
    state.requiredSlots = workflow?.requiredSlots[state.stage] ?? state.requiredSlots;
  }
  state.missingSlots = state.requiredSlots.filter((slot) => !hasValue(state.knownSlots[slot]));
  return state;
}

function setUserRootGoal(state: AgentTaskState, goal: string) {
  state.rootGoal = goal;
  state.activeGoal = goal;
  state.goal = state.rootGoal;
}

function isFinishedRootTask(state: AgentTaskState) {
  return state.completionStatus === "completed"
    || state.completionStatus === "failed"
    || state.completionStatus === "cancelled";
}

function mergeObservationSlots(state: AgentTaskState, toolName: string, observation: unknown) {
  const value = objectValue(observation);
  if (toolName === "list_resumes") {
    const resumes = Array.isArray(value.resumes) ? value.resumes.map(objectValue) : [];
    const selected = selectResumeReference(resumes, state.knownSlots.resumeReference);
    const id = stringValue(selected?.id);
    if (id) {
      updateAuthoritativeEntity(state, {
        type: "entity_revision",
        entityType: "resume",
        entityId: id,
        version: scalarValue(selected?.revision)
      });
    }
  }
  if (toolName === "list_jobs") {
    const jobs = Array.isArray(value.jobs) ? value.jobs.map(objectValue) : [];
    const selected = selectJobReference(jobs, state.knownSlots.jobReference);
    const id = stringValue(selected?.id);
    if (id) {
      updateAuthoritativeEntity(state, {
        type: "entity_revision",
        entityType: "job",
        entityId: id,
        version: scalarValue(selected?.revision ?? selected?.updatedAt)
      });
    }
  }
  if (toolName === "get_active_profile") {
    const id = stringValue(value.profileId);
    if (id) {
      updateAuthoritativeEntity(state, {
        type: "entity_revision",
        entityType: "profile",
        entityId: id,
        version: scalarValue(value.version)
      });
    }
  }
  if (toolName === "get_profile") {
    const profile = objectValue(value.profile);
    const id = stringValue(profile.id ?? value.profileId);
    if (id) {
      updateAuthoritativeEntity(state, {
        type: "entity_revision",
        entityType: "profile",
        entityId: id,
        version: scalarValue(profile.version ?? value.profileVersion)
      });
    }
  }
  if (toolName === "get_resume") {
    const resume = objectValue(value.resume);
    const id = stringValue(resume.id ?? value.resumeId);
    if (id) {
      updateAuthoritativeEntity(state, {
        type: "entity_revision",
        entityType: "resume",
        entityId: id,
        revisionId: stringValue(resume.currentRevisionId ?? value.resumeRevisionId),
        version: scalarValue(resume.revision),
        hash: stringValue(resume.resumeHash ?? value.resumeHash)
      });
    }
  }
  if (toolName === "get_job") {
    const job = objectValue(value.job);
    const id = stringValue(job.id ?? value.jobId);
    if (id) {
      updateAuthoritativeEntity(state, {
        type: "entity_revision",
        entityType: "job",
        entityId: id,
        version: scalarValue(job.revision ?? job.updatedAt ?? value.jobRevision),
        hash: stringValue(job.jobGraphHash ?? value.jobGraphHash)
      });
    }
  }
  if (toolName === "parse_job_description") {
    state.knownSlots.graph = value.graph ?? value.requirementGraph ?? state.knownSlots.graph;
    state.knownSlots.title = value.candidateTitle ?? value.title ?? state.knownSlots.title;
    state.knownSlots.company = value.candidateCompany ?? value.company ?? state.knownSlots.company;
  }
  if (toolName === "commit_job") {
    const id = stringValue(value.jobId ?? value.id);
    if (id) {
      updateAuthoritativeEntity(state, {
        type: "entity_revision",
        entityType: "job",
        entityId: id,
        version: scalarValue(value.jobRevision ?? value.updatedAt),
        hash: stringValue(value.jobGraphHash)
      });
    }
  }
  if (toolName === "apply_tailoring_changes") {
    const revision = objectValue(value.revision);
    const branch = objectValue(value.branch);
    const id = stringValue(value.revisionId ?? revision.id);
    const branchId = stringValue(value.branchId ?? branch.id);
    if (branchId) state.selectedEntities.resumeId = branchId;
    if (id) {
      state.selectedEntities.revisionId = id;
      state.selectedEntities.resumeRevisionId = id;
    }
    const hash = stringValue(value.resumeHash);
    if (hash) state.selectedEntities.resumeHash = hash;
  }
  if (
    state.knownSlots.sourceRoute === "existing_resume_to_job_revision"
    && state.stage === "choose_resume_source"
    && state.selectedEntities.profileId
    && state.selectedEntities.resumeId
    && state.selectedEntities.jobId
  ) {
    state.activeGoal = "analyze_job_fit";
    state.stage = "analyze_fit";
    state.completionStatus = "active";
  }
}

function captureTailoringTruth(state: AgentTaskState, observation: unknown) {
  const value = objectValue(observation);
  const session = objectValue(value.session);
  const plan = objectValue(session.plan);
  const questions = Array.isArray(plan.clarificationQuestions) ? plan.clarificationQuestions : [];
  const answers = Array.isArray(plan.clarificationAnswers) ? plan.clarificationAnswers : [];
  const tailoringSessionId = stringValue(session.id);
  if (tailoringSessionId) state.selectedEntities.tailoringSessionId = tailoringSessionId;
  const answeredIds = new Set(answers.map((answer) => stringValue(objectValue(answer).questionId)).filter(Boolean));
  const missing = questions.filter((question) => {
    const id = stringValue(objectValue(question).id);
    return id && !answeredIds.has(id);
  });
  state.knownSlots.tailoringSession = value.session;
  state.knownSlots.selectedDiffs = Array.isArray(value.appliedDiffs)
    ? value.appliedDiffs
    : Array.isArray(plan.diffs)
      ? plan.diffs
      : [];
  state.knownSlots.confirmedRequirementIds = answers.flatMap((answer) => {
    const ids = objectValue(answer).requirementIds;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  });
  state.knownSlots.currentClarification = missing[0];
  state.stage = missing.length ? "clarify_unsupported_facts" : "preview_changes";
  state.completionStatus = missing.length ? "waiting_for_user" : "active";
}

function selectResumeSourceRoute(
  state: AgentTaskState,
  option: "profile" | "existing_resume"
) {
  state.pendingDecision = undefined;
  state.completionStatus = "active";
  if (option === "profile") {
    state.knownSlots.sourceRoute = "profile_to_job_resume";
    state.stage = "create_profile_resume";
    return;
  }
  state.knownSlots.sourceRoute = "existing_resume_to_job_revision";
  const recommendedResumeId = stringValue(state.knownSlots.recommendedResumeId);
  if (recommendedResumeId) {
    updateAuthoritativeEntity(state, {
      type: "entity_revision",
      entityType: "resume",
      entityId: recommendedResumeId
    });
  }
  state.activeGoal = "analyze_job_fit";
  state.stage = recommendedResumeId ? "analyze_fit" : "choose_resume_source";
}

function updateAuthoritativeEntity(
  state: AgentTaskState,
  event: Extract<AgentTaskEvent, { type: "entity_revision" }>
) {
  const idKey = `${event.entityType}Id` as "profileId" | "resumeId" | "jobId";
  const previousId = state.selectedEntities[idKey];
  const versionKey = event.entityType === "profile"
    ? "profileVersion"
    : event.entityType === "job"
      ? "jobRevision"
      : undefined;
  const previousVersion = versionKey ? state.selectedEntities[versionKey] : undefined;
  const previousRevisionId = event.entityType === "resume"
    ? state.selectedEntities.resumeRevisionId
    : undefined;
  const previousHash = event.entityType === "resume"
    ? state.selectedEntities.resumeHash
    : event.entityType === "job"
      ? state.selectedEntities.jobGraphHash
      : undefined;
  const changed = Boolean(
    previousId && previousId !== event.entityId
    || previousId === event.entityId && event.version !== undefined && previousVersion !== undefined && event.version !== previousVersion
    || previousId === event.entityId && event.revisionId && previousRevisionId && event.revisionId !== previousRevisionId
    || previousId === event.entityId && event.hash && previousHash && event.hash !== previousHash
  );
  if (changed) invalidateDerivedState(state);
  state.selectedEntities[idKey] = event.entityId;
  if (event.entityType === "profile" && event.version !== undefined) {
    state.selectedEntities.profileVersion = event.version;
  }
  if (event.entityType === "resume") {
    if (event.revisionId) state.selectedEntities.resumeRevisionId = event.revisionId;
    if (event.hash) state.selectedEntities.resumeHash = event.hash;
  }
  if (event.entityType === "job") {
    if (event.version !== undefined) state.selectedEntities.jobRevision = event.version;
    if (event.hash) state.selectedEntities.jobGraphHash = event.hash;
  }
  if (event.revisionId) state.selectedEntities.revisionId = event.revisionId;
}

function invalidateDerivedState(state: AgentTaskState) {
  for (const key of [
    "fitAnalysis",
    "tailoringSession",
    "selectedDiffs",
    "confirmedRequirementIds",
    "currentClarification",
    "previewComplete",
    "confirmationAccepted",
    "qualityResult",
    "pendingConfirmation"
  ]) {
    delete state.knownSlots[key];
  }
  state.pendingDecision = undefined;
  state.dependencySnapshots = {};
  state.selectedEntities.tailoringSessionId = undefined;
  state.selectedEntities.revisionId = undefined;
  if (["apply_to_job", "create_tailored_resume"].includes(state.rootGoal)) {
    state.activeGoal = state.selectedEntities.resumeId ? "analyze_job_fit" : "resolve_resume_source";
    state.workflowId = "tailor_existing_resume";
    state.stage = state.selectedEntities.resumeId ? "analyze_fit" : "choose_resume_source";
    state.completionStatus = "active";
  }
}

export function dependencySnapshot(
  state: AgentTaskState,
  observation?: unknown
): AgentTaskState["dependencySnapshots"]["fitResult"] {
  const value = objectValue(observation);
  const dependencies = objectValue(value.dependencies);
  return {
    profileId: stringValue(dependencies.profileId) ?? state.selectedEntities.profileId,
    profileVersion: scalarValue(dependencies.profileVersion) ?? state.selectedEntities.profileVersion,
    resumeId: stringValue(dependencies.resumeId) ?? state.selectedEntities.resumeId,
    resumeRevisionId: stringValue(dependencies.resumeRevisionId) ?? state.selectedEntities.resumeRevisionId,
    resumeHash: stringValue(dependencies.resumeHash) ?? state.selectedEntities.resumeHash,
    jobId: stringValue(dependencies.jobId) ?? state.selectedEntities.jobId,
    jobRevision: scalarValue(dependencies.jobRevision) ?? state.selectedEntities.jobRevision,
    jobGraphHash: stringValue(dependencies.jobGraphHash) ?? state.selectedEntities.jobGraphHash,
    tailoringSessionId: stringValue(dependencies.tailoringSessionId)
      ?? state.selectedEntities.tailoringSessionId
  };
}

function computeTier(goal: string, message = ""): AgentTaskState["computeTier"] {
  const text = `${goal} ${message}`;
  if (/导出|生成|定制|改写|tailor|apply_to_job/i.test(text)) return "T3";
  if (/分析|匹配|评估|岗位|JD/i.test(text)) return "T2";
  if (/查看|查找|搜索|资料|简历/i.test(text)) return "T1";
  return "T0";
}

function workflowStatus(status: AgentSession["workflowState"]["status"]): AgentTaskState["completionStatus"] {
  if (status === "waiting_for_confirmation") return "waiting_for_confirmation";
  if (status === "waiting_for_user" || status === "paused") return "waiting_for_user";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "active";
}

function looksLikeJd(value: string) {
  return value.trim().length >= 240 && /职责|工作内容|responsibilit/i.test(value) && /要求|任职资格|qualification|requirement/i.test(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function scalarValue(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function captureEntityReferences(state: AgentTaskState, message: string) {
  if (/最新的?通用简历/.test(message)) {
    state.knownSlots.resumeReference = "latest_general";
  } else if (/第二份简历/.test(message)) {
    state.knownSlots.resumeReference = "second";
  }
  const jobMatch = message.match(/针对\s*([^，。,]{2,40}?)(?:做|创建|定制|$)/);
  if (jobMatch?.[1]) state.knownSlots.jobReference = jobMatch[1].trim();
  if (/刚才那个岗位|还是上一份/.test(message)) {
    state.knownSlots.reuseSelectedJob = true;
  }
}

function selectResumeReference(
  resumes: Record<string, unknown>[],
  reference: unknown
) {
  if (reference === "second") return resumes[1];
  if (reference === "latest_general") {
    return resumes
      .filter((resume) => resume.purpose === "general")
      .sort(byLatest)[0];
  }
  if (typeof reference === "string") {
    return resumes.find((resume) => resume.id === reference || resume.name === reference);
  }
  return undefined;
}

function selectJobReference(jobs: Record<string, unknown>[], reference: unknown) {
  if (typeof reference !== "string") return undefined;
  return jobs
    .filter((job) =>
      job.id === reference
      || job.title === reference
      || `${job.title ?? ""}${job.company ?? ""}`.includes(reference)
    )
    .sort(byLatest)[0];
}

function byLatest(left: Record<string, unknown>, right: Record<string, unknown>) {
  return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
}
