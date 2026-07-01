import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { OpenAiCompatibleProvider, type AiProviderError } from "@/ai/providers/openAiCompatibleProvider";
import {
  getStageBTaskDefinition,
  type JdAnalyzerTaskInput,
  type ProfileBuilderTaskInput,
  type StageBAiTask
} from "@/ai/tasks/registry";
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

    const definition = getStageBTaskDefinition(body.data.task);

    if (!definition) {
      return aiError("task_not_allowed", "This AI task is not allowed.", 403, startedAt);
    }

    const input = definition.inputSchema.safeParse(body.data.input);
    const taskDefinition = definition as {
      task: StageBAiTask;
      promptVersion: string;
      systemPrompt: string;
      maxOutputChars: number;
      buildUserPrompt(input: unknown): string;
      normalizeOutput(output: unknown, input: unknown): unknown;
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

    const normalized = taskDefinition.normalizeOutput(response.output, input.data);
    const parsedOutput = taskDefinition.outputSchema.safeParse(normalized);

    if (!parsedOutput.success) {
      return aiError("validation_failed", "Model output failed server schema validation.", 422, startedAt, {
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
  task: StageBAiTask,
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

function createMockOutput(task: StageBAiTask, input: unknown) {
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
