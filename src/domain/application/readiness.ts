import {
  ApplicationReadinessSchema,
  type ApplicationReadiness,
  type ApplicationReadinessItem,
  type ApplicationRecord,
  type ApplicationPreparationChecklist,
  type ExportRecord,
  type JobDescription,
  type ResumeBranch,
  type ResumeRevision
} from "@/domain/schemas";

export type ApplicationReadinessInput = {
  application: ApplicationRecord;
  job?: JobDescription;
  branch?: ResumeBranch;
  revision?: ResumeRevision;
  exportRecord?: ExportRecord;
  preparationChecklist?: ApplicationPreparationChecklist;
  now?: string;
};

export function computeApplicationReadiness(input: ApplicationReadinessInput): ApplicationReadiness {
  const now = input.now ?? new Date().toISOString();
  const items: ApplicationReadinessItem[] = [
    jobItem(input.job),
    branchItem(input.application, input.branch),
    revisionItem(input.application, input.branch, input.revision),
    factGuardItem(input.branch),
    pagePolicyItem(input.exportRecord),
    exportItem(input.exportRecord),
    diagnosticsItem(input.application),
    ...preparationItems(input.preparationChecklist)
  ];

  const level = items.some((item) => item.level === "blocked")
    ? "blocked"
    : items.some((item) => item.level === "needs_attention")
      ? "needs_attention"
      : "ready";

  return ApplicationReadinessSchema.parse({
    level,
    items,
    updatedAt: now
  });
}

function preparationItems(checklist?: ApplicationPreparationChecklist): ApplicationReadinessItem[] {
  if (!checklist) {
    return [{
      id: "application_materials",
      label: "申请材料准备",
      level: "needs_attention",
      message: "尚未建立申请材料包；这不会自动改变 Application 状态。"
    }];
  }
  return [{
    id: "application_materials",
    label: "申请材料准备",
    level: checklist.level,
    message: checklist.level === "ready"
      ? "申请材料 checklist 已准备就绪。"
      : checklist.level === "blocked"
        ? "申请材料中存在被 Fact Guard 阻止的内容。"
        : "申请材料仍有未完成、stale 或需复核项目。"
  }];
}

function jobItem(job?: JobDescription): ApplicationReadinessItem {
  return job
    ? {
        id: "job",
        label: "岗位信息",
        level: "ready",
        message: "岗位记录存在。"
      }
    : {
        id: "job",
        label: "岗位信息",
        level: "blocked",
        message: "关联岗位不存在，需先修复岗位引用。"
      };
}

function branchItem(application: ApplicationRecord, branch?: ResumeBranch): ApplicationReadinessItem {
  if (!branch) {
    return {
      id: "branch",
      label: "岗位简历分支",
      level: "blocked",
      message: "关联岗位定制分支不存在。"
    };
  }
  if (branch.id !== application.jobSpecificBranchId || branch.profileId !== application.profileId || branch.jobId !== application.jobId) {
    return {
      id: "branch",
      label: "岗位简历分支",
      level: "blocked",
      message: "分支与 Application 的 Profile 或岗位不匹配。"
    };
  }
  if (branch.branchPurpose !== "job_specific") {
    return {
      id: "branch",
      label: "岗位简历分支",
      level: "blocked",
      message: "只有岗位定制分支可作为正式投递简历。"
    };
  }
  if (branch.migrationStatus !== "verified") {
    return {
      id: "branch",
      label: "岗位简历分支",
      level: "blocked",
      message: "旧版或未验证分支不能用于正式投递。"
    };
  }
  if (branch.syncStatusCache.status === "invalid_reference") {
    return {
      id: "branch",
      label: "岗位简历分支",
      level: "blocked",
      message: "分支存在失效事实引用。"
    };
  }
  if (branch.lifecycleStatus !== "active") {
    return {
      id: "branch",
      label: "岗位简历分支",
      level: "needs_attention",
      message: "分支已归档，历史 Application 可查看，但建议重新选择有效分支。"
    };
  }
  if (branch.revision !== application.selectedBranchRevision || branch.currentRevisionId !== application.selectedRevisionId) {
    return {
      id: "branch",
      label: "岗位简历分支",
      level: "needs_attention",
      message: "分支已有更新，当前 Application 仍锁定选定版本。"
    };
  }
  return {
    id: "branch",
    label: "岗位简历分支",
    level: "ready",
    message: "岗位定制分支有效。"
  };
}

function revisionItem(application: ApplicationRecord, branch?: ResumeBranch, revision?: ResumeRevision): ApplicationReadinessItem {
  if (!revision) {
    return {
      id: "revision",
      label: "选定简历版本",
      level: "blocked",
      message: "选定 ResumeRevision 不存在。"
    };
  }
  if (!branch || revision.branchId !== branch.id || revision.id !== application.selectedRevisionId) {
    return {
      id: "revision",
      label: "选定简历版本",
      level: "blocked",
      message: "选定版本不属于当前岗位分支。"
    };
  }
  return {
    id: "revision",
    label: "选定简历版本",
    level: "ready",
    message: `已选择 revision ${revision.revisionNumber}。`
  };
}

function factGuardItem(branch?: ResumeBranch): ApplicationReadinessItem {
  if (!branch) {
    return {
      id: "fact_guard",
      label: "Fact Guard",
      level: "blocked",
      message: "缺少分支，无法确认 Fact Guard 状态。"
    };
  }
  const blocked = branch.contentItems.some((item) =>
    item.guardRiskLevel === "high"
    || item.guardFindings.some((finding) => !finding.allowed && finding.severity === "high")
  );
  if (blocked) {
    return {
      id: "fact_guard",
      label: "Fact Guard",
      level: "blocked",
      message: "存在正式高风险阻断，不能作为 ready 材料。"
    };
  }
  const ruleOnly = branch.contentItems.some((item) => item.guardMode === "rule_only_verified");
  return {
    id: "fact_guard",
    label: "Fact Guard",
    level: ruleOnly ? "needs_attention" : "ready",
    message: ruleOnly ? "部分内容为规则验证，建议投递前复核。" : "正式事实安全门槛通过。"
  };
}

function pagePolicyItem(exportRecord?: ExportRecord): ApplicationReadinessItem {
  if (!exportRecord) {
    return {
      id: "page_policy",
      label: "分页策略",
      level: "needs_attention",
      message: "尚未关联成功导出记录，无法确认最终页数。"
    };
  }
  if (exportRecord.exportStatus === "blocked_overflow" || exportRecord.exceededPageLimit) {
    return {
      id: "page_policy",
      label: "分页策略",
      level: "blocked",
      message: "最近导出被页数策略阻断。"
    };
  }
  if (exportRecord.overflowStatus === "exceeds_two_pages" || exportRecord.overflowStatus === "overflow" || exportRecord.overflowStatus === "measurement_failed") {
    return {
      id: "page_policy",
      label: "分页策略",
      level: "blocked",
      message: "分页或测量状态阻断导出。"
    };
  }
  return {
    id: "page_policy",
    label: "分页策略",
    level: "ready",
    message: exportRecord.actualPageCount ? `导出页数 ${exportRecord.actualPageCount} 页。` : "导出记录未报告页数，但未触发阻断。"
  };
}

function exportItem(exportRecord?: ExportRecord): ApplicationReadinessItem {
  if (!exportRecord) {
    return {
      id: "export",
      label: "PDF 导出记录",
      level: "needs_attention",
      message: "尚未关联有效 PDF；可以先在简历工作台导出。"
    };
  }
  if (exportRecord.exportStatus !== "direct_pdf_success" && exportRecord.exportStatus !== "print_invoked") {
    return {
      id: "export",
      label: "PDF 导出记录",
      level: "blocked",
      message: "关联导出记录不是成功状态。"
    };
  }
  return {
    id: "export",
    label: "PDF 导出记录",
    level: "ready",
    message: `${exportRecord.displayName} 已关联。`
  };
}

function diagnosticsItem(application: ApplicationRecord): ApplicationReadinessItem {
  const summary = application.diagnosticSummary;
  if (!summary) {
    return {
      id: "diagnostics",
      label: "诊断摘要",
      level: "needs_attention",
      message: "暂无最新诊断摘要；普通警告不会硬阻止投递。"
    };
  }
  if (summary.criticalIssueCount > 0) {
    return {
      id: "diagnostics",
      label: "诊断摘要",
      level: "needs_attention",
      message: `诊断有 ${summary.criticalIssueCount} 个 critical 问题，建议先复核。`
    };
  }
  if (summary.warningIssueCount > 0) {
    return {
      id: "diagnostics",
      label: "诊断摘要",
      level: "needs_attention",
      message: `诊断有 ${summary.warningIssueCount} 个 warning，用户可自行决定是否投递。`
    };
  }
  return {
    id: "diagnostics",
    label: "诊断摘要",
    level: "ready",
    message: "当前诊断摘要未发现阻断项。"
  };
}
