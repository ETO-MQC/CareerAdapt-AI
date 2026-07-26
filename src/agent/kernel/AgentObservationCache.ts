import type { AgentToolResult } from "@/agent/contracts/agentTool";

type CachedObservation = {
  result: AgentToolResult;
  fetchedAt: number;
};

const CACHEABLE_READS = new Set([
  "get_active_profile", "get_profile", "search_profile_facts",
  "get_resume", "get_resume_revision", "get_job",
  "list_profiles", "list_resumes", "list_jobs"
]);

export class AgentObservationCache {
  private readonly entries = new Map<string, CachedObservation>();

  constructor(private readonly ttlMs = 5 * 60_000) {}

  get(toolName: string, input: unknown) {
    if (!CACHEABLE_READS.has(toolName)) return undefined;
    const key = cacheKey(toolName, input);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.fetchedAt > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return structuredClone(entry.result);
  }

  set(toolName: string, input: unknown, result: AgentToolResult) {
    if (!CACHEABLE_READS.has(toolName) || !result.ok) return;
    this.entries.set(cacheKey(toolName, input), {
      result: structuredClone(result),
      fetchedAt: Date.now()
    });
  }

  invalidateAfter(toolName: string) {
    if (!CACHEABLE_READS.has(toolName)) this.entries.clear();
  }
}

function cacheKey(toolName: string, input: unknown) {
  return `${toolName}:${stableStringify(input)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
