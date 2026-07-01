import { nanoid } from "nanoid";
import type { z } from "zod";
import { AiLogSchema, type AiLog, type AiTask } from "@/domain/schemas";
import { stableHashText, summarizeErrorCode } from "@/services/security/text";
import type { AiProvider, AiRepairContext } from "./provider";

type InvokeStructuredInput<TOutput> = {
  task: AiTask;
  input: unknown;
  outputSchema: z.ZodType<TOutput>;
  promptVersion: string;
};

export type AiServiceResult<TOutput> =
  | {
      ok: true;
      data: TOutput;
      logs: AiLog[];
    }
  | {
      ok: false;
      error: string;
      logs: AiLog[];
    };

type AiServiceOptions = {
  maxValidationRetries?: number;
};

export class AiService {
  private readonly maxValidationRetries: number;

  constructor(
    private readonly provider: AiProvider,
    options: AiServiceOptions = {}
  ) {
    this.maxValidationRetries = options.maxValidationRetries ?? 1;
  }

  async invokeStructured<TOutput>(
    request: InvokeStructuredInput<TOutput>
  ): Promise<AiServiceResult<TOutput>> {
    const logs: AiLog[] = [];
    let repair: AiRepairContext | undefined;

    for (let attempt = 0; attempt <= this.maxValidationRetries; attempt += 1) {
      let rawOutput: unknown;
      const startedAt = Date.now();

      try {
        rawOutput = await this.provider.invoke({
          ...request,
          repair
        });
      } catch (error) {
        logs.push(
          this.createLog({
            task: request.task,
            promptVersion: request.promptVersion,
            input: request.input,
            status: "provider_failed",
            errorCode: summarizeErrorCode(error)
          })
        );

        return {
          ok: false,
          error: "AI provider failed before returning structured output.",
          logs
        };
      }

      const parsed = request.outputSchema.safeParse(rawOutput);

      if (parsed.success) {
        logs.push(
          this.createLog({
            task: request.task,
            promptVersion: request.promptVersion,
            input: request.input,
            output: rawOutput,
            status: "success",
            latencyMs: Date.now() - startedAt
          })
        );

        return {
          ok: true,
          data: parsed.data,
          logs
        };
      }

      logs.push(
        this.createLog({
          task: request.task,
          promptVersion: request.promptVersion,
          input: request.input,
          output: rawOutput,
          status: "validation_failed",
          errorCode: "schema_validation_failed",
          latencyMs: Date.now() - startedAt
        })
      );

      if (attempt < this.maxValidationRetries) {
        repair = {
          previousOutput: rawOutput,
          validationError: parsed.error.message
        };
        continue;
      }

      return {
        ok: false,
        error: "AI output failed schema validation after retry.",
        logs
      };
    }

    return {
      ok: false,
      error: "AI output failed for an unknown reason.",
      logs
    };
  }

  private createLog(input: {
    task: AiTask;
    promptVersion: string;
    input: unknown;
    output?: unknown;
    status: AiLog["status"];
    error?: string;
    errorCode?: string;
    latencyMs?: number;
  }): AiLog {
    const inputText = JSON.stringify(input.input);
    const outputText = input.output === undefined ? "" : JSON.stringify(input.output);

    return AiLogSchema.parse({
      id: `ai-log-${nanoid(10)}`,
      task: input.task,
      provider: this.provider.name,
      model: this.provider.model,
      promptVersion: input.promptVersion,
      inputHash: stableHashText(inputText),
      inputLength: inputText.length,
      outputLength: outputText.length || undefined,
      latencyMs: input.latencyMs,
      status: input.status,
      error: input.error,
      errorCode: input.errorCode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
}

export function summarizeForLog(value: unknown): string {
  return redactSensitiveText(JSON.stringify(value, null, 2)).slice(0, 800);
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b1[3-9]\d{9}\b/g, "[redacted-phone]");
}
