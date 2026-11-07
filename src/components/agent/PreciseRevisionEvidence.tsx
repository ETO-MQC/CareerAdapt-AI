"use client";
import { useEffect, useState } from "react";
import { WorkspaceRepository } from "@/services/storage/repositories";
const repository = new WorkspaceRepository();
export function PreciseRevisionHistoryEvidence({ revisions }: { revisions: Array<{ id: string; revisionNumber: number }> }) {
  const [selected, setSelected] = useState("");
  return <details><summary>查询版本操作来源</summary><label>历史版本来源<select aria-label="历史版本来源" value={selected} onChange={e => setSelected(e.target.value)}>
    <option value="">请选择版本</option>{revisions.map(r => <option key={r.id} value={r.id}>版本 {r.revisionNumber + 1}</option>)}
  </select></label>{selected ? <PreciseRevisionEvidence revisionId={selected} /> : null}</details>;
}
export function PreciseRevisionEvidence({ revisionId }: { revisionId?: string }) {
  const [result, setResult] = useState<{ revisionId?: string; audit?: Awaited<ReturnType<WorkspaceRepository["getPreciseResumeRevisionAudit"]>>; error?: string }>({});
  const audit = result.revisionId === revisionId ? result.audit : undefined;
  const error = result.revisionId === revisionId ? result.error : undefined;
  useEffect(() => {
    let active = true;
    if (revisionId) repository.getPreciseResumeRevisionAudit(revisionId).then(value => { if (active) setResult({ revisionId, audit: value }); }).catch(e => { if (active) setResult({ revisionId, error: String(e) }); });
    return () => { active = false; };
  }, [revisionId]);
  if (error) return <p role="alert">来源记录读取失败：{error}</p>;
  if (!audit || audit.proposal.schemaVersion !== "precise-edit-v2") return null;
  const p = audit.proposal;
  return <details data-testid="precise-revision-evidence"><summary>本版本结构化操作来源</summary>
    <p>版本：{audit.revisionId}；操作：{p.operationId}；确认时间：{audit.confirmedAt}</p>
    {p.operation.type === "fact_correction" ? <><p>用户自述，未经独立核验。原值：{p.originalValue}；新值：{p.operation.value}</p>
      <p>原始纠正声明：{p.operation.factProposal.source.content}</p><p>来源：{p.operation.factProposal.source.id}；消息：{p.operation.factProposal.source.messageId}；Turn：{p.operation.factProposal.source.turnId}</p>
      <p>完整性 SHA-256：{p.operation.factProposal.source.contentHash}</p></> : <p>操作类型：{p.operation.type}；来源随原始提案保留。</p>}
  </details>;
}
