"use client";

import type { AgentTaskState } from "@/agent/contracts/agentSession";
import { JobTargetSnapshotSchema } from "@/domain/schemas/jobTarget";

/** Display only the Host-owned target, never infer one from chat or Job order. */
export function AgentJobTarget({ task, compact = false, onOpen }: { task?: AgentTaskState; compact?: boolean; onOpen?(): void }) {
  const parsed = JobTargetSnapshotSchema.safeParse(task?.knownSlots.targetSnapshot);
  if (!parsed.success || task?.selectedEntities.targetSnapshotId !== parsed.data.id) return null;
  const target = parsed.data;
  return (
    <section aria-label="当前目标岗位" className="profile-intake-inline-review" data-target-id={target.id}>
      <strong>{target.company ?? "未填写公司"} · {target.title ?? "临时岗位"}</strong>
      <p>{target.sourceType === "saved_job" ? "已保存岗位" : "本次提供的岗位描述"} · {target.normalizedRequirements.length} 条要求</p>
      {compact ? <button type="button" onClick={onOpen}>查看岗位分析</button> : <details>
        <summary>核对岗位要求与来源</summary>
        <p>以下为解析结果，请对照原文核对；能力是否满足需另行匹配证据。</p>
        <ul>{target.normalizedRequirements.map(requirement => (
          <li key={requirement.id} data-target-requirement-id={requirement.id}>
            <strong>{requirement.priority === "nice_to_have" ? "优先条件" : requirement.hardConstraint ? "必须条件" : "岗位要求"}：</strong>
            {requirement.description}
          </li>
        ))}</ul>
        <details><summary>查看原始岗位描述</summary><blockquote style={{ whiteSpace: "pre-wrap" }}>{target.rawText}</blockquote></details>
      </details>}
    </section>
  );
}
