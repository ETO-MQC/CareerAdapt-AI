export type WorkflowAssetKind = "profile" | "resume" | "job";

export type WorkflowAsset = {
  id: string;
  label: string;
  kind: WorkflowAssetKind;
};

export type WorkflowPrerequisiteResolution = {
  workflowId: string;
  ready: boolean;
  missing: WorkflowAssetKind[];
  availableAlternatives: WorkflowAsset[];
  recommendedNextAction: string;
};

type UnknownRecord = Record<string, unknown>;

export function resolveWorkflowPrerequisites(input: {
  workflowId: string;
  profiles?: unknown[];
  resumes?: unknown[];
  jobs?: unknown[];
}): WorkflowPrerequisiteResolution {
  const assets = {
    profile: normalizeAssets("profile", input.profiles ?? []),
    resume: normalizeAssets("resume", input.resumes ?? []),
    job: normalizeAssets("job", input.jobs ?? [])
  } satisfies Record<WorkflowAssetKind, WorkflowAsset[]>;
  const required = requiredAssetsForWorkflow(input.workflowId);
  const missing = required.filter((kind) => assets[kind].length === 0);
  const availableAlternatives = (Object.keys(assets) as WorkflowAssetKind[]).flatMap((kind) => assets[kind]);
  return {
    workflowId: input.workflowId,
    ready: missing.length === 0,
    missing,
    availableAlternatives,
    recommendedNextAction: recommendedAction({ assets, required, missing })
  };
}

function requiredAssetsForWorkflow(workflowId: string): WorkflowAssetKind[] {
  const canonical = workflowId.replace(/^quick_action:/, "");
  if (canonical === "guided_profile_intake" || canonical === "build_resume_from_profile") return ["profile"];
  if (canonical === "resume_import" || canonical === "job_ingestion") return [];
  if (canonical === "repair_and_export_resume") return ["resume"];
  if (["tailor_existing_resume", "analyze_job_fit"].includes(canonical)) {
    return ["profile", "resume", "job"];
  }
  return [];
}

function normalizeAssets(kind: WorkflowAssetKind, values: unknown[]): WorkflowAsset[] {
  const raw = values.map((value, index) => {
    const record = value && typeof value === "object" ? value as UnknownRecord : {};
    const id = String(record.id ?? record[`${kind}Id`] ?? `${kind}-${index + 1}`);
    const title = String(
      record.displayName
      ?? record.name
      ?? record.title
      ?? (kind === "job" ? record.company : undefined)
      ?? `${kind === "profile" ? "个人资料库" : kind === "resume" ? "简历" : "岗位"} ${index + 1}`
    );
    return { id, label: title.trim() || id, kind };
  });
  const counts = new Map<string, number>();
  raw.forEach((asset) => counts.set(asset.label, (counts.get(asset.label) ?? 0) + 1));
  return raw.map((asset) => ({
    ...asset,
    label: (counts.get(asset.label) ?? 0) > 1 ? `${asset.label} · ${asset.id}` : asset.label
  }));
}

function recommendedAction(input: {
  assets: Record<WorkflowAssetKind, WorkflowAsset[]>;
  required: WorkflowAssetKind[];
  missing: WorkflowAssetKind[];
}) {
  const { assets, required, missing } = input;
  if (missing.includes("profile") && assets.job.length && !assets.resume.length) {
    return "已找到并保留岗位；导入简历或从零整理经历";
  }
  if (missing.length) {
    const kind = missing[0];
    return kind === "profile"
      ? "创建或选择个人资料库"
      : kind === "resume"
        ? "导入或选择一份简历"
        : "导入或选择一个岗位";
  }
  if (required.includes("job") && assets.job.length > 1) return "选择目标岗位";
  if (required.includes("resume") && assets.resume.length > 1) return "选择要使用的简历";
  if (required.includes("profile") && assets.profile.length > 1) return "选择个人资料库";
  return required.length ? "已找到所需资料，确认后继续" : "继续当前步骤";
}
