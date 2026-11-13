"use client";
import { useEffect, useState } from "react";
import type { AgentSession } from "@/agent/contracts/agentSession";
import type { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import type { CareerProfile, ResumeBranch } from "@/domain/schemas";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { resolveCareerAgentContext } from "@/agent/runtime/careerContextBindingResolver";
import { StructuredProposalSchema, confirmedSkill, skillIdentity, type StructuredSelection } from "@/domain/resumeEditing/structuredResumeOperation";
import { PreciseRevisionEvidence } from "./PreciseRevisionEvidence";

const repository = new WorkspaceRepository();
type Target = { key: string; label: string; original: string; disabled: boolean; target: Omit<StructuredSelection, "sessionId" | "taskId" | "profileId"> };
const labels = { fact_correction: "事实字段更正", confirmed_skill_addition: "已确认技能新增", bullet_removal: "删除一条要点", bullet_reordering: "调整要点顺序" };
const fields = { title: "项目名称", role: "岗位名称", organization: "组织名称", startDate: "开始日期", endDate: "结束日期" };
export function StructuredResumeEditor({ session, host }: { session: AgentSession; host: AgentHostStore }) {
  const [branches, setBranches] = useState<ResumeBranch[]>([]), [profile, setProfile] = useState<CareerProfile>();
  const [branchId, setBranchId] = useState(""), [operation, setOperation] = useState<StructuredSelection["operation"]>("fact_correction");
  const [targetKey, setTargetKey] = useState(""), [value, setValue] = useState(""), [permutation, setPermutation] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [editing, setEditing] = useState(false);
  const slot = session.taskState?.knownSlots.preciseResumeEdit as { selection?: StructuredSelection; proposal?: unknown; outcome?: { revisionId: string }; decision?: string } | undefined;
  const parsed = StructuredProposalSchema.safeParse(slot?.proposal), proposal = parsed.success ? parsed.data : undefined;
  const proposalHash = proposal?.proposalHash;
  const branch = branches.find(b => b.id === branchId);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const canonical = session.taskState ? await resolveCareerAgentContext(session, repository) : undefined;
      const profileId = session.taskState ? canonical?.profileId : session.activeProfileId;
      const [values, p] = profileId ? await Promise.all([repository.listAvailableResumeBranches(profileId), repository.getAvailableProfile(profileId)]) : [[], undefined];
      if (active) { setBranches(values.filter(branch => !!branch.currentRevisionId)); setProfile(p); }
    };
    void load().catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [session]);
  useEffect(() => {
    if (!proposalHash || session.pendingConfirmation?.status !== "confirmed") return;
    let active = true;
    host.resolvePreciseResumeEdit(session.id, "recover").catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [host, session.id, session.pendingConfirmation?.status, proposalHash]);
  const targets: Target[] = !branch ? [] : operation === "confirmed_skill_addition" ? (profile?.skills ?? []).flatMap(skill => {
    // Only the known unconfirmed/learning cases are excluded. Unexpected canonical/source failures remain visible on selection.
    if (!skill.fact?.confirmedByUser || skill.fact.riskLevel === "high" || skill.fact.category !== "skill"
      || skill.fact.maturity === "learning" || skill.fact.maturity === "familiar") return [];
    const exists = branch.structuredContentItems?.some(i => i.data.sectionType === "skills" && skillIdentity(i.data.name) === skillIdentity(skill.name));
    return [{ key: skill.id, label: `${skill.name}${exists ? "（已存在）" : "（Profile 已确认）"}`, original: "新增到技能部分末尾", disabled: !!exists,
      target: { branchId, baseRevisionId: branch.currentRevisionId!, sectionType: "skills" as const, itemId: skill.id, field: "name" as const, bulletIndex: null, operation } }];
  }) : (branch.structuredContentItems ?? []).flatMap<Target>(item => {
    const d = item.data;
    if (d.sectionType !== "project" && d.sectionType !== "work" && d.sectionType !== "internship") return [];
    const title = d.sectionType === "project" ? d.title : d.organization;
    const base = { branchId, baseRevisionId: branch.currentRevisionId!, sectionType: d.sectionType, itemId: item.id, operation };
    if (operation === "fact_correction") return Object.entries(fields).flatMap(([field, label]) => {
      if (field === "title" && d.sectionType !== "project") return [];
      const original = (d as unknown as Record<string, unknown>)[field];
      return typeof original === "string" && original.trim() ? [{ key: `${item.id}:${field}`, label: `${title} · ${label}`, original, disabled: false,
        target: { ...base, field: field as keyof typeof fields, bulletIndex: null } }] : [];
    });
    if (operation === "bullet_reordering") return d.highlights.length > 1 ? [{ key: item.id, label: `${title} · 全部要点`, original: d.highlights.map((t, i) => `${i + 1}. ${t}`).join("\n"), disabled: false,
      target: { ...base, field: "highlights" as const, bulletIndex: null } }] : [];
    return d.highlights.map((text, index) => ({ key: `${item.id}:${index}`, label: `${title} · 要点 ${index + 1}`, original: text, disabled: false,
      target: { ...base, field: "highlights" as const, bulletIndex: index } }));
  });
  const target = targets.find(t => t.key === targetKey);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function propose() {
    if (!target || !branch) return;
    if (operation === "confirmed_skill_addition" && profile) confirmedSkill(profile, target.target.itemId);
    await host.selectPreciseResumeEdit(target.target);
    if (operation === "fact_correction") await host.proposePreciseFactCorrection(value);
    else await host.proposePreciseResumeEdit(operation === "bullet_reordering"
      ? { operation, permutation: permutation.split(/[,，\s]+/u).filter(Boolean).map(v => Number(v) - 1) } : { operation });
    setEditing(false);
  }
  const failure = session.taskState?.knownSlots.preciseResumeEditFailure as { code?: string } | undefined;
  const op = proposal?.operation;
  return <details className="agent-confirmation is-inline agent-precise-editor" data-testid="structured-resume-editor">
    <summary>结构化修改简历</summary>
    {!proposal || editing ? <>
      <p>每次只处理一项；先选择目标，审核后确认保存。</p>
      <label>简历<select aria-label="结构化修改简历" value={branchId} onChange={e => { setBranchId(e.target.value); setTargetKey(""); }}>
        <option value="">请选择简历</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name} · {b.branchPurpose === "general" ? "通用" : "岗位"}</option>)}
      </select></label>
      <label>操作<select aria-label="结构化操作" value={operation} onChange={e => { setOperation(e.target.value as typeof operation); setTargetKey(""); }}>
        {Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>目标<select aria-label="结构化修改目标" value={targetKey} onChange={e => setTargetKey(e.target.value)}>
        <option value="">请选择明确目标</option>{targets.map(t => <option key={t.key} value={t.key} disabled={t.disabled}>{t.label}</option>)}
      </select></label>
      {target ? <p style={{ whiteSpace: "pre-wrap" }}>原始内容：{target.original}</p> : null}
      {operation === "fact_correction" ? <><label>我的纠正内容<input aria-label="我的纠正内容" maxLength={200} value={value} onChange={e => setValue(e.target.value)} /></label>
        <p>此输入作为你的原始纠正声明保存，仅用于当前简历；确认不代表外部真实性已获独立核验。</p></> : null}
      {operation === "bullet_reordering" ? <label>新顺序（填写全部原序号，例如 3,1,2）<input aria-label="要点新顺序" value={permutation} onChange={e => setPermutation(e.target.value)} /></label> : null}
      <button type="button" disabled={busy || !!session.pendingConfirmation || !target || operation === "fact_correction" && !value.trim()}
        onClick={() => void run(propose)}>生成结构化审核提案</button>
      <button type="button" disabled={busy || !!session.pendingConfirmation || !target || operation === "fact_correction" && !value.trim()}
        onClick={() => void run(() => operation === "fact_correction" ? host.selectPreciseFactCorrection(target!.target, value) : host.selectPreciseResumeEdit(target!.target))}>选择目标，交给 AI</button>
      {slot?.selection?.operation === operation && !slot?.proposal ? <p role="status">目标已选择；可在对话中提出操作要求，AI 提案仍需逐项审核确认。</p> : null}
    </> : null}
    {proposal && !editing ? <section aria-label="结构化修改审核">
      <p>{labels[proposal.selection.operation]} · {branches.find(b => b.id === proposal.selection.branchId)?.name ?? proposal.selection.branchId}（{proposal.branchPurpose === "general" ? "通用" : "岗位"}）</p>
      <p>基准版本：{proposal.selection.baseRevisionId}</p>
      {op?.type === "fact_correction" ? <><p>原值：{proposal.originalValue}</p><p>新值：{op.value}</p><p>来源：用户原始纠正声明；未经独立核验，不是 Profile 已确认事实。</p>
        <p>更正类型：{op.correctionKind === "date_normalization" ? "同精度日期格式规范化" : "用户明确声明的事实更正"}</p><p>原始声明：{op.factProposal.source.content}</p></> : null}
      {op?.type === "confirmed_skill_addition" ? <><p>新增技能：{(op.data as { name: string }).name} · 来自当前 Profile 已确认事实</p><p>去重检查：不存在；新增到技能部分末尾，已有技能保持原样。</p></> : null}
      {op?.type === "bullet_removal" ? <><p>删除第 {op.index + 1} 条：{(proposal.originalValue as string[])[op.index]}</p><p>只删除此元素；其他要点文字与相对顺序保持不变。</p></> : null}
      {op?.type === "bullet_reordering" ? <><p>只调整顺序，每条文字保持原样（括号为原序号）。</p><p>原顺序</p><ol>{(proposal.originalValue as string[]).map((t, i) => <li key={i}>（{i + 1}）{t}</li>)}</ol>
        <p>新顺序</p><ol>{op.permutation.map(i => <li key={i}>（{i + 1}）{(proposal.originalValue as string[])[i]}</li>)}</ol></> : null}
      <details><summary>来源与核验状态</summary>{proposal.evidenceRefs.map((ref, i) => <p key={i}>原条目依据：{ref.factQuote}</p>)}
        {op?.type === "fact_correction" ? <p>纠正来源：{op.factProposal.source.id}；消息：{op.factProposal.source.messageId}；Turn：{op.factProposal.source.turnId}；SHA-256：{op.factProposal.source.contentHash}</p> : null}
      </details>
      {slot?.outcome ? <><p role="status">已保存版本：{slot.outcome.revisionId}</p><PreciseRevisionEvidence revisionId={slot.outcome.revisionId} /></> : slot?.decision ? <p>此提案已取消或拒绝，未写入。</p> : <div className="agent-confirmation-actions">
        <button disabled={busy} onClick={() => void run(() => host.resolvePreciseResumeEdit(session.id, "confirm"))}>{session.pendingConfirmation?.status === "confirmed" ? "重试原结构化提案" : "确认结构化修改"}</button>
        <button disabled={busy || session.pendingConfirmation?.status === "confirmed"} onClick={() => void run(() => host.resolvePreciseResumeEdit(session.id, "reject"))}>拒绝</button>
        <button disabled={busy || session.pendingConfirmation?.status === "confirmed" && session.taskState?.completionStatus !== "failed"} onClick={() => void run(() => host.resolvePreciseResumeEdit(session.id, "cancel"))}>取消</button>
      </div>}
      {slot?.outcome || slot?.decision ? <button onClick={() => { setEditing(true); setTargetKey(""); }}>开始另一项结构化操作</button> : null}
    </section> : null}
    {error || failure?.code ? <p role="alert" data-error-code={error || failure?.code}>操作未保存，请核对版本、来源和目标后重试。{error || failure?.code}</p> : null}
  </details>;
}
