"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApplicationStatusSchema,
  ResumePresentationConfigSchema,
  type ApplicationPriority,
  type ApplicationReadiness,
  type ApplicationRecord,
  type ApplicationSourceChannel,
  type ApplicationStatus,
  type ExportRecord,
  type ResumePaginationPlan,
  type ResumePresentationConfig
} from "@/domain/schemas";
import { applicationStatusGroup, applicationStatusLabel, APPLICATION_STATUS_ORDER } from "@/domain/application";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import { buildResumePdfFileName, PDF_MIME_TYPE } from "@/services/export/filename";
import { createResumePdfExportRequest, presentationSnapshotFromConfig } from "@/services/export/snapshot";
import { getResumeTemplate } from "@/components/resume/templates/templateRegistry";
import { ApplicationMaterialsPanel } from "@/components/applications/materials/ApplicationMaterialsPanel";
import { hashBytes, stableHashText } from "@/services/security/text";
import { WorkspaceRepository, type ApplicationContext } from "@/services/storage/repositories";
import { WorkspaceEmptyState, WorkspaceErrorState, WorkspaceLoadingState } from "@/components/workspace/WorkspaceStates";
import {
  ProductEmptyState,
  ProductTopbar
} from "@/components/ui/product";

const repository = new WorkspaceRepository();

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; profileId?: string; applications: ApplicationRecord[] };

type ViewMode = "board" | "list";
type SortMode = "updatedAt" | "deadlineAt" | "nextFollowUpAt" | "priority" | "createdAt";
type ApplicationDetailTab = "overview" | "resume" | "materials" | "timeline";

type Filters = {
  status: "all" | ApplicationStatus;
  priority: "all" | ApplicationPriority;
  sourceChannel: "all" | ApplicationSourceChannel;
  pdfState: "all" | "has_pdf" | "missing_pdf";
  readiness: "all" | "blocked" | "needs_attention" | "ready";
  includeArchived: boolean;
  query: string;
  sort: SortMode;
};

const defaultFilters: Filters = {
  status: "all",
  priority: "all",
  sourceChannel: "all",
  pdfState: "all",
  readiness: "all",
  includeArchived: false,
  query: "",
  sort: "updatedAt"
};

const priorities: ApplicationPriority[] = ["high", "normal", "low"];
const sourceChannels: ApplicationSourceChannel[] = ["campus", "company_site", "job_board", "referral", "social", "other"];

export function ApplicationWorkspace() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      await repository.ensureDemoWorkspace();
      const profiles = await repository.listProfiles();
      const profile = profiles[0];
      if (!profile) {
        setLoadState({ status: "ready", profileId: undefined, applications: [] });
        return;
      }
      const applications = await repository.listApplicationsByProfile(profile.id);
      setLoadState({ status: "ready", profileId: profile.id, applications });
    } catch (error) {
      setLoadState({
        status: "error",
        error: error instanceof Error ? error.message : "application_workspace_load_failed"
      });
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requestedApplicationId = new URLSearchParams(window.location.search).get("applicationId") ?? undefined;
      if (requestedApplicationId) {
        setSelectedApplicationId(requestedApplicationId);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(filters.query.trim().toLowerCase()), 220);
    return () => window.clearTimeout(timer);
  }, [filters.query]);

  const applications = useMemo(() => loadState.status === "ready" ? loadState.applications : [], [loadState]);
  const filteredApplications = useMemo(() => {
    return applications
      .filter((application) => filters.includeArchived || application.status !== "archived")
      .filter((application) => filters.status === "all" || application.status === filters.status)
      .filter((application) => filters.priority === "all" || application.priority === filters.priority)
      .filter((application) => filters.sourceChannel === "all" || application.sourceChannel === filters.sourceChannel)
      .filter((application) =>
        filters.pdfState === "all"
        || (filters.pdfState === "has_pdf" ? Boolean(application.selectedExportRecordId) : !application.selectedExportRecordId)
      )
      .filter((application) => filters.readiness === "all" || snapshotReadiness(application).level === filters.readiness)
      .filter((application) => {
        if (!debouncedQuery) {
          return true;
        }
        return [
          application.companySnapshot,
          application.jobTitleSnapshot,
          application.note,
          application.tags.join(" ")
        ].join(" ").toLowerCase().includes(debouncedQuery);
      })
      .sort((a, b) => compareApplications(a, b, filters.sort));
  }, [applications, debouncedQuery, filters]);

  async function archiveApplication(application: ApplicationRecord) {
    try {
      const result = await repository.archiveApplication({
        applicationId: application.id,
        expectedVersion: application.version,
        operationId: `v2-g6a-archive-${application.id}-${application.version}`
      });
      setMessage(result.idempotent ? "该归档操作已经记录过。" : "投递记录已归档。");
      await refresh();
      setSelectedApplicationId(result.application.id);
    } catch (error) {
      setMessage(applicationErrorMessage(error));
    }
  }

  if (loadState.status === "loading") {
    return (
      <main className="page-shell application-workspace">
        <WorkspaceLoadingState />
      </main>
    );
  }

  if (loadState.status === "error") {
    return (
      <main className="page-shell application-workspace">
        <WorkspaceErrorState message={loadState.error} />
      </main>
    );
  }

  return (
    <main className="page-shell application-workspace" data-testid="application-workspace">
      <ProductTopbar title="求职进度" status={applications.length ? `${applications.length} 条记录` : "暂无记录"} />

      {message ? <section className="notice no-print">{message}</section> : null}

      {!loadState.profileId ? <WorkspaceEmptyState /> : null}

      {applications.length ? (
        <ApplicationFilters
          filters={filters}
          viewMode={viewMode}
          onFiltersChange={setFilters}
          onViewModeChange={setViewMode}
        />
      ) : null}

      <section className="application-workarea">
        <div className="application-primary-pane">
          {applications.length === 0 ? (
            <ProductEmptyState
              title="暂无投递记录"
              description="选择一份岗位定制简历后，可在这里管理投递状态、材料与时间线。"
              actions={(
                <>
                  <Link className="product-button" data-variant="primary" href="/resume">选择岗位简历</Link>
                  <Link className="product-button" data-variant="secondary" href="/ai-workspace">返回 AI 助手</Link>
                </>
              )}
            />
          ) : filteredApplications.length === 0 ? (
            <section className="panel application-empty" data-testid="applications-empty-result">
              <h2>没有符合条件的机会</h2>
              <p>调整筛选、搜索词或显示已归档记录后再查看。</p>
            </section>
          ) : viewMode === "board" ? (
            <ApplicationBoard
              applications={filteredApplications}
              selectedApplicationId={selectedApplicationId}
              onSelect={setSelectedApplicationId}
              onArchive={archiveApplication}
            />
          ) : (
            <ApplicationList
              applications={filteredApplications}
              selectedApplicationId={selectedApplicationId}
              onSelect={setSelectedApplicationId}
              onArchive={archiveApplication}
            />
          )}
        </div>

        {selectedApplicationId ? (
          <ApplicationDetail
            applicationId={selectedApplicationId}
            onMessage={setMessage}
            onChanged={async (application) => {
              await refresh();
              setSelectedApplicationId(application.id);
            }}
          />
        ) : (
          applications.length ? <section className="panel application-detail application-empty" data-testid="application-detail-placeholder">
            <h2>选择一条进度</h2>
            <p>左侧选择机会后，在这里查看时间线、材料、提醒和锁定的投递版本。</p>
          </section> : null
        )}
      </section>
    </main>
  );
}

function ApplicationFilters({
  filters,
  viewMode,
  onFiltersChange,
  onViewModeChange
}: {
  filters: Filters;
  viewMode: ViewMode;
  onFiltersChange: (filters: Filters) => void;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  return (
    <section className="panel application-filters no-print" data-testid="application-filters">
      <div className="application-filter-row">
        <label className="field-label">
          搜索
          <input
            value={filters.query}
            onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
            placeholder="公司、岗位、标签、备注"
          />
        </label>
        <label className="field-label">
          状态
          <select value={filters.status} onChange={(event) => onFiltersChange({ ...filters, status: parseStatusFilter(event.target.value) })}>
            <option value="all">全部状态</option>
            {APPLICATION_STATUS_ORDER.map((status) => (
              <option key={status} value={status}>{applicationStatusLabel(status)}</option>
            ))}
          </select>
        </label>
        <label className="field-label">
          优先级
          <select value={filters.priority} onChange={(event) => onFiltersChange({ ...filters, priority: event.target.value as Filters["priority"] })}>
            <option value="all">全部优先级</option>
            {priorities.map((priority) => (
              <option key={priority} value={priority}>{priorityLabel(priority)}</option>
            ))}
          </select>
        </label>
        <label className="field-label">
          来源
          <select value={filters.sourceChannel} onChange={(event) => onFiltersChange({ ...filters, sourceChannel: event.target.value as Filters["sourceChannel"] })}>
            <option value="all">全部来源</option>
            {sourceChannels.map((channel) => (
              <option key={channel} value={channel}>{sourceChannelLabel(channel)}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="application-filter-row compact">
        <label className="field-label">
          PDF
          <select value={filters.pdfState} onChange={(event) => onFiltersChange({ ...filters, pdfState: event.target.value as Filters["pdfState"] })}>
            <option value="all">全部PDF状态</option>
            <option value="has_pdf">有有效PDF记录</option>
            <option value="missing_pdf">缺少PDF记录</option>
          </select>
        </label>
        <label className="field-label">
          准备状态
          <select value={filters.readiness} onChange={(event) => onFiltersChange({ ...filters, readiness: event.target.value as Filters["readiness"] })}>
            <option value="all">全部准备状态</option>
            <option value="blocked">存在阻断</option>
            <option value="needs_attention">需要关注</option>
            <option value="ready">准备就绪</option>
          </select>
        </label>
        <label className="field-label">
          排序
          <select value={filters.sort} onChange={(event) => onFiltersChange({ ...filters, sort: event.target.value as SortMode })}>
            <option value="updatedAt">最近更新</option>
            <option value="deadlineAt">截止日期</option>
            <option value="nextFollowUpAt">跟进日期</option>
            <option value="priority">优先级</option>
            <option value="createdAt">创建时间</option>
          </select>
        </label>
        <label className="inline-toggle application-archive-toggle">
          <input
            type="checkbox"
            checked={filters.includeArchived}
            onChange={(event) => onFiltersChange({ ...filters, includeArchived: event.target.checked })}
          />
          显示已归档
        </label>
        <div className="application-view-toggle" role="group" aria-label="视图切换">
          <button className={viewMode === "board" ? "secondary-button property-tab-active" : "secondary-button"} onClick={() => onViewModeChange("board")}>看板</button>
          <button className={viewMode === "list" ? "secondary-button property-tab-active" : "secondary-button"} onClick={() => onViewModeChange("list")}>列表</button>
        </div>
      </div>
    </section>
  );
}

function ApplicationBoard({
  applications,
  selectedApplicationId,
  onSelect,
  onArchive
}: {
  applications: ApplicationRecord[];
  selectedApplicationId?: string;
  onSelect: (id: string) => void;
  onArchive: (application: ApplicationRecord) => void;
}) {
  const groups = ["机会", "准备中", "已投递", "面试中", "结果"];
  return (
    <section className="application-board" data-testid="application-board">
      {groups.map((group) => {
        const groupApplications = applications.filter((application) => applicationStatusGroup(application.status) === group);
        return (
          <section className="application-board-column" key={group}>
            <h2>{group}</h2>
            <div className="application-card-stack">
              {groupApplications.length === 0 ? <p className="application-muted">暂无记录</p> : null}
              {groupApplications.map((application) => (
                <ApplicationCard
                  key={application.id}
                  application={application}
                  selected={application.id === selectedApplicationId}
                  onSelect={onSelect}
                  onArchive={onArchive}
                />
              ))}
            </div>
          </section>
        );
      })}
    </section>
  );
}

function ApplicationList({
  applications,
  selectedApplicationId,
  onSelect,
  onArchive
}: {
  applications: ApplicationRecord[];
  selectedApplicationId?: string;
  onSelect: (id: string) => void;
  onArchive: (application: ApplicationRecord) => void;
}) {
  return (
    <section className="panel application-list-panel" data-testid="application-list">
      <div className="application-table" role="table">
        <div className="application-table-row application-table-head" role="row">
          <span>公司</span>
          <span>岗位</span>
          <span>状态</span>
          <span>优先级</span>
          <span>版本</span>
          <span>模板</span>
          <span>页数</span>
          <span>截止</span>
          <span>跟进</span>
          <span>更新</span>
          <span>操作</span>
        </div>
        {applications.map((application) => (
          <div
            key={application.id}
            className={`application-table-row ${application.id === selectedApplicationId ? "application-table-row-active" : ""}`}
            role="row"
          >
            <span>{application.companySnapshot ?? "未知公司"}</span>
            <span>{application.jobTitleSnapshot}</span>
            <span>{applicationStatusLabel(application.status)}</span>
            <span>{priorityLabel(application.priority)}</span>
            <span>{application.selectedBranchRevision}</span>
            <span>{application.selectedTemplateId}</span>
            <span>{application.selectedActualPageCount ? `${application.selectedActualPageCount}页` : "待导出"}</span>
            <span>{dateSignal(application.deadlineAt, "deadline")}</span>
            <span>{dateSignal(application.nextFollowUpAt, "follow")}</span>
            <span>{formatDateTime(application.updatedAt)}</span>
            <span className="application-table-actions">
              <button className="secondary-button compact" onClick={() => onSelect(application.id)}>详情</button>
              {application.status !== "archived" ? (
                <button className="secondary-button compact" onClick={() => onArchive(application)}>归档</button>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ApplicationCard({
  application,
  selected,
  onSelect,
  onArchive
}: {
  application: ApplicationRecord;
  selected: boolean;
  onSelect: (id: string) => void;
  onArchive: (application: ApplicationRecord) => void;
}) {
  const readiness = snapshotReadiness(application);
  return (
    <article className={`application-card ${selected ? "application-card-selected" : ""}`} data-testid="application-card">
      <div className="application-card-heading">
        <div>
          <span>{application.companySnapshot ?? "未知公司"}</span>
          <h3>{application.jobTitleSnapshot}</h3>
        </div>
        <strong>{applicationStatusLabel(application.status)}</strong>
      </div>
      <dl className="application-card-meta">
        <div><dt>优先级</dt><dd>{priorityLabel(application.priority)}</dd></div>
        <div><dt>来源</dt><dd>{application.sourceChannel ? sourceChannelLabel(application.sourceChannel) : "未设置"}</dd></div>
        <div><dt>截止</dt><dd>{dateSignal(application.deadlineAt, "deadline")}</dd></div>
        <div><dt>跟进</dt><dd>{dateSignal(application.nextFollowUpAt, "follow")}</dd></div>
        <div><dt>模板</dt><dd>{application.selectedTemplateId}</dd></div>
        <div><dt>页数</dt><dd>{application.selectedActualPageCount ? `${application.selectedActualPageCount}页` : "待导出"}</dd></div>
      </dl>
      <p className={`application-readiness-chip application-readiness-${readiness.level}`}>
        {readiness.label}
      </p>
      <div className="action-row application-card-actions">
        <button className="primary-button compact" onClick={() => onSelect(application.id)}>打开详情</button>
        <Link className="secondary-button compact" href={`/resume?branchId=${encodeURIComponent(application.jobSpecificBranchId)}`}>关联简历</Link>
        {application.status !== "archived" ? (
          <button className="secondary-button compact" onClick={() => onArchive(application)}>归档</button>
        ) : null}
      </div>
    </article>
  );
}

function ApplicationDetail({
  applicationId,
  onChanged,
  onMessage
}: {
  applicationId: string;
  onChanged: (application: ApplicationRecord) => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const [context, setContext] = useState<ApplicationContext | undefined>();
  const [readiness, setReadiness] = useState<ApplicationReadiness | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detailTab, setDetailTab] = useState<ApplicationDetailTab>("overview");
  const [detailForm, setDetailForm] = useState({
    priority: "normal" as ApplicationPriority,
    sourceChannel: "" as "" | ApplicationSourceChannel,
    sourceUrl: "",
    deadlineAt: "",
    plannedApplyAt: "",
    appliedAt: "",
    nextFollowUpAt: "",
    note: "",
    tags: ""
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextContext, nextReadiness] = await Promise.all([
        repository.getApplicationContext(applicationId),
        repository.getApplicationReadiness(applicationId)
      ]);
      setContext(nextContext);
      setReadiness(nextReadiness);
      if (nextContext) {
        setDetailForm({
          priority: nextContext.application.priority,
          sourceChannel: nextContext.application.sourceChannel ?? "",
          sourceUrl: nextContext.application.sourceUrl ?? "",
          deadlineAt: dateInputValue(nextContext.application.deadlineAt),
          plannedApplyAt: dateInputValue(nextContext.application.plannedApplyAt),
          appliedAt: dateInputValue(nextContext.application.appliedAt),
          nextFollowUpAt: dateInputValue(nextContext.application.nextFollowUpAt),
          note: nextContext.application.note ?? "",
          tags: nextContext.application.tags.join(", ")
        });
      }
    } catch (error) {
      onMessage(applicationErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [applicationId, onMessage]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading) {
    return (
      <section className="panel application-detail" data-testid="application-detail">
        <p>正在读取投递详情...</p>
      </section>
    );
  }

  if (!context) {
    return (
      <section className="panel application-detail" data-testid="application-detail">
        <h2>投递记录不存在</h2>
        <p>该记录可能已被移除或损坏。</p>
      </section>
    );
  }

  const { application } = context;
  const latestRevisionAvailable = Boolean(
    context.jobSpecificBranch?.currentRevisionId
    && context.jobSpecificBranch.currentRevisionId !== application.selectedRevisionId
  );
  const latestExport = context.latestExportRecord;

  async function updateStatus(nextStatus: ApplicationStatus) {
    if (!context) {
      return;
    }
    setSaving(true);
    try {
      const result = await repository.updateApplicationStatus({
        applicationId: context.application.id,
        expectedVersion: context.application.version,
        operationId: `v2-g6a-status-${context.application.id}-${context.application.version}-${nextStatus}`,
        nextStatus,
        appliedAt: nextStatus === "applied" ? new Date().toISOString() : undefined
      });
      onMessage(result.idempotent ? "状态未变化。" : "状态已更新。");
      await onChanged(result.application);
      await load();
    } catch (error) {
      onMessage(applicationErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function saveDetails() {
    if (!context) {
      return;
    }
    setSaving(true);
    try {
      const result = await repository.updateApplicationDetails({
        applicationId: context.application.id,
        expectedVersion: context.application.version,
        operationId: `v2-g6a-details-${context.application.id}-${context.application.version}-${stableHashText(JSON.stringify(detailForm))}`,
        priority: detailForm.priority,
        sourceChannel: detailForm.sourceChannel || undefined,
        sourceUrl: detailForm.sourceUrl || undefined,
        deadlineAt: isoFromDateInput(detailForm.deadlineAt),
        plannedApplyAt: isoFromDateInput(detailForm.plannedApplyAt),
        appliedAt: isoFromDateInput(detailForm.appliedAt),
        nextFollowUpAt: isoFromDateInput(detailForm.nextFollowUpAt),
        note: detailForm.note,
        tags: detailForm.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
      });
      onMessage(result.idempotent ? "详情未变化。" : "详情已保存。");
      await onChanged(result.application);
      await load();
    } catch (error) {
      onMessage(applicationErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function linkLatestRevision() {
    if (!context?.jobSpecificBranch?.currentRevisionId) {
      return;
    }
    setSaving(true);
    try {
      const result = await repository.linkApplicationRevision({
        applicationId: context.application.id,
        expectedVersion: context.application.version,
        operationId: `v2-g6a-link-revision-${context.application.id}-${context.application.version}-${context.jobSpecificBranch.currentRevisionId}`,
        revisionId: context.jobSpecificBranch.currentRevisionId
      });
      onMessage("已选择最新版本。");
      await onChanged(result.application);
      await load();
    } catch (error) {
      onMessage(applicationErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function attachLatestExport() {
    if (!context) {
      return;
    }
    if (!latestExport) {
      onMessage("没有可关联的有效 PDF 记录。");
      return;
    }
    setSaving(true);
    try {
      const result = await repository.attachApplicationExport({
        applicationId: context.application.id,
        expectedVersion: context.application.version,
        operationId: `v2-g6a-attach-export-${context.application.id}-${context.application.version}-${latestExport.id}`,
        exportRecordId: latestExport.id
      });
      onMessage("已关联最新导出记录。");
      await onChanged(result.application);
      await load();
    } catch (error) {
      onMessage(applicationErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function restoreArchived() {
    setSaving(true);
    try {
      const result = await repository.restoreApplication({
        applicationId: application.id,
        expectedVersion: application.version,
        operationId: `v2-g6a-restore-${application.id}-${application.version}`
      });
      onMessage("投递记录已恢复。");
      await onChanged(result.application);
      await load();
    } catch (error) {
      onMessage(applicationErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function regeneratePdf() {
    if (!context) {
      return;
    }
    setSaving(true);
    try {
      const { record } = await regenerateApplicationPdf(context);
      const refreshed = await repository.getApplication(context.application.id);
      if (!refreshed) {
        throw new Error("application_not_found");
      }
      const result = await repository.attachApplicationExport({
        applicationId: refreshed.id,
        expectedVersion: refreshed.version,
        operationId: `v2-g6a-attach-regenerated-export-${refreshed.id}-${refreshed.version}-${record.id}`,
        exportRecordId: record.id
      });
      onMessage("PDF 已重新生成并关联到投递记录。");
      await onChanged(result.application);
      await load();
    } catch (error) {
      onMessage(applicationErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel application-detail" data-testid="application-detail">
      <div className="section-heading">
        <div>
          <p className="eyebrow">投递详情</p>
          <h2>{application.companySnapshot ?? "未知公司"} / {application.jobTitleSnapshot}</h2>
          <p>本地版本 {application.version}</p>
        </div>
        <div className="action-row">
          <Link className="secondary-button" href="/jobs">打开岗位</Link>
          <Link className="secondary-button" href={`/resume?branchId=${encodeURIComponent(application.jobSpecificBranchId)}`}>打开关联简历</Link>
          {application.status === "archived" ? (
            <button className="primary-button" disabled={saving} onClick={restoreArchived}>恢复</button>
          ) : null}
        </div>
      </div>

      <div className="inspector-tablist application-detail-tablist" role="tablist" aria-label="投递详情">
        {(["overview", "resume", "materials", "timeline"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={detailTab === tab ? "inspector-tab inspector-tab-active" : "inspector-tab"}
            onClick={() => setDetailTab(tab)}
          >
            {applicationDetailTabLabel(tab)}
          </button>
        ))}
      </div>

      {detailTab === "overview" || detailTab === "resume" ? (
      <div className="application-detail-grid">
        {detailTab === "overview" ? (
        <section className="application-detail-section">
          <h3>状态与日期</h3>
          <label className="field-label">
            当前状态
            <select value={application.status} disabled={saving} onChange={(event) => updateStatus(event.target.value as ApplicationStatus)}>
              {APPLICATION_STATUS_ORDER.map((status) => (
                <option key={status} value={status}>{applicationStatusLabel(status)}</option>
              ))}
            </select>
          </label>
          <div className="compact-form-grid">
            <label className="field-label">
              优先级
              <select value={detailForm.priority} onChange={(event) => setDetailForm({ ...detailForm, priority: event.target.value as ApplicationPriority })}>
                {priorities.map((priority) => (
                  <option key={priority} value={priority}>{priorityLabel(priority)}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              来源渠道
              <select value={detailForm.sourceChannel} onChange={(event) => setDetailForm({ ...detailForm, sourceChannel: event.target.value as "" | ApplicationSourceChannel })}>
                <option value="">未设置</option>
                {sourceChannels.map((channel) => (
                  <option key={channel} value={channel}>{sourceChannelLabel(channel)}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              截止日期
              <input type="date" value={detailForm.deadlineAt} onChange={(event) => setDetailForm({ ...detailForm, deadlineAt: event.target.value })} />
            </label>
            <label className="field-label">
              计划投递
              <input type="date" value={detailForm.plannedApplyAt} onChange={(event) => setDetailForm({ ...detailForm, plannedApplyAt: event.target.value })} />
            </label>
            <label className="field-label">
              实际投递
              <input type="date" value={detailForm.appliedAt} onChange={(event) => setDetailForm({ ...detailForm, appliedAt: event.target.value })} />
            </label>
            <label className="field-label">
              下次跟进
              <input type="date" value={detailForm.nextFollowUpAt} onChange={(event) => setDetailForm({ ...detailForm, nextFollowUpAt: event.target.value })} />
            </label>
          </div>
          <label className="field-label">
            岗位链接
            <input value={detailForm.sourceUrl} onChange={(event) => setDetailForm({ ...detailForm, sourceUrl: event.target.value })} placeholder="https://example.com/job" />
          </label>
          {application.sourceUrl ? (
            <p className="application-muted">当前链接仅作为文本保存，只有用户点击时才会打开。</p>
          ) : null}
          <label className="field-label">
            标签
            <input value={detailForm.tags} onChange={(event) => setDetailForm({ ...detailForm, tags: event.target.value })} placeholder="校招, 内推" />
          </label>
          <label className="field-label">
            备注
            <textarea className="textarea compact-textarea" value={detailForm.note} onChange={(event) => setDetailForm({ ...detailForm, note: event.target.value })} />
          </label>
          <button className="primary-button" disabled={saving} onClick={saveDetails}>保存详情</button>
        </section>
        ) : null}

        {detailTab === "resume" ? (
        <section className="application-detail-section">
          <h3>关联简历与导出</h3>
          <dl className="application-definition-list">
            <div><dt>通用简历</dt><dd>{application.sourceGeneralBranchId ?? "未关联"}</dd></div>
            <div><dt>岗位简历</dt><dd>{application.jobSpecificBranchId}</dd></div>
            <div><dt>投递版本</dt><dd>{application.selectedRevisionId} / 内容版本 {application.selectedBranchRevision}</dd></div>
            <div><dt>展示版本</dt><dd>{application.selectedPresentationRevision}</dd></div>
            <div><dt>模板</dt><dd>{application.selectedTemplateId}</dd></div>
            <div><dt>页数策略</dt><dd>{application.selectedPagePolicy ?? "未记录"} / {application.selectedActualPageCount ? `${application.selectedActualPageCount}页` : "待导出"}</dd></div>
            <div><dt>PDF记录</dt><dd>{context.selectedExportRecord?.displayName ?? "未关联"}</dd></div>
          </dl>
          {latestRevisionAvailable ? (
            <div className="diagnostic-notice">
              关联简历已有更新，当前投递记录保留原选定版本。
              <button className="secondary-button compact" disabled={saving || Boolean(application.appliedSnapshot)} onClick={linkLatestRevision}>选择最新版本</button>
            </div>
          ) : null}
          {application.appliedSnapshot ? (
            <div className="application-lock-box" data-testid="applied-version-lock">
              已投递版本锁定：内容版本 {application.appliedSnapshot.branchRevision} / 展示版本 {application.appliedSnapshot.presentationRevision}
            </div>
          ) : null}
          <div className="action-row application-detail-actions">
            <button className="secondary-button" disabled={saving || !latestExport} onClick={attachLatestExport}>关联最新PDF记录</button>
            <button className="primary-button" disabled={saving || !context.selectedExportRecord} onClick={regeneratePdf}>下载/重新导出PDF</button>
          </div>
          <ApplicationReadinessPanel readiness={readiness} />
        </section>
        ) : null}
      </div>
      ) : null}

      {detailTab === "materials" ? (
      <ApplicationMaterialsPanel
        applicationId={application.id}
        onMessage={onMessage}
        onChanged={load}
      />
      ) : null}

      {detailTab === "timeline" ? (
      <ApplicationTimeline events={application.timeline} />
      ) : null}
    </section>
  );
}

function ApplicationReadinessPanel({ readiness }: { readiness?: ApplicationReadiness }) {
  if (!readiness) {
    return (
      <section className="application-readiness-panel">
        <h3>准备清单</h3>
        <p>准备状态暂不可用。</p>
      </section>
    );
  }
  return (
    <section className="application-readiness-panel" data-testid="application-readiness">
      <div className="section-heading compact-heading">
        <h3>准备清单</h3>
        <strong className={`application-readiness-chip application-readiness-${readiness.level}`}>{readinessLabel(readiness.level)}</strong>
      </div>
      <div className="application-readiness-list">
        {readiness.items.map((item) => (
          <article key={item.id} className={`application-readiness-item application-readiness-item-${item.level}`}>
            <strong>{item.label}</strong>
            <span>{readinessLabel(item.level)}</span>
            <p>{item.message}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function applicationDetailTabLabel(tab: ApplicationDetailTab) {
  const labels: Record<ApplicationDetailTab, string> = {
    overview: "概览",
    resume: "简历",
    materials: "材料",
    timeline: "时间线"
  };
  return labels[tab];
}

function ApplicationTimeline({ events }: { events: ApplicationRecord["timeline"] }) {
  return (
    <section className="application-timeline" data-testid="application-timeline">
      <h3>投递时间线</h3>
      {events.length === 0 ? <p>暂无事件。</p> : null}
      {[...events].reverse().map((event) => (
        <article key={event.id}>
          <span>{formatDateTime(event.occurredAt)}</span>
          <strong>{timelineTypeLabel(event.type)}</strong>
          <p>{event.summary}</p>
        </article>
      ))}
    </section>
  );
}

async function regenerateApplicationPdf(context: ApplicationContext): Promise<{ record: ExportRecord }> {
  const { application, profile, job, jobSpecificBranch, selectedRevision, selectedExportRecord } = context;
  if (!profile || !job || !jobSpecificBranch || !selectedRevision) {
    throw new Error("corrupted_application");
  }
  if (!selectedExportRecord?.paginationSnapshot || !selectedExportRecord.presentationSnapshot) {
    throw new Error("export_snapshot_missing");
  }

  const historicalBranch = {
    ...jobSpecificBranch,
    revision: application.selectedBranchRevision,
    currentRevisionId: application.selectedRevisionId,
    name: selectedRevision.snapshot.name,
    lifecycleStatus: selectedRevision.snapshot.lifecycleStatus,
    contentItems: selectedRevision.snapshot.contentItems
  };
  const presentationConfig = presentationConfigFromApplication(context);
  const renderModel = mapBranchToResumeRenderModel({
    branch: historicalBranch,
    profile,
    job,
    presentationConfig
  });
  const generatedAt = new Date().toISOString();
  const template = getResumeTemplate(presentationConfig.templateId);
  const fileName = buildResumePdfFileName({
    candidateName: renderModel.candidate.name,
    jobTitle: renderModel.jobTitle,
    templateName: template.shortName,
    date: generatedAt
  });
  const paginationPlan = selectedExportRecord.paginationSnapshot as ResumePaginationPlan;
  const exportId = `v2-g6a-regenerate-${application.id}-${stableHashText(`${generatedAt}:${selectedExportRecord.id}`)}`;
  const exportRequest = createResumePdfExportRequest({
    exportId,
    renderModel,
    presentationConfig,
    generatedAt,
    filename: fileName,
    overflowStatus: paginationPlan.status,
    paginationPlan,
    templateVersion: template.version
  });
  const response = await fetch("/api/resume-export/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(exportRequest)
  });
  if (!response.ok) {
    throw new Error("pdf_regenerate_failed");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isPdfBytes(bytes)) {
    throw new Error("invalid_pdf_response");
  }
  const pdfHash = await hashBytes(bytes);
  const completedAt = new Date().toISOString();
  const result = await repository.createResumeExportRecord({
    operationId: exportId,
    branchId: application.jobSpecificBranchId,
    expectedBranchRevision: application.selectedBranchRevision,
    expectedRevisionId: application.selectedRevisionId,
    templateId: presentationConfig.templateId,
    overflowStatus: paginationPlan.status,
    exportStatus: "direct_pdf_success",
    fileName,
    exportMethod: "direct_pdf",
    mimeType: PDF_MIME_TYPE,
    fileSize: bytes.byteLength,
    startedAt: generatedAt,
    completedAt,
    presentationRevision: presentationConfig.presentationRevision,
    presentationSnapshot: presentationSnapshotFromConfig(presentationConfig),
    snapshotHash: exportRequest.snapshot.snapshotHash,
    pdfContentHash: pdfHash,
    pagePolicy: paginationPlan.pagePolicy,
    requestedMaxPages: paginationPlan.requestedMaxPages,
    actualPageCount: paginationPlan.actualPageCount,
    paginationHash: paginationPlan.paginationHash,
    paginationSnapshot: paginationPlan,
    exceededPageLimit: false,
    continuationHeader: "none",
    pageSize: "A4",
    pageDimensions: { widthMm: 210, heightMm: 297 },
    diagnosticsEngineVersion: selectedExportRecord.diagnosticsEngineVersion,
    diagnosticsSnapshotHash: selectedExportRecord.diagnosticsSnapshotHash,
    criticalIssueCount: selectedExportRecord.criticalIssueCount,
    warningIssueCount: selectedExportRecord.warningIssueCount,
    requirementCoverageSummary: selectedExportRecord.requirementCoverageSummary,
    allowHistoricalRevision: true
  });
  triggerBrowserDownload(new Blob([bytes], { type: PDF_MIME_TYPE }), fileName);
  return { record: result.record };
}

function presentationConfigFromApplication(context: ApplicationContext): ResumePresentationConfig {
  const snapshot = context.selectedExportRecord?.presentationSnapshot;
  if (!snapshot) {
    throw new Error("export_snapshot_missing");
  }
  return ResumePresentationConfigSchema.parse({
    schemaVersion: "resume-presentation-v1",
    branchId: context.application.jobSpecificBranchId,
    templateId: context.application.selectedTemplateId,
    contentRevision: {
      branchRevision: context.application.selectedBranchRevision,
      currentRevisionId: context.application.selectedRevisionId
    },
    sectionOrder: snapshot.sectionOrder ?? ["summary", "skills", "experience", "certificates"],
    itemOrderBySection: snapshot.itemOrderBySection,
    hiddenItemIds: snapshot.hiddenItemIds,
    typography: snapshot.typography,
    spacing: snapshot.spacing,
    theme: snapshot.theme,
    pagination: snapshot.pagination ?? {
      pagePolicy: context.application.selectedPagePolicy ?? "one_page_strict",
      pageBreakBeforeSections: []
    },
    sectionStyleOverrides: snapshot.sectionStyleOverrides ?? {},
    presentationRevision: context.application.selectedPresentationRevision,
    updatedAt: context.application.updatedAt
  });
}

function compareApplications(a: ApplicationRecord, b: ApplicationRecord, sort: SortMode) {
  if (sort === "priority") {
    return priorityWeight(a.priority) - priorityWeight(b.priority) || b.updatedAt.localeCompare(a.updatedAt);
  }
  if (sort === "createdAt") {
    return b.createdAt.localeCompare(a.createdAt);
  }
  if (sort === "deadlineAt" || sort === "nextFollowUpAt") {
    const left = a[sort] ?? "9999-12-31T00:00:00.000Z";
    const right = b[sort] ?? "9999-12-31T00:00:00.000Z";
    return left.localeCompare(right) || b.updatedAt.localeCompare(a.updatedAt);
  }
  return b.updatedAt.localeCompare(a.updatedAt);
}

function snapshotReadiness(application: ApplicationRecord) {
  if (!application.selectedExportRecordId) {
    return { level: "needs_attention" as const, label: "需要导出PDF" };
  }
  if ((application.diagnosticSummary?.criticalIssueCount ?? 0) > 0) {
    return { level: "needs_attention" as const, label: "诊断需复核" };
  }
  return { level: "ready" as const, label: "材料已准备" };
}

function parseStatusFilter(value: string): Filters["status"] {
  if (value === "all") {
    return "all";
  }
  const parsed = ApplicationStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : "all";
}

function priorityWeight(priority: ApplicationPriority) {
  return priority === "high" ? 0 : priority === "normal" ? 1 : 2;
}

function priorityLabel(priority: ApplicationPriority) {
  return priority === "high" ? "高" : priority === "normal" ? "普通" : "低";
}

function sourceChannelLabel(channel: ApplicationSourceChannel) {
  const labels: Record<ApplicationSourceChannel, string> = {
    campus: "校招",
    company_site: "公司官网",
    job_board: "招聘平台",
    referral: "内推",
    social: "社交渠道",
    other: "其他"
  };
  return labels[channel];
}

function readinessLabel(level: ApplicationReadiness["level"]) {
  return level === "blocked" ? "存在阻断" : level === "needs_attention" ? "需要关注" : "准备就绪";
}

function timelineTypeLabel(type: ApplicationRecord["timeline"][number]["type"]) {
  const labels: Record<ApplicationRecord["timeline"][number]["type"], string> = {
    created: "创建",
    status_changed: "状态变化",
    priority_changed: "优先级",
    details_updated: "详情更新",
    branch_linked: "简历关联",
    revision_selected: "版本选择",
    export_attached: "PDF关联",
    deadline_changed: "截止日期",
    follow_up_changed: "跟进日期",
    note_added: "备注",
    archived: "归档",
    restored: "恢复"
  };
  return labels[type];
}

function dateSignal(value: string | undefined, mode: "deadline" | "follow") {
  if (!value) {
    return "未设置";
  }
  const date = new Date(value);
  const now = new Date();
  const diffDays = Math.ceil((startOfLocalDay(date).getTime() - startOfLocalDay(now).getTime()) / 86_400_000);
  const formatted = date.toLocaleDateString("zh-CN");
  if (diffDays < 0) {
    return mode === "follow" ? `${formatted} 待跟进` : `${formatted} 已过期`;
  }
  if (diffDays <= 3) {
    return `${formatted} 即将到期`;
  }
  return formatted;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateInputValue(value: string | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isoFromDateInput(value: string) {
  if (!value) {
    return undefined;
  }
  const date = new Date(`${value}T00:00:00`);
  return date.toISOString();
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function isPdfBytes(bytes: Uint8Array) {
  return bytes.length >= 4
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46;
}

function triggerBrowserDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.click();
  URL.revokeObjectURL(url);
}

function applicationErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "操作失败。";
  }
  if (error.message === "invalid_status_transition") {
    return "状态流转不合法，请按准备、投递、面试、结果的顺序操作。";
  }
  if (error.message === "version_conflict" || error.message === "revision_conflict") {
    return "保存失败：投递记录已被更新，请刷新后重试。";
  }
  if (error.message === "duplicate_application") {
    return "该岗位简历已有未归档投递记录。";
  }
  if (error.message === "invalid_url") {
    return "岗位链接必须是 http 或 https URL。";
  }
  if (error.message === "application_revision_locked" || error.message === "application_export_locked") {
    return "已投递版本已锁定，不能静默覆盖历史投递版本。";
  }
  if (error.message === "export_snapshot_missing") {
    return "缺少可重新生成 PDF 的导出快照，请先在简历工作台重新导出。";
  }
  return `操作失败：${error.message}`;
}
