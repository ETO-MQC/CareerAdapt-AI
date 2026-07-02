import { describe, expect, it } from "vitest";
import { runC1Eval, type C1EvalReport } from "./runEval";
import { c1EvalCases } from "./cases";

const hasRealAiConfig = Boolean(process.env.AI_API_KEY && process.env.AI_MODEL);

describe("C1 AI辅助自动验收", () => {
  let report: C1EvalReport;

  it("运行全部C1验收案例（硬校验 + 可选AI Judge）", async () => {
    report = await runC1Eval({
      enableAiJudge: hasRealAiConfig,
      artifactDir: "artifacts"
    });

    expect(report.summary.total).toBe(15);
    expect(report.cases.length).toBe(15);

    // 硬校验：期望通过的检查必须通过，期望失败的检查必须失败
    for (const caseResult of report.cases) {
      const expectedFailures = new Set(
        c1EvalCases.find((c) => c.id === caseResult.caseId)?.expectedHardCheckFailures ?? []
      );

      // 非预期的失败
      const unexpectedFailures = caseResult.hardValidation.checks.filter(
        (c) => !c.passed && !expectedFailures.has(c.name)
      );
      expect(
        unexpectedFailures,
        `案例 ${caseResult.caseId} 非预期硬校验失败: ${unexpectedFailures.map((c) => `${c.name}: ${c.detail}`).join("; ")}`
      ).toHaveLength(0);

      // 期望失败的检查必须确实失败
      for (const expectedName of expectedFailures) {
        const check = caseResult.hardValidation.checks.find((c) => c.name === expectedName);
        expect(
          check?.passed,
          `案例 ${caseResult.caseId} 期望 ${expectedName} 失败但实际通过`
        ).toBe(false);
      }
    }

    // 报告文件必须存在
    expect(report.evaluatedAt).toBeDefined();
    expect(report.matcherVersion).toBeDefined();
    expect(report.judgeVersion).toBe("c1-judge.v1");

    if (!hasRealAiConfig) {
      expect(report.aiJudgeSkipped).toBe(true);
      console.log("⚠️ AI Judge skipped: 未配置 AI_API_KEY / AI_MODEL，仅运行硬校验。");
    } else {
      expect(report.aiJudgeSkipped).toBe(false);
      expect(report.sameModelJudgeBias).toBe(true);
      console.log(`ℹ️ AI Judge model: ${report.judgeModel}`);
      console.log(`⚠️ same-model judge bias: Judge使用与evidence-matcher相同的模型。`);
    }

    // 打印总结
    console.log("\n=== C1 验收总结 ===");
    console.log(`总案例: ${report.summary.total}`);
    console.log(`硬校验通过: ${report.summary.hardPassed}`);
    console.log(`硬校验失败: ${report.summary.hardFailed}`);
    if (!report.aiJudgeSkipped) {
      console.log(`AI Judge通过: ${report.summary.aiPassed}`);
      console.log(`AI Judge失败: ${report.summary.aiFailed}`);
    }
    console.log(`总体通过: ${report.summary.overallPassed}`);
    console.log(`总体失败: ${report.summary.overallFailed}`);
    console.log(`\n报告已生成: artifacts/c1-evaluation.json, artifacts/c1-evaluation.md`);
  }, 120_000);
});
