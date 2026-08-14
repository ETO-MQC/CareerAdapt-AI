import { z } from "zod";
import type {
  ArtifactRef,
  CareerToolExecutionContext,
  CareerToolPersonProfileBinding,
  CareerToolResult,
  OperationReceipt
} from "../tools/CareerToolGateway";
import {
  buildCareerInteractionPlan,
  CareerInteractionPlanSchema,
  type CareerInformationNeedDraft,
  type CareerInteractionQuestion
} from "@/domain/careerInteraction/CareerInteractionPlan";
import { isTailoringQuestionPaused, normalizeTailoringStage, type TailoringStage } from "./tailoringStage";

export const CareerWorkflowStatusSchema = z.enum([
  "completed",
  "waiting_for_user",
  "waiting_for_confirmation",
  "partial",
  "failed"
]);

export const CareerWorkflowFacadeResultSchema = z.object({
  status: CareerWorkflowStatusSchema,
  /** Canonical Host-owned workflow checkpoint. `nextAction` is only a hint. */
  workflowStage: z.string().min(1),
  nextAction: z.string().optional(),
  userPrompt: z.string().optional(),
  artifactRefs: z.array(z.object({ id: z.string(), kind: z.string(), toolName: z.string(), sourceToolName: z.string() }).passthrough()).optional(),
  receipts: z.array(z.object({ operationId: z.string(), toolName: z.string(), status: z.string(), completedAt: z.string() }).passthrough()).optional(),
  safeError: z.object({ code: z.string(), message: z.string(), recoverable: z.boolean() }).optional(),
  workflowCheckpoint: z.record(z.string(), z.unknown()),
  interactionPlan: CareerInteractionPlanSchema.optional()
}).strict();

export type CareerWorkflowFacadeResult = z.infer<typeof CareerWorkflowFacadeResultSchema>;

const ProfileIntakeTurnInputSchema = z.object({
  userTurn: z.string().min(1).max(24_000),
  agentSessionId: z.string().min(1).optional(),
  profileId: z.string().min(1).optional(),
  expectedProfileRevision: z.number().int().min(0).optional(),
  messageId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
  capturedAt: z.string().datetime({ offset: true }).optional(),
  activeQuestion: z.record(z.string(), z.unknown()).optional(),
  provisionalDraftCheckpoint: z.record(z.string(), z.unknown()).optional()
}).strict();

const ProfileIntakeFinalizeInputSchema = z.object({
  importId: z.string().min(1),
  expectedDraftRevision: z.number().int().min(0)
}).strict();

const ResumeImportInputSchema = z.object({ attachmentId: z.string().min(1) }).strict();
const JobFitInputSchema = z.object({ profileId: z.string().min(1), resumeId: z.string().min(1), jobId: z.string().min(1) }).strict();
const TailorResumeInputSchema = JobFitInputSchema.extend({ intensity: z.enum(["conservative", "balanced", "aggressive"]).optional() }).strict();
const ProfileToResumeInputSchema = z.object({
  targetProfileId: z.string().min(1),
  expectedProfileVersion: z.number().int().min(0),
  acknowledgedActiveProfileId: z.string().min(1).optional(),
  name: z.string().min(1).max(120).optional(),
  purpose: z.enum(["general", "targeted"]).optional()
}).strict();
const ComposeResumeInputSchema = z.object({
  profileId: z.string().min(1),
  expectedProfileRevision: z.number().int().min(1),
  mode: z.enum(["general", "job_specific"]),
  jobId: z.string().min(1).optional(),
  sourceResumeId: z.string().min(1).optional(),
  checkpointId: z.string().min(1).optional(),
  name: z.string().min(1).max(120).optional(),
  generalResumeMode: z.enum(["create_new", "update_existing"]).optional(),
  targetDirection: z.string().trim().min(1).max(160).optional(),
  targetAudience: z.string().trim().min(1).max(160).optional(),
  companyType: z.string().trim().min(1).max(160).optional(),
  acknowledgedActiveProfileId: z.string().min(1).optional(),
  userPreferences: z.record(z.string(), z.unknown()).optional()
}).strict().superRefine((input, context) => {
  if (input.mode === "job_specific" && !input.jobId) context.addIssue({ code: "custom", path: ["jobId"], message: "jobId is required for job-specific composition" });
});
const ResumeExportInputSchema = z.object({ resumeId: z.string().min(1), templateId: z.string().min(1).optional() }).strict();

export type CareerWorkflowFacadeDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  personProfileBinding: CareerToolPersonProfileBinding;
};

export const CAREER_WORKFLOW_FACADE_DEFINITIONS: CareerWorkflowFacadeDefinition[] = [
  { name: "career.workflow.profile_intake_turn", description: "Normal Profile Intake turn. Capture the authoritative user turn, merge the provisional draft, compute gaps, then stop with one next action.", inputSchema: ProfileIntakeTurnInputSchema, personProfileBinding: "required" },
  { name: "career.workflow.profile_intake_finalize", description: "Finalize all Profile Intake source turns into one grounded final review draft. Stops for user review and never commits the Profile.", inputSchema: ProfileIntakeFinalizeInputSchema, personProfileBinding: "required" },
  { name: "career.workflow.resume_import", description: "Import one staged CareerAdapt attachment through the existing local parser and return the review checkpoint. Never accepts file bytes or paths.", inputSchema: ResumeImportInputSchema, personProfileBinding: "required" },
  { name: "career.workflow.job_fit", description: "Run the existing deterministic Job Fit workflow and return its terminal artifact.", inputSchema: JobFitInputSchema, personProfileBinding: "required" },
  { name: "career.workflow.tailor_resume", description: "Start the existing isolated Job Resume tailoring workflow and stop for the next question or review boundary.", inputSchema: TailorResumeInputSchema, personProfileBinding: "required" },
  { name: "career.workflow.profile_to_resume", description: "Create or reuse an isolated general resume from the confirmed Profile without writing resume content back to Profile.", inputSchema: ProfileToResumeInputSchema, personProfileBinding: "required" },
  { name: "career.workflow.compose_resume", description: "Build an evidence graph and resume blueprint, show a grounded proposal, then write an isolated general or job-specific ResumeRevision only after explicit confirmation.", inputSchema: ComposeResumeInputSchema, personProfileBinding: "required" },
  { name: "career.workflow.resume_export", description: "Create the existing Preview/PDF export artifact for a selected resume.", inputSchema: ResumeExportInputSchema, personProfileBinding: "optional" }
];

type ExecuteAtomic = (name: string, input: unknown, context: CareerToolExecutionContext) => Promise<CareerToolResult>;

export async function executeCareerWorkflowFacade(
  name: string,
  rawInput: unknown,
  context: CareerToolExecutionContext,
  operationId: string,
  executeAtomic: ExecuteAtomic
): Promise<{ data: CareerWorkflowFacadeResult; artifacts: ArtifactRef[]; receipts: OperationReceipt[] }> {
  const definition = CAREER_WORKFLOW_FACADE_DEFINITIONS.find((candidate) => candidate.name === name);
  if (!definition) throw Object.assign(new Error("unknown_career_workflow"), { code: "unknown_career_workflow" });
  const input = definition.inputSchema.parse(rawInput) as Record<string, unknown>;
  const call = async (toolName: string, value: unknown, index = 0) => executeAtomic(toolName, value, {
    ...context,
    operationId: `${operationId}-${index + 1}`
  });

  if (name === "career.workflow.profile_intake_turn") {
    const result = await call("career.profile.capture_intake", {
      sessionId: requiredString(input.agentSessionId, "agentSessionId"),
      messageId: requiredString(input.messageId, "messageId"),
      turnId: requiredString(input.turnId, "turnId"),
      text: input.userTurn,
      capturedAt: typeof input.capturedAt === "string" ? input.capturedAt : new Date().toISOString(),
      targetProfileId: requiredString(input.profileId, "profileId"),
      expectedProfileVersion: requiredNumber(input.expectedProfileRevision, "expectedProfileRevision"),
      ...profileIntakeCheckpointFields(input)
    });
    return facadeFromAtomic(name, operationId, result, "waiting_for_user", "ask_high_value_gap", "请根据交互规划，在确有必要时只确认一项会改变整理结果的事实。", {
      kind: "profile_intake_turn",
      profileId: input.profileId,
      expectedProfileRevision: input.expectedProfileRevision,
      understood: compactData(result.data, [
        "importId", "expectedDraftRevision", "persistenceStatus", "candidateCount", "usableCandidateCount",
        "quarantinedCandidateCount", "nextTurnPlan", "interviewPlan", "followUpQuestion",
        "candidates", "reviewProjection", "artifactPayload", "intakeSession", "persistenceReceipt",
        "providerStatus", "extractionStatus"
      ]),
      provisionalDraftCheckpoint: input.provisionalDraftCheckpoint
    }, context);
  }
  if (name === "career.workflow.profile_intake_finalize") {
    const result = await call("career.profile.synthesize_intake", input);
    return facadeFromAtomic(name, operationId, result, "waiting_for_user", "show_final_review", "请展示一次最终资料草稿并等待用户编辑、忽略、新增或全部采用。", {
      kind: "profile_intake_final_review",
      profileId: context.careerSessionBinding?.profileId,
      synthesis: compactData(result.data, [
        "importId", "expectedDraftRevision", "candidateCount", "reviewProgress", "finalSynthesis",
        "reviewProjection", "artifactPayload", "candidates", "intakeSession", "interviewPlan",
        "persistenceReceipt", "finalReviewCount", "finalCareerWriting"
      ])
    }, context);
  }
  if (name === "career.workflow.resume_import") {
    const result = await call("career.resume.import.prepare", input);
    return facadeFromAtomic(name, operationId, result, "waiting_for_user", "review_import", "简历已由 CareerAdapt 本地解析，请展示核对入口并等待用户决定。", {
      kind: "resume_import_review",
      attachmentId: input.attachmentId,
      import: compactData(result.data, [
        "importId", "expectedDraftRevision", "candidateCount", "needsConfirmationCount", "providerStatus",
        "extractionStatus", "persistenceReceipt", "sourceKind", "sourceType", "fileName", "sourceFile",
        "reviewSummary", "artifactPayload", "warnings", "status"
      ])
    }, context);
  }
  if (name === "career.workflow.job_fit") {
    const result = await call("career.job.analyze_fit", input);
    return facadeFromAtomic(name, operationId, result, "completed", "explain_job_fit", undefined, {
      kind: "job_fit",
      profileId: input.profileId,
      resumeId: input.resumeId,
      jobId: input.jobId,
      result: compactData(result.data, ["fitAnalysisId", "score", "matched", "gaps", "artifactId", "resumeRevision"])
    }, context);
  }
  if (name === "career.workflow.tailor_resume") {
    const result = await call("career.tailoring.create_session", input);
    const createdSession = result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>).session
      : undefined;
    return facadeFromAtomic(name, operationId, result, "waiting_for_user", "ask_current_tailoring_question", "请只询问当前定制会话返回的下一题。", {
      kind: "tailoring_session",
      workflowStage: "generate_plan",
      profileId: input.profileId,
      resumeId: input.resumeId,
      jobId: input.jobId,
      // Keep the authoritative persisted session intact. Subsequent native
      // tailoring steps parse this checkpoint as TailoringSessionSchema; a
      // shallow summary would lose the plan/branch/job context and force the
      // artifact reducer to fall back to a pending entity id.
      session: createdSession
    }, context);
  }
  if (name === "career.workflow.profile_to_resume") {
    const { purpose, ...atomicInput } = input;
    const result = await call("career.resume.ensure_general_from_profile", atomicInput);
    return facadeFromAtomic(name, operationId, result, "completed", "open_resume", undefined, {
      kind: "profile_to_resume",
      profileId: input.targetProfileId,
      expectedProfileVersion: input.expectedProfileVersion,
      purpose,
      result: compactData(result.data, ["resumeId", "revision", "created", "profileId", "artifactId"])
    }, context);
  }
  if (name === "career.workflow.compose_resume") {
    if (context.confirmed && typeof input.checkpointId === "string" && input.checkpointId.trim()) {
      const composed = await call("career.resume.compose", input, 1);
      const composedData = objectValue(composed.data);
      return facadeFromAtomic(name, operationId, composed, "completed", "open_resume", undefined, {
        kind: "resume_composition",
        ...objectValue(composedData.checkpoint),
        profileId: input.profileId,
        expectedProfileRevision: input.expectedProfileRevision,
        mode: input.mode,
        jobId: input.jobId,
        sourceResumeId: input.sourceResumeId,
        checkpointId: input.checkpointId,
        compositionResult: composedData.composition,
        result: compactData(composed.data, ["resumeId", "revisionId", "revision", "mode", "idempotent"])
      }, context);
    }
    const plan = await call("career.resume.plan_composition", input);
    if (!plan.ok) {
      return facadeFromAtomic(name, operationId, plan, "waiting_for_confirmation", "review_composition", "组装方案暂时没有完成，请先查看安全错误并重试。", {
        kind: "resume_composition",
        profileId: input.profileId,
        mode: input.mode,
        planError: plan.error
      }, context);
    }
    const planned = objectValue(plan.data);
    const persistedCheckpoint = objectValue(planned.checkpoint);
      const checkpoint: Record<string, unknown> = {
        kind: "resume_composition",
        ...persistedCheckpoint,
      profileId: input.profileId,
      expectedProfileRevision: input.expectedProfileRevision,
      mode: input.mode,
      jobId: input.jobId,
      sourceResumeId: input.sourceResumeId,
      checkpointId: stringValue(planned.checkpointId) ?? stringValue(persistedCheckpoint.checkpointId),
      targetDirection: input.targetDirection,
      targetAudience: input.targetAudience,
      companyType: input.companyType,
      proposal: planned.compositionProposal,
      evidenceGraph: planned.evidenceGraph,
      blueprint: planned.blueprint,
      reviewResult: planned.reviewResult,
      metrics: planned.metrics,
      keywordCoverage: planned.keywordCoverage,
      informationNeeds: planned.informationNeeds,
      compositionResult: planned.composition,
      writingExecution: planned.writingExecution,
      telemetry: planned.telemetry,
        planReceipt: plan.receipt
      };
    if (!context.confirmed && (context.confirmationCount ?? 0) < 1) {
      return facadeFromAtomic(name, operationId, plan, "waiting_for_confirmation", "review_composition", "组装提案已准备好。你可以直接生成，也可以补充最多两项可选信息后再生成。", checkpoint, context);
    }
    const composed = await call("career.resume.compose", {
      ...input,
      checkpointId: stringValue(planned.checkpointId) ?? stringValue(persistedCheckpoint.checkpointId)
    }, 1);
      return facadeFromAtomic(name, operationId, composed, "completed", "open_resume", undefined, {
        ...checkpoint,
      compositionResult: objectValue(composed.data).composition,
      result: compactData(composed.data, ["resumeId", "revisionId", "revision", "mode", "idempotent"])
    }, context);
  }
  const result = await call("career.export.resume", input);
  return facadeFromAtomic(name, operationId, result, "completed", "open_export", undefined, {
    kind: "resume_export",
    resumeId: input.resumeId,
    result: compactData(result.data, ["resumeId", "revision", "artifactId", "previewArtifactId", "pdfArtifactId", "fileName"])
  }, context);
}

function facadeFromAtomic(
  facadeName: string,
  operationId: string,
  result: CareerToolResult,
  successStatus: CareerWorkflowFacadeResult["status"],
  nextAction: string,
  userPrompt: string | undefined,
  workflowCheckpoint: Record<string, unknown>,
  context?: CareerToolExecutionContext
) {
  const status: CareerWorkflowFacadeResult["status"] = result.ok
    ? successStatus
    : result.receipt.status === "confirmation_required"
      ? "waiting_for_confirmation"
      : result.error?.recoverable ? "partial" : "failed";
  const facadeReceipt: OperationReceipt = {
    operationId,
    toolName: facadeName,
    idempotencyKey: operationId,
    status: status === "failed" || status === "partial" ? "failed" : status === "waiting_for_confirmation" ? "confirmation_required" : "completed",
    completedAt: new Date().toISOString()
  };
  const workflowStage = facadeWorkflowStage(facadeName, result, workflowCheckpoint);
  const projectedNextAction = facadeName === "career.workflow.tailor_resume"
    ? workflowStage === "clarify_unsupported_facts"
      ? "ask_current_tailoring_question"
      : workflowStage === "generate_changes"
        ? "generate_tailoring_changes"
        : workflowStage === "preview_changes"
          ? "review_tailoring_diff"
          : nextAction
    : nextAction;
  const projectedPrompt = facadeName === "career.workflow.tailor_resume"
    ? workflowStage === "clarify_unsupported_facts"
      ? "请只询问当前定制会话返回的下一题。"
      : workflowStage === "generate_changes"
        ? "澄清已完成，可以生成定制修改建议。"
        : userPrompt
    : userPrompt;
  return {
    data: CareerWorkflowFacadeResultSchema.parse({
      status,
      workflowStage,
      nextAction: status === "waiting_for_confirmation" ? "request_confirmation" : projectedNextAction,
      userPrompt: status === "waiting_for_confirmation" ? "这一步需要你的明确确认。" : projectedPrompt,
      artifactRefs: result.artifacts,
      receipts: [result.receipt, facadeReceipt],
      safeError: result.error ? { code: result.error.code, message: result.error.message, recoverable: result.error.recoverable } : undefined,
      workflowCheckpoint,
      interactionPlan: buildFacadeInteractionPlan({ facadeName, result, workflowCheckpoint, context })
    }),
    artifacts: result.artifacts,
    receipts: [result.receipt, facadeReceipt]
  };
}

function facadeWorkflowStage(
  facadeName: string,
  result: CareerToolResult,
  checkpoint: Record<string, unknown>
) {
  if (facadeName === "career.workflow.tailor_resume") {
    const declared = normalizeTailoringStage(stringValue(checkpoint.workflowStage) ?? "");
    const data = objectValue(result.data);
    const session = objectValue(data.session ?? checkpoint.session);
    const plan = objectValue(session.plan);
    const questionPlan = objectValue(plan.questionPlan);
    if (isTailoringQuestionPaused(session)) return "clarify_unsupported_facts" satisfies TailoringStage;
    if (plan.generationStatus === "completed" || questionPlan.status === "completed") return "preview_changes" satisfies TailoringStage;
    if (questionPlan.status === "ready_for_generation" || plan.generationStatus === "ready_for_generation") return "generate_changes" satisfies TailoringStage;
    return declared ?? "generate_plan" satisfies TailoringStage;
  }
  const stages: Record<string, string> = {
    "career.workflow.profile_intake_turn": "collect_experience",
    "career.workflow.profile_intake_finalize": "final_review",
    "career.workflow.resume_import": "import_review",
    "career.workflow.job_fit": "review_result",
    "career.workflow.profile_to_resume": "resume_ready",
    "career.workflow.compose_resume": "review_composition",
    "career.workflow.resume_export": "export_ready"
  };
  return stringValue(checkpoint.workflowStage) ?? stages[facadeName] ?? "completed";
}

function buildFacadeInteractionPlan(input: {
  facadeName: string;
  result: CareerToolResult;
  workflowCheckpoint: Record<string, unknown>;
  context?: CareerToolExecutionContext;
}) {
  const data = objectValue(input.result.data);
  const checkpoint = input.workflowCheckpoint;
  const binding = input.context?.careerSessionBinding;
  const needs: CareerInformationNeedDraft[] = [];
  let recommendedNextQuestion: CareerInteractionQuestion | undefined;

  if (input.facadeName === "career.workflow.profile_intake_turn") {
    const nextTurn = objectValue(data.nextTurnPlan);
    const activeQuestion = objectValue(objectValue(data.interviewPlan).activeQuestion);
    const question = stringValue(nextTurn.question) ?? stringValue(data.followUpQuestion) ?? stringValue(activeQuestion.question);
    const candidateId = stringValue(nextTurn.candidateId) ?? stringValue(activeQuestion.candidateId);
    const dimension = stringValue(nextTurn.dimension) ?? stringValue(activeQuestion.dimension);
    if (question) {
      const needId = `profile-intake:${candidateId ?? "current"}:${dimension ?? "detail"}`;
      needs.push({
        id: needId,
        type: "factual_gap",
        ...(candidateId ? { targetAssetId: candidateId } : {}),
        ...(dimension ? { dimension } : {}),
        importance: 0.9,
        reason: question,
        answerChangesOutcome: true,
        required: false,
        alreadyAsked: false,
        priorityFactors: {
          missingDimensionWeight: 0.9,
          careerAssetImportance: 0.9,
          expectedArtifactImpact: 0.9,
          currentReadinessGap: 0.7
        }
      });
      recommendedNextQuestion = {
        needId,
        question,
        ...(candidateId ? { targetAssetId: candidateId } : {}),
        ...(dimension ? { dimension } : {})
      };
    }
  } else if (input.facadeName === "career.workflow.resume_import") {
    if (Number(data.needsConfirmationCount ?? 0) > 0) {
      needs.push({
        id: "resume-import:review",
        type: "confirmation",
        importance: 0.85,
        reason: "解析结果中有内容需要你核对；我会先把来源和冲突集中展示。",
        answerChangesOutcome: true,
        required: true,
        alreadyAsked: false,
        priorityFactors: { expectedArtifactImpact: 0.85, currentReadinessGap: 0.5 }
      });
    }
  } else if (input.facadeName === "career.workflow.tailor_resume") {
    const session = objectValue(data.session ?? checkpoint.session);
    const plan = objectValue(session.plan);
    const questions = arrayValue(plan.clarificationQuestions);
    const activeId = stringValue(objectValue(plan.questionPlan).activeQuestionId);
    const active = questions
      .map(objectValue)
      .find((question) => (activeId ? question.id === activeId : true) && !["answered", "skipped"].includes(String(question.status ?? "")));
    if (active) {
      const question = stringValue(active.question);
      if (question) {
        const needId = `tailoring:${stringValue(active.id) ?? "clarification"}`;
        needs.push({
          id: needId,
          type: "factual_gap",
          ...(stringValue(active.targetContentItemId) ? { targetAssetId: stringValue(active.targetContentItemId) } : {}),
          importance: 0.82,
          reason: question,
          answerChangesOutcome: true,
          required: false,
          alreadyAsked: false,
          priorityFactors: { expectedArtifactImpact: 0.9, currentReadinessGap: 0.6, jobRelevance: 0.9 }
        });
        recommendedNextQuestion = { needId, question };
      }
    }
  } else if (input.facadeName === "career.workflow.profile_to_resume") {
    // A general resume is safe when intent is absent, but a single preference
    // question can improve the next revision without blocking this artifact.
    const purpose = stringValue(checkpoint.purpose);
    if (purpose === "general" || purpose === "targeted") {
      // The page/conversation already supplied the preference; no extra
      // interview is needed after the artifact has been created.
    } else {
    const needId = "profile-to-resume:target-direction";
    needs.push({
      id: needId,
      type: "user_preference",
      importance: 0.38,
      reason: "这份简历主要准备投什么方向？如果暂时没有明确方向，我先保留为通用简历。",
      answerChangesOutcome: true,
      required: false,
      alreadyAsked: false,
      priorityFactors: { expectedArtifactImpact: 0.45, lowValueOptionalPenalty: 0.25 }
    });
    recommendedNextQuestion = { needId, question: needs[0].reason };
    }
  } else if (input.facadeName === "career.workflow.compose_resume") {
    const compositionNeeds = arrayValue(data.informationNeeds ?? checkpoint.informationNeeds);
    for (const [index, value] of compositionNeeds.slice(0, 2).entries()) {
      const item = objectValue(value);
      const question = stringValue(item.question);
      if (!question) continue;
      const needId = stringValue(item.id) ?? `resume-composition:need:${index + 1}`;
      needs.push({
        id: needId,
        type: "factual_gap",
        importance: 0.58,
        reason: question,
        answerChangesOutcome: true,
        required: false,
        alreadyAsked: false,
        priorityFactors: { expectedArtifactImpact: 0.65, currentReadinessGap: 0.35, jobRelevance: 0.8 }
      });
      if (!recommendedNextQuestion) recommendedNextQuestion = { needId, question };
    }
  } else if (input.facadeName === "career.workflow.job_fit") {
    const questions = arrayValue(data.questions ?? data.ambiguousFacts);
    for (const [index, value] of questions.slice(0, 3).entries()) {
      const question = typeof value === "string" ? value : stringValue(objectValue(value).question);
      if (!question) continue;
      const needId = `job-fit:ambiguity:${index + 1}`;
      needs.push({
        id: needId,
        type: "factual_gap",
        importance: 0.8,
        reason: question,
        answerChangesOutcome: true,
        required: false,
        alreadyAsked: false,
        priorityFactors: { expectedArtifactImpact: 0.9, jobRelevance: 1 }
      });
      if (!recommendedNextQuestion) recommendedNextQuestion = { needId, question };
    }
  }

  const knownContext = {
    person: binding?.personId ? { id: binding.personId } : undefined,
    profile: binding?.profileId ? { id: binding.profileId, revision: binding.profileRevision } : undefined,
    resumes: stringValue(checkpoint.resumeId) ? [{ id: checkpoint.resumeId }] : undefined,
    job: stringValue(checkpoint.jobId) ? { id: checkpoint.jobId } : undefined,
    activeCareerAssets: checkpoint.understood,
    existingDecisions: checkpoint.result ?? checkpoint.synthesis
  };
  const objective = {
    "career.workflow.profile_intake_turn": "把真实经历整理成可复用、可核验的职业资产",
    "career.workflow.profile_intake_finalize": "汇总经历并交给用户做一次最终审核",
    "career.workflow.resume_import": "把现有简历整理进资料体系并保留来源",
    "career.workflow.job_fit": "用已确认证据分析岗位匹配与真实缺口",
    "career.workflow.tailor_resume": "在不改变事实边界的前提下准备岗位简历",
    "career.workflow.profile_to_resume": "从已确认资料生成一份与资料库隔离的简历",
    "career.workflow.compose_resume": "从证据图和蓝图生成一份可核验、与资料库隔离的简历",
    "career.workflow.resume_export": "检查已选简历并准备预览或导出"
  }[input.facadeName] ?? "完成当前职业任务";
  return buildCareerInteractionPlan({
    workflow: input.facadeName,
    objective,
    knownContext,
    informationNeeds: needs,
    ...(recommendedNextQuestion ? { recommendedNextQuestion } : {}),
    canProceedWithoutQuestion: true,
    ...(needs.length === 0 ? { stopReason: input.result.ok ? "当前步骤没有需要用户补充的关键信息。" : input.result.error?.message } : {}),
    interactionSummary: input.result.ok ? "已完成当前步骤的资料读取与安全规划。" : "当前步骤未完成，保留已有资料并等待恢复。"
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function profileIntakeCheckpointFields(input: Record<string, unknown>) {
  const active = input.activeQuestion && typeof input.activeQuestion === "object" && !Array.isArray(input.activeQuestion)
    ? input.activeQuestion as Record<string, unknown>
    : {};
  const draft = input.provisionalDraftCheckpoint && typeof input.provisionalDraftCheckpoint === "object" && !Array.isArray(input.provisionalDraftCheckpoint)
    ? input.provisionalDraftCheckpoint as Record<string, unknown>
    : {};
  return {
    ...(typeof active.questionId === "string" ? { intakeQuestionId: active.questionId } : {}),
    ...(typeof active.candidateId === "string" ? { intakeCandidateId: active.candidateId } : {}),
    ...(typeof active.dimension === "string" ? { intakeDimension: active.dimension } : {}),
    ...(typeof draft.importId === "string" ? { importId: draft.importId } : {}),
    ...(typeof draft.draftRevision === "number" ? { expectedDraftRevision: draft.draftRevision } : {})
  };
}

function requiredString(value: unknown, field: string) {
  if (typeof value === "string" && value.trim()) return value;
  throw Object.assign(new Error(`${field} is required at the CareerAdapt boundary`), { code: "career_workflow_context_required" });
}

function requiredNumber(value: unknown, field: string) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  throw Object.assign(new Error(`${field} is required at the CareerAdapt boundary`), { code: "career_workflow_context_required" });
}

function compactData(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
}
