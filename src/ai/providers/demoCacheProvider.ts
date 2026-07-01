import type { AiInvokeRequest, AiProvider } from "../provider";
import { stableHashText } from "@/services/security/text";

export class DemoCacheProvider implements AiProvider {
  readonly name = "demo-cache";

  private readonly cache: Map<string, unknown>;

  constructor(
    cacheEntries: Record<string, unknown> = {},
    private readonly fallback?: AiProvider
  ) {
    this.cache = new Map(Object.entries(cacheEntries));
  }

  async invoke<TOutput>(request: AiInvokeRequest<TOutput>): Promise<unknown> {
    const key = this.cacheKey(request.task, request.promptVersion, inputHashForCache(request.input));

    if (this.cache.has(key) && !request.repair) {
      return this.cache.get(key);
    }

    if (!this.fallback) {
      throw new Error(`Demo cache miss for exact task, prompt version, and input hash: ${key}.`);
    }

    return this.fallback.invoke(request);
  }

  private cacheKey(task: string, promptVersion: string, inputHash: string) {
    return `${task}:${promptVersion}:${inputHash}`;
  }
}

function inputHashForCache(input: unknown) {
  if (typeof input === "object" && input && "inputHash" in input && typeof input.inputHash === "string") {
    return input.inputHash;
  }

  return stableHashText(JSON.stringify(input));
}
