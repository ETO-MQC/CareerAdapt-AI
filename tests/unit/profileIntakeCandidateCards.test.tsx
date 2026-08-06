import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfileIntakeCandidateCards } from "@/components/agent/ProfileIntakeCandidateCards";
import type { ProfileIntakeReviewProjection } from "@/domain/profileIntake/ProfileIntakeReviewProjection";

function projection(status: "accepted" | "proposed"): ProfileIntakeReviewProjection {
  const reviewed = status === "accepted" ? 1 : 0;
  return {
    importId: "import-1",
    draftRevision: 1,
    sourceMessageId: "message-1",
    sourceTurnId: "turn-1",
    sourceContentHash: "12345678",
    extractionStatus: "structured",
    providerStatus: "available",
    candidates: [{
      id: "candidate-1",
      sectionType: "education",
      sourceSpan: { start: 0, end: 10 },
      sourceQuote: "郑州大学本科计算机科学与技术",
      structuredItem: { sectionType: "education", school: "郑州大学", degree: "本科", major: "计算机科学与技术" },
      professionalText: "就读于郑州大学计算机科学与技术专业。",
      uncertainFields: [],
      confidence: 1,
      needsConfirmation: status !== "accepted",
      status,
      decision: status === "accepted" ? "accept" : undefined,
      canAccept: true,
      fieldEvidence: []
    }],
    reviewProgress: {
      total: 1,
      proposed: status === "accepted" ? 0 : 1,
      valid: 1,
      uncertain: 0,
      accepted: reviewed,
      ignored: 0,
      rejected: 0,
      reviewed
    },
    followUpQuestions: []
  } as unknown as ProfileIntakeReviewProjection;
}

function awardProjection(): ProfileIntakeReviewProjection {
  const base = projection("proposed");
  return {
    ...base,
    candidates: [{
      ...base.candidates[0],
      id: "candidate-award",
      sectionType: "awards",
      sourceQuote: "获得蓝桥杯竞赛河南省 Python A 组省级三等奖。",
      structuredItem: {
        sectionType: "awards",
        name: "蓝桥杯省级三等奖"
      },
      professionalText: "获得蓝桥杯省级三等奖。"
    }]
  } as unknown as ProfileIntakeReviewProjection;
}

describe("ProfileIntakeCandidateCards", () => {
  it("collapses reviewed receipts and reopens them from the header", () => {
    const onAction = vi.fn();
    render(<ProfileIntakeCandidateCards projection={projection("accepted")} onAction={onAction} />);

    const toggle = screen.getByRole("button", { name: /经历候选/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const count = toggle.querySelector(".profile-intake-inline-review-count");
    const chevron = toggle.querySelector("svg.profile-intake-inline-review-chevron");
    expect(chevron).not.toBeNull();
    expect(count?.nextElementSibling).toBe(chevron);
    expect(screen.queryByText("部分字段需要核对")).not.toBeInTheDocument();
    expect(screen.queryByText("✓ 已记录教育经历：郑州大学 · 本科 · 计算机科学与技术")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("✓ 已记录教育经历：郑州大学 · 本科 · 计算机科学与技术")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^重新打开$/ }));
    expect(onAction).toHaveBeenCalledWith({
      type: "profile_intake_candidate_decision",
      candidateId: "candidate-1",
      decision: "reopen"
    });
  });

  it("shows the review hint while any candidate remains unreviewed", async () => {
    const { rerender } = render(<ProfileIntakeCandidateCards projection={projection("proposed")} />);
    const toggle = screen.getByRole("button", { name: /经历候选/ });

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("部分字段需要核对")).toBeVisible();

    rerender(<ProfileIntakeCandidateCards projection={projection("accepted")} />);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "false"));
    expect(screen.queryByText("部分字段需要核对")).not.toBeInTheDocument();
  });

  it("sends award name corrections as edited labels instead of evidence patches", async () => {
    const onAction = vi.fn();
    render(<ProfileIntakeCandidateCards projection={awardProjection()} onAction={onAction} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑后采用" }));
    fireEvent.change(screen.getByRole("textbox", { name: "名称" }), {
      target: { value: "蓝桥杯竞赛河南省PythonA组省级三等奖" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并采用" }));

    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
    const action = onAction.mock.calls[0]?.[0];
    expect(action).toMatchObject({
      type: "profile_intake_candidate_edit",
      importId: "import-1",
      candidateId: "candidate-award",
      editedLabel: "蓝桥杯竞赛河南省PythonA组省级三等奖",
      decision: "accept"
    });
    expect(action.fieldPatch).toBeUndefined();
  });
});
