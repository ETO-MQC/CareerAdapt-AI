import type { AiInvokeRequest, AiProvider } from "../provider";

export class FallbackAiProvider implements AiProvider {
  readonly name: string;

  constructor(
    private readonly primary: AiProvider,
    private readonly demoCache: AiProvider
  ) {
    this.name = `${primary.name}->${demoCache.name}`;
  }

  async invoke<TOutput>(request: AiInvokeRequest<TOutput>): Promise<unknown> {
    try {
      return await this.primary.invoke(request);
    } catch (primaryError) {
      try {
        return await this.demoCache.invoke(request);
      } catch (cacheError) {
        const primaryMessage = primaryError instanceof Error ? primaryError.message : "unknown primary failure";
        const cacheMessage = cacheError instanceof Error ? cacheError.message : "unknown demo cache failure";
        throw new Error(`Primary provider failed and demo cache fallback is unavailable: ${primaryMessage}; ${cacheMessage}`);
      }
    }
  }
}
