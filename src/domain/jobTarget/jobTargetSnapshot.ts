import { JobDescriptionSchema, JobRequirementSchema, type JobDescription } from "@/domain/schemas/job";
import type { JobRequirementGraphV3 } from "@/domain/schemas/jobOptimizationV3";
import type { JobRequirementGraphV4 } from "@/domain/schemas/jobOptimizationV4";
import { JobTargetSnapshotSchema, type JobTargetSnapshot } from "@/domain/schemas/jobTarget";
import { projectJobGraphV3ToAnalyzerOutput, projectJobGraphV4ToAnalyzerOutput } from "@/domain/jobOptimization/v3/project";
import { stableHashText } from "@/services/security/text";

export function createPastedJobTargetSnapshot(input: {
  rawText: string;
  graph: JobRequirementGraphV3 | JobRequirementGraphV4;
  title?: string;
  company?: string;
  capturedAt?: string;
}) {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const title = input.title?.trim() || input.graph.roleProfile.title?.trim();
  const company = input.company?.trim();
  const projection = input.graph.schemaVersion === "job-requirement-graph-v4"
    ? projectJobGraphV4ToAnalyzerOutput({
        graph: input.graph,
        title: title || "临时岗位",
        company: company || "未填写公司",
        now: capturedAt
      })
    : projectJobGraphV3ToAnalyzerOutput({
        graph: input.graph,
        title: title || "临时岗位",
        company: company || "未填写公司",
        now: capturedAt
      });
  const normalizedRequirements = projection.requirements.map((requirement) => JobRequirementSchema.parse({
    id: requirement.id,
    category: requirement.category,
    description: requirement.description,
    priority: requirement.priority,
    hardConstraint: requirement.hardConstraint,
    sourceSpan: requirement.sourceSpan,
    keywords: requirement.keywords,
    confidence: requirement.confidenceLevel === "high" ? 0.9 : requirement.confidenceLevel === "medium" ? 0.7 : 0.45,
    createdAt: capturedAt,
    updatedAt: capturedAt
  }));
  const rawText = input.rawText.trim();
  const rawTextHash = stableHashText(rawText);
  const id = `job-target-${rawTextHash.slice(0, 24)}`;
  return JobTargetSnapshotSchema.parse({
    id,
    schemaVersion: "job-target-snapshot-v1",
    version: 1,
    sourceType: "pasted_jd",
    rawText,
    rawTextHash,
    ...(title ? { title } : {}),
    ...(company ? { company } : {}),
    normalizedRequirements,
    requirementGraph: input.graph,
    targetSignals: input.graph.roleProfile.hiringSignals.map((signal) => signal.statement),
    capturedAt,
    createdAt: capturedAt,
    updatedAt: capturedAt
  });
}

export function createSavedJobTargetSnapshot(job: JobDescription, capturedAt = new Date().toISOString()) {
  return JobTargetSnapshotSchema.parse({
    id: `job-target-${job.id}-${stableHashText(job.updatedAt).slice(0, 12)}`,
    schemaVersion: "job-target-snapshot-v1",
    version: 1,
    sourceType: "saved_job",
    rawText: job.rawText,
    rawTextHash: stableHashText(job.rawText),
    title: job.title,
    company: job.company,
    ...(job.location ? { location: job.location } : {}),
    normalizedRequirements: job.requirements,
    ...(job.requirementGraph ? { requirementGraph: job.requirementGraph } : {}),
    targetSignals: [],
    capturedAt,
    sourceJobId: job.id,
    sourceJobRevision: job.updatedAt,
    createdAt: capturedAt,
    updatedAt: capturedAt
  });
}

export function jobTargetSnapshotToJobDescription(snapshot: JobTargetSnapshot): JobDescription {
  const timestamp = snapshot.sourceJobRevision ?? snapshot.updatedAt;
  return JobDescriptionSchema.parse({
    id: snapshot.sourceJobId ?? snapshot.id,
    title: snapshot.title ?? "临时岗位",
    company: snapshot.company ?? "未填写公司",
    ...(snapshot.location ? { location: snapshot.location } : {}),
    rawText: snapshot.rawText,
    source: "imported_text",
    parsedAt: snapshot.capturedAt,
    requirements: snapshot.normalizedRequirements,
    ...(snapshot.requirementGraph ? { requirementGraph: snapshot.requirementGraph } : {}),
    analysisStatus: snapshot.requirementGraph && "needsReview" in snapshot.requirementGraph && snapshot.requirementGraph.needsReview
      ? "needs_review"
      : "validated",
    createdAt: snapshot.createdAt,
    updatedAt: timestamp
  });
}

export function jobTargetSnapshotHash(snapshot: JobTargetSnapshot) {
  return stableHashText(JSON.stringify({
    id: snapshot.id,
    version: snapshot.version,
    rawTextHash: snapshot.rawTextHash,
    requirementGraph: snapshot.requirementGraph,
    normalizedRequirements: snapshot.normalizedRequirements
  }));
}
