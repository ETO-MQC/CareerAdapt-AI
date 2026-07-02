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

    // 逐案例校验
    for (const caseResult of report.cases) {
      const caseDef = c1EvalCases.find((c) => c.id === caseResult.caseId)!;
      const expectedFailures = new Set(caseDef.expectedHardCheckFailures ?? []);

      if (caseDef.expectedDisposition === "accept") {
        // 合法案例：非预期的硬校验失败必须为0
        const unexpectedFailures = caseResult.hardValidation.checks.filter(
          (c) => !c.passed && !expectedFailures.has(c.name)
        );
        expect(
          unexpectedFailures,
          `合法案例 ${caseResult.caseId} 非预期硬校验失败: ${unexpectedFailures.map((c) => `${c.name}: ${c.detail}`).join("; ")}`
        ).toHaveLength(0);
      } else {
        // 非法案例：必须被正确拒绝（至少一个预期检查失败）
        const expectedFailsPresent = [...expectedFailures].every((name) => {
          const check = caseResult.hardValidation.checks.find((c) => c.name === name);
          return check && !check.passed;
        });
        expect(
          expectedFailsPresent,
          `非法案例 ${caseResult.caseId} 未被正确拒绝：期望 ${[...expectedFailures].join(", ")} 失败`
        ).toBe(true);
      }
    }

    // 安全断言
    expect(report.summary.hardSafetyFailures).toBe(0);
    expect(report.summary.negativeCasesCorrectlyRejected).toBe(
      report.cases.filter((c) => c.expectedDisposition === "reject").length
    );

    // 合法语义案例通过率 >= 80%
    const acceptCases = report.cases.filter((c) => c.expectedDisposition === "accept");
    const passRate = acceptCases.length > 0
      ? report.summary.positiveCasesPassed / acceptCases.length
      : 1;
    console.log(`\n合法案例通过率: ${report.summary.positiveCasesPassed}/${acceptCases.length} (${(passRate * 100).toFixed(1)}%)`);
    expect(passRate).toBeGreaterThanOrEqual(0.8);

    // 总体合格
    expect(report.summary.overallQualified).toBe(true);

    if (!hasRealAiConfig) {
      expect(report.aiJudgeSkipped).toBe(true);
      console.log("⚠️ AI Judge skipped: 未配置 AI_API_KEY / AI_MODEL，仅运行硬校验。");
    } else {
      expect(report.aiJudgeSkipped).toBe(false);
      expect(report.sameModelJudgeBias).toBe(true);
      console.log(`ℹ️ AI Judge model: ${report.judgeModel}`);
      console.log(`ℹ️ Judge invalid: ${report.summary.judgeInvalid}`);
    }

    // 打印总结
    console.log("\n=== C1 验收总结 ===");
    console.log(`总案例: ${report.summary.total}`);
    console.log(`正面案例通过: ${report.summary.positiveCasesPassed}`);
    console.log(`负面案例正确拒绝: ${report.summary.negativeCasesCorrectlyRejected}`);
    console.log(`硬安全失败: ${report.summary.hardSafetyFailures}`);
    console.log(`语义案例通过: ${report.summary.semanticCasesPassed}`);
    console.log(`Judge自相矛盾: ${report.summary.judgeInvalid}`);
    if (!report.aiJudgeSkipped) {
      console.log(`AI Judge通过: ${report.summary.aiPassed}`);
      console.log(`AI Judge失败: ${report.summary.aiFailed}`);
    }
    console.log(`总体合格: ${report.summary.overallQualified ? "✅" : "❌"}`);
    console.log(`\n报告已生成: artifacts/c1-evaluation.json, artifacts/c1-evaluation.md`);
  }, 180_000);
});
