"use client";
import { useEffect, useState } from "react";
import type { AgentSession } from "@/agent/contracts/agentSession";
import type { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { WorkspaceRepository } from "@/services/storage/repositories";
import type { ResumeBranch } from "@/domain/schemas";
import { PreciseProposalSchema, type PreciseSelection } from "@/domain/resumeEditing/preciseResumeEdit";
import { StructuredResumeEditor } from "./StructuredResumeEditor";

const repository = new WorkspaceRepository();
export function PreciseResumeEditor({ session, host, profileName }: { session: AgentSession; host: AgentHostStore; profileName?: string }) {
  const [branches, setBranches] = useState<ResumeBranch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [wording, setWording] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const slot = session.taskState?.knownSlots.preciseResumeEdit as { selection?: PreciseSelection; proposal?: unknown; outcome?: { revisionId: string }; decision?: string } | undefined;
  const parsed = PreciseProposalSchema.safeParse(slot?.proposal);
  const proposal = parsed.success ? parsed.data : undefined;
  const branch = branches.find(b => b.id === branchId);
  const targets = (branch?.structuredContentItems ?? []).flatMap(item => {
    if (item.data.sectionType !== "project" && item.data.sectionType !== "work" && item.data.sectionType !== "internship") return [];
    const sectionType = item.data.sectionType;
    const title = sectionType === "project" ? item.data.title : item.data.organization;
    const base = { branchId: branch!.id, baseRevisionId: branch!.currentRevisionId!, sectionType, itemId: item.id };
    return [
      ...(typeof item.data.description === "string" && item.data.description.trim() ? [{ key: `${item.id}:description`, label: `${title} · 描述`, value: item.data.description,
        target: { ...base, field: "description" as const, bulletIndex: null } }] : []),
      ...item.data.highlights.flatMap((value, index) => value.trim() ? [{ key: `${item.id}:highlights:${index}`, label: `${title} · 要点 ${index + 1}`, value,
        target: { ...base, field: "highlights" as const, bulletIndex: index } }] : [])
    ];
  });
  const target = targets.find(t => t.key === targetKey);
  const selectedBranch = branches.find(b => b.id === slot?.selection?.branchId);
  const selectedItem = selectedBranch?.structuredContentItems?.find(i => i.id === slot?.selection?.itemId);
  const selectedTitle = selectedItem?.data.sectionType === "project" ? selectedItem.data.title
    : selectedItem?.data.sectionType === "work" || selectedItem?.data.sectionType === "internship" ? selectedItem.data.organization : "所选条目";
  useEffect(() => {
    let active = true;
    repository.listResumeBranches().then(values => { if (active) setBranches(values.filter(b => b.profileId === session.activeProfileId && b.lifecycleStatus === "active" && !!b.currentRevisionId)); })
      .catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [session.id, session.activeProfileId, slot?.outcome?.revisionId]);
  useEffect(() => {
    if (session.pendingConfirmation?.toolName !== "career.workflow.precise_edit" || session.pendingConfirmation.status !== "confirmed") return;
    let active = true;
    host.resolvePreciseResumeEdit(session.id, "recover").catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [host, session.id, session.pendingConfirmation?.status, session.pendingConfirmation?.toolName]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const failure = session.taskState?.knownSlots.preciseResumeEditFailure as { code?: string } | undefined;
  const issue = error || failure?.code || "";
  const issueText = /stale|conflict/.test(issue) ? "原版本已变化，请弃用此提案，重新选择当前版本并审核。"
    : /guard|safety|evidence/.test(issue) ? "这项修改需要核对事实或来源，尚未保存。请保留原事实后调整措辞。"
    : /mismatch|hash/.test(issue) ? "提案与确认记录不一致，已停止操作。请重新选择字段并审核。"
    : issue ? "操作未完成，原文与提案已保留。请核对当前选择后重试。" : "";
  return <><details hidden={!!slot?.selection && "operation" in slot.selection} className="agent-confirmation is-inline agent-precise-editor" data-testid="precise-resume-editor">
    <summary>精确修改一个字段</summary>
    <p>明确选择简历和字段后，可在对话中要求 AI 润色，或输入建议措辞供审核。</p>
    {!proposal ? <><label>简历<select aria-label="精确修改简历" value={branchId} onChange={e => { setBranchId(e.target.value); setTargetKey(""); }}>
      <option value="">请选择简历</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name} · {b.branchPurpose === "general" ? "通用" : "岗位"}</option>)}
    </select></label>
    <label>字段<select aria-label="精确修改字段" value={targetKey} onChange={e => setTargetKey(e.target.value)}>
      <option value="">请选择条目与字段</option>{targets.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
    </select></label></> : null}
    {target && !proposal ? <><p>原文：{target.value}</p><button type="button" disabled={busy || !!session.pendingConfirmation} onClick={() => void run(() => host.selectPreciseResumeEdit(target.target))}>选择此字段</button></> : null}
    {slot?.selection ? <p>已选：{selectedBranch?.name ?? "所选简历"} · {selectedTitle} · {slot.selection.field === "description" ? "描述" : `要点 ${(slot.selection.bulletIndex ?? 0) + 1}`}</p> : null}
    {slot?.selection && !proposal ? <><label>建议措辞<textarea aria-label="建议措辞" value={wording} onChange={e => setWording(e.target.value)} /></label>
      <button type="button" disabled={busy || !wording.trim()} onClick={() => void run(() => host.proposePreciseResumeEdit(wording))}>生成审核提案</button></> : null}
    {proposal ? <section aria-label="精确修改审核">
      <p>资料：{profileName ?? proposal.selection.profileId}；简历：{branches.find(b => b.id === proposal.selection.branchId)?.name ?? proposal.selection.branchId}（{proposal.branchPurpose === "general" ? "通用" : "岗位"}）</p>
      <p>基于版本：{proposal.selection.baseRevisionId}</p>
      <p>原文：{proposal.originalValue}</p><p>建议：{proposal.proposedValue}</p>
      <p>分类：基于已确认事实的措辞调整</p>
      <details><summary>查看来源依据（{proposal.evidenceRefs.length}）</summary><ul>{proposal.evidenceRefs.map((ref, i) => <li key={i}>{ref.factQuote}（{"factId" in ref ? ref.factId : ref.linkedFactId}）</li>)}</ul></details>
      {slot?.outcome ? <p role="status">已保存版本：{slot.outcome.revisionId}</p> : slot?.decision ? <p>此提案已{slot.decision === "reject" ? "拒绝" : "取消"}，未写入。</p> : <div className="agent-confirmation-actions">
        <button type="button" disabled={busy} onClick={() => void run(() => host.resolvePreciseResumeEdit(session.id, "confirm"))}>{session.pendingConfirmation?.status === "confirmed" ? "重试原提案" : "确认修改"}</button>
        <button type="button" disabled={busy || session.pendingConfirmation?.status === "confirmed"} onClick={() => void run(() => host.resolvePreciseResumeEdit(session.id, "reject"))}>拒绝</button>
        <button type="button" disabled={busy || session.pendingConfirmation?.status === "confirmed" && session.taskState?.completionStatus !== "failed"} onClick={() => void run(() => host.resolvePreciseResumeEdit(session.id, "cancel"))}>取消</button>
      </div>}
    </section> : null}
    {issueText ? <p role="alert" data-error-code={issue}>{issueText}</p> : null}
  </details><StructuredResumeEditor session={session} host={host} /></>;
}
