import { describe, expect, it } from "vitest";
import {
  analyzeJobDescriptionV4,
  buildProvisionalJdSemanticLedger,
  compileJobRequirementGraphV4,
  reconcileJdSemanticLedger
} from "@/domain/jobOptimization";
import { AI_CODING_TASK_DESIGNER_JD } from "../fixtures/aiCodingTaskDesignerJd";
import { AI_TRAINER_JD_V4 } from "../fixtures/aiTrainerJdV4";

describe("Job Semantic Compiler V4", () => {
  it("uses dynamic numbered and colon hierarchy for the AI trainer fixture", () => {
    const result = analyzeJobDescriptionV4({ rawText: AI_TRAINER_JD_V4 });
    const responsibilities = result.graph.requirements.filter((item) => item.section === "responsibility");
    const context = result.graph.contextGroups.find((item) => item.relation === "topic_list");

    expect(responsibilities.map((item) => item.statement)).toEqual([
      "帮助优化 AI 对复杂要求的理解与执行能力。",
      "设计高难度题目",
      "评估 AI 的回答质量",
      "帮助优化 AI 的理解和执行能力"
    ]);
    expect(responsibilities.find((item) => item.statement === "设计高难度题目")?.details).toHaveLength(5);
    expect(responsibilities.find((item) => item.statement === "评估 AI 的回答质量")?.details).toHaveLength(6);
    expect(responsibilities.find((item) => item.statement === "帮助优化 AI 的理解和执行能力")?.details).toHaveLength(4);
    expect(context?.details.map((item) => item.text)).toEqual(["复杂多轮指令", "复杂任务规划", "搜索任务"]);
    expect(result.graph.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "source_inconsistency" })
    ]));
    expect(result.graph.needsReview).toBe(true);
    expect(result.graph.sourceCoverage.coverageRatio).toBe(1);
    expect(result.graph.requirements.some((item) => ["具体工作内容", "你需要重点看：", "例如，让 AI："].includes(item.statement))).toBe(false);
  });

  it("preserves the Coding Agent top-level groups and non-scoring details", () => {
    const { graph } = analyzeJobDescriptionV4({ rawText: AI_CODING_TASK_DESIGNER_JD });
    expect(graph.requirements.filter((item) => item.section === "responsibility")).toHaveLength(7);
    expect(graph.requirements.filter((item) => item.section === "required")).toHaveLength(4);
    expect(graph.requirements.filter((item) => item.section === "preferred")).toHaveLength(6);
    expect(graph.requirements.flatMap((item) => item.details)).toHaveLength(18);
    expect(graph.groups.find((item) => item.relation === "any_of")?.requirementIds).toHaveLength(4);
    expect(graph.groups.find((item) => item.relation === "preferred_any_of")?.requirementIds).toHaveLength(6);
    expect(graph.verificationMaterials).toHaveLength(6);
    expect(graph.roleProfile.hiringSignals).toHaveLength(3);
  });

  it("applies a real AI disposition override before graph compilation", () => {
    const rawText = "岗位职责\n设计高难度题目\n你不需要自己训练模型，但需要判断回答质量。";
    const provisionalUnits = buildProvisionalJdSemanticLedger(rawText);
    const target = provisionalUnits.find((unit) => unit.text === "设计高难度题目")!;
    const aiAssignments = provisionalUnits.map((unit) => unit.id === target.id
      ? { sourceUnitId: unit.id, verdict: "override" as const, disposition: "context" as const, section: "responsibility" as const, confidence: 0.94, reason: "该行是上下文标题" }
      : { sourceUnitId: unit.id, verdict: "accept" as const });
    const ledger = reconcileJdSemanticLedger({ rawText, provisionalUnits, aiAssignments });
    const graph = compileJobRequirementGraphV4({ rawText, ledger });

    expect(ledger.units.find((unit) => unit.id === target.id)?.final?.disposition).toBe("context");
    expect(graph.requirements.some((item) => item.sourceUnitId === target.id)).toBe(false);
    expect(graph.contextGroups.some((item) => item.sourceUnitId === target.id)).toBe(true);
  });

  it("rejects invented IDs and cyclic parents locally without losing source coverage", () => {
    const rawText = "岗位职责\n1. 设计任务\n2. 评估结果";
    const provisionalUnits = buildProvisionalJdSemanticLedger(rawText);
    const first = provisionalUnits.find((unit) => unit.text === "设计任务")!;
    const second = provisionalUnits.find((unit) => unit.text === "评估结果")!;
    const aiAssignments = [
      ...provisionalUnits.map((unit) => unit.id === first.id
        ? { sourceUnitId: unit.id, verdict: "override" as const, disposition: "requirement_detail" as const, parentUnitId: second.id, confidence: 0.9 }
        : unit.id === second.id
          ? { sourceUnitId: unit.id, verdict: "override" as const, disposition: "requirement_detail" as const, parentUnitId: first.id, confidence: 0.9 }
          : { sourceUnitId: unit.id, verdict: "accept" as const }),
      { sourceUnitId: "invented", verdict: "accept" as const }
    ];
    const ledger = reconcileJdSemanticLedger({ rawText, provisionalUnits, aiAssignments });
    const graph = compileJobRequirementGraphV4({ rawText, ledger });

    expect(ledger.issues.map((item) => item.code)).toEqual(expect.arrayContaining(["invented_source_id", "parent_cycle"]));
    expect(graph.requirements.map((item) => item.statement)).toEqual(["设计任务", "评估结果"]);
    expect(graph.sourceCoverage.coverageRatio).toBe(1);
    expect(graph.semanticUnits.every((unit) => rawText.slice(unit.sourceSpan.start, unit.sourceSpan.end) === unit.text)).toBe(true);
  });
});
