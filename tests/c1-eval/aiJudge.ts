import { OpenAiCompatibleProvider } from "@/ai/providers/openAiCompatibleProvider";
import { c1JudgePrompt } from "./judgePrompt";
import { C1JudgeInputSchema, C1JudgeOutputSchema, type C1JudgeInput, type C1JudgeOutput } from "./judgeSchema";

export type AiJudgeResult = {
  success: boolean;
  output?: C1JudgeOutput;
  error?: string;
  model?: string;
  latencyMs?: number;
  judgeInvalid?: boolean;
  retried?: boolean;
};

const SCORE_THRESHOLD = 3;

/**
 * 运行AI语义Judge评价一个匹配结果。
 * 使用与evidence-matcher相同的Provider endpoint，但独立system prompt。
 * 包含一致性校验和一次重试。
 */
export async function runAiJudge(input: C1JudgeInput, signal?: AbortSignal): Promise<AiJudgeResult> {
  const parsed = C1JudgeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: `Judge input schema error: ${parsed.error.message}` };
  }

  const provider = new OpenAiCompatibleProvider();
  const startTime = Date.now();

  // 第一次尝试
  const firstResult = await invokeJudgeOnce(provider, parsed.data, signal);
  if (!firstResult.success) {
    return { ...firstResult, latencyMs: Date.now() - startTime };
  }

  // 一致性校验
  const consistency = validateJudgeConsistency(firstResult.output!);
  if (consistency.valid) {
    return { ...firstResult, latencyMs: Date.now() - startTime };
  }

  // 一致性失败 → 重试一次
  const retryResult = await invokeJudgeOnce(provider, parsed.data, signal);
  if (!retryResult.success) {
    return {
      success: true,
      output: firstResult.output,
      model: firstResult.model,
      latencyMs: Date.now() - startTime,
      judgeInvalid: true,
      retried: true,
      error: `Judge consistency invalid (${consistency.reason}), retry also failed: ${retryResult.error}`
    };
  }

  const retryConsistency = validateJudgeConsistency(retryResult.output!);
  if (retryConsistency.valid) {
    return { ...retryResult, latencyMs: Date.now() - startTime, retried: true };
  }

  // 两次都不一致 → 返回第一次结果，标记invalid
  return {
    success: true,
    output: firstResult.output,
    model: firstResult.model,
    latencyMs: Date.now() - startTime,
    judgeInvalid: true,
    retried: true,
    error: `Judge consistency invalid after retry: ${retryConsistency.reason}`
  };
}

async function invokeJudgeOnce(
  provider: OpenAiCompatibleProvider,
  input: C1JudgeInput,
  signal?: AbortSignal
): Promise<AiJudgeResult> {
  try {
    const response = await provider.invoke({
      systemPrompt: c1JudgePrompt.system,
      userPrompt: JSON.stringify(input, null, 2),
      maxOutputChars: 4_000,
      signal: signal ?? AbortSignal.timeout(30_000)
    });

    const rawOutput = coerceJudgeOutput(response.output);
    const result = C1JudgeOutputSchema.safeParse(rawOutput);

    if (!result.success) {
      return {
        success: false,
        error: `Judge output schema error: ${result.error.message}`,
        model: (response as Record<string, unknown>).model as string | undefined
      };
    }

    return {
      success: true,
      output: result.data,
      model: (response as Record<string, unknown>).model as string | undefined
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

type ConsistencyResult = { valid: true } | { valid: false; reason: string };

function validateJudgeConsistency(output: C1JudgeOutput): ConsistencyResult {
  const hasCriticalFailures = output.criticalFailures.length > 0;
  const allScoresAboveThreshold = [
    output.evidenceGrounding,
    output.matchLevelReasonableness,
    output.riskAssessment,
    output.explanationQuality,
    output.hallucinationSafety
  ].every((score) => score >= SCORE_THRESHOLD);

  // criticalFailures非空时passed必须为false
  if (hasCriticalFailures && output.passed) {
    return { valid: false, reason: "criticalFailures非空但passed为true" };
  }

  // criticalFailures为空且五项评分均>=3时passed必须为true
  if (!hasCriticalFailures && allScoresAboveThreshold && !output.passed) {
    return { valid: false, reason: "criticalFailures为空且五项评分均>=3但passed为false" };
  }

  return { valid: true };
}

/**
 * 将AI原始输出coerce为Judge output结构。
 * 处理模型可能的字段名变体。
 */
function coerceJudgeOutput(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) {
    return raw;
  }

  const obj = raw as Record<string, unknown>;

  return {
    passed: typeof obj.passed === "boolean" ? obj.passed : false,
    evidenceGrounding: coerceScore(obj.evidenceGrounding ?? obj.evidence_grounding ?? obj.evidenceGroundingScore),
    matchLevelReasonableness: coerceScore(obj.matchLevelReasonableness ?? obj.match_level_reasonableness ?? obj.matchLevelScore),
    riskAssessment: coerceScore(obj.riskAssessment ?? obj.risk_assessment ?? obj.riskScore),
    explanationQuality: coerceScore(obj.explanationQuality ?? obj.explanation_quality ?? obj.explanationScore),
    hallucinationSafety: coerceScore(obj.hallucinationSafety ?? obj.hallucination_safety ?? obj.hallucinationScore),
    criticalFailures: Array.isArray(obj.criticalFailures) ? obj.criticalFailures
      : Array.isArray(obj.critical_failures) ? obj.critical_failures
        : Array.isArray(obj.failures) ? obj.failures
          : [],
    issues: Array.isArray(obj.issues) ? obj.issues : [],
    recommendedMatchLevel: obj.recommendedMatchLevel ?? obj.recommended_match_level,
    recommendedRiskLevel: obj.recommendedRiskLevel ?? obj.recommended_risk_level
  };
}

function coerceScore(value: unknown): number {
  if (typeof value === "number" && value >= 0 && value <= 5) {
    return value;
  }
  if (typeof value === "string") {
    const num = Number(value);
    if (!isNaN(num) && num >= 0 && num <= 5) {
      return num;
    }
  }
  return 0;
}
