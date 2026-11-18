"use client";

import { liveQuery } from "dexie";
import Link from "next/link";
import { useEffect, useState } from "react";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { isSelectedProfileImpactCurrent, type SelectedProfileImpact } from "@/services/agent/selectedProfileImpact";
import type { AgentArtifactAction } from "@/agent/contracts/agentActions";
import { ProfileImpactProposalSchema } from "@/agent/contracts/profileImpactProposal";
import { tailoringDiffId } from "@/services/jobs/tailoringDiffId";
import { TailoringDiffRecord } from "./artifacts/AgentArtifactContent";
import type { ResumeBranch } from "@/domain/schemas";

const repository = new WorkspaceRepository();

export function ProfileImpactReport({ report, proposal: rawProposal, onArtifactAction }: { report: SelectedProfileImpact;
  proposal?: unknown; onArtifactAction?(action: AgentArtifactAction): Promise<unknown> | void }) {
  const [validity, setValidity] = useState<{ report: SelectedProfileImpact; value: "checking" | "current" | "stale" }>({ report, value: "checking" });
  const [branches, setBranches] = useState<ResumeBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<Record<string, string>>({});
  const [selectedItem, setSelectedItem] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [editingItem, setEditingItem] = useState(false);
  const [itemText, setItemText] = useState("");
  const proposal = ProfileImpactProposalSchema.safeParse(rawProposal);
  useEffect(() => {
    const subscription = liveQuery(() => isSelectedProfileImpactCurrent(repository, report)).subscribe({
      next: current => setValidity({ report, value: current ? "current" : "stale" }),
      error: () => setValidity({ report, value: "stale" })
    });
    return () => subscription.unsubscribe();
  }, [report]);
  useEffect(() => {
    let active = true;
    void repository.listAvailableResumesForCareerProfile(report.binding.profileId).then(rows => {
      if (active) setBranches(rows.map(row => row.branch).filter(branch => branch.branchPurpose === "job_specific" && branch.profileId === report.binding.profileId));
    });
    return () => { active = false; };
  }, [report]);
  async function act(action: AgentArtifactAction) {
    setBusy(true);
    setError(undefined);
    try { await onArtifactAction?.(action); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作未完成，请重新核对后重试。"); }
    finally { setBusy(false); }
  }
  if (validity.report !== report || validity.value === "checking") return <p role="status">正在核对资料和岗位是否仍为最新版本…</p>;
  if (validity.value === "stale") return <p role="alert">资料或岗位已变化，报告已过期。请重新选择岗位并分析。</p>;
  return <section className="agent-artifact profile-impact-report" aria-label="经历与岗位影响报告">
    {error ? <p role="alert">{error}</p> : null}
    <h3>本次确认的资料变化</h3>
    {report.changes.length ? report.changes.map(item => <article key={item.id}>
      <strong>{item.title}</strong>{item.subtitle ? <p>{item.subtitle}</p> : null}<p>{item.body}</p>
    </article>) : <p>本次没有可单独展示的已确认经历变化。</p>}
    <p>以下为当前证据关联；没有可靠历史基线时，不推断匹配度变化。</p>
    {report.jobs.map(job => <article key={job.jobId}>
      <h3>{job.title}</h3>
      {job.status === "NOT_ANALYZED" ? <p>岗位需求尚未完成有效解析，暂时无法分析。</p> : job.rows.map(row => <section key={row.requirementId}>
        <h4>{row.requirement}</h4><p>{row.explanation}</p>
        {row.flags.includes("NEW_EVIDENCE_RELEVANT") ? <p>{row.flags.includes("REVIEW_REQUIRED")
          ? "本次确认的经历可能与这项要求相关，请先核对。"
          : "建议：针对这项岗位要求，核对并考虑在岗位简历中突出下方已确认的相关经历。"}</p> : null}
        {row.flags.includes("REMAINING_GAP") ? <p>仍需补充证据：{row.missingAspects.join("；") || "目前证据尚不充分"}</p> : null}
        {row.flags.includes("REVIEW_REQUIRED") ? <p>这项关联需要进一步核对。</p> : null}
        {row.evidence.map((item, index) => <div key={`${row.requirementId}-${index}`}><p>证据：{item.text}</p>
          {item.sources.map((source, sourceIndex) => <p key={sourceIndex}>来源：{source.excerpt}</p>)}
        </div>)}
      </section>)}
      {job.status === "ANALYZED" && branches.some(branch => branch.jobId === job.jobId) ? <div>
        <h4>将已确认经历加入已有岗位简历</h4>
        <label>岗位简历 <select value={selectedBranch[job.jobId] ?? ""} onChange={event => setSelectedBranch(current => ({ ...current, [job.jobId]: event.target.value }))}>
          <option value="">请选择岗位简历</option>
          {branches.filter(branch => branch.jobId === job.jobId).map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select></label>
        <label>资料变化 <select value={selectedItem[job.jobId] ?? ""} onChange={event => setSelectedItem(current => ({ ...current, [job.jobId]: event.target.value }))}>
          <option value="">请选择经历</option>{report.changes.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>
        <button type="button" disabled={busy || !selectedBranch[job.jobId] || !selectedItem[job.jobId]}
          onClick={() => void act({ type: "profile_impact_prepare", jobId: job.jobId, branchId: selectedBranch[job.jobId], itemId: selectedItem[job.jobId] })}>核对加入建议</button>
      </div> : null}
      {proposal.success && proposal.data.jobId === job.jobId && proposal.data.status === "pending" ? <section aria-label="核对经历加入建议">
        <h4>核对经历加入建议</h4><p>原内容：该简历尚未包含此经历。</p><p>建议加入：{proposal.data.title} · {proposal.data.body}</p>
        <p>岗位要求：{proposal.data.requirement}</p><p>来源：已确认个人资料；将按事实核验后写入新版本。</p>
        <p>事实核验：提交时将重新核对来源、事实和版本。</p>
        {proposal.data.addDecision === "edit" ? <p>编辑后描述：{proposal.data.editedItemText}</p> : null}
        <div className="agent-diff-actions">
          <button type="button" disabled={busy} aria-pressed={proposal.data.addDecision === "accept"}
            onClick={() => void act({ type: "profile_impact_decide", proposalId: proposal.data.id, decision: "include_item" })}>采用经历</button>
          {proposal.data.editableDescription ? <button type="button" disabled={busy} aria-pressed={proposal.data.addDecision === "edit"}
            onClick={() => { setItemText(proposal.data.editedItemText ?? proposal.data.editableDescription ?? ""); setEditingItem(true); }}>编辑后采用经历</button> : null}
          <button type="button" disabled={busy} aria-pressed={proposal.data.addDecision === "reject"}
            onClick={() => void act({ type: "profile_impact_decide", proposalId: proposal.data.id, decision: "exclude_item" })}>忽略经历</button>
        </div>
        {editingItem ? <form onSubmit={event => { event.preventDefault(); if (!itemText.trim()) return;
          void act({ type: "profile_impact_decide", proposalId: proposal.data.id, decision: "edit_item", editedValue: itemText.trim() }); setEditingItem(false); }}>
          <label>编辑经历描述<textarea value={itemText} onChange={event => setItemText(event.target.value)} /></label>
          <button type="submit" disabled={busy || !itemText.trim()}>采用编辑后的经历</button>
          <button type="button" onClick={() => setEditingItem(false)}>取消编辑</button>
        </form> : null}
        <p>使用现有已确认资料生成建议；缺少依据的要求仍需另行补充。</p>
        <button type="button" disabled={busy} onClick={() => void act({ type: "profile_impact_decide", proposalId: proposal.data.id, decision: "generate" })}>生成岗位修改建议</button>
        {proposal.data.generationStatus === "empty" ? <p role="status">现有简历没有生成可安全采用的字段修改；你仍可审核这段已确认经历。</p> : null}
        {proposal.data.diffs.map(diff => {
          const diffId = tailoringDiffId(diff);
          const review = proposal.data.reviews.find(item => item.diffId === diffId);
          return <TailoringDiffRecord key={diffId} diff={diff} diffId={diffId} session={{ job: { requirements: job.rows.map(row => ({ id: row.requirementId, description: row.requirement })) } }} review={{ ...review,
            status: review?.decision === "accept" ? "accepted" : review?.decision === "edit" ? "edited" : review?.decision === "reject" ? "rejected" : "suggested" }}
            onDecision={async (decision, editedValue) => { await act({ type: "profile_impact_decide", proposalId: proposal.data.id,
              decision, diffId, ...(editedValue ? { editedValue } : {}) }); }} />;
        })}
        <button type="button" disabled={busy || proposal.data.addDecision === "pending"
          || (proposal.data.addDecision === "reject" && proposal.data.reviews.every(review => review.decision === "reject"))
          || proposal.data.diffs.some(diff => !proposal.data.reviews.some(review => review.diffId === tailoringDiffId(diff)))}
          onClick={() => void act({ type: "profile_impact_decide", proposalId: proposal.data.id, decision: "confirm" })}>应用已选修改</button>
        <button type="button" disabled={busy} onClick={() => void act({ type: "profile_impact_decide", proposalId: proposal.data.id, decision: "ignore" })}>忽略</button>
      </section> : null}
      {proposal.success && proposal.data.jobId === job.jobId && proposal.data.status === "applied" ? <p>已保存新版本，原版本仍保留。</p> : null}
      {job.status === "ANALYZED" ? <Link href={`/jobs?jobId=${encodeURIComponent(job.jobId)}`}>前往此岗位的简历工作区</Link> : null}
    </article>)}
    <p>可回到对话补充材料，或明确选择一个岗位继续讨论简历修改；当前分析不会修改简历。</p>
  </section>;
}
