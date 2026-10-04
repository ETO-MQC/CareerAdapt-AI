import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentArtifactContent } from "@/components/agent/artifacts/AgentArtifactContent";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import type { AgentSession, AgentTaskState } from "@/agent/contracts/agentSession";
import {
  TAILORING_DIAGNOSTIC_LIMIT,
  TailoringDiagnosticSchema,
  TailoringDiagnosticsSchema,
  buildTailoringDiagnostics,
  explainTailoringReason,
  readTailoringDiagnostics,
  resumeItemLabel
} from "@/agent/contracts/tailoringDiagnostics";

const NOW = "2026-10-04T00:00:00.000Z";
const reducer = new AgentTaskStateReducer();

function tailoringState(): AgentTaskState {
  return reducer.create({
    id: "session-1",
    workflowState: { workflowId: "tailor_resume", step: "clarify" },
    artifactRefs: [],
    memory: {}
  } as unknown as AgentSession);
}

function generationObservation(input: {
  rejected?: { reasonCode: string; sectionId?: string; itemId?: string; fieldPath?: string }[];
  generationDiagnostics?: { code: string; targetItemId?: string }[];
  items?: { id: string; data: Record<string, unknown> }[];
  generatedDiffRevision?: number;
}) {
  return {
    session: {
      id: "tailoring-session-1",
      generatedDiffRevision: input.generatedDiffRevision ?? 3,
      branch: {
        structuredContentItems: (input.items ?? []).map((item) => ({ id: item.id, data: item.data }))
      },
      plan: {
        diffReviews: [{ diffId: "d1", status: "suggested" }],
        generationDiagnostics: input.generationDiagnostics ?? []
      }
    },
    rejectedDiffs: (input.rejected ?? []).map((entry) => ({
      reasonCode: entry.reasonCode,
      diff: {
        target: {
          sectionId: entry.sectionId ?? "project",
          itemId: entry.itemId ?? "item-1",
          fieldPath: entry.fieldPath ?? "highlights"
        }
      }
    }))
  };
}

function generate(observation: unknown) {
  return reducer.reduce(tailoringState(), {
    type: "tool_observation",
    toolName: "generate_tailoring_changes",
    observation
  });
}

describe("tailoring diagnostics projection", () => {
  it("projects rejected diffs onto task state with section, item and field", () => {
    const state = generate(generationObservation({
      rejected: [{ reasonCode: "target_not_found", sectionId: "education", itemId: "edu-1", fieldPath: "description" }],
      items: [{ id: "edu-1", data: { sectionType: "education", school: "示例大学" } }]
    }));

    const diagnostics = TailoringDiagnosticsSchema.parse(state.knownSlots.tailoringDiagnostics);
    expect(diagnostics.diagnostics).toHaveLength(1);
    expect(diagnostics.diagnostics[0]).toMatchObject({
      status: "rejected",
      reasonCode: "target_not_found",
      sectionType: "education",
      itemId: "edu-1",
      itemLabel: "示例大学",
      fieldPath: "description",
      tailoringSessionId: "tailoring-session-1"
    });
    expect(diagnostics.generatedDiffRevision).toBe(3);
  });

  it("maps distinct reason codes onto distinct statuses", () => {
    const state = generate(generationObservation({
      rejected: [
        { reasonCode: "original_mismatch", itemId: "a" },
        { reasonCode: "confirmation_required", itemId: "b" },
        { reasonCode: "invented_metric", itemId: "c" }
      ],
      generationDiagnostics: [{ code: "invalid_ai_output" }]
    }));

    const { diagnostics } = TailoringDiagnosticsSchema.parse(state.knownSlots.tailoringDiagnostics);
    const statusByCode = new Map(diagnostics.map((entry) => [entry.reasonCode, entry.status]));
    expect(statusByCode.get("original_mismatch")).toBe("original_mismatch");
    expect(statusByCode.get("confirmation_required")).toBe("pending_confirmation");
    expect(statusByCode.get("invented_metric")).toBe("rejected");
    expect(statusByCode.get("invalid_ai_output")).toBe("blocked");
  });

  it("keeps every rejection reason code explainable in Chinese", () => {
    const codes = [
      "target_not_found", "original_mismatch", "blocked_identity_path", "invented_metric",
      "responsibility_upgrade", "insufficient_evidence", "confirmation_required", "duplicate_sentence",
      "jd_parroting", "keyword_stuffing", "path_not_allowed", "unsupported_metric", "identity_field_changed"
    ];
    for (const code of codes) {
      const explanation = explainTailoringReason(code);
      expect(explanation.length).toBeGreaterThan(4);
      expect(explanation).not.toBe(code);
    }
    expect(explainTailoringReason("rejected_after_retry_original_mismatch")).toBe(
      explainTailoringReason("original_mismatch")
    );
    expect(explainTailoringReason("totally_unknown_code").length).toBeGreaterThan(4);
  });

  it("never lets diagnostics reach the selected diff set", () => {
    const state = generate(generationObservation({
      rejected: [{ reasonCode: "original_mismatch", itemId: "a" }],
      generationDiagnostics: [{ code: "invalid_ai_output" }]
    }));

    expect(state.knownSlots.selectedDiffs).toEqual([]);
    expect(state.knownSlots.selectedDiffIds).toEqual([]);
    expect(state.knownSlots.acceptedDiffIds).toEqual([]);
    expect(state.knownSlots.remainingDiffCount).toBe(1);
  });

  it("replaces the previous diagnostics when a new plan is generated", () => {
    const first = generate(generationObservation({ rejected: [{ reasonCode: "invented_metric", itemId: "old-item" }] }));
    expect(TailoringDiagnosticsSchema.parse(first.knownSlots.tailoringDiagnostics).diagnostics).toHaveLength(1);

    const second = generate(generationObservation({ rejected: [{ reasonCode: "target_not_found", itemId: "new-item" }] }));
    const diagnostics = TailoringDiagnosticsSchema.parse(second.knownSlots.tailoringDiagnostics);
    expect(diagnostics.diagnostics).toHaveLength(1);
    expect(diagnostics.diagnostics[0].itemId).toBe("new-item");
    expect(diagnostics.diagnostics.some((entry) => entry.itemId === "old-item")).toBe(false);
  });

  it("caps the diagnostic count and reports how many were dropped", () => {
    const rejected = Array.from({ length: TAILORING_DIAGNOSTIC_LIMIT + 7 }, (_, index) => ({
      reasonCode: "invented_metric",
      itemId: `item-${index}`
    }));
    const diagnostics = buildTailoringDiagnostics({
      observation: generationObservation({ rejected }),
      capturedAt: NOW
    });

    expect(diagnostics.diagnostics).toHaveLength(TAILORING_DIAGNOSTIC_LIMIT);
    expect(diagnostics.truncatedCount).toBe(7);
  });

  it("falls back to an empty set for legacy or malformed slots", () => {
    expect(readTailoringDiagnostics(undefined)).toEqual({ diagnostics: [], truncatedCount: 0, generatedDiffRevision: 0 });
    expect(readTailoringDiagnostics({ legacy: true })).toEqual({ diagnostics: [], truncatedCount: 0, generatedDiffRevision: 0 });
    expect(readTailoringDiagnostics({ diagnostics: "nope", truncatedCount: -1 }).diagnostics).toEqual([]);
  });

  it("restores a session whose stored slots predate the diagnostics field", () => {
    const session = {
      id: "session-legacy",
      workflowState: { workflowId: "tailor_resume", step: "preview_changes", data: { selectedDiffIds: ["keep-me"] } },
      artifactRefs: [],
      memory: {}
    } as unknown as AgentSession;

    const restored = reducer.create(session);
    expect(restored.knownSlots.selectedDiffIds).toEqual(["keep-me"]);
    expect(restored.knownSlots.tailoringDiagnostics).toBeUndefined();
    expect(readTailoringDiagnostics(restored.knownSlots.tailoringDiagnostics).diagnostics).toEqual([]);
  });

  it("labels items by the field a reader recognises", () => {
    expect(resumeItemLabel({ sectionType: "work", organization: "某公司", role: "工程师" })).toBe("某公司");
    expect(resumeItemLabel({ sectionType: "project", title: "某系统" })).toBe("某系统");
    expect(resumeItemLabel({ sectionType: "skills", name: "React" })).toBe("React");
    expect(resumeItemLabel({ sectionType: "education" })).toBeUndefined();
    expect(resumeItemLabel(undefined)).toBeUndefined();
  });

  it("rejects diagnostics that carry raw payloads or unknown fields", () => {
    expect(TailoringDiagnosticSchema.safeParse({
      diagnosticId: "d",
      status: "rejected",
      reasonCode: "invented_metric",
      capturedAt: NOW,
      rawModelText: "模型原始输出"
    }).success).toBe(false);
  });
});

describe("tailoring diagnostics artifact surface", () => {
  function renderArtifactWithDiagnostics(diagnostics: unknown) {
    return render(
      <AgentArtifactContent
        artifact={{
          id: "tailoring-workspace",
          kind: "tailoring_workspace",
          title: "岗位定制",
          entityType: "job",
          entityId: "job-1",
          createdAt: NOW,
          updatedAt: NOW,
          status: "active",
          summary: "岗位简历修改预览"
        }}
        state={{
          step: "preview_changes",
          busy: false,
          diffs: [{
            target: { sectionId: "project", itemId: "p-1", fieldPath: "highlights" },
            operation: "replace",
            original: ["原文要点"],
            value: ["新要点"],
            reason: "贴近岗位要求",
            requirementIds: [],
            targetKeywords: [],
            evidenceRefs: [],
            supportLevel: "verified"
          }],
          confirmedRequirementIds: [],
          tailoringSession: { id: "tailoring-session-1", plan: { diffReviews: [] } }
        }}
        taskState={{
          rootGoal: "generate_job_specific_resume",
          workflowId: "tailor_resume",
          stage: "preview_changes",
          knownSlots: { tailoringDiagnostics: diagnostics }
        } as never}
      />
    );
  }

  it("shows section, item and field for each unapplied diagnostic", () => {
    renderArtifactWithDiagnostics({
      diagnostics: [{
        diagnosticId: "d-1",
        status: "original_mismatch",
        reasonCode: "original_mismatch",
        sectionType: "education",
        itemId: "edu-1",
        itemLabel: "示例大学",
        fieldPath: "description",
        capturedAt: NOW
      }],
      truncatedCount: 0,
      generatedDiffRevision: 2
    });

    expect(screen.getByText(/未应用\/需关注 1 项/)).toBeTruthy();
    expect(screen.getByText(/教育 · 示例大学 · description/)).toBeTruthy();
    expect(screen.getByText("内容已变更")).toBeTruthy();
    expect(screen.getByText("简历内容在生成后发生了变化，改写已放弃以避免覆盖你的新修改。")).toBeTruthy();
  });

  it("reports truncated diagnostics instead of hiding them", () => {
    renderArtifactWithDiagnostics({ diagnostics: [], truncatedCount: 9, generatedDiffRevision: 1 });
    expect(screen.getByText(/未应用\/需关注 9 项/)).toBeTruthy();
    expect(screen.getByText("另有 9 项未展示。")).toBeTruthy();
  });

  it("renders nothing when there is no diagnostic to explain", () => {
    const { container } = renderArtifactWithDiagnostics({ diagnostics: [], truncatedCount: 0, generatedDiffRevision: 0 });
    expect(container.querySelector(".agent-tailoring-diagnostics")).toBeNull();
  });
});
