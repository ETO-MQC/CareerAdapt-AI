import { AgentModelResultSchema, type AgentModelResult, type AgentModelToolCall } from "./agentModel";

export const AGENT_TOOL_PROTOCOLS = [
  "native_openai",
  "structured_json",
  "textual_hermes",
  "textual_xml",
  "textual_json",
  "no_tool"
] as const;

export type AgentToolProtocol = typeof AGENT_TOOL_PROTOCOLS[number];

export type AgentToolProtocolDiagnostics = {
  provider?: string;
  model?: string;
  providerResponseShape?: string[];
  markerKinds: string[];
  requestedToolName?: string;
  unknownToolNames?: string[];
  allowedToolNames: string[];
  argumentShape?: Record<string, string>;
  stopReason?: string;
  nativeToolCallsPresent: boolean;
  safeErrorCode?: string;
  repairPath?: "none" | "adapter" | "structured_action_fallback";
  providerErrorCode?: string;
  providerHttpStatus?: number;
  retryable?: boolean;
  recoveryAttempted?: boolean;
};

export type NormalizedToolDecision = {
  text?: string;
  toolCalls: AgentModelToolCall[];
  protocol: AgentToolProtocol;
  repairApplied: boolean;
  diagnostics: AgentToolProtocolDiagnostics;
  stopReason: AgentModelResult["stopReason"];
};

/** Public adapter object for callers that prefer an injectable boundary. */
export class AgentToolProtocolAdapter {
  constructor(private readonly allowedTools: Array<{ name: string }>) {}

  normalize(rawResponse: AgentModelResult, options: AdapterOptions = {}) {
    return normalizeAgentToolProtocol(rawResponse, this.allowedTools, options);
  }
}

export class AgentToolProtocolError extends Error {
  readonly code = "provider_textual_tool_protocol";
  readonly retryable = true;
  constructor(readonly diagnostics: AgentToolProtocolDiagnostics, message = "Provider tool protocol could not be parsed safely.") {
    super(message);
    this.name = "AgentToolProtocolError";
  }
}

type AdapterOptions = {
  repairApplied?: boolean;
};

/**
 * Normalize provider dialects at the model boundary.  The executor only sees
 * calls returned by this function, and callers still validate them against
 * the authoritative tool registry before execution.
 */
export function normalizeAgentToolProtocol(
  rawResponse: AgentModelResult,
  allowedTools: Array<{ name: string }>,
  options: AdapterOptions = {}
): NormalizedToolDecision {
  const response = AgentModelResultSchema.parse(rawResponse);
  const allowed = new Set(allowedTools.map((tool) => tool.name));
  const baseDiagnostics: AgentToolProtocolDiagnostics = {
    provider: response.provider,
    model: response.model,
    providerResponseShape: response.providerResponseShape,
    markerKinds: [],
    allowedToolNames: [...allowed].sort(),
    stopReason: response.stopReason,
    nativeToolCallsPresent: Boolean(response.toolCalls?.length),
    repairPath: options.repairApplied ? "structured_action_fallback" : "none"
  };

  if (response.toolCalls?.length) {
    const unknown = response.toolCalls.filter((call) => !allowed.has(call.name)).map((call) => call.name);
    if (unknown.length) baseDiagnostics.unknownToolNames = [...new Set(unknown)];
    return {
      text: response.text?.trim() || undefined,
      toolCalls: response.toolCalls,
      protocol: "native_openai",
      repairApplied: Boolean(options.repairApplied),
      diagnostics: baseDiagnostics,
      stopReason: "tool_calls"
    };
  }

  const text = response.text?.trim();
  if (!text) {
    return {
      toolCalls: [],
      protocol: "no_tool",
      repairApplied: Boolean(options.repairApplied),
      diagnostics: baseDiagnostics,
      stopReason: response.stopReason
    };
  }

  const structured = parseStructuredJson(text, allowed, baseDiagnostics);
  if (structured) return withRepair(structured, options.repairApplied);

  const textual = parseTextualCalls(text, allowed, baseDiagnostics);
  if (textual.kind === "error") throw new AgentToolProtocolError({
    ...textual.diagnostics,
    repairPath: "adapter",
    recoveryAttempted: true,
    retryable: true
  });
  if (textual.diagnostics.unknownToolNames?.length) {
    throw new AgentToolProtocolError({
      ...textual.diagnostics,
      safeErrorCode: "unknown_agent_tool",
      repairPath: "adapter",
      recoveryAttempted: true,
      retryable: false
    });
  }
  if (textual.calls.length) {
    return {
      text: removeToolMarkers(text).trim() || undefined,
      toolCalls: textual.calls,
      protocol: textual.protocol,
      repairApplied: true,
      diagnostics: { ...textual.diagnostics, repairPath: "adapter", recoveryAttempted: true },
      stopReason: "tool_calls"
    };
  }
  return {
    text,
    toolCalls: [],
    protocol: "no_tool",
    repairApplied: Boolean(options.repairApplied),
    diagnostics: baseDiagnostics,
    stopReason: response.stopReason
  };
}

function parseStructuredJson(
  text: string,
  allowed: Set<string>,
  diagnostics: AgentToolProtocolDiagnostics
): NormalizedToolDecision | undefined {
  const candidate = stripJsonFence(text);
  const parsed = parseJsonObject(candidate);
  if (!parsed) return undefined;
  const rawCalls = parsed.toolCalls;
  if (!Array.isArray(rawCalls)) return undefined;
  diagnostics.markerKinds.push("structured_json");
  const calls = rawCalls.flatMap((value, index) => parseCall(value, index, allowed, diagnostics));
  if (diagnostics.unknownToolNames?.length) return blockedUnknownTools({
    ...AgentModelResultSchema.parse({ stopReason: "tool_calls", text }),
    text,
    toolCalls: undefined
  }, diagnostics, diagnostics.unknownToolNames);
  if (!calls.length) throw new AgentToolProtocolError({
    ...diagnostics,
    safeErrorCode: "provider_textual_tool_protocol"
  });
  return {
    text: typeof parsed.text === "string" && parsed.text.trim() ? parsed.text.trim() : undefined,
    toolCalls: calls,
    protocol: "structured_json",
    repairApplied: true,
    diagnostics,
    stopReason: "tool_calls"
  };
}

function parseTextualCalls(
  text: string,
  allowed: Set<string>,
  diagnostics: AgentToolProtocolDiagnostics
): { kind: "ok"; calls: AgentModelToolCall[]; protocol: "textual_xml" | "textual_json"; diagnostics: AgentToolProtocolDiagnostics } | { kind: "error"; diagnostics: AgentToolProtocolDiagnostics } {
  const calls: AgentModelToolCall[] = [];
  const wrapperMatches = [...text.matchAll(/<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi)];
  if (/<tool_call\b/i.test(text) && !wrapperMatches.length) {
    diagnostics.markerKinds.push("malformed_marker");
    return { kind: "error", diagnostics: { ...diagnostics, safeErrorCode: "provider_textual_tool_protocol" } };
  }
  if (wrapperMatches.length) {
    diagnostics.markerKinds.push("tool_call");
    for (const [index, match] of wrapperMatches.entries()) {
      const body = (match[1] ?? "").trim();
      const jsonBody = parseJsonObject(body);
      if (jsonBody && typeof jsonBody.name === "string") {
        diagnostics.markerKinds.push("tool_call_json");
        const call = parseCall(jsonBody, index, allowed, diagnostics);
        if (call.length) calls.push(...call);
        continue;
      }
      const functionMatch = body.match(/<function\s*=\s*([A-Za-z_][\w.-]*)\s*>([\s\S]*?)(?:<\/function>|$)/i);
      if (!functionMatch) return { kind: "error", diagnostics: { ...diagnostics, safeErrorCode: "provider_textual_tool_protocol" } };
      const requestedName = functionMatch[1];
      const argsText = functionMatch[2].trim();
      const args = parseFunctionArguments(argsText, diagnostics);
      if (!args) return { kind: "error", diagnostics: { ...diagnostics, requestedToolName: requestedName, safeErrorCode: "provider_textual_tool_protocol" } };
      const call = makeCall(requestedName, args, index, allowed, diagnostics);
      if (call) calls.push(call);
    }
    return { kind: "ok", calls, protocol: calls.length && diagnostics.markerKinds.includes("tool_call_json") ? "textual_json" : "textual_xml", diagnostics };
  }

  const functionMatches = [...text.matchAll(/<function\s*=\s*([A-Za-z_][\w.-]*)\s*>([\s\S]*?)(?:<\/function>|$)/gi)];
  if (/<function\s*=/i.test(text) && !/<\/function>/i.test(text)) {
    diagnostics.markerKinds.push("malformed_marker");
    return { kind: "error", diagnostics: { ...diagnostics, safeErrorCode: "provider_textual_tool_protocol" } };
  }
  if (functionMatches.length || /<parameter\s*=/i.test(text)) {
    diagnostics.markerKinds.push("function");
    for (const [index, match] of functionMatches.entries()) {
      const requestedName = match[1];
      const args = parseFunctionArguments((match[2] ?? "").trim(), diagnostics);
      if (!args) return { kind: "error", diagnostics: { ...diagnostics, requestedToolName: requestedName, safeErrorCode: "provider_textual_tool_protocol" } };
      const call = makeCall(requestedName, args, index, allowed, diagnostics);
      if (call) calls.push(call);
    }
    return functionMatches.length && calls.length
      ? { kind: "ok", calls, protocol: "textual_xml", diagnostics }
      : { kind: "error", diagnostics: { ...diagnostics, safeErrorCode: "provider_textual_tool_protocol" } };
  }

  if (/<tool_call\b|<function\s*=/i.test(text)) {
    diagnostics.markerKinds.push("malformed_marker");
    return { kind: "error", diagnostics: { ...diagnostics, safeErrorCode: "provider_textual_tool_protocol" } };
  }
  return { kind: "ok", calls, protocol: "textual_xml", diagnostics };
}

function parseFunctionArguments(value: string, diagnostics: AgentToolProtocolDiagnostics) {
  if (!value) return {};
  const json = parseJsonObject(value);
  if (json && !("name" in json) && !("toolCalls" in json)) {
    diagnostics.markerKinds.push("function_json");
    diagnostics.argumentShape = argumentShape(json);
    return json;
  }
  const parameters = [...value.matchAll(/<parameter\s*=\s*([A-Za-z_][\w.-]*)\s*>([\s\S]*?)(?=<parameter\s*=|<\/function>|$)/gi)];
  if (!parameters.length && /<parameter\s*=/i.test(value)) return undefined;
  const args: Record<string, unknown> = {};
  for (const parameter of parameters) args[parameter[1]] = parseParameterValue(parameter[2]);
  diagnostics.argumentShape = argumentShape(args);
  return args;
}

function parseCall(value: unknown, index: number, allowed: Set<string>, diagnostics: AgentToolProtocolDiagnostics) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : typeof record.tool === "string" ? record.tool : undefined;
  if (!name) return [];
  const args = record.arguments && typeof record.arguments === "object" && !Array.isArray(record.arguments)
    ? record.arguments as Record<string, unknown>
    : record.input && typeof record.input === "object" && !Array.isArray(record.input)
      ? record.input as Record<string, unknown>
      : {};
  const call = makeCall(name, args, index, allowed, diagnostics);
  return call ? [call] : [];
}

function makeCall(
  requestedName: string,
  args: Record<string, unknown>,
  index: number,
  allowed: Set<string>,
  diagnostics: AgentToolProtocolDiagnostics
) {
  const name = allowed.has(requestedName) ? requestedName : textualToolAlias(requestedName, allowed);
  if (!name) {
    diagnostics.requestedToolName = requestedName;
    diagnostics.unknownToolNames = [...new Set([...(diagnostics.unknownToolNames ?? []), requestedName])];
    return undefined;
  }
  diagnostics.argumentShape = argumentShape(args);
  return {
    id: `protocol-tool-call-${index + 1}`,
    name,
    arguments: args
  } satisfies AgentModelToolCall;
}

function textualToolAlias(requestedName: string, allowed: Set<string>) {
  const aliases: Record<string, string> = {
    read_profile: "get_profile"
  };
  const canonical = aliases[requestedName];
  return canonical && allowed.has(canonical) ? canonical : undefined;
}

function blockedUnknownTools(
  response: AgentModelResult,
  diagnostics: AgentToolProtocolDiagnostics,
  unknown: string[]
): NormalizedToolDecision {
  return {
    text: "当前步骤需要的能力不可用；我会保留已经记录的内容，不会执行未知操作。",
    toolCalls: [],
    protocol: response.toolCalls?.length ? "native_openai" : "structured_json",
    repairApplied: true,
    diagnostics: {
      ...diagnostics,
      unknownToolNames: [...new Set(unknown)],
      safeErrorCode: "unknown_agent_tool"
    },
    stopReason: "ask_user"
  };
}

function withRepair(value: NormalizedToolDecision, repairApplied?: boolean) {
  return { ...value, repairApplied: Boolean(repairApplied) || value.repairApplied };
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return undefined;
    try {
      const parsed = JSON.parse(match[0]) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : undefined;
    } catch {
      return undefined;
    }
  }
}

function stripJsonFence(value: string) {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function parseParameterValue(value: string) {
  const trimmed = value.replace(/<\/parameter>\s*$/i, "").trim();
  if (!trimmed) return "";
  try { return JSON.parse(trimmed); } catch { return trimmed; }
}

function removeToolMarkers(value: string) {
  return value
    .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<function\s*=[\s\S]*?(?:<\/function>|$)/gi, "")
    .trim();
}

function argumentShape(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shapeOf(item)]));
}

function shapeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value;
}
