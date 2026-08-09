import { z } from "zod";
import type {
  ArtifactRef,
  CareerToolExecutionContext,
  CareerToolPersonProfileBinding,
  CareerToolResult,
  OperationReceipt
} from "../tools/CareerToolGateway";

export const CareerWorkflowStatusSchema = z.enum([
  "completed",
  "waiting_for_user",
  "waiting_for_confirmation",
  "partial",
  "failed"
]);

export const CareerWorkflowFacadeResultSchema = z.object({
  status: CareerWorkflowStatusSchema,
  nextAction: z.string().optional(),
  userPrompt: z.string().optional(),
  artifactRefs: z.array(z.object({ id: z.string(), kind: z.string(), toolName: z.string(), sourceToolName: z.string() }).passthrough()).optional(),
  receipts: z.array(z.object({ operationId: z.string(), toolName: z.string(), status: z.string(), completedAt: z.string() }).passthrough()).optional(),
  safeError: z.object({ code: z.string(), message: z.string(), recoverable: z.boolean() }).optional(),
  workflowCheckpoint: z.record(z.string(), z.unknown())
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
  name: z.string().min(1).max(120).optional()
}).strict();
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
    return facadeFromAtomic(name, operationId, result, "waiting_for_user", "ask_high_value_gap", "请只询问返回结果中的一个最高价值缺口。", {
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
    });
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
    });
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
    });
  }
  if (name === "career.workflow.job_fit") {
    const result = await call("career.job.analyze_fit", input);
    return facadeFromAtomic(name, operationId, result, "completed", "explain_job_fit", undefined, {
      kind: "job_fit",
      profileId: input.profileId,
      resumeId: input.resumeId,
      jobId: input.jobId,
      result: compactData(result.data, ["fitAnalysisId", "score", "matched", "gaps", "artifactId", "resumeRevision"])
    });
  }
  if (name === "career.workflow.tailor_resume") {
    const result = await call("career.tailoring.create_session", input);
    const createdSession = result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>).session
      : undefined;
    return facadeFromAtomic(name, operationId, result, "waiting_for_user", "answer_tailoring_question", "请只询问当前定制会话返回的下一题。", {
      kind: "tailoring_session",
      profileId: input.profileId,
      resumeId: input.resumeId,
      jobId: input.jobId,
      // Keep the authoritative persisted session intact. Subsequent native
      // tailoring steps parse this checkpoint as TailoringSessionSchema; a
      // shallow summary would lose the plan/branch/job context and force the
      // artifact reducer to fall back to a pending entity id.
      session: createdSession
    });
  }
  if (name === "career.workflow.profile_to_resume") {
    const result = await call("career.resume.ensure_general_from_profile", input);
    return facadeFromAtomic(name, operationId, result, "completed", "open_resume", undefined, {
      kind: "profile_to_resume",
      profileId: input.targetProfileId,
      expectedProfileVersion: input.expectedProfileVersion,
      result: compactData(result.data, ["resumeId", "revision", "created", "profileId", "artifactId"])
    });
  }
  const result = await call("career.export.resume", input);
  return facadeFromAtomic(name, operationId, result, "completed", "open_export", undefined, {
    kind: "resume_export",
    resumeId: input.resumeId,
    result: compactData(result.data, ["resumeId", "revision", "artifactId", "previewArtifactId", "pdfArtifactId", "fileName"])
  });
}

function facadeFromAtomic(
  facadeName: string,
  operationId: string,
  result: CareerToolResult,
  successStatus: CareerWorkflowFacadeResult["status"],
  nextAction: string,
  userPrompt: string | undefined,
  workflowCheckpoint: Record<string, unknown>
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
  return {
    data: CareerWorkflowFacadeResultSchema.parse({
      status,
      nextAction: status === "waiting_for_confirmation" ? "request_confirmation" : nextAction,
      userPrompt: status === "waiting_for_confirmation" ? "这一步需要你的明确确认。" : userPrompt,
      artifactRefs: result.artifacts,
      receipts: [result.receipt, facadeReceipt],
      safeError: result.error ? { code: result.error.code, message: result.error.message, recoverable: result.error.recoverable } : undefined,
      workflowCheckpoint
    }),
    artifacts: result.artifacts,
    receipts: [result.receipt, facadeReceipt]
  };
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
