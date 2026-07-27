import type { AgentToolResult } from "@/agent/contracts/agentTool";

type CachedObservation = {
  result: AgentToolResult;
  fetchedAt: number;
  identity?: string;
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
    if (!CACHEABLE_READS.has(toolName) || !result.ok || incomplete(result.data)) return;
    this.entries.set(cacheKey(toolName, input), {
      result: structuredClone(result),
      fetchedAt: Date.now(),
      identity: authoritativeIdentity(result.data)
    });
  }

  invalidateAfter(toolName: string) {
    const dependentReads: Record<string, string[]> = {
      commit_resume_import: ["list_profiles", "get_active_profile", "get_profile", "search_profile_facts", "list_resumes", "get_resume", "get_resume_revision"],
      commit_job: ["list_jobs", "get_job"],
      create_job_resume_from_profile: ["list_resumes", "get_resume", "get_resume_revision"],
      apply_tailoring_changes: ["list_resumes", "get_resume", "get_resume_revision"],
      answer_tailoring_question: ["get_resume", "get_resume_revision"]
    };
    const invalidated = dependentReads[toolName];
    if (!invalidated) return;
    for (const key of this.entries.keys()) {
      if (invalidated.some((name) => key.startsWith(`${name}:`))) this.entries.delete(key);
    }
  }

  invalidateEntity(entityType: "profile" | "resume" | "job", entityId?: string) {
    const names = entityType === "profile"
      ? ["get_active_profile", "get_profile", "search_profile_facts", "list_profiles"]
      : entityType === "resume"
        ? ["get_resume", "get_resume_revision", "list_resumes"]
        : ["get_job", "list_jobs"];
    for (const [key, entry] of this.entries) {
      if (names.some((name) => key.startsWith(`${name}:`)) && (!entityId || key.includes(JSON.stringify(entityId)) || entry.identity?.includes(entityId))) {
        this.entries.delete(key);
      }
    }
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

function incomplete(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.partial === true || record.complete === false || record.status === "partial" || record.status === "error") {
    return true;
  }
  // Empty discovery results are time-sensitive: a confirmed mutation can
  // create the first entity before a later turn asks for the list again.
  return ["profiles", "resumes", "jobs"].some((key) =>
    Array.isArray(record[key]) && (record[key] as unknown[]).length === 0
  );
}

function authoritativeIdentity(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const nested = ["profile", "resume", "revision", "job"]
    .map((key) => record[key])
    .find((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) as Record<string, unknown> | undefined;
  const source = nested ?? record;
  const id = source.id ?? source.profileId ?? source.resumeId ?? source.jobId;
  const version = source.version ?? source.revision ?? source.revisionId ?? source.updatedAt ?? source.hash;
  return id && version ? `${String(id)}@${String(version)}` : undefined;
}
