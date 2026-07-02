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
  hardFailIf: string[];
  matchResult: CaseMatchResult;
  hardValidation: HardValidationResult;
  aiJudgment?: {
    success: boolean;
    output?: C1JudgeOutput;
    error?: string;
    model?: string;
    latencyMs?: number;
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
    hardPassed: number;
    hardFailed: number;
    aiPassed: number;
    aiFailed: number;
    aiSkipped: number;
    overallPassed: number;
    overallFailed: number;
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
  const overallPassed = hardValidation.passed
    && (!aiJudgment || !aiJudgment.success || (aiJudgment.output?.passed ?? false));

  return {
    caseId: caseDef.id,
    caseName: caseDef.name,
    description: caseDef.description,
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
  const hardPassed = caseResults.filter((r) => r.hardValidation.passed).length;
  const hardFailed = caseResults.length - hardPassed;

  let aiPassed = 0;
  let aiFailed = 0;
  const aiSkipped = enableAi ? 0 : caseResults.length;

  if (enableAi) {
    for (const result of caseResults) {
      if (result.aiJudgment?.success && result.aiJudgment.output?.passed) {
        aiPassed++;
      } else if (result.aiJudgment?.success) {
        aiFailed++;
      }
    }
  }

  const overallPassed = caseResults.filter((r) => r.overallPassed).length;
  const overallFailed = caseResults.length - overallPassed;

  return {
    evaluatedAt: new Date().toISOString(),
    matcherVersion: MATCHER_VERSION,
    judgeVersion: "c1-judge.v1",
    judgeModel: caseResults[0]?.aiJudgment?.model ?? null,
    sameModelJudgeBias: enableAi,
    aiJudgeSkipped: !enableAi,
    summary: {
      total: caseResults.length,
      hardPassed,
      hardFailed,
      aiPassed,
      aiFailed,
      aiSkipped,
      overallPassed,
      overallFailed
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
  lines.push(`| 硬校验通过 | ${report.summary.hardPassed} |`);
  lines.push(`| 硬校验失败 | ${report.summary.hardFailed} |`);
  if (!report.aiJudgeSkipped) {
    lines.push(`| AI Judge通过 | ${report.summary.aiPassed} |`);
    lines.push(`| AI Judge失败 | ${report.summary.aiFailed} |`);
  } else {
    lines.push(`| AI Judge跳过 | ${report.summary.aiSkipped} |`);
  }
  lines.push(`| 总体通过 | ${report.summary.overallPassed} |`);
  lines.push(`| 总体失败 | ${report.summary.overallFailed} |`);
  lines.push("");

  lines.push("## 案例详情");
  lines.push("");

  for (const caseResult of report.cases) {
    const status = caseResult.overallPassed ? "✅" : "❌";
    lines.push(`### ${status} ${caseResult.caseName}（${caseResult.caseId}）`);
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
        lines.push("**AI Judge：**");
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
