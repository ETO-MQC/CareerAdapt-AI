import { redactSensitiveTextForModel } from "@/services/security/text";

export type SafeSchemaIssue = {
  path: string;
  code: string;
  expected?: string;
  received?: string;
  unrecognizedKeys?: string[];
};

export function summarizeSchemaIssues(error: unknown): SafeSchemaIssue[] {
  const issues = (error as {
    issues?: Array<Record<string, unknown> & { path?: PropertyKey[]; code?: string }>;
    error?: { issues?: Array<Record<string, unknown> & { path?: PropertyKey[]; code?: string }> };
  })?.issues ?? (error as {
    error?: { issues?: Array<Record<string, unknown> & { path?: PropertyKey[]; code?: string }> };
  })?.error?.issues ?? [];

  return issues.slice(0, 20).map((issue) => {
    const input = issue.input;
    const received = input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
    const keys = Array.isArray(issue.keys)
      ? issue.keys.filter((key): key is string => typeof key === "string").slice(0, 12)
      : undefined;
    return {
      path: formatSchemaPath(issue.path ?? []),
      code: typeof issue.code === "string" ? issue.code : "unknown",
      ...(typeof issue.expected === "string" ? { expected: issue.expected } : {}),
      ...(input !== undefined ? { received } : {}),
      ...(keys?.length ? { unrecognizedKeys: keys } : {})
    };
  });
}

export function describeResumeMapperOutputShape(rawOutput: unknown) {
  const top = asRecord(rawOutput);
  const wrapped = ["structuredDraft", "draft", "resume", "result"]
    .map((key) => asRecord(top?.[key]))
    .find(Boolean);
  const structuredDraft = asRecord(wrapped?.structuredDraft) ?? wrapped;
  const basics = asRecord(structuredDraft?.basics);
  const sections = Array.isArray(structuredDraft?.sections) ? structuredDraft.sections : [];
  const sampleSection = sections.map(asRecord).find(Boolean);
  const items = Array.isArray(sampleSection?.items) ? sampleSection.items : [];
  const sampleItem = items.map(asRecord).find(Boolean);
  return {
    topLevelKeys: Object.keys(top ?? {}).slice(0, 20),
    structuredDraftKeys: Object.keys(structuredDraft ?? {}).slice(0, 20),
    basicsKeys: Object.keys(basics ?? {}).slice(0, 20),
    sectionCount: sections.length,
    sampleSectionKeys: Object.keys(sampleSection ?? {}).slice(0, 20),
    sampleItemKeys: Object.keys(sampleItem ?? {}).slice(0, 20)
  };
}

export function debugRedactedResumeMapperRaw(rawOutput: unknown) {
  if (
    process.env.NODE_ENV !== "development"
    || process.env.AI_DEBUG_RESUME_MAPPER_RAW !== "1"
  ) return;
  const serialized = JSON.stringify(rawOutput);
  console.debug(
    "[resume-document-mapper:redacted-raw]",
    redactSensitiveTextForModel(serialized).text
  );
}

function formatSchemaPath(path: PropertyKey[]) {
  return path.reduce<string>((result, part) => {
    if (typeof part === "number") return `${result}[${part}]`;
    return result ? `${result}.${String(part)}` : String(part);
  }, "");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
