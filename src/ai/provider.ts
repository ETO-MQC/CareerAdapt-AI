import type { z } from "zod";
import type { AiTask } from "@/domain/schemas";

export type AiRepairContext = {
  previousOutput: unknown;
  validationError: string;
};

export type AiInvokeRequest<TOutput> = {
  task: AiTask;
  input: unknown;
  outputSchema: z.ZodType<TOutput>;
  promptVersion: string;
  repair?: AiRepairContext;
};

export interface AiProvider {
  readonly name: string;
  readonly model?: string;
  invoke<TOutput>(request: AiInvokeRequest<TOutput>): Promise<unknown>;
}
