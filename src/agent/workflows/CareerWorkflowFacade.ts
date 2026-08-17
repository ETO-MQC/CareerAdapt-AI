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
import { JobRequirementGraphV4Schema, JobTargetPersistenceSchema, JobTargetSnapshotSchema } from "@/domain/schemas";
import { createPastedJobTargetSnapshot, jobTargetSnapshotHash } from "@/domain/jobTarget/jobTargetSnapshot";

export const CareerWorkflowStatusSchema = z.enum([
  "completed",
  "waiting_for_user",
  "waiting_for_confirmation",
  "working",
  "review_ready",
  "recoverable_failure",
  "partial",
  "failed"
]);

export const CareerWorkflowFacadeResultSchema = z.object({
  status: CareerWorkflowStatusSchema,
  /** Canonical Host-owned workflow checkpoint. `nextAction` is only a hint. */
  workflowStage: z.string().min(1),
  nextAction: z.string().optional(),
  userPrompt: z.string().optional(),
  checkpointId: z.string().min(1).optional(),
  interaction: z.record(z.string(), z.unknown()).optional(),
  review: z.record(z.string(), z.unknown()).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
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
const TailorTargetInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("saved_job"), jobId: z.string().min(1) }).strict(),
  z.object({
    type: z.literal("pasted_jd"),
    text: z.string().trim().min(20).max(24_000),
    title: z.string().trim().min(1).max(160).optional(),
    company: z.string().trim().min(1).max(160).optional(),
    sourceUrl: z.string().url().optional(),
    persistence: JobTargetPersistenceSchema.default("ask")
  }).strict()
]);
const TailorResumeInputSchema = z.object({
  profileId: z.string().min(1).optional(),
  sourceResumeId: z.string().min(1).optional(),
  /** Compatibility alias for pre-P4.5c.1.7 callers. */
  resumeId: z.string().min(1).optional(),
  jobId: z.string().min(1).optional(),
  target: TailorTargetInputSchema.optional(),
  /** Canonical direct external-target contract; raw text is never persisted by the contract layer. */
  targetText: z.string().trim().min(20).max(24_000).optional(),
  saveTargetPreference: z.enum(["ask", "save", "session_only", "unknown"]).optional(),
  checkpointId: z.string().min(1).optional(),
  userAnswer: z.union([
    z.string().trim().min(1).max(8_000),
    z.array(z.string().trim().min(1)).min(1).max(32),
    z.boolean()
  ]).optional(),
  intensity: z.enum(["conservative", "balanced", "aggressive"]).optional()
}).strict().superRefine((input, refinement) => {
  if (input.checkpointId) return;
  if (!input.jobId && !input.target && !input.targetText) refinement.addIssue({ code: "custom", path: ["jobId"], message: "jobId, target, or targetText is required to start tailoring" });
});
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
  { name: "career.workflow.tailor_resume", description: "Canonical generate_job_specific_resume workflow: create a target-specific Job Resume from a saved Job or direct external targetText, using the selected Profile/source resume. A pasted target remains session-only until the user explicitly chooses persistence.", inputSchema: TailorResumeInputSchema, personProfileBinding: "required" },
  { name: "career.workflow.profile_to_resume", description: "Create or reuse an isolated general resume from the confirmed Profile without writing resume content back to Profile.", inputSchema: ProfileToResumeInputSchema, personProfileBinding: "required" },
  { name: "career.workflow.compose_resume", description: "Build an evidence graph and grounded general/base Resume from the confirmed Profile, show a proposal, then write an isolated ResumeRevision only after explicit confirmation. Use tailor_resume for any saved-job or external-target resume.", inputSchema: ComposeResumeInputSchema, personProfileBinding: "required" },
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
    return executeTailoringResumeFacade(input, context, operationId, call);
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

type TailoringFacadeCall = (toolName: string, value: unknown, index?: number) => Promise<CareerToolResult>;

async function executeTailoringResumeFacade(
  input: Record<string, unknown>,
  context: CareerToolExecutionContext,
  operationId: string,
  call: TailoringFacadeCall
) {
  const rawTargetInput = input.target as
    | { type: "saved_job"; jobId: string }
    | { type: "pasted_jd"; text: string; title?: string; company?: string; sourceUrl?: string; persistence: "ask" | "save" | "session_only" }
    | undefined;
  const targetInput = rawTargetInput
    ?? (typeof input.targetText === "string"
      ? {
          type: "pasted_jd" as const,
          text: input.targetText,
          persistence: normalizeTargetPersistence(input.saveTargetPreference)
        }
      : undefined);
  if (targetInput) input.target = targetInput;
  const sourceResumeId = stringValue(input.sourceResumeId) ?? stringValue(input.resumeId);
  const profileId = stringValue(input.profileId)
    ?? context.authoritativeTaskState?.selectedEntities.profileId
    ?? context.careerSessionBinding?.profileId;
  let resolvedSourceResumeId = sourceResumeId;
  let jobId = stringValue(input.jobId)
    ?? (targetInput?.type === "saved_job" ? targetInput.jobId : undefined)
    ?? context.authoritativeTaskState?.selectedEntities.jobId;
  const checkpointId = stringValue(input.checkpointId);
  const persistedSession = objectValue(context.authoritativeTaskState?.knownSlots.tailoringSession);
  const persistedSessionId = stringValue(persistedSession.id);
  const results: CareerToolResult[] = [];
  let session = checkpointId ? persistedSession : {};
  const persistedTargetSnapshot = objectValue(persistedSession.targetSnapshot);
  let targetSnapshot = checkpointId && Object.keys(persistedTargetSnapshot).length
    ? JobTargetSnapshotSchema.parse(persistedTargetSnapshot)
    : undefined;
  let fitAnalysis = targetSnapshot ? undefined : context.authoritativeTaskState?.knownSlots.fitAnalysis;

  if (checkpointId && (!persistedSessionId || persistedSessionId !== checkpointId)) {
    const failure = syntheticTailoringResult(operationId, "tailoring_checkpoint_not_found", "当前定制 checkpoint 不存在或已变化，已保留当前岗位和简历选择。", false);
    return tailoringFacadeProgress(operationId, input, context, results.concat(failure), {}, undefined, "failed");
  }

  if (!checkpointId) {
    if (!profileId || (!resolvedSourceResumeId && !targetInput)) {
      const failure = syntheticTailoringResult(operationId, "tailoring_selection_required", "开始岗位定制需要当前选中的岗位、简历和资料版本。", false);
      return tailoringFacadeProgress(operationId, input, context, results.concat(failure), {}, undefined, "failed");
    }
    let callIndex = 0;
    if (targetInput?.type === "pasted_jd") {
      const parsed = await call("career.job.parse", {
        rawText: targetInput.text,
        ...(targetInput.title ? { title: targetInput.title } : {}),
        ...(targetInput.company ? { company: targetInput.company } : {})
      }, callIndex++);
      results.push(parsed);
      if (!parsed.ok) {
        return tailoringFacadeProgress(operationId, input, context, results, {
          kind: "tailoring_target",
          workflowStage: "parse_target",
          profileId,
          targetSourceType: "pasted_jd",
          jobPersistenceDecision: targetInput.persistence
        }, undefined, "recoverable_failure");
      }
      const parsedData = objectValue(parsed.data);
      const graph = JobRequirementGraphV4Schema.parse(parsedData.graph);
      targetSnapshot = JobTargetSnapshotSchema.parse({
        ...createPastedJobTargetSnapshot({
          rawText: targetInput.text,
          graph,
          title: stringValue(parsedData.candidateTitle) ?? targetInput.title,
          company: stringValue(parsedData.candidateCompany) ?? targetInput.company
        }),
        ...(targetInput.sourceUrl ? { sourceUrl: targetInput.sourceUrl } : {})
      });
      jobId = undefined;
      fitAnalysis = undefined;
    }
    if (!resolvedSourceResumeId) {
      const listed = await call("career.resume.list", {}, callIndex++);
      results.push(listed);
      const resumeValues = listed.ok ? arrayValue(objectValue(listed.data).resumes) : [];
      const resumes = resumeValues
        .map((value: unknown) => objectValue(value))
        .filter((resume: Record<string, unknown>) => resume.branchPurpose === "general" && resume.lifecycleStatus === "active");
      if (resumes.length !== 1) {
        return tailoringFacadeProgress(operationId, input, context, results, {
          kind: "tailoring_source_selection",
          workflowStage: "choose_resume_source",
          profileId,
          ...(targetSnapshot ? {
            targetSourceType: targetSnapshot.sourceType,
            targetSnapshotId: targetSnapshot.id,
            targetSnapshotVersion: targetSnapshot.version,
            targetSnapshotHash: jobTargetSnapshotHash(targetSnapshot),
            targetSnapshot
          } : {}),
          resumeCandidates: resumes.slice(0, 12),
          sourceResumeId: undefined
        }, undefined, "waiting_for_user");
      }
      resolvedSourceResumeId = stringValue(resumes[0].id);
    }
    if (!resolvedSourceResumeId || (!jobId && !targetSnapshot)) {
      const failure = syntheticTailoringResult(operationId, "tailoring_selection_required", "开始岗位定制需要当前选中的岗位、简历和资料版本。", false);
      return tailoringFacadeProgress(operationId, input, context, results.concat(failure), {}, undefined, "failed");
    }
    if (fitAnalysis === undefined && context.availableCareerToolNames?.has("career.job.analyze_fit") !== false) {
      const fit = await call("career.job.analyze_fit", {
        profileId,
        resumeId: resolvedSourceResumeId,
        ...(jobId ? { jobId } : {}),
        ...(targetSnapshot ? { targetSnapshot } : {})
      }, callIndex++);
      results.push(fit);
      if (!fit.ok) {
        return tailoringFacadeProgress(operationId, input, context, results, {
          kind: "tailoring_session",
          workflowStage: "analyze_fit",
          profileId,
          resumeId: resolvedSourceResumeId,
          ...(jobId ? { jobId } : {}),
          ...(targetSnapshot ? {
            targetSourceType: targetSnapshot.sourceType,
            targetSnapshotId: targetSnapshot.id,
            targetSnapshotVersion: targetSnapshot.version,
            targetSnapshotHash: jobTargetSnapshotHash(targetSnapshot),
            targetSnapshot,
            jobPersistenceDecision: targetInput?.type === "pasted_jd" ? targetInput.persistence : undefined
          } : {}),
          fitAnalysis: compactData(fit.data, ["analysis", "dependencies"])
        }, undefined, "working");
      }
      fitAnalysis = fit.data;
    }
    const created = await call("career.tailoring.create_session", {
      profileId,
      resumeId: resolvedSourceResumeId,
      ...(jobId ? { jobId } : {}),
      ...(targetSnapshot ? { targetSnapshot } : {}),
      ...(input.intensity ? { intensity: input.intensity } : {})
    }, callIndex++);
    results.push(created);
    session = objectValue(objectValue(created.data).session);
  }

  if (!stringValue(session.id)) {
    const last = results.at(-1) ?? syntheticTailoringResult(operationId, "tailoring_session_missing", "定制 checkpoint 没有返回可恢复的会话，当前选择已保留。", true);
    if (!results.length) results.push(last);
    return tailoringFacadeProgress(operationId, input, context, results, {
      kind: "tailoring_session",
      workflowStage: "generate_plan",
      profileId,
      resumeId: resolvedSourceResumeId,
      ...(jobId ? { jobId } : {}),
      ...(targetSnapshot ? {
        targetSourceType: targetSnapshot.sourceType,
        targetSnapshotId: targetSnapshot.id,
        targetSnapshotVersion: targetSnapshot.version,
        targetSnapshotHash: jobTargetSnapshotHash(targetSnapshot),
        targetSnapshot,
        jobPersistenceDecision: targetInput?.type === "pasted_jd" ? targetInput.persistence : undefined
      } : {}),
      ...(fitAnalysis === undefined ? {} : { fitAnalysis: compactData(fitAnalysis, ["analysis", "dependencies"]) })
    }, undefined, "working");
  }

  if (input.userAnswer !== undefined) {
    const activeQuestionId = tailoringActiveQuestionId(session);
    if (activeQuestionId) {
      const answered = await call("career.tailoring.answer_question", {
        session,
        questionId: activeQuestionId,
        answer: input.userAnswer
      }, results.length);
      results.push(answered);
      if (!answered.ok) {
        return tailoringFacadeProgress(operationId, input, context, results, tailoringCheckpoint(input, session, fitAnalysis), session, "recoverable_failure");
      }
      session = objectValue(objectValue(answered.data).session);
    }
  }

  const checkpoint = tailoringCheckpoint({ ...input, target: targetInput }, session, fitAnalysis);
  if (isTailoringQuestionPaused(session)) {
    return tailoringFacadeProgress(operationId, input, context, results.concat(
      results.length ? [] : [checkpointOnlyTailoringResult(operationId, session)]
    ), checkpoint, session, "waiting_for_user");
  }
  if (context.availableCareerToolNames?.has("career.tailoring.generate_changes") === false) {
    return tailoringFacadeProgress(operationId, input, context, results.concat(
      results.length ? [] : [checkpointOnlyTailoringResult(operationId, session)]
    ), checkpoint, session, "waiting_for_user");
  }
  if (tailoringGenerationIsCurrent(session)) {
    return tailoringFacadeProgress(operationId, input, context, results.concat(
      results.length ? [] : [checkpointOnlyTailoringResult(operationId, session)]
    ), checkpoint, session, "review_ready");
  }
  const generated = await call("career.tailoring.generate_changes", { session }, results.length);
  results.push(generated);
  const generatedSession = objectValue(objectValue(generated.data).session);
  return tailoringFacadeProgress(
    operationId,
    input,
    context,
    results,
    tailoringCheckpoint({ ...input, target: targetInput }, stringValue(generatedSession.id) ? generatedSession : session, fitAnalysis),
    stringValue(generatedSession.id) ? generatedSession : session,
    "review_ready"
  );
}

function tailoringFacadeProgress(
  operationId: string,
  input: Record<string, unknown>,
  context: CareerToolExecutionContext,
  results: CareerToolResult[],
  checkpoint: Record<string, unknown>,
  session: Record<string, unknown> | undefined,
  requestedStatus: CareerWorkflowFacadeResult["status"]
) {
  const last = results.at(-1) ?? checkpointOnlyTailoringResult(operationId, session ?? {});
  const workflowStage = facadeWorkflowStage("career.workflow.tailor_resume", last, checkpoint);
  const status: CareerWorkflowFacadeResult["status"] = last.ok
    ? requestedStatus
    : last.receipt.status === "confirmation_required"
      ? "waiting_for_confirmation"
      : last.error?.recoverable ? "recoverable_failure" : "failed";
  const interactionPlan = buildFacadeInteractionPlan({
    facadeName: "career.workflow.tailor_resume",
    result: last,
    workflowCheckpoint: checkpoint,
    context
  });
  const facadeReceipt: OperationReceipt = {
    operationId,
    toolName: "career.workflow.tailor_resume",
    idempotencyKey: operationId,
    status: status === "failed" || status === "recoverable_failure" ? "failed" : status === "waiting_for_confirmation" ? "confirmation_required" : "completed",
    completedAt: new Date().toISOString()
  };
  const artifactRefs = [...new Map(results.flatMap((result) => result.artifacts).map((artifact) => [artifact.id, artifact])).values()];
  const receipts = [...results.map((result) => result.receipt), facadeReceipt];
  const prompt = stringValue(interactionPlan?.recommendedNextQuestion?.question)
    ?? (workflowStage === "generate_changes" ? "澄清已完成，可以生成定制修改建议。" : undefined);
  const review = tailoringReviewProjection(session ?? objectValue(checkpoint.session));
  const data = CareerWorkflowFacadeResultSchema.parse({
    status,
    workflowStage,
    nextAction: status === "waiting_for_confirmation"
      ? "request_confirmation"
      : workflowStage === "clarify_unsupported_facts"
        ? "ask_current_tailoring_question"
        : workflowStage === "generate_changes"
          ? "generate_tailoring_changes"
          : workflowStage === "preview_changes"
            ? "review_tailoring_diff"
            : "continue_tailoring",
    ...(status === "waiting_for_user" && prompt ? { userPrompt: prompt } : {}),
    ...(stringValue(checkpoint.checkpointId) ? { checkpointId: stringValue(checkpoint.checkpointId) } : {}),
    interaction: interactionPlan,
    ...(Object.keys(review).length ? { review } : {}),
    artifactRefs,
    receipts,
    ...(last.error ? { safeError: { code: last.error.code, message: last.error.message, recoverable: last.error.recoverable } } : {}),
    workflowCheckpoint: checkpoint
  });
  return { data, artifacts: artifactRefs, receipts };
}

function tailoringCheckpoint(input: Record<string, unknown>, session: Record<string, unknown>, fitAnalysis?: unknown) {
  const branch = objectValue(session.branch);
  const job = objectValue(session.job);
  const id = stringValue(session.id);
  const snapshotValue = objectValue(session.targetSnapshot);
  const targetSnapshot = Object.keys(snapshotValue).length ? JobTargetSnapshotSchema.parse(snapshotValue) : undefined;
  const targetInput = objectValue(input.target);
  const jobPersistenceDecision = targetSnapshot
    ? stringValue(targetInput.persistence) ?? stringValue(input.jobPersistenceDecision)
    : undefined;
  return {
    kind: "tailoring_session",
    workflowStage: tailoringStageForSession(session),
    checkpointId: id,
    profileId: stringValue(input.profileId) ?? stringValue(objectValue(session.profile).id),
    resumeId: stringValue(input.sourceResumeId) ?? stringValue(input.resumeId) ?? stringValue(branch.id),
    ...(!targetSnapshot ? { jobId: stringValue(input.jobId) ?? stringValue(job.id) } : {}),
    ...(targetSnapshot ? {
      targetSourceType: targetSnapshot.sourceType,
      targetSnapshotId: targetSnapshot.id,
      targetSnapshotVersion: targetSnapshot.version,
      targetSnapshotHash: jobTargetSnapshotHash(targetSnapshot),
      targetSnapshot,
      ...(jobPersistenceDecision ? { jobPersistenceDecision } : {})
    } : {}),
    ...(fitAnalysis === undefined ? {} : { fitAnalysis: compactData(fitAnalysis, ["analysis", "dependencies", "score", "matched", "gaps"]) }),
    session,
    review: tailoringReviewProjection(session)
  } satisfies Record<string, unknown>;
}

function normalizeTargetPersistence(value: unknown): "ask" | "save" | "session_only" {
  return value === "save" || value === "session_only" ? value : "ask";
}

function tailoringStageForSession(session: Record<string, unknown>) {
  if (isTailoringQuestionPaused(session)) return "clarify_unsupported_facts";
  return tailoringGenerationIsCurrent(session) ? "preview_changes" : "generate_changes";
}

function tailoringActiveQuestionId(session: Record<string, unknown>) {
  return stringValue(objectValue(objectValue(session.plan).questionPlan).activeQuestionId);
}

function tailoringGenerationIsCurrent(session: Record<string, unknown>) {
  const plan = objectValue(session.plan);
  const questionPlan = objectValue(plan.questionPlan);
  return plan.generationStatus === "completed"
    && plan.generatedDiffsBasedOnQuestionPlanRevision === questionPlan.revision
    && plan.generatedDiffsBasedOnAnswerRevisionHash === plan.answerRevisionHash;
}

function tailoringReviewProjection(session: Record<string, unknown>) {
  const plan = objectValue(session.plan);
  return {
    generationStatus: plan.generationStatus,
    diffs: arrayValue(plan.diffs),
    diffReviews: arrayValue(plan.diffReviews)
  };
}

function checkpointOnlyTailoringResult(operationId: string, session: Record<string, unknown>): CareerToolResult {
  return {
    ok: true,
    data: { session },
    artifacts: [],
    receipt: {
      operationId: `${operationId}-checkpoint`,
      toolName: "career.workflow.tailor_resume",
      status: "completed",
      completedAt: new Date().toISOString()
    }
  };
}

function syntheticTailoringResult(operationId: string, code: string, message: string, recoverable: boolean): CareerToolResult {
  return {
    ok: false,
    error: { code, category: recoverable ? "recoverable" : "validation", message, recoverable },
    artifacts: [],
    receipt: {
      operationId: `${operationId}-validation`,
      toolName: "career.workflow.tailor_resume",
      status: "failed",
      completedAt: new Date().toISOString()
    }
  };
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
