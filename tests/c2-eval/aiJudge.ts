import { OpenAiCompatibleProvider } from "@/ai/providers/openAiCompatibleProvider";
import { c2JudgePrompt } from "./judgePrompt";
import { C2JudgeInputSchema, C2JudgeOutputSchema, type C2JudgeInput, type C2JudgeOutput } from "./judgeSchema";

export type AiJudgeCategory =
  | "passed"               // 模型返回且Judge判定 passed=true
  | "judge_disagreed"      // 模型返回但Judge判定 passed=false
  | "provider_unavailable" // 429/超时/网络错误
  | "schema_invalid"       // 模型返回但Schema校验失败
  | "consistency_invalid"  // 模型返回但一致性校验失败（重试后仍失败）
  | "input_error";         // 输入数据本身不合法

export type AiJudgeResult = {
  success: boolean;
  output?: C2JudgeOutput;
  error?: string;
  model?: string;
  latencyMs?: number;
  category: AiJudgeCategory;
  retried?: boolean;
};

/**
 * 运行AI语义Judge评价一个 Fact Guard 结果。
 * 包含一致性校验和一次重试。
 */
export async function runC2AiJudge(input: C2JudgeInput, signal?: AbortSignal): Promise<AiJudgeResult> {
  const parsed = C2JudgeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: `Judge input schema error: ${parsed.error.message}`, category: "input_error" };
  }

  const provider = new OpenAiCompatibleProvider();
  const startTime = Date.now();

  const firstResult = await invokeJudgeOnce(provider, parsed.data, signal);
  if (!firstResult.success) {
    return { ...firstResult, latencyMs: Date.now() - startTime };
  }

  const consistency = validateJudgeConsistency(firstResult.output!);
  if (consistency.valid) {
    return {
      ...firstResult,
      latencyMs: Date.now() - startTime,
      category: firstResult.output!.passed ? "passed" : "judge_disagreed"
    };
  }

  // 一致性失败 → 重试一次
  const retryResult = await invokeJudgeOnce(provider, parsed.data, signal);
  if (!retryResult.success) {
    return {
      success: true,
      output: firstResult.output,
      model: firstResult.model,
      latencyMs: Date.now() - startTime,
      category: "consistency_invalid",
      retried: true,
      error: `Judge consistency invalid (${consistency.reason}), retry also failed: ${retryResult.error}`
    };
  }

  const retryConsistency = validateJudgeConsistency(retryResult.output!);
  if (retryConsistency.valid) {
    return {
      ...retryResult,
      latencyMs: Date.now() - startTime,
      retried: true,
      category: retryResult.output!.passed ? "passed" : "judge_disagreed"
    };
  }

  return {
    success: true,
    output: firstResult.output,
    model: firstResult.model,
    latencyMs: Date.now() - startTime,
    category: "consistency_invalid",
    retried: true,
    error: `Judge consistency invalid after retry: ${retryConsistency.reason}`
  };
}

async function invokeJudgeOnce(
  provider: OpenAiCompatibleProvider,
  input: C2JudgeInput,
  signal?: AbortSignal
): Promise<AiJudgeResult> {
  try {
    const response = await provider.invoke({
      systemPrompt: c2JudgePrompt.system,
      userPrompt: JSON.stringify(input, null, 2),
      maxOutputChars: 4_000,
      signal: signal ?? AbortSignal.timeout(30_000)
    });

    const rawOutput = coerceJudgeOutput(response.output);
    const result = C2JudgeOutputSchema.safeParse(rawOutput);

    if (!result.success) {
      return {
        success: false,
        error: `Judge output schema error: ${result.error.message}`,
        model: (response as Record<string, unknown>).model as string | undefined,
        category: "schema_invalid"
      };
    }

    return {
      success: true,
      output: result.data,
      model: (response as Record<string, unknown>).model as string | undefined,
      category: result.data.passed ? "passed" : "judge_disagreed"
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: msg,
      category: classifyProviderError(msg)
    };
  }
}

type ConsistencyResult = { valid: true } | { valid: false; reason: string };

function validateJudgeConsistency(output: C2JudgeOutput): ConsistencyResult {
  // suggestionSafe ↔ recommendedDisposition 一致性
  if (output.suggestionSafe && output.recommendedDisposition !== "pass") {
    return { valid: false, reason: "suggestionSafe=true 但 recommendedDisposition !== pass" };
  }
  if (!output.suggestionSafe && output.recommendedDisposition !== "block") {
    return { valid: false, reason: "suggestionSafe=false 但 recommendedDisposition !== block" };
  }

  // passed 计算正确性
  const expectedPassed = output.agreesWithSystemDisposition && output.evidenceGrounded && output.scopeIsolationSafe;
  if (output.passed !== expectedPassed) {
    return { valid: false, reason: `passed 应为 ${expectedPassed}，实际为 ${output.passed}` };
  }

  return { valid: true };
}

/**
 * 将AI原始输出coerce为Judge output结构。
 */
function coerceJudgeOutput(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) {
    return raw;
  }

  const obj = raw as Record<string, unknown>;

  const suggestionSafe = typeof obj.suggestionSafe === "boolean" ? obj.suggestionSafe
    : typeof obj.suggestion_safe === "boolean" ? obj.suggestion_safe
      : false;

  const recommendedDisposition = coerceDisposition(obj.recommendedDisposition ?? obj.recommended_disposition ?? obj.actualDisposition ?? obj.actual_disposition);

  const agreesWithSystemDisposition = typeof obj.agreesWithSystemDisposition === "boolean" ? obj.agreesWithSystemDisposition
    : typeof obj.agrees_with_system_disposition === "boolean" ? obj.agrees_with_system_disposition
      : typeof obj.dispositionCorrect === "boolean" ? obj.dispositionCorrect
        : typeof obj.disposition_correct === "boolean" ? obj.disposition_correct
          : false;

  const findingsComplete = typeof obj.findingsComplete === "boolean" ? obj.findingsComplete
    : typeof obj.findings_complete === "boolean" ? obj.findings_complete
      : false;

  const evidenceGrounded = typeof obj.evidenceGrounded === "boolean" ? obj.evidenceGrounded
    : typeof obj.evidence_grounded === "boolean" ? obj.evidence_grounded
      : false;

  const scopeIsolationSafe = typeof obj.scopeIsolationSafe === "boolean" ? obj.scopeIsolationSafe
    : typeof obj.scope_isolation_safe === "boolean" ? obj.scope_isolation_safe
      : false;

  const passed = typeof obj.passed === "boolean" ? obj.passed
    : agreesWithSystemDisposition && evidenceGrounded && scopeIsolationSafe;

  return {
    suggestionSafe,
    recommendedDisposition,
    agreesWithSystemDisposition,
    findingsComplete,
    evidenceGrounded,
    scopeIsolationSafe,
    passed,
    issues: Array.isArray(obj.issues) ? obj.issues : []
  };
}

function coerceDisposition(value: unknown): "pass" | "block" {
  return value === "block" ? "block" : "pass";
}

const PROVIDER_ERROR_SIGNALS = [
  "429", "503", "502", "timeout", "ETIMEDOUT", "ECONNREFUSED",
  "ECONNRESET", "fetch failed", "network", "missing_ai_config",
  "empty_model_output", "model_output_too_large"
];

function classifyProviderError(msg: string): AiJudgeCategory {
  const lower = msg.toLowerCase();
  if (PROVIDER_ERROR_SIGNALS.some((signal) => lower.includes(signal.toLowerCase()))) {
    return "provider_unavailable";
  }
  return "schema_invalid";
}
