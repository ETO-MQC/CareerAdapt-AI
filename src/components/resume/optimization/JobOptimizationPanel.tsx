"use client";

import { useMemo, useState } from "react";
import { Check, ChevronLeft, Sparkles } from "lucide-react";
import { analyzeJobFit, applyTailoringPlan, confirmTailoringClaims, createTailoringPlan, validateTailoringSuggestions, withTailoringSuggestions } from "@/services/jobs/tailoringService";
import { invokeStructuredAi } from "@/ai/client";
import type {
  CareerProfile,
  ClaimConfirmation,
  JobDescription,
  ResumeBranch,
  ResumeTailoringPlan,
  TailoringClaim,
  TailoringIntensity,
  TailoringSuggestion
} from "@/domain/schemas";
import { ResumeTailorOutputSchema } from "@/domain/schemas";
import type { WorkspaceRepository } from "@/services/storage/repositories";
import { nanoid } from "nanoid";

type TailoringView = "overview" | "suggestions" | "apply";

export function JobOptimizationPanel({
  repository,
  profile,
  jobs,
  branch,
  canEdit,
  onBranchReady,
  onMessage
}: {
  repository: WorkspaceRepository;
  profile?: CareerProfile;
  jobs: JobDescription[];
  branch?: ResumeBranch;
  selectedContentItemId?: string;
  canEdit: boolean;
  onJobCreated: (job: JobDescription) => void;
  onBranchReady: (branch: ResumeBranch) => void;
  onApplyStructureSuggestion: (kind: "reorder" | "hide" | "show", contentItemId: string) => void;
  onMessage: (message: string) => void;
}) {
  const [view, setView] = useState<TailoringView>("overview");
  const [intensity, setIntensity] = useState<TailoringIntensity>("balanced");
  const [plan, setPlan] = useState<ResumeTailoringPlan>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmations, setConfirmations] = useState<Record<string, ClaimConfirmation>>({});
  const [pending, setPending] = useState(false);
  const [applyError, setApplyError] = useState("");
  const targetJob = useMemo(() => jobs.find((job) => job.id === branch?.jobId), [branch?.jobId, jobs]);
  const analysis = useMemo(() => profile && branch && targetJob ? analyzeJobFit({ profile, branch, job: targetJob }) : undefined, [profile, branch, targetJob]);

  if (!profile || !branch || !targetJob) {
    return <section className="optimization-panel studio-subpanel" data-testid="job-optimization-panel"><div className="warning-box">请先从岗位页创建并打开一份岗位简历。</div></section>;
  }
  const activeProfile = profile;
  const activeBranch = branch;
  const activeJob = targetJob;

  const report = analysis?.report;
  const claims = (plan?.claims ?? []).filter((claim) => normalizeDiffText(claim.currentText) !== normalizeDiffText(claim.proposedText));
  const suggestionsById = new Map((plan?.suggestions ?? []).map((suggestion) => [suggestion.id, suggestion]));
  const selectedClaims = claims.filter((claim) => selected.has(claim.id));
  const confirmationCount = selectedClaims.filter((claim) => claim.decision === "requires_confirmation").length;
  const keywordCount = new Set(selectedClaims.flatMap((claim) => claim.keywords)).size;
  const hiddenCount = selectedClaims.filter((claim) => claim.section === "ordering" && /隐藏/.test(claim.reason)).length;

  async function generatePlan() {
    setPending(true);
    setApplyError("");
    try {
      const result = createTailoringPlan({ profile: activeProfile, branch: activeBranch, job: activeJob, intensity, operationId: `plan-${activeBranch.id}-${activeBranch.revision}-${activeJob.id}` });
      const generated: TailoringSuggestion[] = [];
      const invalidOutputCodes: Array<"invalid_ai_output" | "no_change_needed"> = [];
      await Promise.all((result.taskInputs ?? []).map(async (request) => {
        let response = await invokeStructuredAi({ task: "resume-tailor", businessInput: request, outputSchema: ResumeTailorOutputSchema });
        await repository.saveAiLogs([response.log]);
        let validated = response.ok ? validateTailoringSuggestions({ suggestions: response.data.suggestions }) : undefined;
        if (!response.ok || !validated?.suggestions.length) {
          response = await invokeStructuredAi({ task: "resume-tailor", businessInput: { ...request, retryContext: { previousWasNoOp: true } }, outputSchema: ResumeTailorOutputSchema });
          await repository.saveAiLogs([response.log]);
          validated = response.ok ? validateTailoringSuggestions({ suggestions: response.data.suggestions }) : undefined;
        }
        if (validated?.suggestions.length) generated.push(...validated.suggestions);
        else invalidOutputCodes.push(validated?.rejected[0]?.code ?? "invalid_ai_output");
      }));
      const nextPlan = result.plan ? withTailoringSuggestions({ plan: result.plan, suggestions: generated, invalidOutputCodes }) : undefined;
      setPlan(nextPlan);
      setSelected(new Set(nextPlan?.claims.filter((claim) => claim.decision !== "blocked").map((claim) => claim.id)));
      if (!generated.length) setApplyError(invalidOutputCodes.includes("no_change_needed") ? "当前内容已较匹配，无需修改。" : "AI 未生成有效改写，请重试；现有简历未发生变化。");
      setView("suggestions");
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : "AI 未生成有效改写，请重试；现有简历未发生变化。");
      setView("suggestions");
    } finally { setPending(false); }
  }

  function updateConfirmation(claim: TailoringClaim, proficiency: ClaimConfirmation["proficiency"] | undefined, accepted = true) {
    setConfirmations((current) => ({ ...current, [claim.id]: { claimId: claim.id, accepted, proficiency, syncScope: accepted ? "resume_only" : "rejected" } }));
  }

  async function applySelected() {
    if (!plan || !activeBranch.currentRevisionId) return;
    setPending(true);
    try {
      const deselected: ClaimConfirmation[] = claims.filter((claim) => !selected.has(claim.id)).map((claim) => ({ claimId: claim.id, accepted: false, syncScope: "rejected" }));
      const confirmed = confirmTailoringClaims({ plan, confirmations: [...Object.values(confirmations), ...deselected] });
      if (confirmed.status === "needs_confirmation") {
        setPlan(confirmed.plan);
        onMessage("请先确认所有推导项和新增能力，或选择暂不添加。");
        return;
      }
      const result = await applyTailoringPlan({
        plan: confirmed.plan!,
        operationId: `apply-tailoring-${confirmed.plan!.id}-${nanoid(8)}`,
        apply: async ({ plan: confirmedPlan, operationId }) => {
          const saved = await repository.applyTailoringPlan({ plan: confirmedPlan, operationId, expectedBranchRevision: activeBranch.revision, expectedRevisionId: activeBranch.currentRevisionId! });
          onBranchReady(saved.branch);
          return { branchId: saved.branch.id, revisionId: saved.revision?.id ?? saved.branch.currentRevisionId! };
        }
      });
      onMessage(result.summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : "应用岗位定制失败，请重试。";
      setApplyError(message);
      onMessage(message);
    } finally { setPending(false); }
  }

  return (
    <section className="optimization-panel tailoring-panel studio-subpanel" data-testid="job-optimization-panel" aria-label="AI 岗位优化">
      <nav className="tailoring-view-tabs" aria-label="岗位定制步骤">
        {(["overview", "suggestions", "apply"] as const).map((item, index) => <button key={item} type="button" className={view === item ? "inspector-tab inspector-tab-active" : "inspector-tab"} onClick={() => setView(item)} disabled={item !== "overview" && !plan}>{index + 1} {viewLabel(item)}</button>)}
      </nav>

      {view === "overview" ? <div className="tailoring-page" data-testid="tailoring-overview">
        <header className="tailoring-hero">
          <div><span>{activeJob.company}</span><h2>{activeJob.title}</h2><p>岗位适配度，不代表 ATS 通过率或录取概率</p></div>
          <strong aria-label="岗位适配度">{report?.overallCoverage ?? 0}</strong>
        </header>
        <label className="field-label">推荐改写力度
          <select value={intensity} onChange={(event) => setIntensity(event.target.value as TailoringIntensity)}>
            <option value="conservative">保守对齐</option><option value="balanced">平衡强化</option><option value="proactive">主动定向</option>
          </select>
        </label>
        <div className="tailoring-score-grid">
          {report ? Object.entries(report.subScores).map(([key, score]) => <div key={key}><span>{scoreLabel(key)}</span><strong>{score}</strong></div>) : null}
        </div>
        <ResultList title="你的优势" items={(report?.coveredRequirementIds ?? []).slice(0, 4).map((id) => requirementText(activeJob, id))} empty="已有真实内容可作为定制基础" />
        <ResultList title="主要缺口" items={(report?.uncoveredRequirementIds ?? []).slice(0, 4).map((id) => requirementText(activeJob, id))} empty="暂未发现明显缺口" />
        <div className="info-box"><strong>推荐策略</strong><p>{strategyCopy(intensity)}</p></div>
        <button className="primary-button" type="button" disabled={pending || !canEdit} onClick={() => { void generatePlan(); }}><Sparkles size={16} />生成改写建议</button>
      </div> : null}

      {view === "suggestions" ? <div className="tailoring-page" data-testid="tailoring-suggestions">
        <div className="section-heading compact-heading"><div><h2>改写建议</h2><p>可直接采用的建议已选中，需要确认的内容集中在下一步处理。</p></div><button className="secondary-button compact" onClick={() => setSelected(new Set(claims.filter((claim) => claim.decision === "auto_applicable").map((claim) => claim.id)))}>采用全部可直接应用建议</button></div>
        {sectionGroups(claims).map(([section, items]) => <section key={section} className="tailoring-suggestion-group"><h3>{sectionLabel(section)}</h3>{items.map((claim) => { const suggestion = suggestionsById.get(claim.id); return <article key={claim.id} className="tailoring-suggestion-card">
          <div className="tailoring-suggestion-status"><span>{decisionLabel(claim)}</span><input type="checkbox" aria-label="采用建议" checked={selected.has(claim.id)} disabled={claim.decision === "blocked"} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(claim.id); else next.delete(claim.id); return next; })} /></div>
          <div><small>当前内容</small><p>{claim.currentText || "暂无"}</p></div><div><small>建议内容</small><p><FieldDiff before={claim.currentText} after={claim.proposedText} /></p></div>
          <div className="tailoring-suggestion-meta"><p><strong>为什么修改：</strong>{claim.reason}</p><p><strong>覆盖要求：</strong>{(claim.requirementIds ?? []).map((id) => requirementText(activeJob, id)).join("、") || "对应岗位要求"}</p><p><strong>新增关键词：</strong>{suggestion?.coveredKeywordsAfter.filter((keyword) => !suggestion.coveredKeywordsBefore.includes(keyword)).join("、") || "表达结构调整"}</p><p><strong>依据来源：</strong>{claim.evidenceRefs.length ? `${claim.evidenceRefs.length} 条已确认事实证据` : "当前岗位简历中的用户确认内容"}</p><p><strong>修改风险：</strong>{suggestion?.riskLevel === "low" ? "低" : suggestion?.riskLevel === "high" ? "高" : "中，需确认"}</p></div>
          {claim.keywords.length ? <div className="keyword-phrase">{claim.keywords.join("、")}</div> : null}
        </article>; })}</section>)}
        {!claims.length ? <div className="info-box">当前内容已较匹配，无需修改；若 AI 未生成有效改写，可返回上一步重试。</div> : null}
        {applyError ? <div className="warning-box" role="alert">{applyError}</div> : null}
        <div className="action-row"><button className="secondary-button" onClick={() => setView("overview")}><ChevronLeft size={16} />返回概览</button><button className="primary-button" onClick={() => setView("apply")}>确认并应用</button></div>
      </div> : null}

      {view === "apply" ? <div className="tailoring-page" data-testid="tailoring-apply">
        <h2>确认并应用</h2>
        <div className="tailoring-apply-summary"><span>将修改 <strong>{selectedClaims.length}</strong> 处</span><span>新增关键词 <strong>{keywordCount}</strong> 个</span><span>隐藏 <strong>{hiddenCount}</strong> 项</span><span>需确认 <strong>{confirmationCount}</strong> 项</span><span>预计岗位适配度 <strong>{plan?.estimatedFitScore ?? report?.overallCoverage ?? 0}</strong></span></div>
        {selectedClaims.filter((claim) => claim.decision === "requires_confirmation").length ? <section className="tailoring-confirmations"><h3>待确认能力与表达</h3>{selectedClaims.filter((claim) => claim.decision === "requires_confirmation").map((claim) => <article key={claim.id} className="tailoring-confirmation-card"><strong>{claim.proposedText.length > 50 ? `${claim.proposedText.slice(0, 50)}...` : claim.proposedText}</strong><p>你的资料中没有直接记录这项表述，请选择最符合真实情况的描述。默认仅用于当前岗位简历。</p><div className="chip-row">{([['proficient','熟练使用'],['familiar','熟悉基础'],['aware','了解'],['learning','正在学习']] as const).map(([value, label]) => <button type="button" key={value} className={confirmations[claim.id]?.proficiency === value ? "secondary-button compact property-tab-active" : "secondary-button compact"} onClick={() => updateConfirmation(claim, value)}>{label}</button>)}<button type="button" className="secondary-button compact" onClick={() => updateConfirmation(claim, undefined, false)}>不添加</button></div><small>保存范围：仅用于当前岗位简历</small></article>)}</section> : null}
        <div className="info-box"><strong>导出前检查</strong><p><Check size={14} /> 通过 / 有建议 / 需要处理将在保存后显示；它不会改变事实。</p></div>
        <button className="primary-button" type="button" disabled={pending || !canEdit} onClick={() => { void applySelected(); }}>应用选择并保存新版本</button>
        {applyError ? <div className="warning-box" role="alert">{applyError}</div> : null}
        <p className="muted-copy">来源通用简历和个人资料库默认不变。保存后会创建新版本，可以撤销。</p>
      </div> : null}
    </section>
  );
}

function ResultList({ title, items, empty }: { title: string; items: string[]; empty: string }) { return <section className="tailoring-result-list"><h3>{title}</h3><ul>{items.length ? items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>) : <li>{empty}</li>}</ul></section>; }
function viewLabel(view: TailoringView) { return ({ overview: "匹配概览", suggestions: "改写建议", apply: "确认并应用" } as const)[view]; }
function scoreLabel(key: string) { return ({ hardConstraints: "硬性条件", coreCompetencies: "核心能力", responsibilities: "职责匹配", preferredQualifications: "加分项", terminologyCoverage: "关键词覆盖" } as Record<string, string>)[key] ?? key; }
function sectionLabel(section: TailoringClaim["section"]) { return ({ summary: "自我评价", skills: "技能", project: "项目经历", work: "工作 / 实习经历", internship: "工作 / 实习经历", ordering: "排序与隐藏" } as Partial<Record<TailoringClaim["section"], string>>)[section] ?? "其他"; }
function strategyCopy(intensity: TailoringIntensity) { return intensity === "conservative" ? "对齐关键词、压缩句子并调整顺序，不产生新能力陈述。" : intensity === "balanced" ? "用岗位语言重组真实经历；合理推导项集中确认后再应用。" : "更主动地重构相关内容并建议能力项；所有非直接依据内容都需确认。"; }
function decisionLabel(claim: TailoringClaim) { return claim.decision === "auto_applicable" ? "可直接采用" : claim.decision === "requires_confirmation" ? "需要确认" : "不能添加"; }
function requirementText(job: JobDescription, id: string) { return job.requirements.find((item) => item.id === id)?.description ?? "这项岗位要求暂未在简历中体现"; }
function sectionGroups(claims: TailoringClaim[]) { const order: TailoringClaim["section"][] = ["summary", "skills", "project", "work", "internship", "ordering"]; return order.map((section) => [section, claims.filter((claim) => claim.section === section)] as const).filter(([, items]) => items.length); }
function normalizeDiffText(value: string) { return value.replace(/<[^>]+>/g, "").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase(); }
function FieldDiff({ before, after }: { before: string; after: string }) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  const end = suffix ? after.length - suffix : after.length;
  return <>{after.slice(0, prefix)}<mark>{after.slice(prefix, end)}</mark>{after.slice(end)}</>;
}
