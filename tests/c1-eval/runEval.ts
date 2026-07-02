import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createRuleRequirementMatches,
  resolveEffectiveMatch,
  checkRequirementMatchStale,
  evidenceRefKey,
  MATCHER_VERSION
} from "@/domain/match/matcher";
import type { RequirementMatch, MatchEvaluation, MatchLevel, MatchRisk } from "@/domain/schemas";
import { c1EvalCases, type C1EvalCase } from "./cases";
import { hardValidateMatch, type HardValidationResult } from "./hardValidate";
import { runAiJudge } from "./aiJudge";
import { c1JudgePrompt } from "./judgePrompt";
import type { C1JudgeInput, C1JudgeOutput } from "./judgeSchema";

// ─── 类型定义 ───

export type CaseMatchResult = {
  matchLevel: MatchLevel;
  riskLevel: string;
  risks: MatchRisk[];
  evidenceRefKeys: string[];
  explanation: string;
  isStale: boolean;
};

export type CaseEvalResult = {
  caseId: string;
  caseName: string;
  description: string;
  expectedDisposition: "accept" | "reject";
  hardFailIf: string[];
  matchResult: CaseMatchResult;
  hardValidation: HardValidationResult;
  aiJudgment?: {
    success: boolean;
    output?: C1JudgeOutput;
    error?: string;
    model?: string;
    latencyMs?: number;
    judgeInvalid?: boolean;
    retried?: boolean;
  };
  overallPassed: boolean;
};

export type C1EvalReport = {
  evaluatedAt: string;
  matcherVersion: string;
  judgeVersion: string;
  judgeModel: string | null;
  sameModelJudgeBias: boolean;
  aiJudgeSkipped: boolean;
  summary: {
    total: number;
    positiveCasesPassed: number;
    negativeCasesCorrectlyRejected: number;
    hardSafetyFailures: number;
    semanticCasesPassed: number;
    judgeInvalid: number;
    overallQualified: boolean;
    aiPassed: number;
    aiFailed: number;
    aiSkipped: number;
  };
  cases: CaseEvalResult[];
};

// ─── 主入口 ───

/**
 * 运行全部C1验收案例。
 * @param options.enableAiJudge 是否运行AI Judge（需要API Key）
 * @param options.artifactDir 报告输出目录
 */
export async function runC1Eval(options?: {
  enableAiJudge?: boolean;
  artifactDir?: string;
}): Promise<C1EvalReport> {
  const enableAi = options?.enableAiJudge ?? false;
  const artifactDir = options?.artifactDir ?? resolve(process.cwd(), "artifacts");

  const caseResults: CaseEvalResult[] = [];

  for (const caseDef of c1EvalCases) {
    const result = await evalSingleCase(caseDef, enableAi);
    caseResults.push(result);
  }

  const report = buildReport(caseResults, enableAi);
  writeReport(report, artifactDir);

  return report;
}

// ─── 单案例评估 ───

async function evalSingleCase(caseDef: C1EvalCase, enableAi: boolean): Promise<CaseEvalResult> {
  const context = { profile: caseDef.profile, job: caseDef.job, matcherVersion: MATCHER_VERSION };
  const matches = createRuleRequirementMatches(context);

  // 对于stale案例：修改profileVersion后重新计算stale
  let isStale = false;
  let match: RequirementMatch;
  if (caseDef.flags?.includes("stale") && matches.length > 0) {
    match = matches[0];
    const staleContext = { ...context, profile: { ...caseDef.profile, version: caseDef.profile.version + 1 } };
    const staleCheck = checkRequirementMatchStale(match, staleContext);
    isStale = staleCheck.isStale;
  } else {
    match = matches[0];
  }

  const effective = resolveEffectiveMatch(match);
  const matchResult: CaseMatchResult = {
    matchLevel: effective.matchLevel,
    riskLevel: effective.riskLevel,
    risks: [...effective.risks],
    evidenceRefKeys: effective.evidenceRefs.map((ref) => evidenceRefKey(ref)),
    explanation: effective.explanation,
    isStale
  };

  // 硬校验
  const hardValidation = hardValidateMatch(match, caseDef, caseDef.profile, isStale);

  // AI Judge（可选）
  let aiJudgment: CaseEvalResult["aiJudgment"];
  if (enableAi) {
    const judgeInput = buildJudgeInput(caseDef, effective);
    const judgeResult = await runAiJudge(judgeInput);
    aiJudgment = judgeResult;
  }

  // 总体判定
  // accept案例：硬校验通过即通过（AI Judge为补充信号，不阻塞）
  // reject案例：硬校验正确识别了预期失败
  const isReject = caseDef.expectedDisposition === "reject";
  const overallPassed = isReject
    ? !hardValidation.passed  // reject案例被正确拒绝
    : hardValidation.passed;  // accept案例硬校验通过即通过

  return {
    caseId: caseDef.id,
    caseName: caseDef.name,
    description: caseDef.description,
    expectedDisposition: caseDef.expectedDisposition,
    hardFailIf: caseDef.hardFailIf,
    matchResult,
    hardValidation,
    aiJudgment,
    overallPassed
  };
}

function buildJudgeInput(caseDef: C1EvalCase, effective: MatchEvaluation): C1JudgeInput {
  return {
    requirement: {
      description: caseDef.job.requirements[0]?.description ?? "",
      hardConstraint: caseDef.job.requirements[0]?.hardConstraint ?? false,
      keywords: caseDef.job.requirements[0]?.keywords ?? []
    },
    confirmedFacts: collectConfirmedFactTexts(caseDef),
    matchResult: {
      matchLevel: effective.matchLevel,
      riskLevel: effective.riskLevel,
      risks: [...effective.risks],
      evidenceRefKeys: effective.evidenceRefs.map((ref) => evidenceRefKey(ref)),
      explanation: effective.explanation
    }
  };
}

function collectConfirmedFactTexts(caseDef: C1EvalCase): Array<{ refKey: string; factText: string }> {
  const result: Array<{ refKey: string; factText: string }> = [];

  for (const exp of caseDef.profile.experiences) {
    for (const fact of exp.facts) {
      if (fact.confirmedByUser) {
        result.push({
          refKey: evidenceRefKey({
            type: "experience_fact",
            experienceId: exp.id,
            factId: fact.id,
            factQuote: fact.statement,
            factText: fact.statement
          }),
          factText: fact.statement
        });
      }
    }
  }

  for (const skill of caseDef.profile.skills) {
    if (skill.fact?.confirmedByUser) {
      result.push({
        refKey: evidenceRefKey({
          type: "skill_fact",
          skillId: skill.id,
          factId: skill.fact.id,
          factQuote: skill.fact.statement,
          factText: skill.fact.statement
        }),
        factText: skill.fact.statement
      });
    }
  }

  for (const cert of caseDef.profile.certificates) {
    if (cert.fact?.confirmedByUser) {
      result.push({
        refKey: evidenceRefKey({
          type: "certificate_fact",
          certificateId: cert.id,
          factId: cert.fact.id,
          factQuote: cert.fact.statement,
          factText: cert.fact.statement
        }),
        factText: cert.fact.statement
      });
    }
  }

  return result;
}

// ─── 报告生成 ───

function buildReport(caseResults: CaseEvalResult[], enableAi: boolean): C1EvalReport {
  // 正面案例（accept）通过数
  const positiveCases = caseResults.filter((r) => r.expectedDisposition === "accept");
  const positiveCasesPassed = positiveCases.filter((r) => r.overallPassed).length;

  // 负面案例（reject）被正确拒绝数
  const negativeCases = caseResults.filter((r) => r.expectedDisposition === "reject");
  const negativeCasesCorrectlyRejected = negativeCases.filter((r) => r.overallPassed).length;

  // 硬安全失败：accept案例中有硬校验失败
  const hardSafetyFailures = positiveCases.filter((r) => !r.hardValidation.passed).length;

  // 语义案例通过：accept案例中硬校验通过的数
  const semanticCasesPassed = positiveCases.filter((r) => r.hardValidation.passed).length;

  // AI Judge统计
  let aiPassed = 0;
  let aiFailed = 0;
  let judgeInvalid = 0;
  const aiSkipped = enableAi ? 0 : caseResults.length;

  if (enableAi) {
    for (const result of caseResults) {
      if (result.aiJudgment?.judgeInvalid) {
        judgeInvalid++;
      }
      if (result.aiJudgment?.success && result.aiJudgment.output?.passed) {
        aiPassed++;
      } else if (result.aiJudgment?.success) {
        aiFailed++;
      }
    }
  }

  // 总体合格：无安全失败 + 负面案例全部正确拒绝 + 合法语义案例通过率>=80%
  const semanticPassRate = positiveCases.length > 0 ? semanticCasesPassed / positiveCases.length : 1;
  const overallQualified = hardSafetyFailures === 0
    && negativeCasesCorrectlyRejected === negativeCases.length
    && semanticPassRate >= 0.8;

  return {
    evaluatedAt: new Date().toISOString(),
    matcherVersion: MATCHER_VERSION,
    judgeVersion: c1JudgePrompt.version,
    judgeModel: caseResults[0]?.aiJudgment?.model ?? null,
    sameModelJudgeBias: enableAi,
    aiJudgeSkipped: !enableAi,
    summary: {
      total: caseResults.length,
      positiveCasesPassed,
      negativeCasesCorrectlyRejected,
      hardSafetyFailures,
      semanticCasesPassed,
      judgeInvalid,
      overallQualified,
      aiPassed,
      aiFailed,
      aiSkipped
    },
    cases: caseResults
  };
}

function writeReport(report: C1EvalReport, artifactDir: string) {
  if (!existsSync(artifactDir)) {
    mkdirSync(artifactDir, { recursive: true });
  }

  // JSON报告
  const jsonPath = resolve(artifactDir, "c1-evaluation.json");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");

  // Markdown报告
  const mdPath = resolve(artifactDir, "c1-evaluation.md");
  writeFileSync(mdPath, buildMarkdownReport(report), "utf-8");
}

function buildMarkdownReport(report: C1EvalReport): string {
  const lines: string[] = [];

  lines.push("# C1 经历匹配验收报告");
  lines.push("");
  lines.push(`- 评估时间：${report.evaluatedAt}`);
  lines.push(`- Matcher版本：${report.matcherVersion}`);
  lines.push(`- Judge版本：${report.judgeVersion}`);
  lines.push(`- Judge模型：${report.judgeModel ?? "未使用（硬校验模式）"}`);
  if (report.sameModelJudgeBias) {
    lines.push("- ⚠️ **same-model judge bias**：Judge使用与evidence-matcher相同的模型，语义评分可能偏高。");
  }
  if (report.aiJudgeSkipped) {
    lines.push("- ℹ️ AI Judge已跳过（未配置API Key），仅运行硬校验。");
  }
  lines.push("");

  lines.push("## 总结");
  lines.push("");
  lines.push("| 指标 | 数值 |");
  lines.push("|------|------|");
  lines.push(`| 总案例数 | ${report.summary.total} |`);
  lines.push(`| 正面案例通过 | ${report.summary.positiveCasesPassed} |`);
  lines.push(`| 负面案例正确拒绝 | ${report.summary.negativeCasesCorrectlyRejected} |`);
  lines.push(`| 硬安全失败 | ${report.summary.hardSafetyFailures} |`);
  lines.push(`| 语义案例通过 | ${report.summary.semanticCasesPassed} |`);
  lines.push(`| Judge自相矛盾 | ${report.summary.judgeInvalid} |`);
  if (!report.aiJudgeSkipped) {
    lines.push(`| AI Judge通过 | ${report.summary.aiPassed} |`);
    lines.push(`| AI Judge失败 | ${report.summary.aiFailed} |`);
  } else {
    lines.push(`| AI Judge跳过 | ${report.summary.aiSkipped} |`);
  }
  lines.push(`| **总体合格** | **${report.summary.overallQualified ? "✅ 是" : "❌ 否"}** |`);
  lines.push("");

  lines.push("## 案例详情");
  lines.push("");

  for (const caseResult of report.cases) {
    const status = caseResult.overallPassed ? "✅" : "❌";
    const disposition = caseResult.expectedDisposition === "accept" ? "🟢合法" : "🔴非法";
    lines.push(`### ${status} ${caseResult.caseName}（${caseResult.caseId}）${disposition}`);
    lines.push("");
    lines.push(`> ${caseResult.description}`);
    lines.push("");

    lines.push("**匹配结果：**");
    lines.push(`- matchLevel: \`${caseResult.matchResult.matchLevel}\``);
    lines.push(`- riskLevel: \`${caseResult.matchResult.riskLevel}\``);
    lines.push(`- risks: ${caseResult.matchResult.risks.length > 0 ? caseResult.matchResult.risks.map((r) => `\`${r}\``).join(", ") : "无"}`);
    lines.push(`- evidenceRefKeys: ${caseResult.matchResult.evidenceRefKeys.length > 0 ? caseResult.matchResult.evidenceRefKeys.map((k) => `\`${k}\``).join(", ") : "无"}`);
    lines.push(`- explanation: ${caseResult.matchResult.explanation}`);
    if (caseResult.matchResult.isStale) {
      lines.push("- ⚠️ **stale**: true");
    }
    lines.push("");

    lines.push("**硬校验：**");
    for (const check of caseResult.hardValidation.checks) {
      const checkStatus = check.passed ? "✅" : "❌";
      lines.push(`- ${checkStatus} ${check.name}: ${check.detail}`);
    }
    lines.push("");

    if (caseResult.aiJudgment) {
      if (caseResult.aiJudgment.success && caseResult.aiJudgment.output) {
        const ai = caseResult.aiJudgment.output;
        const invalidTag = caseResult.aiJudgment.judgeInvalid ? " ⚠️ **judgeInvalid**" : "";
        lines.push(`**AI Judge：**${invalidTag}`);
        lines.push(`- passed: ${ai.passed}`);
        lines.push(`- evidenceGrounding: ${ai.evidenceGrounding}/5`);
        lines.push(`- matchLevelReasonableness: ${ai.matchLevelReasonableness}/5`);
        lines.push(`- riskAssessment: ${ai.riskAssessment}/5`);
        lines.push(`- explanationQuality: ${ai.explanationQuality}/5`);
        lines.push(`- hallucinationSafety: ${ai.hallucinationSafety}/5`);
        if (ai.criticalFailures.length > 0) {
          lines.push(`- criticalFailures: ${ai.criticalFailures.join("; ")}`);
        }
        if (ai.issues.length > 0) {
          lines.push(`- issues: ${ai.issues.join("; ")}`);
        }
        if (ai.recommendedMatchLevel) {
          lines.push(`- recommendedMatchLevel: \`${ai.recommendedMatchLevel}\``);
        }
        if (ai.recommendedRiskLevel) {
          lines.push(`- recommendedRiskLevel: \`${ai.recommendedRiskLevel}\``);
        }
        if (caseResult.aiJudgment.latencyMs) {
          lines.push(`- latency: ${caseResult.aiJudgment.latencyMs}ms`);
        }
      } else {
        lines.push(`**AI Judge：** ❌ 失败 — ${caseResult.aiJudgment.error ?? "未知错误"}`);
      }
      lines.push("");
    }

    if (caseResult.hardFailIf.length > 0) {
      lines.push(`**硬性失败条件：** ${caseResult.hardFailIf.join("；")}`);
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("**声明：** 本报告为C1阶段AI辅助验收工具，用于辅助人工验收。AI Judge结果不替代人工验收判断，硬校验结果为确定性检查，但仍建议人工复核关键案例。");
  lines.push("");

  return lines.join("\n");
}
