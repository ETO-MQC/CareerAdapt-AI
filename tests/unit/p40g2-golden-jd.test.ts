import { describe, expect, it } from "vitest";
import { analyzeJobDescriptionV3, reconcileJobRequirementGraphV3 } from "@/domain/jobOptimization";
import { AI_CODING_TASK_DESIGNER_JD } from "../fixtures/aiCodingTaskDesignerJd";

describe("P4.0g.2 golden JD semantic ledger", () => {
  it("builds the required hierarchy without promoting metadata or details", () => {
    const graph = analyzeJobDescriptionV3({ rawText: AI_CODING_TASK_DESIGNER_JD });
    expect(graph.requirements.filter((r) => r.section === "responsibility")).toHaveLength(7);
    expect(graph.requirements.filter((r) => r.section === "required")).toHaveLength(4);
    expect(graph.requirements.filter((r) => r.section === "preferred")).toHaveLength(6);
    expect(graph.requirements.flatMap((r) => r.details)).toHaveLength(18);
    expect(graph.groups.filter((g) => g.relation === "any_of")).toHaveLength(1);
    expect(graph.groups.find((g) => g.relation === "any_of")?.requirementIds).toHaveLength(4);
    expect(graph.groups.find((g) => g.relation === "preferred_any_of")?.requirementIds).toHaveLength(6);
    expect(graph.verificationMaterials).toHaveLength(6);
    expect(graph.verificationMaterials.find((m) => m.kind === "badcase")?.requiredComponents).toEqual(["agent", "goal", "failure", "reproduction", "cause"]);
    expect(graph.roleProfile.hiringSignals.length).toBeGreaterThanOrEqual(3);
    expect(graph.sourceCoverage.unassignedUnitIds).toEqual([]);
    expect(graph.sourceCoverage.inventedReferenceCount).toBe(0);
    expect(graph.sourceCoverage.coverageRatio).toBe(1);
    expect(graph.sourceCoverage.metadataUnitIds).toHaveLength(5);
    expect(graph.requirements.some((r) => ["Vibe Coding", "关联项目", "【Code】General coding", "职责内容", "参与要求", "岗位要求", "优先考虑"].includes(r.statement))).toBe(false);
  });

  it("keeps canonical hash stable across enrichment differences", () => {
    const base = analyzeJobDescriptionV3({ rawText: AI_CODING_TASK_DESIGNER_JD });
    const assignments = base.sourceUnits!.map((unit, index) => ({ sourceUnitId: unit.id, disposition: unit.disposition, confidence: index % 2 ? 0.51 : 0.99, reason: `run-${index}` }));
    const first = reconcileJobRequirementGraphV3({ rawText: AI_CODING_TASK_DESIGNER_JD, aiOutput: { requirements: [], unitAssignments: assignments, riskNotes: [] } }).graph;
    const second = reconcileJobRequirementGraphV3({ rawText: AI_CODING_TASK_DESIGNER_JD, aiOutput: { requirements: [], unitAssignments: [...assignments].reverse().map((a) => ({ ...a, confidence: 0.77, reason: "changed" })), riskNotes: [] } }).graph;
    expect(first.graphHash).toBe(second.graphHash);
    expect(first.requirements.map((r) => r.id)).toEqual(second.requirements.map((r) => r.id));
  });

  it("is stable across five deterministic parses", () => {
    const graphs = Array.from({ length: 5 }, () => analyzeJobDescriptionV3({ rawText: AI_CODING_TASK_DESIGNER_JD }));
    expect(new Set(graphs.map((graph) => graph.graphHash))).toHaveLength(1);
    expect(new Set(graphs.map((graph) => graph.requirements.length))).toHaveLength(1);
    expect(new Set(graphs.map((graph) => graph.groups.length))).toHaveLength(1);
    expect(new Set(graphs.map((graph) => JSON.stringify(graph.sourceUnits?.map((unit) => [unit.id, unit.disposition, unit.parentUnitId]))))).toHaveLength(1);
  });

  it("rejects missing, invented, and detail-promotion AI assignments without losing scaffold", () => {
    const base = analyzeJobDescriptionV3({ rawText: AI_CODING_TASK_DESIGNER_JD });
    const detail = base.sourceUnits!.find((unit) => unit.disposition === "requirement_detail")!;
    const result = reconcileJobRequirementGraphV3({ rawText: AI_CODING_TASK_DESIGNER_JD, aiOutput: { requirements: [], unitAssignments: [
      { sourceUnitId: detail.id, disposition: "requirement", confidence: 0.99, reason: "promote" },
      { sourceUnitId: "invented-unit", disposition: "requirement", confidence: 0.99, reason: "invented" }
    ], riskNotes: [] } });
    expect(result.status).toBe("needs_review");
    expect(result.graph.sourceCoverage.inventedReferenceCount).toBe(1);
    expect(result.graph.requirements.some((requirement) => requirement.sourceUnitId === detail.id)).toBe(false);
    expect(result.graph.sourceUnits).toHaveLength(base.sourceUnits!.length);
  });
});
