"use client";

import { useMemo, useState } from "react";
import type {
  ResumeDiagnosticAction,
  ResumeDiagnosticCategory,
  ResumeDiagnosticIssue,
  ResumeDiagnosticSnapshot
} from "@/domain/schemas";

type DiagnosticFilter = "all" | ResumeDiagnosticCategory;

export function ResumeDiagnosticsPanel({
  snapshot,
  stale,
  running,
  error,
  canEdit,
  onRun,
  onLocateIssue,
  onApplyAction,
  onIgnoreIssue
}: {
  snapshot?: ResumeDiagnosticSnapshot;
  stale: boolean;
  running: boolean;
  error?: string;
  canEdit: boolean;
  onRun: () => void;
  onLocateIssue: (issue: ResumeDiagnosticIssue) => void;
  onApplyAction: (issue: ResumeDiagnosticIssue, action: ResumeDiagnosticAction) => void;
  onIgnoreIssue: (issue: ResumeDiagnosticIssue) => void;
}) {
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState<DiagnosticFilter>("all");
  const openIssues = useMemo(() => snapshot?.issues.filter((issue) => issue.status !== "ignored") ?? [], [snapshot]);
  const filteredIssues = useMemo(() => {
    const issues = openIssues.filter((issue) => filter === "all" || issue.category === filter);
    return [...issues].sort((left, right) => severityRank(right) - severityRank(left) || left.code.localeCompare(right.code));
  }, [filter, openIssues]);
  const categories = useMemo(() => {
    const keys: DiagnosticFilter[] = ["all", ...Array.from(new Set(openIssues.map((issue) => issue.category)))];
    return keys;
  }, [openIssues]);

  return (
    <section className="panel no-print diagnostics-panel" data-testid="resume-diagnostics-panel">
      <div className="section-heading">
        <div>
          <h2>简历诊断</h2>
          <p aria-live="polite">
            {running
              ? "正在诊断当前内容和展示状态。"
              : stale
                ? "诊断已过期，请重新诊断。"
                : snapshot
                  ? `最近诊断：${snapshot.summary.open} 个未处理问题。`
                  : "尚未运行诊断。"}
          </p>
        </div>
        <div className="action-row">
          <button className="secondary-button compact" type="button" onClick={() => setOpen((current) => !current)}>
            {open ? "收起" : "展开"}
          </button>
          <button className="primary-button compact" type="button" disabled={running} onClick={onRun}>
            重新诊断
          </button>
        </div>
      </div>
      {open ? (
        <>
          {error ? <div className="diagnostic-notice" data-testid="diagnostic-error">{error}</div> : null}
          {snapshot ? (
            <>
              <div className="diagnostics-summary" data-testid="diagnostics-summary">
                <SummaryTile label="总问题" value={snapshot.summary.open} />
                <SummaryTile label="critical" value={snapshot.summary.critical} tone="critical" />
                <SummaryTile label="warning" value={snapshot.summary.warning} tone="warning" />
                <SummaryTile label="info" value={snapshot.summary.info} />
                <SummaryTile label="岗位覆盖" value={`${snapshot.summary.requirementCoverage.covered}/${snapshot.summary.requirementCoverage.totalRequirements}`} />
                <SummaryTile label="页数" value={`${snapshot.summary.page.actualPageCount}/${snapshot.summary.page.requestedMaxPages}`} />
                <SummaryTile label="ATS结构" value={atsStatusLabel(snapshot.summary.atsStructureStatus)} />
                <SummaryTile label="导出" value={snapshot.summary.exportHardBlocked ? "硬阻断" : "可继续"} tone={snapshot.summary.exportHardBlocked ? "critical" : undefined} />
              </div>
              {stale ? <div className="diagnostic-notice" data-testid="stale-diagnostic">当前内容、岗位、模板或分页已变化，旧诊断仅作参考。</div> : null}
              <div className="diagnostic-filter-row" data-testid="diagnostic-category-filters">
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={`secondary-button compact ${filter === category ? "property-tab-active" : ""}`}
                    onClick={() => setFilter(category)}
                  >
                    {categoryLabel(category)}
                  </button>
                ))}
              </div>
              <div className="diagnostic-issue-list" data-testid="diagnostic-issue-list">
                {filteredIssues.length > 0 ? filteredIssues.map((issue) => (
                  <DiagnosticIssueCard
                    key={issue.id}
                    issue={issue}
                    canEdit={canEdit}
                    onLocate={() => onLocateIssue(issue)}
                    onApplyAction={(action) => onApplyAction(issue, action)}
                    onIgnore={() => onIgnoreIssue(issue)}
                  />
                )) : <p className="save-status">当前筛选下没有未处理诊断项。</p>}
              </div>
            </>
          ) : (
            <div className="diagnostic-notice">点击“重新诊断”后，会基于当前正文、岗位要求、展示配置、模板和分页计划生成派生诊断结果。</div>
          )}
        </>
      ) : null}
    </section>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string | number; tone?: "critical" | "warning" }) {
  return (
    <div className={`diagnostics-summary-tile ${tone ? `diagnostics-summary-tile-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DiagnosticIssueCard({
  issue,
  canEdit,
  onLocate,
  onApplyAction,
  onIgnore
}: {
  issue: ResumeDiagnosticIssue;
  canEdit: boolean;
  onLocate: () => void;
  onApplyAction: (action: ResumeDiagnosticAction) => void;
  onIgnore: () => void;
}) {
  return (
    <article className={`diagnostic-card diagnostic-card-${issue.severity}`} data-testid={`diagnostic-issue-${issue.code}`}>
      <div className="diagnostic-card-heading">
        <div>
          <span className="diagnostic-severity">{severityLabel(issue.severity)}</span>
          <span className="diagnostic-category">{categoryLabel(issue.category)}</span>
        </div>
        <span>{issue.code}</span>
      </div>
      <h3>{issue.title}</h3>
      <p>{issue.description}</p>
      <div className="diagnostic-targets">
        {issue.requirementIds.length ? <span>Requirement：{issue.requirementIds.join(", ")}</span> : null}
        {issue.sectionType ? <span>Section：{issue.sectionType}</span> : null}
        {issue.contentItemIds.length ? <span>Block：{issue.contentItemIds.join(", ")}</span> : null}
      </div>
      {issue.evidence.length ? (
        <dl className="diagnostic-evidence">
          {issue.evidence.map((item, index) => (
            <div key={`${item.label}-${index}`}>
              <dt>{item.label}</dt>
              <dd>{String(item.value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="action-row diagnostic-card-actions">
        <button className="secondary-button compact" type="button" onClick={onLocate}>
          定位
        </button>
        {issue.recommendedActions.map((action) => (
          <button
            key={action.id}
            className={action.safeAutoApply ? "primary-button compact" : "secondary-button compact"}
            type="button"
            disabled={action.safeAutoApply && !canEdit}
            onClick={() => onApplyAction(action)}
          >
            {action.label}
          </button>
        ))}
        <button className="secondary-button compact" type="button" onClick={onIgnore}>
          忽略
        </button>
      </div>
    </article>
  );
}

function severityRank(issue: ResumeDiagnosticIssue) {
  if (issue.severity === "critical") {
    return 3;
  }
  if (issue.severity === "warning") {
    return 2;
  }
  return 1;
}

function severityLabel(severity: ResumeDiagnosticIssue["severity"]) {
  if (severity === "critical") {
    return "严重";
  }
  if (severity === "warning") {
    return "警告";
  }
  return "提示";
}

function categoryLabel(category: DiagnosticFilter) {
  const labels: Record<DiagnosticFilter, string> = {
    all: "全部诊断",
    requirement_coverage: "岗位覆盖",
    fact_gap: "事实缺口",
    content_relevance: "相关性",
    content_density: "内容密度",
    readability: "可读性",
    spacing: "间距",
    pagination: "分页",
    template_fit: "模板",
    ats_structure: "ATS结构",
    contact_completeness: "联系方式",
    section_structure: "Section"
  };
  return labels[category];
}

function atsStatusLabel(status: ResumeDiagnosticSnapshot["summary"]["atsStructureStatus"]) {
  if (status === "structure_friendly") {
    return "结构友好";
  }
  if (status === "minor_risk") {
    return "轻度风险";
  }
  if (status === "clear_risk") {
    return "明显风险";
  }
  return "无法确认";
}
