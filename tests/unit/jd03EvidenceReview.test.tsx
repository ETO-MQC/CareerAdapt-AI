import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TailoringDiffRecord } from "@/components/agent/artifacts/AgentArtifactContent";

const diff = {
  target: { sectionId: "project", itemId: "project", fieldPath: "highlights" },
  original: ["参与需求梳理和验收"], value: ["参与需求梳理，交付验收记录"], reason: "突出真实定性交付",
  requirementIds: ["req-quality", "req-team"], supportLevel: "verified",
  evidenceRefs: [{ type: "experience_fact", experienceId: "experience", factId: "fact", factQuote: "参与需求梳理和验收", factText: "参与需求梳理和验收" }]
};
const session = {
  job: { requirements: [{ id: "req-quality", description: "参与质量验收" }, { id: "req-team", description: "与团队协作" }] },
  profile: { experiences: [{ id: "experience", title: "应用项目", facts: [{ id: "fact", provenance: [{ sourceType: "pdf_import", sourceText: "原件完整段落", sourceQuote: "原件中的参与职责", fileName: "synthetic.pdf", pageNumber: 2 }] }] }] }
};

describe("JD-03 evidence-backed review", () => {
  it("shows multiple requirements, the original quote and original file locator without making a review decision", () => {
    const decide = vi.fn();
    render(<TailoringDiffRecord diff={diff} session={session} review={{}} diffId="review" onDecision={decide} />);
    fireEvent.click(screen.getByText("岗位要求与来源证据"));
    expect(screen.getByText("参与质量验收")).toBeVisible();
    expect(screen.getByText("与团队协作")).toBeVisible();
    expect(screen.getByText("应用项目")).toBeVisible();
    expect(screen.getByText(/原件中的参与职责/)).toHaveTextContent("synthetic.pdf，第 2 页");
    expect(screen.getByText(/审核状态：待审核/)).toBeVisible();
    expect(decide).not.toHaveBeenCalled();
  });
  it.each(["reasonable_inference", "user_declared"])("keeps %s distinct from source-backed evidence", supportLevel => {
    render(<TailoringDiffRecord diff={{ ...diff, supportLevel }} session={session} review={{}} diffId="review" onDecision={vi.fn()} />);
    fireEvent.click(screen.getByText("岗位要求与来源证据"));
    expect(screen.getByText(/支持类型：.*需核对/)).toBeVisible();
  });
  it("warns when a requirement or fact can no longer be resolved, rather than inventing source details", () => {
    render(<TailoringDiffRecord diff={diff} session={{}} review={{ status: "rejected" }} diffId="review" onDecision={vi.fn()} />);
    fireEvent.click(screen.getByText("岗位要求与来源证据"));
    expect(screen.getAllByText("原岗位要求暂不可用，请重新核对岗位")).toHaveLength(2);
    expect(screen.getByText(/未能定位原始事实/)).toBeVisible();
    expect(screen.getByText(/审核状态：已忽略/)).toBeVisible();
    expect(screen.queryByText("应用项目")).not.toBeInTheDocument();
  });
  it("keeps missing evidence explicit and routes manual edits through the existing review action", () => {
    const decide = vi.fn();
    render(<TailoringDiffRecord diff={{ ...diff, evidenceRefs: [] }} review={{}} diffId="review" onDecision={decide} />);
    fireEvent.click(screen.getByText("岗位要求与来源证据"));
    expect(screen.getByText(/没有附带来源引用/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "编辑后采用" }));
    fireEvent.change(screen.getByLabelText("编辑建议内容"), { target: { value: "参与验收并整理记录" } });
    fireEvent.click(screen.getByRole("button", { name: "采用编辑" }));
    expect(decide).toHaveBeenCalledWith("edit", "参与验收并整理记录");
  });
});
