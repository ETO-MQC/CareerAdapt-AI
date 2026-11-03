import { analyzeJobDescriptionV4, buildProvisionalJdSemanticLedger } from "@/domain/jobOptimization";
import { JdAnalyzerModelOutputSchema } from "@/domain/schemas";
import { stageBTaskRegistry } from "@/ai/tasks/registry";

export const semanticRaw = "任职要求\n能完成接口设计，能定位生产故障";
export function semanticAnalysis() {
  const units = buildProvisionalJdSemanticLedger(semanticRaw);
  const output = JdAnalyzerModelOutputSchema.parse(stageBTaskRegistry["jd-analyzer"].coerceRawOutput({
    unitAssignments: units.map((unit) => unit.text.includes("，") ? {
      sourceUnitId: unit.id, verdict: "override", confidence: 0.95,
      segments: [{ start: 0, end: 8, section: "required", exactKeywords: ["接口", "invented"], semanticAliases: ["API design"] }, { start: 8, end: unit.text.length, section: "required" }]
    } : { sourceUnitId: unit.id, verdict: "accept" })
  }));
  return analyzeJobDescriptionV4({ rawText: semanticRaw, aiAssignments: output.unitAssignments });
}

