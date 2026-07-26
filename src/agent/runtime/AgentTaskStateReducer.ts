import type { AgentSession, AgentTaskState } from "@/agent/contracts/agentSession";
import { getWorkflowDefinition } from "@/agent/workflows/workflowRegistry";
import {
  deriveNextLegalStage,
  TaskContinuationResolver
} from "./TaskContinuationResolver";

export type AgentTaskEvent =
  | { type: "user_message"; message: string; goal?: string }
  | { type: "slot_answer"; slot: string; value: unknown }
  | { type: "tool_observation"; toolName: string; observation: unknown; artifactIds?: string[] }
  | { type: "confirmation_requested"; toolName: string; operationId: string }
  | { type: "confirmation_accepted"; toolName: string }
  | { type: "confirmation_rejected"; toolName: string }
  | { type: "entity_revision"; entityType: "profile" | "resume" | "job"; entityId: string; revisionId?: string }
  | { type: "failed"; errorCode: string };

export class AgentTaskStateReducer {
  create(session: AgentSession, goal = session.memory?.currentGoal ?? "conversation"): AgentTaskState {
    const now = new Date().toISOString();
    const knownSlots = { ...session.workflowState.data };
    const state: AgentTaskState = {
      goal,
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
      artifacts: session.artifactRefs.map((artifact) => artifact.id),
      completionStatus: workflowStatus(session.workflowState.status),
      computeTier: computeTier(goal),
      updatedAt: now
    };
    return normalize(state);
  }

  reduce(previous: AgentTaskState, event: AgentTaskEvent): AgentTaskState {
    const state = structuredClone(previous);
    state.updatedAt = new Date().toISOString();
    if (event.type === "user_message") {
      const continuation = new TaskContinuationResolver().resolve(state, event.message);
      if (continuation.consumed) {
        if (continuation.goal) state.goal = continuation.goal;
        Object.assign(state.knownSlots, continuation.slotUpdates);
        if (continuation.intent === "continue") {
          state.stage = deriveNextLegalStage(state);
        }
        state.completionStatus = "active";
        state.computeTier = computeTier(state.goal, event.message);
        return normalize(state);
      }
      if (event.goal) state.goal = event.goal;
      if (state.completionStatus !== "waiting_for_confirmation") state.completionStatus = "active";
      if (/基于现有简历.*岗位定制|定制简历|创建.*岗位简历|创建.*定制简历/i.test(event.message)) {
        state.goal = "create_tailored_resume";
        state.workflowId = "tailor_existing_resume";
      } else if (/分析.*(岗位|职位).*(匹配|适配)|匹配度/i.test(event.message)) {
        state.goal = "analyze_job_fit";
        state.workflowId = "analyze_job_fit";
      } else if (/导入.*简历|上传.*简历/i.test(event.message)) {
        state.goal = "import_resume";
      } else if (/从资料库.*(生成|创建).*简历/i.test(event.message)) {
        state.goal = "create_resume_from_profile";
      } else if (/导出.*简历/i.test(event.message)) {
        state.goal = "export_resume";
      } else if (/归档.*简历/i.test(event.message)) {
        state.goal = "archive_resume";
      } else if (/恢复.*简历/i.test(event.message)) {
        state.goal = "restore_resume";
      }
      captureEntityReferences(state, event.message);
      if (looksLikeJd(event.message)) {
        state.goal = "ingest_job";
        state.workflowId = "job_ingestion";
        state.stage = "parse_job";
        state.knownSlots.rawText = event.message.trim();
      } else if (/应聘|申请.*岗位|这工作.*试试|想试试.*岗位/i.test(event.message)) {
        state.goal = "apply_to_job";
      }
      if (/从资料库|资料库生成|路线\s*A/i.test(event.message)) {
        state.knownSlots.sourceRoute = "profile_to_job_resume";
        state.stage = "create_profile_resume";
      } else if (/已有简历|现有简历|路线\s*B/i.test(event.message)) {
        state.knownSlots.sourceRoute = "existing_resume_to_job_revision";
        const recommendedResumeId = stringValue(state.knownSlots.recommendedResumeId);
        if (recommendedResumeId) state.selectedEntities.resumeId = recommendedResumeId;
        state.stage = recommendedResumeId ? "analyze_fit" : "choose_resume_source";
      }
      state.computeTier = computeTier(state.goal, event.message);
    }
    if (event.type === "slot_answer") {
      state.knownSlots[event.slot] = event.value;
      state.completionStatus = "active";
    }
    if (event.type === "tool_observation") {
      state.lastObservation = { toolName: event.toolName, value: event.observation };
      state.artifacts = unique([...state.artifacts, ...(event.artifactIds ?? [])]);
      mergeObservationSlots(state, event.toolName, event.observation);
      if (event.toolName === "commit_job") {
        state.stage = state.goal === "ingest_job" ? "completed" : "choose_resume_source";
        state.completionStatus = state.goal === "ingest_job" ? "completed" : "active";
      } else if (event.toolName === "recommend_resume_source") {
        const value = objectValue(event.observation);
        state.knownSlots.sourceRecommendation = value.recommendation;
        state.knownSlots.recommendedResumeId = value.recommendedResumeId;
        state.stage = "choose_resume_source";
        state.completionStatus = "waiting_for_user";
      } else if (event.toolName === "create_job_resume_from_profile") {
        const value = objectValue(event.observation);
        const resumeId = stringValue(value.resumeId);
        const revisionId = stringValue(value.revisionId);
        if (resumeId) state.selectedEntities.resumeId = resumeId;
        if (revisionId) state.selectedEntities.revisionId = revisionId;
        state.stage = "analyze_fit";
        state.completionStatus = "active";
      } else if (event.toolName === "analyze_job_fit") {
        state.knownSlots.fitAnalysis = objectValue(event.observation).analysis ?? event.observation;
        state.stage = state.goal === "analyze_job_fit" ? "completed" : "generate_plan";
        state.completionStatus = state.goal === "analyze_job_fit" ? "completed" : "active";
      } else if (event.toolName === "create_tailoring_session") {
        captureTailoringTruth(state, event.observation);
      } else if (event.toolName === "answer_tailoring_question") {
        captureTailoringTruth(state, event.observation);
      } else if (event.toolName === "preview_tailoring_changes") {
        state.knownSlots.previewComplete = true;
        state.stage = "confirm_apply";
        state.completionStatus = "waiting_for_confirmation";
      } else if (event.toolName === "apply_tailoring_changes") {
        const value = objectValue(event.observation);
        state.knownSlots.qualityResult = value.qualityResult ?? {
          status: "passed",
          factGuard: "passed",
          revisionCreated: Boolean(value.revision ?? value.revisionId)
        };
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
    }
    if (event.type === "confirmation_accepted") {
      state.completionStatus = "active";
      state.knownSlots.confirmationAccepted = true;
      delete state.knownSlots.pendingConfirmation;
    }
    if (event.type === "confirmation_rejected") {
      state.completionStatus = "waiting_for_user";
      delete state.knownSlots.pendingConfirmation;
    }
    if (event.type === "entity_revision") {
      const key = `${event.entityType}Id` as "profileId" | "resumeId" | "jobId";
      state.selectedEntities[key] = event.entityId;
      if (event.revisionId) state.selectedEntities.revisionId = event.revisionId;
    }
    if (event.type === "failed") {
      state.completionStatus = "failed";
      state.lastObservation = { errorCode: event.errorCode };
    }
    return normalize(state);
  }
}

function normalize(state: AgentTaskState): AgentTaskState {
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

function mergeObservationSlots(state: AgentTaskState, toolName: string, observation: unknown) {
  const value = objectValue(observation);
  if (toolName === "list_resumes") {
    const resumes = Array.isArray(value.resumes) ? value.resumes.map(objectValue) : [];
    const selected = selectResumeReference(resumes, state.knownSlots.resumeReference);
    const id = stringValue(selected?.id);
    if (id) state.selectedEntities.resumeId = id;
  }
  if (toolName === "list_jobs") {
    const jobs = Array.isArray(value.jobs) ? value.jobs.map(objectValue) : [];
    const selected = selectJobReference(jobs, state.knownSlots.jobReference);
    const id = stringValue(selected?.id);
    if (id) state.selectedEntities.jobId = id;
  }
  if (toolName === "get_active_profile") {
    const id = stringValue(value.profileId);
    if (id) state.selectedEntities.profileId = id;
  }
  if (toolName === "get_profile") {
    const profile = objectValue(value.profile);
    const id = stringValue(profile.id ?? value.profileId);
    if (id) state.selectedEntities.profileId = id;
  }
  if (toolName === "parse_job_description") {
    state.knownSlots.graph = value.graph ?? value.requirementGraph ?? state.knownSlots.graph;
    state.knownSlots.title = value.candidateTitle ?? value.title ?? state.knownSlots.title;
    state.knownSlots.company = value.candidateCompany ?? value.company ?? state.knownSlots.company;
  }
  if (toolName === "commit_job") {
    const id = stringValue(value.jobId ?? value.id);
    if (id) state.selectedEntities.jobId = id;
  }
  if (toolName === "apply_tailoring_changes") {
    const revision = objectValue(value.revision);
    const branch = objectValue(value.branch);
    const id = stringValue(value.revisionId ?? revision.id);
    if (id) state.selectedEntities.revisionId = id;
    const branchId = stringValue(value.branchId ?? branch.id);
    if (branchId) state.selectedEntities.resumeId = branchId;
  }
}

function captureTailoringTruth(state: AgentTaskState, observation: unknown) {
  const value = objectValue(observation);
  const session = objectValue(value.session);
  const plan = objectValue(session.plan);
  const questions = Array.isArray(plan.clarificationQuestions) ? plan.clarificationQuestions : [];
  const answers = Array.isArray(plan.clarificationAnswers) ? plan.clarificationAnswers : [];
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
