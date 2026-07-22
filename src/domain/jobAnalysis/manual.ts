import type { JdAnalyzerOutput } from "@/domain/schemas";
import { analyzeJobDescriptionV3, projectJobGraphV3ToAnalyzerOutput } from "@/domain/jobOptimization/v3";

/** Compatibility projection: Graph v3 remains authoritative while the review UI keeps its flat draft contract. */
export function createManualJdOutput(rawText: string, title: string, company: string): JdAnalyzerOutput {
  return projectJobGraphV3ToAnalyzerOutput({
    graph: analyzeJobDescriptionV3({ rawText }),
    title,
    company
  });
}
