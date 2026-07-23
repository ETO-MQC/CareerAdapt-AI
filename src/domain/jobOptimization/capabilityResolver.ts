import {
  CapabilityEntitySchema,
  type CapabilityEntity,
  type CapabilityEntitySource,
  type CapabilityEntityType,
  type JobDescription,
  type TailoringJobContext
} from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";

type ResolverInput = {
  job?: (Pick<JobDescription, "title" | "company" | "requirements"> & { keywords?: string[] }) | TailoringJobContext;
  requirements?: string[];
  keywords?: string[];
  userAnswers?: string[];
};

type DictionaryEntry = {
  label: string;
  type: CapabilityEntityType;
  pattern: RegExp;
};

const DICTIONARY: DictionaryEntry[] = [
  { label: "Talents AI", type: "platform", pattern: /\b(?:talents?\s*ai|telent(?:s)?\s*ai)\b(?=\s*平台)/i },
  { label: "Talents", type: "company", pattern: /\b(?:talents?(?:\s*ai)?|telent(?:s)?(?:\s*ai)?)\b/i },
  { label: "Claude Code", type: "tool", pattern: /\bclaude\s*code\b/i },
  { label: "Cursor", type: "tool", pattern: /\bcursor\b/i },
  { label: "Codex", type: "tool", pattern: /\bcodex\b/i },
  { label: "Windsurf", type: "tool", pattern: /\bwindsurf\b/i },
  { label: "Playwright", type: "tool", pattern: /\bplaywright\b/i },
  { label: "Vitest", type: "tool", pattern: /\bvitest\b/i },
  { label: "ChatGPT", type: "model", pattern: /\bchatgpt\b/i },
  { label: "Claude", type: "model", pattern: /\bclaude\b(?!\s*code)/i },
  { label: "Gemini", type: "model", pattern: /\bgemini\b/i },
  { label: "Qwen", type: "model", pattern: /\bqwen\b/i },
  { label: "豆包", type: "model", pattern: /豆包/ },
  { label: "元宝", type: "model", pattern: /元宝/ },
  { label: "复杂指令设计", type: "skill", pattern: /复杂指令设计/ },
  { label: "任务规划", type: "workflow", pattern: /任务规划/ },
  { label: "输出质量评估", type: "workflow", pattern: /输出质量评估|模型输出评估/ },
  { label: "dashboard", type: "material", pattern: /\bdashboard\b/i },
  { label: "billing history", type: "material", pattern: /\bbilling\s*history\b/i },
  { label: "GitHub 链接", type: "material", pattern: /\bgithub\b(?:\s*链接)?/i }
];

const PROFICIENCY_TYPES = new Set<CapabilityEntityType>(["tool", "model", "skill", "workflow"]);
const BLOCKED_SKILL_TYPES = new Set<CapabilityEntityType>(["platform", "company", "material", "unknown"]);

export function normalizeCapabilityLabel(value: string) {
  const normalized = value.toLowerCase().replace(/[\s_-]+/g, "").replace(/[^\p{L}\p{N}]/gu, "");
  if (/^(?:talents?ai?|telents?ai?)$/.test(normalized)) return "talents";
  return normalized;
}

export function resolveCapabilityEntities(input: ResolverInput): CapabilityEntity[] {
  const sources: Array<{ text: string; source: CapabilityEntitySource }> = [];
  if (input.job) {
    sources.push({ text: input.job.title, source: "job_title" });
    if (input.job.company?.trim()) sources.push({ text: input.job.company, source: "job_company" });
    if ("rawText" in input.job && input.job.rawText.trim()) sources.push({ text: input.job.rawText, source: "requirement" });
    const requirements = "requirements" in input.job
      ? input.job.requirements.map((item) => item.description)
      : [...input.job.responsibilities, ...input.job.mustHave, ...input.job.niceToHave];
    requirements.forEach((text) => sources.push({ text, source: "requirement" }));
    input.job.keywords?.forEach((text) => sources.push({ text, source: "keyword" }));
  }
  input.requirements?.forEach((text) => sources.push({ text, source: "requirement" }));
  input.keywords?.forEach((text) => sources.push({ text, source: "keyword" }));
  input.userAnswers?.forEach((text) => sources.push({ text, source: "user_answer" }));

  const resolved: CapabilityEntity[] = [];
  for (const candidate of sources) {
    if (!candidate.text.trim()) continue;
    if (candidate.source === "job_company") {
      resolved.push(entity(candidate.text.trim(), "company", candidate.source));
      continue;
    }
    let matched = false;
    for (const entry of DICTIONARY) {
      if (!entry.pattern.test(candidate.text)) continue;
      matched = true;
      resolved.push(entity(entry.label, entry.type, candidate.source));
    }
    if (!matched && (candidate.source === "keyword" || candidate.source === "user_answer")) {
      resolved.push(entity(candidate.text.trim(), "unknown", candidate.source));
    }
  }
  const seen = new Set<string>();
  return resolved.filter((item) => {
    const key = `${item.normalizedLabel}:${item.type}:${item.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function capabilityAllowsProficiency(capability?: CapabilityEntity) {
  return Boolean(capability && PROFICIENCY_TYPES.has(capability.type));
}

export function capabilityBlockedFromSkill(capability?: CapabilityEntity) {
  return Boolean(capability && BLOCKED_SKILL_TYPES.has(capability.type));
}

export function capabilityIsMaterialOnly(capability?: CapabilityEntity) {
  return Boolean(capability && ["platform", "company", "material"].includes(capability.type));
}

export function pickProficiencyCapability(entities: CapabilityEntity[]) {
  return entities.find((item) => capabilityAllowsProficiency(item));
}

function entity(label: string, type: CapabilityEntityType, source: CapabilityEntitySource) {
  const normalizedLabel = normalizeCapabilityLabel(label);
  return CapabilityEntitySchema.parse({
    id: `capability-${stableHashText(`${normalizedLabel}:${type}:${source}`)}`,
    label,
    normalizedLabel,
    type,
    source
  });
}
