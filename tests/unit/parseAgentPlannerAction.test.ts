import { describe, expect, it, vi } from "vitest";
import { parseAgentPlannerAction } from "@/agent/runtime/parseAgentPlannerAction";

describe("parseAgentPlannerAction", () => {
  it("repairs a schema mismatch at most once", async () => {
    const repair = vi.fn(async () => ({ type: "still_invalid" }));
    const result = await parseAgentPlannerAction({ action: "bad" }, repair);

    expect(result.success).toBe(false);
    expect(result.attempt).toBe(2);
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it("accepts a repaired structure", async () => {
    const repair = vi.fn(async () => ({
      action: "complete",
      content: "任务完成"
    }));
    const result = await parseAgentPlannerAction({ action: "bad" }, repair);

    expect(result).toMatchObject({
      success: true,
      attempt: 2,
      data: { type: "workflow_complete", message: "任务完成" }
    });
    expect(repair).toHaveBeenCalledTimes(1);
  });
});
