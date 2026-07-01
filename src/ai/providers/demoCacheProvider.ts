import { MockAiProvider } from "./mockProvider";
import type { AiInvokeRequest, AiProvider } from "../provider";

export class DemoCacheProvider implements AiProvider {
  readonly name = "demo-cache";

  private readonly fallback: AiProvider;
  private readonly cache: Map<string, unknown>;

  constructor(cacheEntries: Record<string, unknown> = {}, fallback: AiProvider = new MockAiProvider()) {
    this.cache = new Map(Object.entries(cacheEntries));
    this.fallback = fallback;
  }

  async invoke<TOutput>(request: AiInvokeRequest<TOutput>): Promise<unknown> {
    const key = this.cacheKey(request.task, request.promptVersion);

    if (this.cache.has(key) && !request.repair) {
      return this.cache.get(key);
    }

    return this.fallback.invoke(request);
  }

  private cacheKey(task: string, promptVersion: string) {
    return `${task}:${promptVersion}`;
  }
}
