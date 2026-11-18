"use client";

import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import type { AgentArtifactAction } from "@/agent/contracts/agentActions";
import type { JobDescription } from "@/domain/schemas";
import type { WorkspaceRepository } from "@/services/storage/repositories";

export function ProfileImpactSelector({ repository, operationId, initialSelection, pendingInteraction, onAnalyze }: {
  repository: WorkspaceRepository;
  operationId: string;
  initialSelection: string[];
  pendingInteraction?: unknown;
  onAnalyze(action: AgentArtifactAction): Promise<unknown>;
}) {
  const [jobs, setJobs] = useState<JobDescription[]>([]);
  const [selected, setSelected] = useState<string[]>(initialSelection);
  const [selectionEdited, setSelectionEdited] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pending = pendingInteraction && typeof pendingInteraction === "object" ? pendingInteraction as {
    kind?: string; prompt?: string; candidates?: Array<{ id: string; title: string; company: string | null; order: number; updatedAt: string }> } : undefined;
  const candidatesCurrent = pending?.candidates?.every(candidate => jobs.some(job => job.id === candidate.id
    && job.title === candidate.title && job.company === candidate.company && job.updatedAt === candidate.updatedAt));
  useEffect(() => {
    const subscription = liveQuery(() => repository.listAvailableJobDescriptions()).subscribe({
      next: value => { setJobs(value); setError(undefined); },
      error: () => setError("无法读取岗位列表，请稍后重试。")
    });
    return () => subscription.unsubscribe();
  }, [repository]);
  async function analyze() {
    setBusy(true);
    setError(undefined);
    try { await onAnalyze({ type: "profile_impact_analyze", operationId, jobIds: selected }); }
    catch { setError("分析未完成，资料或岗位可能已变化，请重新核对后再试。"); }
    finally { setBusy(false); }
  }
  return <section aria-label="选择要分析的岗位" className="agent-artifact profile-impact-selector">
    <strong>选择要分析的岗位</strong>
    {pending?.kind === "clarify_jobs" && Array.isArray(pending.candidates) && candidatesCurrent ? <div role="status">
      <p>{pending.prompt}</p><ol>{pending.candidates.map(candidate => <li key={candidate.id}>
        {candidate.company ? `${candidate.company} · ` : ""}{candidate.title}
      </li>)}</ol><p>请回复编号，或在下方勾选并确认。</p>
    </div> : null}
    {pending?.candidates?.length && jobs.length && !candidatesCurrent ? <p role="alert">岗位候选已变化，请重新选择。</p> : null}
    {initialSelection.length ? <p>已根据你的描述预选岗位，请核对后确认。</p> : null}
    <p>请勾选希望比较的岗位。岗位是工作区共享的，只会分析你本次选择的岗位。</p>
    {jobs.length ? <fieldset disabled={busy}><legend>岗位</legend>{jobs.map(job => <label key={job.id} data-selected={selected.includes(job.id) || undefined}>
      <input type="checkbox" checked={selected.includes(job.id)} onChange={event => { setSelectionEdited(true); setSelected(current => event.target.checked
        ? [...current, job.id] : current.filter(id => id !== job.id)); }} /> <span className="profile-impact-selector-job"><span>{job.title}</span>{job.company ? <span className="profile-impact-selector-company"> · {job.company}</span> : null}</span>
    </label>)}</fieldset> : <p>暂无可选岗位。请先保存或解析岗位。</p>}
    {error ? <p role="alert">{error}</p> : null}
    <button className="primary-button" type="button" disabled={busy || selected.length === 0 || selected.length > 30
      || Boolean(pending?.candidates?.length && jobs.length && !candidatesCurrent && !selectionEdited)} onClick={() => void analyze()}>
      {busy ? "正在分析…" : "分析所选岗位"}
    </button>
  </section>;
}
