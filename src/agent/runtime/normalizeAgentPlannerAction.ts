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
      return [{ value: option.trim(), label: option.trim() }];
    }
    if (!isRecord(option)) return [];
    const label = stringValue(option.label)
      ?? stringValue(option.description)
      ?? stringValue(option.value);
    if (!label) return [];
    return [{
      value: stringValue(option.value) ?? label,
      label
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
