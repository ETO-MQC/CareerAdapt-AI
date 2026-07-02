import { describe, expect, it } from "vitest";
import { runC2Eval, type C2EvalReport } from "./runEval";

const hasRealAiConfig = Boolean(process.env.AI_API_KEY && process.env.AI_MODEL);

describe("C2 AI建议与 Fact Guard 自动验收", () => {
  let report: C2EvalReport;

  it("运行全部C2验收案例（硬校验 + 工作流测试 + 可选AI Judge）", async () => {
    report = await runC2Eval({
      enableAiJudge: hasRealAiConfig,
      artifactDir: "artifacts"
    });

    expect(report.summary.total).toBe(16);
    expect(report.cases.length).toBe(16);

    // 逐案例校验
    for (const caseResult of report.cases) {
      const unexpectedFailures = caseResult.hardValidation.checks.filter((c) => !c.passed);
      expect(
        unexpectedFailures,
        `案例 ${caseResult.caseId} 硬校验失败: ${unexpectedFailures.map((c) => `${c.name}: ${c.detail}`).join("; ")}`
      ).toHaveLength(0);

      const failedWorkflowTests = (caseResult.workflowTests ?? []).filter((t) => !t.passed);
      expect(
        failedWorkflowTests,
        `案例 ${caseResult.caseId} 工作流测试失败: ${failedWorkflowTests.map((t) => `${t.operationName}: ${t.detail}`).join("; ")}`
      ).toHaveLength(0);
    }

    // 安全断言
    expect(report.summary.hardSafetyFailures).toBe(0);

    // 产品确定性指标：系统混淆矩阵
    expect(report.summary.unsafeAllowed).toBe(0);
    expect(report.summary.safeBlocked).toBe(0);
    expect(report.summary.safeAllowed).toBe(6);
    expect(report.summary.unsafeBlocked).toBe(10);

    // 工作流测试全部通过
    expect(report.summary.workflowTestsPassed).toBe(report.summary.workflowTestsTotal);

    // AI Judge 一致性指标（如有）
    if (!hasRealAiConfig) {
      expect(report.aiJudgeSkipped).toBe(true);
      console.log("⚠️ AI Judge skipped: 未配置 AI_API_KEY / AI_MODEL，仅运行硬校验。");
    } else {
      expect(report.aiJudgeSkipped).toBe(false);
      expect(report.sameModelJudgeBias).toBe(true);
      console.log(`ℹ️ AI Judge model: ${report.judgeModel}`);
      console.log(`ℹ️ Judge一致: ${report.summary.judgeAgreed}`);
      console.log(`ℹ️ Judge不一致: ${report.summary.judgeDisagreed}`);
      console.log(`ℹ️ Judge不可用: ${report.summary.judgeUnavailable}`);
      console.log(`ℹ️ Judge无效: ${report.summary.judgeInvalid}`);
    }

    // 总体合格
    expect(report.summary.overallQualified).toBe(true);

    // 打印总结
    console.log("\n=== C2 验收总结 ===");
    console.log(`总案例: ${report.summary.total}`);
    console.log(`硬安全失败: ${report.summary.hardSafetyFailures}`);
    console.log(`工作流测试: ${report.summary.workflowTestsPassed}/${report.summary.workflowTestsTotal}`);
    console.log(`产品指标: safeAllowed=${report.summary.safeAllowed} safeBlocked=${report.summary.safeBlocked} unsafeBlocked=${report.summary.unsafeBlocked} unsafeAllowed=${report.summary.unsafeAllowed}`);
    if (!report.aiJudgeSkipped) {
      console.log(`Judge一致: ${report.summary.judgeAgreed} 不一致: ${report.summary.judgeDisagreed} 不可用: ${report.summary.judgeUnavailable} 无效: ${report.summary.judgeInvalid}`);
    }
    console.log(`总体合格: ${report.summary.overallQualified ? "✅" : "❌"}`);
    console.log(`\n报告已生成: artifacts/c2-evaluation.json, artifacts/c2-evaluation.md`);
  }, 180_000);
});
