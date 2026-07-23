import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { OpenAiCompatibleProvider, type AiProviderError } from "@/ai/providers/openAiCompatibleProvider";
import {
  getAiTaskDefinition,
  type EvidenceMatcherTaskInput,
  type FactGuardTaskInput,
  type JdAnalyzerTaskInput,
  type ProfileBuilderTaskInput,
  type ResumeJsonMapperTaskInput,
  type ResumeTailorTaskInput,
} from "@/ai/tasks/registry";
import type { AiTask, ResumeTailorBatchInput, ResumeTailoringDiffTaskInput } from "@/domain/schemas";
import { redactSensitiveTextForModel } from "@/services/security/text";
import { mapNormalizedBlocksToReviewDraft } from "@/domain/resumeImport/normalizer";
import { mapExternalResumeJson } from "@/domain/resumeImport/jsonMapper";
import { decodeAiSettingsFromHeader, type AiSettings } from "@/services/storage/aiSettings";
import { buildRetryPrompt } from "@/ai/retryPrompt";

const StructuredAiRequestSchema = z
  .object({
    task: z.string().min(1),
    input: z.unknown()
  })
  .strict();

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  try {
    const body = StructuredAiRequestSchema.safeParse(await request.json());

    if (!body.success) {
      return aiError("bad_request", "Request must contain only task and input.", 400, startedAt);
    }

    const definition = getAiTaskDefinition(body.data.task);

    if (!definition) {
      return aiError("task_not_allowed", "This AI task is not allowed.", 403, startedAt);
    }

    const input = definition.inputSchema.safeParse(body.data.input);
    const taskDefinition = definition as {
      task: AiTask;
      promptVersion: string;
      systemPrompt: string;
      maxOutputChars: number;
      buildUserPrompt(input: unknown): string;
      coerceRawOutput(rawOutput: unknown, input?: unknown): unknown;
      normalizeOutput(output: unknown, input: unknown): unknown;
      validateOutput?(output: unknown, input: unknown): void;
      outputSchema: { safeParse(output: unknown): { success: true; data: unknown } | { success: false } };
    };

    if (!input.success) {
      return aiError("invalid_input", "Task input failed validation.", 400, startedAt);
    }

    const aiConfigHeader = request.headers.get("x-ai-config");
    const customSettings: AiSettings | undefined = aiConfigHeader ? decodeAiSettingsFromHeader(aiConfigHeader) : undefined;
    const effectiveProvider = customSettings?.provider || process.env.AI_PROVIDER || "openai-compatible";

    if (effectiveProvider === "mock") {
      return aiSuccess(
        definition.task,
        definition.promptVersion,
        createMockOutput(definition.task, input.data),
        {
          provider: "mock",
          model: "mock-stage-b",
          inputLength: estimateInputLength(input.data),
          outputLength: 0,
          latencyMs: Date.now() - startedAt
        }
      );
    }

    const provider = new OpenAiCompatibleProvider(customSettings);
    const baseUserPrompt = taskDefinition.buildUserPrompt(input.data);
    let lastValidationFailure: string | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await provider.invoke({
        systemPrompt: taskDefinition.systemPrompt,
        userPrompt: attempt === 0 ? baseUserPrompt : buildRetryPrompt({ task: taskDefinition.task, baseUserPrompt, failure: lastValidationFailure, input: input.data }),
        maxOutputChars: taskDefinition.maxOutputChars,
        signal: AbortSignal.timeout(60_000)
      });

      console.info("[ai:attempt]", {
        task: taskDefinition.task,
        attempt: attempt + 1,
        failureCode: lastValidationFailure,
        provider: response.provider,
        model: response.model,
        latency: Date.now() - startedAt,
        outputLength: response.outputLength
      });

      let normalized: unknown;
      try {
        const coerced = taskDefinition.coerceRawOutput(response.output, input.data);
        normalized = taskDefinition.normalizeOutput(coerced, input.data);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "resume_tailor_model_shape_invalid";
        const issues = (error as { issues?: Array<{ path: PropertyKey[]; code: string }> }).issues ?? [];
        if (process.env.NODE_ENV === "development" && body.data.task.startsWith("resume-tailor")) {
          console.warn("[resume-tailor:normalization-failed]", issues.map((issue, suggestionIndex) => ({
            suggestionIndex,
            paths: [issue.path.join(".")],
            codes: [issue.code]
          })));
        }
        lastValidationFailure = reason;
        if (attempt === 0) continue;
        return aiError(reason, "Model returned content, but its shape did not pass validation.", 422, startedAt, {
          provider: response.provider, model: response.model, inputLength: baseUserPrompt.length, outputLength: response.outputLength
        });
      }
      const parsedOutput = taskDefinition.outputSchema.safeParse(normalized);

      if (!parsedOutput.success) {
        if (process.env.NODE_ENV === "development") {
          const issues = (parsedOutput as { error?: { issues?: Array<{ path: PropertyKey[]; code: string }> } }).error?.issues ?? [];
          console.error("[ai:validation_failed]", issues.map((issue) => ({ path: issue.path, code: issue.code })));
        }
        lastValidationFailure = "validation_failed";
        if (attempt === 0) {
          continue;
        }

        return aiError("validation_failed", "Model output failed server schema validation.", 422, startedAt, {
          provider: response.provider,
          model: response.model,
          inputLength: baseUserPrompt.length,
          outputLength: response.outputLength
        });
      }

      if (process.env.NODE_ENV === "development" && taskDefinition.task === "jd-analyzer") {
        const sourceIds = new Set((input.data as JdAnalyzerTaskInput).sourceUnits?.map((unit) => unit.id) ?? []);
        const assignments = (parsedOutput.data as { unitAssignments?: Array<{ sourceUnitId: string }> }).unitAssignments ?? [];
        const returnedIds = assignments.map((assignment) => assignment.sourceUnitId);
        const uniqueReturnedIds = new Set(returnedIds);
        console.info("[jd-analyzer:diagnostics]", {
          task: taskDefinition.task, attempt: attempt + 1, errorStage: "none", issuePaths: [], issueCodes: [],
          sourceUnitCount: sourceIds.size, assignmentCount: assignments.length,
          missingCount: [...sourceIds].filter((id) => !uniqueReturnedIds.has(id)).length,
          duplicateCount: returnedIds.length - uniqueReturnedIds.size,
          inventedCount: [...uniqueReturnedIds].filter((id) => !sourceIds.has(id)).length,
          outputLength: response.outputLength
        });
      }

      try {
        if (body.data.task.startsWith("resume-tailor") && (parsedOutput.data as { suggestions?: unknown[] }).suggestions?.length === 0) {
          if (attempt === 0) {
            lastValidationFailure = "no_change_needed";
            continue;
          }
          return aiSuccess(taskDefinition.task, taskDefinition.promptVersion, parsedOutput.data, {
            provider: response.provider, model: response.model, inputLength: baseUserPrompt.length,
            outputLength: response.outputLength, latencyMs: Date.now() - startedAt
          });
        }
        taskDefinition.validateOutput?.(parsedOutput.data, input.data);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown";
        if (process.env.NODE_ENV === "development") {
          console.warn(`[ai:semantic_validation] task=${body.data.task} attempt=${attempt} reason=${reason}`);
        }
        lastValidationFailure = reason;
        if (attempt === 0) {
          continue;
        }

        return aiError(`semantic_validation_failed:${reason}`, `Semantic validation failed: ${reason}`, 422, startedAt, {
          provider: response.provider,
          model: response.model,
          inputLength: baseUserPrompt.length,
          outputLength: response.outputLength
        });
      }

      return aiSuccess(taskDefinition.task, taskDefinition.promptVersion, parsedOutput.data, {
        provider: response.provider,
        model: response.model,
        inputLength: baseUserPrompt.length,
        outputLength: response.outputLength,
        latencyMs: Date.now() - startedAt
      });
    }

    return aiError("validation_failed", "Model output failed server validation.", 422, startedAt, {
      inputLength: estimateInputLength(input.data)
    });
  } catch (error) {
    const code = typeof (error as AiProviderError).code === "string" ? (error as AiProviderError).code : "provider_failed";
    return aiError(code, "AI request failed.", code === "missing_ai_config" ? 503 : 502, startedAt);
  }
}

function aiSuccess(
  task: AiTask,
  promptVersion: string,
  output: unknown,
  meta: {
    provider: string;
    model: string;
    inputLength: number;
    outputLength: number;
    latencyMs: number;
  }
) {
  return NextResponse.json({
    ok: true,
    task,
    promptVersion,
    output,
    meta
  });
}

function aiError(
  code: string,
  message: string,
  status: number,
  startedAt: number,
  meta: Partial<{
    provider: string;
    model: string;
    inputLength: number;
    outputLength: number;
  }> = {}
) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message
      },
      meta: {
        ...meta,
        latencyMs: Date.now() - startedAt
      }
    },
    { status }
  );
}

function estimateInputLength(input: unknown) {
  if (typeof input === "object" && input && "rawText" in input && typeof input.rawText === "string") {
    return input.rawText.length;
  }

  return JSON.stringify(input).length;
}

function createMockOutput(task: AiTask, input: unknown) {
  if (task === "resume-document-mapper") {
    const rawText = typeof input === "object" && input && "rawText" in input ? String(input.rawText) : "[]";
    return mapNormalizedBlocksToReviewDraft(JSON.parse(redactSensitiveTextForModel(rawText).text));
  }
  if (task === "resume-json-mapper") {
    const mapperInput = input as ResumeJsonMapperTaskInput;
    const result = mapExternalResumeJson(JSON.parse(redactSensitiveTextForModel(mapperInput.rawText).text));
    if (!result.ok) throw new Error(result.message);
    return result.value;
  }
  if (task === "profile-builder") {
    const profileInput = input as ProfileBuilderTaskInput;
    const firstLine = profileInput.rawText.split(/\r?\n/).find(Boolean) || profileInput.rawText.slice(0, 40);
    const sourceQuote = firstLine.slice(0, 80);
    const now = new Date().toISOString();

    return {
      basics: {
        name: {
          value: "待确认用户",
          sourceQuote,
          confidenceLevel: "low",
          confidenceReason: "Mock provider cannot reliably infer a name from arbitrary input.",
          needsConfirmation: true
        },
        summary: {
          value: sourceQuote,
          sourceQuote,
          confidenceLevel: "medium",
          confidenceReason: "Derived from the first non-empty resume line.",
          needsConfirmation: true
        },
        links: []
      },
      experiences: [
        {
          id: "profile-builder-mock-exp",
          type: "other",
          organization: {
            value: "待分类经历",
            sourceQuote,
            confidenceLevel: "low",
            confidenceReason: "Mock provider keeps this as a manual review item.",
            needsConfirmation: true
          },
          role: {
            value: "待确认角色",
            sourceQuote,
            confidenceLevel: "low",
            confidenceReason: "Mock provider keeps this as a manual review item.",
            needsConfirmation: true
          },
          facts: [
            {
              id: "profile-builder-mock-fact",
              statement: sourceQuote,
              category: "experience",
              sourceQuote,
              confidenceLevel: "medium",
              confidenceReason: "Extracted from the first non-empty resume line.",
              needsConfirmation: true,
              confirmedByUser: false,
              createdAt: now,
              updatedAt: now
            }
          ],
          tags: [],
          confirmedByUser: false,
          createdAt: now,
          updatedAt: now
        }
      ],
      skills: [],
      certificates: [],
      unclassifiedBlocks: redactSensitiveTextForModel(profileInput.rawText).text.length > 0 ? [] : [profileInput.rawText]
    };
  }

  if (task === "evidence-matcher") {
    const matcherInput = input as EvidenceMatcherTaskInput;
    const firstCandidate = matcherInput.candidates[0];

    return {
      evaluations: [
        {
          requirementId: matcherInput.requirement.id,
          matchLevel: firstCandidate ? "weak" : "none",
          riskLevel: firstCandidate ? "medium" : matcherInput.requirement.hardConstraint ? "high" : "medium",
          risks: firstCandidate ? ["low_confidence"] : ["source_missing"],
          evidenceRefs: firstCandidate ? [firstCandidate.evidenceRef] : [],
          explanation: firstCandidate
            ? "Mock evidence matcher selected the first rule candidate for explanation."
            : "Mock evidence matcher found no rule candidates and returned no evidence."
        }
      ]
    };
  }

  if (task === "resume-tailor") {
    const tailorInput = input as ResumeTailorTaskInput;
    const firstEvidence = tailorInput.allowedEvidenceRefs[0];
    const before = tailorInput.currentContent.fieldValue;
    const beforeText = Array.isArray(before) ? before.join("；") : before;
    const keywords = tailorInput.relevantRequirements.flatMap((item) => item.keywords).filter((item) => item.toLowerCase() !== "ai").slice(0, 4);
    const after = `围绕${keywords.join("、") || tailorInput.jobContext.title}重写：${beforeText}`;

    return {
      suggestions: [
        {
          id: "mock-tailoring-suggestion",
          intensity: tailorInput.intensity,
          operation: "rewrite",
          targetSectionType: tailorInput.target.sectionType,
          targetSectionId: tailorInput.target.sectionId,
          targetItemId: tailorInput.target.itemId,
          targetFieldPath: tailorInput.target.fieldPath,
          before,
          after,
          changedFields: [tailorInput.target.fieldPath.split(".").at(-1) ?? "field"],
          requirementIds: tailorInput.relevantRequirements.map((item) => item.requirementId),
          targetKeywords: keywords,
          coveredKeywordsBefore: [],
          coveredKeywordsAfter: keywords,
          claimSupportLevel: firstEvidence ? "verified" : "reasonable_inference",
          evidenceRefs: firstEvidence ? [firstEvidence] : [],
          rationale: `针对 ${tailorInput.relevantRequirements[0]?.description ?? tailorInput.jobContext.title} 调整当前字段表达。`,
          riskLevel: firstEvidence ? "low" : "medium",
          metrics: { textChangeRatio: 0.5, keywordGain: keywords.length },
          status: firstEvidence ? "ready" : "requires_confirmation"
        }
      ]
    };
  }

  if (task === "resume-tailor-batch") {
    const batchInput = input as ResumeTailorBatchInput;
    return {
      suggestions: batchInput.targets.map((target, index) => {
        const beforeText = Array.isArray(target.before) ? target.before.join("；") : target.before;
        const keywords = target.relevantRequirements.flatMap((item) => item.keywords).filter((item) => item.toLowerCase() !== "ai").slice(0, 4);
        return {
          id: `mock-tailoring-batch-${index}`,
          intensity: batchInput.intensity, operation: "rewrite", targetSectionType: target.sectionType,
          targetSectionId: target.sectionId, targetItemId: target.itemId, targetFieldPath: target.fieldPath,
          before: target.before, after: `围绕${keywords.join("、") || batchInput.compactJobContext.title}重写：${beforeText}`,
          changedFields: [target.fieldPath.split(".").at(-1) ?? "field"],
          requirementIds: target.relevantRequirements.map((item) => item.requirementId), targetKeywords: keywords,
          coveredKeywordsBefore: [], coveredKeywordsAfter: keywords, claimSupportLevel: "reasonable_inference",
          evidenceRefs: target.allowedEvidenceRefs, rationale: `针对 ${target.relevantRequirements[0]?.description ?? batchInput.compactJobContext.title} 调整表达。`,
          riskLevel: "medium", metrics: { textChangeRatio: 0.5, keywordGain: keywords.length }, status: "requires_confirmation"
        };
      })
    };
  }

  if (task === "resume-tailor-diff") {
    const diffInput = input as ResumeTailoringDiffTaskInput;
    const itemId = diffInput.target.itemId;
    if (!itemId) return { diffs: [], clarifications: [] };
    const evidenceRefs = diffInput.allowedEvidenceRefs.slice(0, 3);
    if (!evidenceRefs.length) {
      return {
        diffs: [],
        clarifications: [{
          question: `请补充一个可核验案例，说明你如何满足“${diffInput.relevantRequirements[0]?.description ?? "该岗位要求"}”。`,
          requirementIds: diffInput.relevantRequirements.map((item) => item.requirementId).slice(0, 3),
          answerType: "text"
        }]
      };
    }
    return {
      diffs: [{
        target: {
          sectionId: diffInput.target.sectionId,
          itemId,
          fieldPath: diffInput.target.fieldPath
        },
        operation: diffInput.allowedOperation,
        original: diffInput.currentContent.fieldValue,
        value: diffInput.currentContent.fieldValue,
        reason: "Mock provider preserves the verified source value.",
        requirementIds: diffInput.relevantRequirements.map((item) => item.requirementId).slice(0, 3),
        targetKeywords: diffInput.relevantRequirements.flatMap((item) => item.keywords).slice(0, 4),
        evidenceRefs,
        supportLevel: "verified"
      }],
      clarifications: []
    };
  }

  if (task === "resume-optimization-planner") {
    const plannerInput = input as { sections: Array<{ itemId: string; currentText: string }> };
    return {
      assessments: plannerInput.sections.map((section) => ({
        itemId: section.itemId,
        action: "rewrite_from_evidence" as const,
        reason: "Mock planner: all sections marked for rewrite.",
        suggestedKeywords: [],
        relatedRequirementIds: [],
        clarificationQuestions: []
      })),
      globalNotes: "Mock 模式：所有片段均已标记为可改写。"
    };
  }

  if (task === "fact-guard") {
    const guardInput = input as FactGuardTaskInput;
    const hasBlockedRule = guardInput.ruleFindings.some((finding) => !finding.allowed && finding.severity === "high");
    const hasAnyRule = guardInput.ruleFindings.some((finding) => !finding.allowed);
    return {
      status: hasBlockedRule ? "blocked_high_risk" : hasAnyRule ? "needs_edit" : "pass",
      riskLevel: hasBlockedRule ? "high" : hasAnyRule ? "medium" : "low",
      findings: guardInput.ruleFindings,
      explanation: hasAnyRule
        ? "Mock fact guard preserved rule findings and requires editing unsupported content."
        : "Mock fact guard found no unsupported new facts beyond usedEvidenceRefs."
    };
  }

  const jdInput = input as JdAnalyzerTaskInput;
  const sourceQuote = jdInput.rawText.split(/[。；;\n]/).find(Boolean)?.slice(0, 120) || jdInput.rawText.slice(0, 120);
  const now = new Date().toISOString();

  return {
    title: {
      value: jdInput.title,
      sourceQuote,
      confidenceLevel: "medium",
      confidenceReason: "Title came from user-provided job metadata.",
      needsConfirmation: false
    },
    company: {
      value: jdInput.company,
      sourceQuote,
      confidenceLevel: "medium",
      confidenceReason: "Company came from user-provided job metadata.",
      needsConfirmation: false
    },
    requirements: [
      {
        id: "jd-analyzer-mock-req",
        category: "responsibility",
        description: sourceQuote,
        priority: "high",
        hardConstraint: false,
        sourceQuote,
        keywords: [],
        confidenceLevel: "medium",
        confidenceReason: "Mock provider extracted the first JD clause.",
        needsConfirmation: true,
        confirmedByUser: false,
        createdAt: now,
        updatedAt: now
      }
    ],
    riskNotes: []
  };
}
