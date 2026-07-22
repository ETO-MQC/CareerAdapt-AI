import { nanoid } from "nanoid";
import {
  JobDescriptionSchema,
  type JobAnalysisDraft,
  type JobDescription,
  type JdAnalyzerOutput,
  type RawInputDocument
} from "@/domain/schemas";

export function mapJobDraftToJobDescription(input: {
  draft: JobAnalysisDraft;
  rawInput: RawInputDocument;
  jobId?: string;
  now?: string;
}): JobDescription {
  const now = input.now ?? new Date().toISOString();
  const output = getJobOutput(input.draft);
  const confirmedIds = new Set(output.requirements.filter((requirement) => requirement.confirmedByUser && requirement.sourceSpan).map((requirement) => requirement.id));
  const requirementGraph = input.draft.requirementGraph ? {
    ...input.draft.requirementGraph,
    requirements: input.draft.requirementGraph.requirements.filter((requirement) => confirmedIds.has(requirement.id)),
    groups: input.draft.requirementGraph.groups.map((group) => ({ ...group, requirementIds: group.requirementIds.filter((id) => confirmedIds.has(id) || input.draft.requirementGraph!.verificationMaterials.some((material) => material.id === id)) }))
  } : undefined;

  return JobDescriptionSchema.parse({
    id: input.jobId ?? `job-${nanoid(10)}`,
    title: output.title?.value || input.draft.title,
    company: output.company?.value || input.draft.company,
    industry: output.industry?.value,
    location: output.location?.value,
    workType: output.workType?.value,
    rawText: input.rawInput.rawText,
    source: "imported_text",
    parsedAt: now,
    requirementGraph,
    analysisStatus: input.draft.status === "needs_review" ? "needs_review" : input.draft.requirementGraph ? "validated" : undefined,
    analysisIssues: input.draft.analysisIssues,
    requirements: output.requirements
      .filter((requirement) => requirement.confirmedByUser && requirement.sourceSpan)
      .map((requirement) => ({
        id: requirement.id || `req-${nanoid(10)}`,
        category: requirement.category,
        description: requirement.description,
        priority: requirement.priority,
        hardConstraint: requirement.hardConstraint,
        sourceSpan: requirement.sourceSpan,
        keywords: requirement.keywords,
        confidence: confidenceToNumber(requirement.confidenceLevel),
        createdAt: now,
        updatedAt: now
      })),
    createdAt: now,
    updatedAt: now
  });
}

function getJobOutput(draft: JobAnalysisDraft): JdAnalyzerOutput {
  if (draft.analyzerOutput) {
    return draft.analyzerOutput;
  }

  return {
    requirements: draft.manualRequirements,
    riskNotes: draft.riskNotes
  };
}

function confidenceToNumber(level: "high" | "medium" | "low") {
  if (level === "high") {
    return 0.9;
  }

  if (level === "medium") {
    return 0.7;
  }

  return 0.45;
}
