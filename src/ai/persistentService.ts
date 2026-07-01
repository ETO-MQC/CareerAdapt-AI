import { AiService, type AiServiceResult } from "./service";
import type { AiTask } from "@/domain/schemas";
import type { z } from "zod";
import type { WorkspaceRepository } from "@/services/storage/repositories";

type InvokeStructuredInput<TOutput> = {
  task: AiTask;
  input: unknown;
  outputSchema: z.ZodType<TOutput>;
  promptVersion: string;
};

export class PersistentAiService {
  constructor(
    private readonly aiService: AiService,
    private readonly repository: WorkspaceRepository
  ) {}

  async invokeStructured<TOutput>(
    request: InvokeStructuredInput<TOutput>
  ): Promise<AiServiceResult<TOutput>> {
    const result = await this.aiService.invokeStructured(request);

    if (result.logs.length > 0) {
      await this.repository.saveAiLogs(result.logs);
    }

    return result;
  }
}
