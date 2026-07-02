import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { OpenAiCompatibleProvider, type AiProviderError } from "@/ai/providers/openAiCompatibleProvider";
import {
  getAiTaskDefinition,
  type EvidenceMatcherTaskInput,
  type FactGuardTaskInput,
  type JdAnalyzerTaskInput,
  type ProfileBuilderTaskInput,
  type ResumeTailorTaskInput,
} from "@/ai/tasks/registry";
import type { AiTask } from "@/domain/schemas";
import { redactSensitiveTextForModel } from "@/services/security/text";

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
      coerceRawOutput(rawOutput: unknown): unknown;
      normalizeOutput(output: unknown, input: unknown): unknown;
      validateOutput?(output: unknown, input: unknown): void;
      outputSchema: { safeParse(output: unknown): { success: true; data: unknown } | { success: false } };
    };

    if (!input.success) {
      return aiError("invalid_input", "Task input failed validation.", 400, startedAt);
    }

    if (process.env.AI_PROVIDER === "mock") {
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

    const provider = new OpenAiCompatibleProvider();
    const response = await provider.invoke({
      systemPrompt: taskDefinition.systemPrompt,
      userPrompt: taskDefinition.buildUserPrompt(input.data),
      maxOutputChars: taskDefinition.maxOutputChars,
      signal: AbortSignal.timeout(25_000)
    });

    const coerced = taskDefinition.coerceRawOutput(response.output);
    const normalized = taskDefinition.normalizeOutput(coerced, input.data);
    const parsedOutput = taskDefinition.outputSchema.safeParse(normalized);

    if (!parsedOutput.success) {
      return aiError("validation_failed", "Model output failed server schema validation.", 422, startedAt, {
        provider: response.provider,
        model: response.model,
        inputLength: estimateInputLength(input.data),
        outputLength: response.outputLength
      });
    }

    try {
      taskDefinition.validateOutput?.(parsedOutput.data, input.data);
    } catch {
      return aiError("semantic_validation_failed", "Model output failed business semantic validation.", 422, startedAt, {
        provider: response.provider,
        model: response.model,
        inputLength: estimateInputLength(input.data),
        outputLength: response.outputLength
      });
    }

    return aiSuccess(taskDefinition.task, taskDefinition.promptVersion, parsedOutput.data, {
      provider: response.provider,
      model: response.model,
      inputLength: estimateInputLength(input.data),
      outputLength: response.outputLength,
      latencyMs: Date.now() - startedAt
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

  return 0;
}

function createMockOutput(task: AiTask, input: unknown) {
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
    const firstSection = tailorInput.sectionTexts[0];
    const firstMatch = tailorInput.matches[0];
    const firstEvidence = tailorInput.allowedEvidenceRefs[0];

    return {
      suggestions: [
        {
          type: "rewrite",
          targetSectionId: firstSection?.sectionId ?? "section-missing",
          originalText: firstSection?.text ?? "当前无草稿文本。",
          suggestedText: firstSection?.text ? `围绕岗位要求优化表达：${firstSection.text}` : "当前无草稿文本。",
          reason: "Mock resume-tailor keeps the wording grounded in the existing draft section and linked evidence.",
          requirementIds: firstMatch ? [firstMatch.requirementId] : tailorInput.requirementIds.slice(0, 1),
          usedEvidenceRefs: firstEvidence ? [firstEvidence] : [],
          riskLevel: "low"
        },
        {
          type: "remove_or_shorten",
          targetSectionId: firstSection?.sectionId ?? "section-missing",
          originalText: firstSection?.text ?? "当前无草稿文本。",
          suggestedText: firstSection?.text?.slice(0, 80) ?? "当前无草稿文本。",
          reason: "Mock resume-tailor provides a shorter version for compact resume space.",
          requirementIds: firstMatch ? [firstMatch.requirementId] : tailorInput.requirementIds.slice(0, 1),
          usedEvidenceRefs: firstEvidence ? [firstEvidence] : [],
          riskLevel: "low"
        },
        {
          type: "follow_up_question",
          targetSectionId: firstSection?.sectionId ?? "section-missing",
          originalText: firstSection?.text ?? "当前无草稿文本。",
          suggestedText: "是否有已确认的量化结果或证据可以补充？",
          reason: "Mock resume-tailor asks a follow-up instead of inventing unsupported facts.",
          requirementIds: firstMatch ? [firstMatch.requirementId] : tailorInput.requirementIds.slice(0, 1),
          usedEvidenceRefs: [],
          riskLevel: "medium"
        }
      ]
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
        priority: "important",
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
