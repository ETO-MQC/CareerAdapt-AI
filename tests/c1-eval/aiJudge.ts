import { OpenAiCompatibleProvider } from "@/ai/providers/openAiCompatibleProvider";
import { c1JudgePrompt } from "./judgePrompt";
import { C1JudgeInputSchema, C1JudgeOutputSchema, type C1JudgeInput, type C1JudgeOutput } from "./judgeSchema";

export type AiJudgeResult = {
  success: boolean;
  output?: C1JudgeOutput;
  error?: string;
  model?: string;
  latencyMs?: number;
};

/**
 * 运行AI语义Judge评价一个匹配结果。
 * 使用与evidence-matcher相同的Provider endpoint，但独立system prompt。
 */
export async function runAiJudge(input: C1JudgeInput, signal?: AbortSignal): Promise<AiJudgeResult> {
  const parsed = C1JudgeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: `Judge input schema error: ${parsed.error.message}` };
  }

  const provider = new OpenAiCompatibleProvider();
  const startTime = Date.now();

  try {
    const response = await provider.invoke({
      systemPrompt: c1JudgePrompt.system,
      userPrompt: JSON.stringify(parsed.data, null, 2),
      maxOutputChars: 4_000,
      signal: signal ?? AbortSignal.timeout(30_000)
    });

    const latencyMs = Date.now() - startTime;
    const rawOutput = coerceJudgeOutput(response.output);
    const result = C1JudgeOutputSchema.safeParse(rawOutput);

    if (!result.success) {
      return {
        success: false,
        error: `Judge output schema error: ${result.error.message}`,
        model: (response as Record<string, unknown>).model as string | undefined,
        latencyMs
      };
    }

    return {
      success: true,
      output: result.data,
      model: (response as Record<string, unknown>).model as string | undefined,
      latencyMs
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startTime
    };
  }
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
