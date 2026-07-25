import { z } from "zod";

const DISPLAY_ONLY_FIELDS = new Set([
  "reasoning",
  "label",
  "description",
  "nextStep"
]);

const ACTION_ALIASES: Record<string, string> = {
  ask_clarification: "ask_user",
  complete: "workflow_complete",
  failed: "workflow_failed"
};

type UnknownRecord = Record<string, unknown>;

export function normalizeAgentPlannerAction(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;

  const source = stripDisplayFields(raw);
  const rawType = stringValue(source.type) ?? stringValue(source.action);
  const type = rawType ? ACTION_ALIASES[rawType] ?? rawType : undefined;
  if (!type) return source;

  const message = stringValue(source.message) ?? stringValue(source.content);
  switch (type) {
    case "assistant_message":
      return compact({ type, message });
    case "ask_user":
      return compact({
        type,
        message,
        field: stringValue(source.field),
        options: normalizeOptions(source.options)
      });
    case "request_confirmation":
      return compact({
        type,
        message,
        call: normalizeToolCall(source.call ?? source)
      });
    case "tool_call": {
      const candidateCalls = Array.isArray(source.calls)
        ? source.calls
        : source.call
          ? [source.call]
          : hasToolCallShape(source)
            ? [source]
            : [];
      return { type, calls: candidateCalls.map(normalizeToolCall) };
    }
    case "workflow_complete":
      return compact({ type, message });
    case "workflow_failed":
      return compact({
        type,
        code: stringValue(source.code) ?? "planner_failed",
        message,
        retryable: typeof source.retryable === "boolean" ? source.retryable : false
      });
    default:
      return compact({ ...source, type });
  }
}

export function safePlannerIssueSummary(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "$",
    code: issue.code
  }));
}

export function recoverUnknownToolCall(requestedToolName: string, allowedNames: Set<string>) {
  const normalized = requestedToolName.trim().toLowerCase().replace(/[-\s]+/g, "_");
  const aliases: Record<string, string> = {
    parse_job: "parse_job_description",
    save_job: "commit_job",
    create_job: "commit_job",
    import_job: "parse_job_description",
    list_resume: "list_resumes",
    list_profile: "list_profiles",
    list_job: "list_jobs",
    export_pdf: "export_resume"
  };
  const candidate = aliases[normalized] ?? normalized;
  return allowedNames.has(candidate) ? candidate : undefined;
}

function normalizeToolCall(value: unknown) {
  const source = isRecord(value) ? stripDisplayFields(value) : {};
  return compact({
    toolName: stringValue(source.toolName) ?? stringValue(source.tool_name),
    operationId: stringValue(source.operationId) ?? stringValue(source.operation_id),
    input: recordValue(source.input)
      ?? recordValue(source.arguments)
      ?? recordValue(source.toolInput)
      ?? {}
  });
}

function normalizeOptions(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const options = value.flatMap((option) => {
    if (typeof option === "string" && option.trim()) {
      return [{
        id: stableOptionId(option.trim()),
        label: option.trim(),
        action: { type: "answer", field: "choice", value: option.trim() }
      }];
    }
    if (!isRecord(option)) return [];
    const label = stringValue(option.label)
      ?? stringValue(option.description)
      ?? stringValue(option.value);
    if (!label) return [];
    return [{
      id: stringValue(option.id) ?? stableOptionId(label),
      label,
      action: isRecord(option.action)
        ? option.action
        : { type: "answer", field: stringValue(option.field) ?? "choice", value: stringValue(option.value) ?? label }
    }];
  });
  return options.length ? options.slice(0, 12) : undefined;
}

function stripDisplayFields(value: UnknownRecord) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !DISPLAY_ONLY_FIELDS.has(key))
  );
}

function hasToolCallShape(value: UnknownRecord) {
  return Boolean(
    value.toolName
    || value.tool_name
    || value.operationId
    || value.operation_id
    || value.arguments
    || value.toolInput
  );
}

function compact<T extends UnknownRecord>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stableOptionId(value: string) {
  return `option-${value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "choice"}`;
}
