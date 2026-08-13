"use client";

import type { AgentArtifactAction } from "@/agent/contracts/agentActions";
import type { AgentTaskState } from "@/agent/contracts/agentSession";
import { ResumeTailoringDiffSchema } from "@/domain/schemas";
import { tailoringDiffId } from "@/services/jobs/tailoringDiffId";
import { TailoringDiffRecord } from "./artifacts/AgentArtifactContent";

export function AgentTailoringInlineDiffs({
  taskState,
  onArtifactAction
}: {
  taskState: AgentTaskState;
  onArtifactAction?(action: AgentArtifactAction): Promise<unknown> | void;
}) {
  if (!(["preview_changes", "confirm_apply"] as string[]).includes(taskState.stage)) return null;
  const tailoring = asRecord(taskState.knownSlots.tailoringSession);
  const plan = asRecord(tailoring.plan);
  const diffs = Array.isArray(plan.diffs) ? plan.diffs : [];
  if (!diffs.length) return null;
  const reviews = Array.isArray(plan.diffReviews) ? plan.diffReviews.map(asRecord) : [];
  const reviewsById = new Map(reviews.flatMap((review) => typeof review.diffId === "string" ? [[review.diffId, review] as const] : []));
  const feedback = asRecord(taskState.knownSlots.artifactActionFeedback);
  const shown = diffs.slice(0, 3);

  return (
    <section className="agent-tailoring-inline" aria-label="岗位定制修改预览">
      <header>
        <strong>岗位定制修改</strong>
        <span>先核对前 {shown.length} 项</span>
      </header>
      <div className="agent-diff-list">
        {shown.map((item, index) => {
          const parsed = ResumeTailoringDiffSchema.safeParse(item);
          const diff = asRecord(item);
          const diffId = parsed.success ? tailoringDiffId(parsed.data) : undefined;
          const review = diffId ? reviewsById.get(diffId) ?? {} : {};
          return (
            <TailoringDiffRecord
              key={diffId ?? `inline-invalid-diff-${index}`}
              diff={diff}
              review={review}
              diffId={diffId}
              feedback={feedback.entityId === diffId ? feedback : undefined}
              onDecision={async (decision, editedValue) => {
                if (!diffId || !onArtifactAction) return;
                await onArtifactAction({ type: "tailoring_diff_decision", diffId, decision, editedValue });
              }}
            />
          );
        })}
      </div>
    </section>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
