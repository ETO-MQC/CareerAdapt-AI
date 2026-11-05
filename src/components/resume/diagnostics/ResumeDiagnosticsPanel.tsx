"use client";

import type { GeneralResumeReview } from "@/domain/resumeComposition/reviewExistingGeneralResume";
import type { PdfTextReadiness } from "@/services/export/pdfTextReadiness";
import { useMemo, useState } from "react";
import type { ResumeDiagnosticAction, ResumeDiagnosticIssue, ResumeDiagnosticSnapshot } from "@/domain/schemas";

type DeliveryFilter = "all" | "must_handle" | "job_match" | "content" | "format";

export function ResumeDiagnosticsPanel({
  generalReview, reviewStale, onReview, onLocateReview, pdfReadiness, pdfStale,
  snapshot, stale, running, error, canEdit, onRun, onLocateIssue, onApplyAction, onIgnoreIssue
}: {
  generalReview?: GeneralResumeReview;
  reviewStale?: boolean;
  onReview?: () => void;
  onLocateReview?: (itemId: string) => void;
  pdfReadiness?: PdfTextReadiness;
  pdfStale?: boolean;
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
  const [filter, setFilter] = useState<DeliveryFilter>("all");
  const issues = useMemo(() => mergePrimaryIssues(snapshot?.issues.filter((issue) => issue.status !== "ignored") ?? []), [snapshot]);
  const filtered = useMemo(() => issues
    .filter((issue) => filter === "all" || deliveryCategory(issue) === filter)
    .sort((left, right) => severityRank(right) - severityRank(left) || left.title.localeCompare(right.title, "zh-CN")), [filter, issues]);
  const counts = useMemo(() => ({
    must_handle: issues.filter((issue) => deliveryCategory(issue) === "must_handle").length,
    job_match: issues.filter((issue) => deliveryCategory(issue) === "job_match").length,
    content: issues.filter((issue) => deliveryCategory(issue) === "content").length,
    format: issues.filter((issue) => deliveryCategory(issue) === "format").length
  }), [issues]);

  return (
    <section className="no-print diagnostics-panel studio-subpanel" data-testid="resume-diagnostics-panel">
      <div className="section-heading">
        <div>
          <h2>投递检查</h2>
          <p aria-live="polite">{running ? "正在检查岗位匹配、内容表达和排版…" : stale ? "检查结果已过期，请重新检查。" : snapshot ? `还有 ${issues.length} 项可处理。` : "检查投递前需要处理的内容。"}</p>
        </div>
        <div className="action-row">
          <button className="secondary-button compact" type="button" onClick={() => setOpen((current) => !current)}>{open ? "收起" : "展开"}</button>
          <button className="primary-button compact" data-testid="run-resume-diagnostics" type="button" disabled={running} onClick={onRun}>重新检查</button>
        </div>
      </div>
      {open ? <>
        {onReview ? <button type="button" className="secondary-button compact" data-testid="review-general-resume" onClick={onReview}>审阅当前通用简历（只读）</button> : null}
        {generalReview ? <div data-testid="general-resume-review">
          <p>当前原文审阅 · Revision {generalReview.revisionId} · {reviewStale ? "已过期，请重新审阅" : "当前版本"}</p>
          <p>只读规则审阅，不创建正式版本，不修改个人资料。可向 AI 助手要求完整审阅；修改须另行确认。</p>
          <p>事实安全门禁：{generalReview.reviewResult.diagnostics?.hardGate.status ?? "unknown"} · Claim Risk：{generalReview.reviewResult.diagnostics?.claimRisk?.level ?? "unknown"}</p>
          {Object.entries({ "HR 快速阅读": generalReview.reviewResult.diagnostics?.recruiterScan,
            "简历内容质量": generalReview.reviewResult.diagnostics?.contentQuality,
            "ATS 结构": generalReview.reviewResult.diagnostics?.atsStructure }).map(([label, dimensions]) => <details key={label}><summary>{label}</summary>
            {Object.entries(dimensions ?? {}).map(([name, observation]) => <p key={name}>{dimensionLabel(name)}：{observation.status} · {observation.reason}</p>)}
          </details>)}
          {generalReview.reviewResult.diffs.map(diff => <article key={diff.id} className="diagnostic-card" data-testid="general-review-finding">
            <strong>{diff.kind === "verify" ? "需要确认事实" : "建议优化"} · {diff.fieldPath}</strong>
            <blockquote>{diff.before}</blockquote><p>{diff.recommendation}</p>
            {diff.after ? <p>候选修改：{diff.after}</p> : null}
            <p>原始证据：{generalReview.evidence.find(e => e.itemId === diff.itemId)?.excerpt ?? "Unknown：缺少独立来源"}</p>
            <button type="button" className="secondary-button compact" onClick={() => onLocateReview?.(diff.itemId)}>定位原文</button>
          </article>)}
          {!generalReview.reviewResult.diffs.length ? <p>当前规则未发现表达问题；语义与真实模型质量仍未认证。</p> : null}
        </div> : null}
        <div className="diagnostic-notice" data-testid="pdf-text-readiness">
          实际 PDF 文本层：{pdfReadiness && !pdfStale ? pdfReadiness.textLayer : "unknown"}；
          正文一致性：{pdfReadiness && !pdfStale ? pdfReadiness.contentParity : "unknown"}；
          提取顺序：{pdfReadiness && !pdfStale ? pdfReadiness.readingOrder : "unknown"}。
          {pdfReadiness ? ` ${pdfReadiness.pageCount || "页数未知"} 页 · ${pdfStale ? "检查已过期" : pdfReadiness.failureCode ? "检查未完成" : "已检查实际导出文件"}` : "请先导出 PDF。"}
          。第三方 ATS 兼容性：Unknown。
        </div>
        {error ? <div className="diagnostic-notice" role="alert" data-testid="diagnostic-error">{error}</div> : null}
        {snapshot ? <>
          <div className="diagnostics-summary" data-testid="diagnostics-summary">
            <SummaryTile label="必须处理" value={counts.must_handle || "已通过"} tone={counts.must_handle ? "critical" : undefined} />
            <SummaryTile label="岗位匹配" value={counts.job_match || "未发现规则问题"} />
            <SummaryTile label="内容表达" value={counts.content || "未发现规则问题"} />
            <SummaryTile label="排版与系统解析" value={counts.format || "未发现规则问题"} />
          </div>
          {stale ? <div className="diagnostic-notice" data-testid="stale-diagnostic">正文、岗位、模板或分页已变化，旧结果仅供参考。</div> : null}
          <div className="diagnostic-filter-row" data-testid="diagnostic-category-filters">
            {(["all", "must_handle", "job_match", "content", "format"] as const).map((value) => <button key={value} type="button" className={`secondary-button compact ${filter === value ? "property-tab-active" : ""}`} onClick={() => setFilter(value)}>{filterLabel(value, counts)}</button>)}
          </div>
          <div className="diagnostic-issue-list" data-testid="diagnostic-issue-list">
            {filtered.length ? filtered.map((issue) => <DiagnosticIssue key={issue.id} issue={issue} canEdit={canEdit} onLocate={() => onLocateIssue(issue)} onApply={(action) => onApplyAction(issue, action)} onIgnore={() => onIgnoreIssue(issue)} />) : <p className="save-status">这一类未发现规则问题；未检查的维度仍为 Unknown。</p>}
          </div>
        </> : <div className="diagnostic-notice">点击“重新检查”，查看投递前需要处理和建议优化的项目。</div>}
      </> : null}
    </section>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string | number; tone?: "critical" }) {
  return <div className={`diagnostics-summary-tile ${tone ? `diagnostics-summary-tile-${tone}` : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

function DiagnosticIssue({ issue, canEdit, onLocate, onApply, onIgnore }: { issue: ResumeDiagnosticIssue; canEdit: boolean; onLocate: () => void; onApply: (action: ResumeDiagnosticAction) => void; onIgnore: () => void }) {
  return <article className={`diagnostic-card diagnostic-card-${issue.severity}`} data-testid={`diagnostic-issue-${issue.code}`}>
    <div className="diagnostic-card-heading"><span className="diagnostic-severity">{statusLabel(issue)}</span><span>{factStatus(issue)}</span></div>
    <h3>{issue.title}</h3>
    <p>{issue.description}</p>
    <div className="action-row diagnostic-card-actions">
      <button className="secondary-button compact" type="button" onClick={onLocate}>定位内容</button>
      {issue.recommendedActions.map((action) => <button key={action.id} className={action.safeAutoApply ? "primary-button compact" : "secondary-button compact"} type="button" disabled={action.safeAutoApply && !canEdit} onClick={() => onApply(action)}>{action.label.replace(/G5a\s*/g, "")}</button>)}
      <button className="secondary-button compact" type="button" onClick={onIgnore}>可忽略</button>
    </div>
    <details>
      <summary>技术详情</summary>
      <div className="diagnostic-targets"><span>问题代码：{issue.code}</span>{issue.requirementIds.length ? <span>要求：{issue.requirementIds.join(", ")}</span> : null}{issue.contentItemIds.length ? <span>内容：{issue.contentItemIds.join(", ")}</span> : null}</div>
      {issue.evidence.length ? <dl className="diagnostic-evidence">{issue.evidence.map((item, index) => <div key={`${item.label}-${index}`}><dt>{item.label}</dt><dd>{String(item.value)}</dd></div>)}</dl> : null}
    </details>
  </article>;
}

function mergePrimaryIssues(issues: ResumeDiagnosticIssue[]) {
  const byKey = new Map<string, ResumeDiagnosticIssue>();
  for (const issue of issues) {
    const requirementId = issue.requirementIds[0];
    const key = requirementId && ["REQUIRED_REQUIREMENT_NOT_COVERED", "PREFERRED_REQUIREMENT_NOT_COVERED", "REQUIREMENT_FACT_GAP"].includes(issue.code) ? `requirement-gap:${requirementId}` : issue.id;
    const existing = byKey.get(key);
    if (!existing || severityRank(issue) > severityRank(existing) || issue.code.includes("NOT_COVERED")) byKey.set(key, issue);
  }
  return [...byKey.values()];
}

function deliveryCategory(issue: ResumeDiagnosticIssue): Exclude<DeliveryFilter, "all"> {
  if (issue.severity === "critical") return "must_handle";
  if (["requirement_coverage", "fact_gap"].includes(issue.category)) return "job_match";
  if (["content_relevance", "content_density", "readability", "contact_completeness", "section_structure"].includes(issue.category)) return "content";
  return "format";
}
function statusLabel(issue: ResumeDiagnosticIssue) { return issue.severity === "critical" ? "必须处理" : issue.severity === "warning" ? "建议优化" : "可忽略"; }
function factStatus(issue: ResumeDiagnosticIssue) {
  if (/FACT_GAP|NOT_COVERED/.test(issue.code)) return "需要补充材料";
  if (/CONFIRM|RISK/.test(issue.code)) return "需要用户确认";
  if (issue.evidence.length) return "规则检查依据";
  return "需人工核对";
}
function severityRank(issue: ResumeDiagnosticIssue) { return issue.severity === "critical" ? 3 : issue.severity === "warning" ? 2 : 1; }
function filterLabel(value: DeliveryFilter, counts: Record<Exclude<DeliveryFilter, "all">, number>) {
  if (value === "all") return "全部";
  const label = { must_handle: "必须处理", job_match: "岗位匹配", content: "内容表达", format: "排版与系统解析" }[value];
  return `${label} ${counts[value]}`;
}

function dimensionLabel(name: string) {
  const labels: Record<string, string> = { positioning: "定位", scanClarity: "快速阅读", strongestExperience: "最强经历",
    factualFidelity: "事实忠实度", specificity: "具体性", relevance: "相关性", clarity: "清晰度", evidenceDensity: "证据密度",
    redundancy: "重复与冗余", ownershipAccuracy: "职责准确性", textExtractability: "PDF文本层", sectionStructure: "栏目结构",
    fieldCompleteness: "字段完整性", readingOrder: "阅读顺序", supportedKeywordCoverage: "有来源关键词", unsupportedKeywordInjection: "无来源关键词" };
  return labels[name] ?? name;
}
