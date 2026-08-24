import type { CareerProfile, JobDescription, ResumeBranch } from "@/domain/schemas";

export function extractExplicitTargetRole(rawText: string): string | undefined {
  const lines = rawText.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  const labeled = lines.find((line) => /^(?:岗位名称|岗位|职位名称|职位|job\s*title)\s*[:：]/iu.test(line));
  if (labeled) {
    const value = labeled.replace(/^[^:：]+[:：]\s*/u, "").trim();
    return safeTargetRole(value);
  }
  const wrapperMatch = /^(?:我想|我要|希望|请帮我)?\s*(?:应聘|申请|投递)\s*(?:这个|该|目标)?\s*(?:岗位|职位)?\s*(?:[:：]\s*)?(.*)$/u.exec(lines[0] ?? "");
  if (wrapperMatch?.[1]?.trim()) return safeTargetRole(wrapperMatch[1]);
  const first = lines[0];
  if (!first || first.length > 80) return undefined;
  return safeTargetRole(first);
}

export function resolveResumeTargetRole(input: {
  branch: ResumeBranch;
  profile: CareerProfile;
  job?: JobDescription;
}): string | undefined {
  const { branch, profile, job } = input;
  const basics = branch.resumeBasics;
  const branchLocalRole = basics?.targetRole?.trim() || undefined;
  if (branch.branchPurpose === "general") {
    // General branches are presentation artifacts, not mirrors of the
    // profile's historical headline/targetRole. Only a branch-local direction
    // (for example composition.targetDirection) is allowed here.
    const historicalProfileRoles = [
      profile.structuredBasics?.targetRole?.trim(),
      profile.structuredBasics?.headline?.trim()
    ].filter((value): value is string => Boolean(value));
    const safeBranchRole = safeTargetRole(branchLocalRole);
    return safeBranchRole && !historicalProfileRoles.includes(safeBranchRole)
      ? safeBranchRole
      : undefined;
  }
  const savedJobTitle = safeTargetRole(job?.title);
  if (savedJobTitle) return savedJobTitle;
  const explicitJobTitle = job ? extractExplicitTargetRole(job.rawText) : undefined;
  if (explicitJobTitle) return explicitJobTitle;
  const snapshotTitle = safeTargetRole(branch.targetSnapshot?.title);
  if (snapshotTitle) return snapshotTitle;
  const graph = branch.targetSnapshot?.requirementGraph as { roleProfile?: { title?: unknown } } | undefined;
  const graphTitle = typeof graph?.roleProfile?.title === "string" ? safeTargetRole(graph.roleProfile.title) : undefined;
  if (graphTitle) return graphTitle;
  return safeTargetRole(branchLocalRole) || "岗位定制简历";
}

function safeTargetRole(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 80 || /[\r\n]/u.test(normalized)) return undefined;
  if (/^(?:岗位|职位|岗位描述|职位描述|职责|要求|招聘信息|responsibilities?|requirements?)$/iu.test(normalized)) return undefined;
  if (/(?:岗位描述|职位描述|招聘信息|岗位职责|任职要求)/iu.test(normalized)) return undefined;
  if (/^(?:我想|我要|希望|请帮我)?\s*(?:应聘|申请|投递)/u.test(normalized)) return undefined;
  if (/[。！？!?；;]/u.test(normalized)) return undefined;
  if (/^(?:岗位名称|岗位|职位名称|职位|job\s*title)\s*[:：]/iu.test(normalized)) return undefined;
  return normalized;
}
