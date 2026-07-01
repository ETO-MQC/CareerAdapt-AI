import { nanoid } from "nanoid";
import type { z } from "zod";
import { AiLogSchema, type AiLog, type AiTask } from "@/domain/schemas";
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
            error: error instanceof Error ? error.message : "Unknown provider failure"
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
            status: "success"
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
          error: parsed.error.message
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
  }): AiLog {
    return AiLogSchema.parse({
      id: `ai-log-${nanoid(10)}`,
      task: input.task,
      provider: this.provider.name,
      promptVersion: input.promptVersion,
      inputSummary: summarizeForLog(input.input),
      outputSummary: input.output === undefined ? undefined : summarizeForLog(input.output),
      status: input.status,
      error: input.error,
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
