"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, Sparkles, Square } from "lucide-react";
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
import { ResumeTailorOutputSchema, ResumeTailorPlannerOutputSchema } from "@/domain/schemas";
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
  const [progress, setProgress] = useState({ step: 0, completed: 0, skipped: 0, failed: 0 });
  const generationController = useRef<AbortController | undefined>(undefined);
  const [plannerAssessment, setPlannerAssessment] = useState<{ globalNotes?: string; skippedCount: number; rewrittenCount: number }>();
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
    generationController.current?.abort();
    const controller = new AbortController();
    generationController.current = controller;
    setPending(true);
    setProgress({ step: 1, completed: 0, skipped: 0, failed: 0 });
    setPlannerAssessment(undefined);
    setView("suggestions");
    try {
      const result = createTailoringPlan({ profile: activeProfile, branch: activeBranch, job: activeJob, intensity, operationId: `plan-${activeBranch.id}-${activeBranch.revision}-${activeJob.id}` });
      const taskInputs = result.taskInputs ?? [];
      if (!taskInputs.length) {
        onMessage("简历内容较少，无需改写。");
        setPlan(result.plan);
        return;
      }

      // --- Phase 1: 全局评估 ---
      const plannerInput = {
        jobContext: result.plan?.jobContext ?? { title: activeJob.title, rawText: activeJob.rawText },
        requirements: activeJob.requirements.map((r) => ({ id: r.id, description: r.description, priority: r.priority, category: r.category, keywords: r.keywords })),
        sections: taskInputs.map((t) => ({ sectionType: t.target.sectionType, itemId: t.target.itemId ?? "", currentText: typeof t.currentContent.fieldValue === "string" ? t.currentContent.fieldValue : t.currentContent.fieldValue.join("；"), relevantRequirementIds: t.relevantRequirements.map((r) => r.requirementId) }))
      };
      const plannerResponse = await invokeStructuredAi({ task: "resume-optimization-planner", businessInput: plannerInput, outputSchema: ResumeTailorPlannerOutputSchema, signal: controller.signal });
      await repository.saveAiLogs([plannerResponse.log]);

      const skipIds = new Set<string>();
      if (plannerResponse.ok) {
        for (const assessment of plannerResponse.data.assessments) {
          if (assessment.verdict === "skip") skipIds.add(assessment.itemId);
        }
        setPlannerAssessment({
          globalNotes: plannerResponse.data.globalNotes,
          skippedCount: skipIds.size,
          rewrittenCount: plannerResponse.data.assessments.length - skipIds.size
        });
      } else {
        setPlannerAssessment({ globalNotes: "AI 评估未能完成，将对所有片段尝试改写。", skippedCount: 0, rewrittenCount: taskInputs.length });
      }
      setProgress((current) => ({ ...current, step: 2, skipped: skipIds.size }));

      // --- Phase 2: 仅对可改写片段发送改写请求 ---
      const generated: TailoringSuggestion[] = [];
      const allRejectedReasons: string[] = [];
      const rewriteInputs = taskInputs.filter((t) => !skipIds.has(t.target.itemId ?? ""));
      setProgress((current) => ({ ...current, step: 3 }));
      const batchSize = Math.ceil(rewriteInputs.length / Math.min(2, rewriteInputs.length || 1));
      const batches = Array.from({ length: Math.ceil(rewriteInputs.length / batchSize) }, (_, index) => rewriteInputs.slice(index * batchSize, (index + 1) * batchSize));
      for (const batch of batches) {
        if (controller.signal.aborted) break;
        const first = batch[0];
        const response = await invokeStructuredAi({
          task: "resume-tailor-batch",
          businessInput: {
            draftId: first.draftId, profileId: first.profileId, jobId: first.jobId, intensity: first.intensity,
            compactJobContext: {
              title: first.jobContext.title, roleMission: first.jobContext.roleMission,
              topResponsibilities: first.jobContext.responsibilities.slice(0, 4), targetKeywords: first.jobContext.keywords.slice(0, 16)
            },
            targets: batch.map((request) => ({
              itemId: request.target.itemId ?? request.target.sectionId, sectionType: request.target.sectionType, sectionId: request.target.sectionId, fieldPath: request.target.fieldPath,
              structuredItem: request.currentContent.structuredItem, before: request.currentContent.fieldValue, renderedText: request.currentContent.renderedText,
              relevantRequirements: request.relevantRequirements.slice(0, 4), allowedEvidenceRefs: request.allowedEvidenceRefs, allowedFacts: request.allowedFacts
            }))
          },
          outputSchema: ResumeTailorOutputSchema,
          signal: controller.signal
        });
        await repository.saveAiLogs([response.log]);
        const validated = response.ok ? validateTailoringSuggestions({ suggestions: response.data.suggestions }) : undefined;
        if (validated?.suggestions.length) generated.push(...validated.suggestions);
        else if (validated?.rejected.length) allRejectedReasons.push(...validated.rejected.flatMap((r) => r.reasons));
        else allRejectedReasons.push(response.ok ? "empty_suggestions" : (response as { errorCode?: string }).errorCode ?? "provider_error");
        setProgress((current) => ({ ...current, completed: current.completed + (validated?.suggestions.length ?? 0), failed: current.failed + Math.max(0, batch.length - (validated?.suggestions.length ?? 0)) }));
        const partialPlan = result.plan ? withTailoringSuggestions({ plan: result.plan, suggestions: generated, invalidOutputCodes: [] }) : undefined;
        setPlan(partialPlan);
        setSelected(new Set(partialPlan?.claims.filter((claim) => claim.decision !== "blocked").map((claim) => claim.id)));
      }

      const nextPlan = result.plan ? withTailoringSuggestions({ plan: result.plan, suggestions: generated, invalidOutputCodes: allRejectedReasons.includes("no_change_needed") ? ["no_change_needed"] : ["invalid_ai_output"] }) : undefined;
      setPlan(nextPlan);
      setSelected(new Set(nextPlan?.claims.filter((claim) => claim.decision !== "blocked").map((claim) => claim.id)));
      if (!generated.length && skipIds.size && rewriteInputs.length === 0) onMessage("AI 评估认为当前简历内容已与岗位匹配，无需改写。");
      else if (!generated.length && allRejectedReasons.length) onMessage(summarizeRejectionReasons(allRejectedReasons));
      else if (!generated.length) onMessage("AI 未能生成有效改写内容。");
    } catch (error) {
      if (controller.signal.aborted) {
        onMessage("已停止生成，已完成的建议会保留。");
        return;
      }
      onMessage(error instanceof Error ? `生成失败：${error.message}` : "AI 生成改写时出现异常，请稍后重试。");
    } finally { setPending(false); generationController.current = undefined; }
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
        <ResultList title="你的优势" items={(report?.coveredRequirementDescriptions ?? []).slice(0, 4).map((description) => `匹配能力：${description}`)} empty="暂未识别到可直接证明的岗位优势" />
        <ResultList title="主要缺口" items={(report?.uncoveredRequirementDescriptions ?? []).slice(0, 4).map((description) => `尚无直接证据：${description}`)} empty="暂未发现明显缺口" />
        <div className="info-box"><strong>推荐策略</strong><p>{strategyCopy(intensity)}</p></div>
        <button className="primary-button" type="button" disabled={pending || !canEdit} onClick={() => { void generatePlan(); }}><Sparkles size={16} />生成改写建议</button>
      </div> : null}

      {view === "suggestions" ? <div className="tailoring-page" data-testid="tailoring-suggestions">
        <div className="section-heading compact-heading"><div><h2>改写建议</h2><p>可直接采用的建议已选中，需要确认的内容集中在下一步处理。</p></div><button className="secondary-button compact" onClick={() => setSelected(new Set(claims.filter((claim) => claim.decision === "auto_applicable").map((claim) => claim.id)))}>采用全部可直接应用建议</button></div>
        {plannerAssessment ? <div className="info-box" style={{ marginBottom: "0.75rem" }}>
          <strong>AI 评估结果</strong>
          <p>{plannerAssessment.globalNotes ?? "已完成匹配分析。"}</p>
          <p style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "var(--color-text-secondary, #666)" }}>
            可改写 {plannerAssessment.rewrittenCount} 项，跳过 {plannerAssessment.skippedCount} 项。
          </p>
        </div> : null}
        {sectionGroups(claims).map(([section, items]) => <section key={section} className="tailoring-suggestion-group"><h3>{sectionLabel(section)}</h3>{items.map((claim) => { const suggestion = suggestionsById.get(claim.id); return <article key={claim.id} className="tailoring-suggestion-card">
          <div className="tailoring-suggestion-status"><span>{decisionLabel(claim)}</span><input type="checkbox" aria-label="采用建议" checked={selected.has(claim.id)} disabled={claim.decision === "blocked"} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(claim.id); else next.delete(claim.id); return next; })} /></div>
          <div><small>当前内容</small><p>{claim.currentText || "暂无"}</p></div><div><small>建议内容</small><p><FieldDiff before={claim.currentText} after={claim.proposedText} /></p></div>
          <div className="tailoring-suggestion-meta"><p><strong>为什么修改：</strong>{claim.reason}</p><p><strong>覆盖要求：</strong>{(claim.requirementIds ?? []).map((id) => requirementText(activeJob, id)).join("、") || "对应岗位要求"}</p><p><strong>新增关键词：</strong>{suggestion?.coveredKeywordsAfter.filter((keyword) => !suggestion.coveredKeywordsBefore.includes(keyword)).join("、") || "表达结构调整"}</p><p><strong>依据来源：</strong>{claim.evidenceRefs.length ? `${claim.evidenceRefs.length} 条已确认事实证据` : "当前岗位简历中的用户确认内容"}</p><p><strong>修改风险：</strong>{suggestion?.riskLevel === "low" ? "低" : suggestion?.riskLevel === "high" ? "高" : "中，需确认"}</p></div>
          {claim.keywords.length ? <div className="keyword-phrase">{claim.keywords.join("、")}</div> : null}
        </article>; })}</section>)}
        {pending ? <div className="info-box" aria-live="polite"><strong>{progress.step}/3 {progress.step === 1 ? "正在分析岗位要求" : progress.step === 2 ? "正在筛选需要改写的内容" : "正在生成并验证建议"}</strong><p>已完成 {progress.completed} 项　跳过 {progress.skipped} 项　失败 {progress.failed} 项</p><button className="secondary-button compact" type="button" onClick={() => generationController.current?.abort()}><Square size={14} aria-hidden="true" />停止生成</button></div> : null}
        {!claims.length && !pending ? <div className="info-box">当前内容已较匹配，无需修改。可返回上一步调整岗位描述后重试。</div> : null}
        <div className="action-row"><button className="secondary-button" onClick={() => { setPlan(undefined); setPlannerAssessment(undefined); setSelected(new Set()); setView("overview"); }}>弃用建议</button><button className="secondary-button" onClick={() => setView("overview")}><ChevronLeft size={16} />返回概览</button><button className="primary-button" onClick={() => setView("apply")}>确认并应用</button></div>
      </div> : null}

      {view === "apply" ? <div className="tailoring-page" data-testid="tailoring-apply">
        <h2>确认并应用</h2>
        <div className="tailoring-apply-summary"><span>将修改 <strong>{selectedClaims.length}</strong> 处</span><span>新增关键词 <strong>{keywordCount}</strong> 个</span><span>隐藏 <strong>{hiddenCount}</strong> 项</span><span>需确认 <strong>{confirmationCount}</strong> 项</span><span>预计岗位适配度 <strong>{plan?.estimatedFitScore ?? report?.overallCoverage ?? 0}</strong></span></div>
        {selectedClaims.filter((claim) => claim.decision === "requires_confirmation").length ? <section className="tailoring-confirmations"><h3>待确认能力与表达</h3>{selectedClaims.filter((claim) => claim.decision === "requires_confirmation").map((claim) => <article key={claim.id} className="tailoring-confirmation-card"><strong>{claim.proposedText.length > 50 ? `${claim.proposedText.slice(0, 50)}...` : claim.proposedText}</strong><p>你的资料中没有直接记录这项表述，请选择最符合真实情况的描述。默认仅用于当前岗位简历。</p><div className="chip-row">{([['proficient','熟练使用'],['familiar','熟悉基础'],['aware','了解'],['learning','正在学习']] as const).map(([value, label]) => <button type="button" key={value} className={confirmations[claim.id]?.proficiency === value ? "secondary-button compact property-tab-active" : "secondary-button compact"} onClick={() => updateConfirmation(claim, value)}>{label}</button>)}<button type="button" className="secondary-button compact" onClick={() => updateConfirmation(claim, undefined, false)}>不添加</button></div><small>保存范围：仅用于当前岗位简历</small></article>)}</section> : null}
        <div className="info-box"><strong>导出前检查</strong><p><Check size={14} /> 通过 / 有建议 / 需要处理将在保存后显示；它不会改变事实。</p></div>
        <button className="primary-button" type="button" disabled={pending || !canEdit} onClick={() => { void applySelected(); }}>应用选择并保存新版本</button>
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
function summarizeRejectionReasons(reasons: string[]): string {
  const unique = [...new Set(reasons)];
  if (!unique.length) return "AI 未能生成有效改写内容。建议检查岗位描述是否包含具体技能或职责描述。";
  const httpErrors = unique.filter((r) => r.startsWith("provider_http_"));
  if (httpErrors.length) {
    const codes = httpErrors.map((r) => r.replace("provider_http_", ""));
    const descriptions: Record<string, string> = {
      "401": "API Key 无效或已过期，请在设置中检查 AI API Key。",
      "403": "API Key 无权限访问该模型，请检查模型名称和 API Key 是否匹配。",
      "429": "AI 服务请求过于频繁，请稍后再试。",
      "500": "AI 服务端内部错误，请稍后再试。",
      "502": "AI 服务网关错误，请检查 AI 服务地址配置是否正确。",
      "503": "AI 服务暂时不可用，请稍后再试。"
    };
    const msg = codes.map((c) => descriptions[c] ?? `AI 服务返回 HTTP ${c} 错误。`).join(" ");
    return msg;
  }
  const aiErrors: string[] = [];
  if (unique.includes("missing_ai_config")) aiErrors.push("AI 服务未配置（缺少 API Key 或模型名称），请在设置中完成 AI 配置。");
  if (unique.includes("provider_failed") || unique.includes("empty_model_output")) aiErrors.push("AI 服务调用失败或返回空内容，请检查网络连接和 AI 配置后重试。");
  if (unique.some((r) => r.includes("invalid_json")) || unique.includes("client_schema_validation_failed")) aiErrors.push("AI 返回了无法解析的内容，请重试；若反复出现请检查 AI 模型设置。");
  if (unique.includes("empty_suggestions")) aiErrors.push("AI 未返回任何改写建议，请重试。");
  const semanticFails = unique.filter((r) => r.startsWith("semantic_validation_failed:"));
  if (semanticFails.length) {
    const semanticReasons: Record<string, string> = {
      "resume_tailor_no_op": "AI 改写结果与原文相同，未产生有效变化。",
      "resume_tailor_section_out_of_scope": "AI 返回了不属于当前简历片段的改写内容。",
      "resume_tailor_requirement_out_of_scope": "AI 引用了不属于当前任务的岗位要求。",
      "resume_tailor_evidence_ref_out_of_scope": "AI 引用了不在允许范围内的证据来源。",
      "invalid_ai_output": "AI 返回了空的改写建议。"
    };
    for (const fail of semanticFails) {
      const reason = fail.split(":")[1] ?? "";
      aiErrors.push(semanticReasons[reason] ?? `AI 改写未通过业务校验（${reason}）。`);
    }
  }
  if (aiErrors.length) return aiErrors.join(" ");
  const messages: string[] = [];
  if (unique.includes("copied_original") || unique.includes("insufficient_text_delta")) messages.push("改写内容与原文差异过小");
  if (unique.includes("no_keyword_or_structure_gain")) messages.push("未覆盖新的岗位关键词");
  if (unique.includes("generic_target_keywords")) messages.push("岗位描述中的关键词过于泛化（如仅包含「AI」等通用词），建议补充具体技术栈或职责描述");
  if (unique.includes("missing_after")) messages.push("AI 返回了空内容");
  if (unique.includes("irrelevant_rationale") || unique.includes("generic_rationale") || unique.includes("rationale_copies_requirement")) messages.push("AI 生成的修改理由不充分");
  if (unique.includes("conservative_delta_too_large")) messages.push("保守模式下改写幅度过大");
  if (!messages.length) messages.push("AI 改写未通过校验");
  return `改写建议未通过校验：${messages.join("；")}（${unique.join(", ")}）。请调整岗位描述后重试。`;
}
function FieldDiff({ before, after }: { before: string; after: string }) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  const end = suffix ? after.length - suffix : after.length;
  return <>{after.slice(0, prefix)}<mark>{after.slice(prefix, end)}</mark>{after.slice(end)}</>;
}
