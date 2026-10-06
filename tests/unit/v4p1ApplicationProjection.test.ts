import { describe, expect, it } from "vitest";
import {
  applicationStatusTerminal,
  applicationTransitionError,
  projectFollowUp
} from "@/domain/jobAssets/applicationProjection";
import type { ApplicationStatus } from "@/domain/schemas/application";

const STATUSES: ApplicationStatus[] = [
  "discovered", "preparing", "ready", "applied", "interviewing",
  "offer", "rejected", "withdrawn", "archived"
];

describe("V4-P1 stage 4: application transition projection (P2-A.1: adapted to the production state machine)", () => {
  it("advances along the forward chain onto the existing ApplicationStatus set", () => {
    expect(applicationTransitionError("discovered", "preparing")).toBeUndefined();
    expect(applicationTransitionError("preparing", "ready")).toBeUndefined();
    expect(applicationTransitionError("ready", "applied")).toBeUndefined();
    expect(applicationTransitionError("applied", "interviewing")).toBeUndefined();
    for (const terminal of ["offer", "rejected", "withdrawn"] as ApplicationStatus[]) {
      expect(applicationTransitionError("interviewing", terminal)).toBeUndefined();
    }
  });

  it("never introduces the reference statuses submitted/acknowledged/interview_completed", () => {
    expect(STATUSES).not.toContain("submitted");
    expect(STATUSES).not.toContain("acknowledged");
    expect(STATUSES).not.toContain("interview_completed");
    for (const status of STATUSES) {
      for (const forbidden of ["submitted", "acknowledged", "interview_completed"] as const) {
        expect(applicationTransitionError(status, forbidden as unknown as ApplicationStatus)).toBe("invalid_application_transition");
      }
    }
  });

  it("delegates to the production state machine, including its legitimate backward edges", () => {
    // 既有 statusMachine 的回退边是生产行为：projection 必须与它一致。
    expect(applicationTransitionError("preparing", "discovered")).toBeUndefined();
    expect(applicationTransitionError("ready", "preparing")).toBeUndefined();
    expect(applicationTransitionError("interviewing", "applied")).toBeUndefined();
    expect(applicationTransitionError("discovered", "withdrawn")).toBeUndefined();
    // 同状态是幂等操作（canTransitionApplicationStatus 的既有语义）。
    expect(applicationTransitionError("applied", "applied")).toBeUndefined();
    // 跨级跳过仍然拒绝。
    expect(applicationTransitionError("discovered", "applied")).toBe("invalid_application_transition");
    expect(applicationTransitionError("ready", "interviewing")).toBe("invalid_application_transition");
    expect(applicationTransitionError("applied", "offer")).toBe("invalid_application_transition");
    expect(applicationTransitionError("preparing", "archived")).toBeUndefined();
  });

  it("keeps terminal statuses terminal except for archiving", () => {
    for (const terminal of ["offer", "rejected", "withdrawn"] as ApplicationStatus[]) {
      expect(applicationStatusTerminal(terminal)).toBe(true);
      expect(applicationTransitionError(terminal, "interviewing")).toBe("invalid_application_transition");
      expect(applicationTransitionError(terminal, "archived")).toBeUndefined();
    }
    expect(applicationStatusTerminal("applied")).toBe(false);
  });

  it("answers for every existing status (exhaustive coverage via the shared machine)", () => {
    for (const status of STATUSES) {
      // 同状态幂等：生产状态机对 from === to 返回 true。
      expect(applicationTransitionError(status, status)).toBeUndefined();
    }
  });
});

describe("V4-P1 stage 4: follow-up cadence", () => {
  const UPDATED = "2026-10-01T00:00:00.000Z";

  it("does not follow up before one interval elapses", () => {
    expect(projectFollowUp({ status: "applied", updatedAt: UPDATED }, "2026-10-05T00:00:00.000Z"))
      .toEqual({ kind: "none" });
    expect(projectFollowUp({ status: "applied", updatedAt: UPDATED }, "2026-10-08T00:00:00.000Z"))
      .toEqual({ kind: "due", cycle: 1, maxFollowUps: 2, isFinalCycle: false, ageDays: 7 });
  });

  it("uses a shorter cadence for interviewing than for applied", () => {
    expect(projectFollowUp({ status: "interviewing", updatedAt: UPDATED }, "2026-10-06T00:00:00.000Z"))
      .toEqual({ kind: "due", cycle: 1, maxFollowUps: 2, isFinalCycle: false, ageDays: 5 });
  });

  it("marks the final cycle and goes silent afterwards without touching the application", () => {
    const final = projectFollowUp({ status: "applied", updatedAt: UPDATED }, "2026-10-15T00:00:00.000Z");
    expect(final).toEqual({ kind: "due", cycle: 2, maxFollowUps: 2, isFinalCycle: true, ageDays: 14 });

    const silent = projectFollowUp({ status: "applied", updatedAt: UPDATED }, "2026-10-23T00:00:00.000Z");
    expect(silent).toEqual({ kind: "none" });
  });

  it("generates no follow-up for pre-application, terminal, or archived statuses", () => {
    for (const status of ["discovered", "preparing", "ready", "offer", "rejected", "withdrawn", "archived"] as ApplicationStatus[]) {
      expect(projectFollowUp({ status, updatedAt: "2026-09-01T00:00:00.000Z" }, "2026-10-20T00:00:00.000Z"))
        .toEqual({ kind: "none" });
    }
  });

  it("treats a future updatedAt as not due (defensive against clock skew)", () => {
    expect(projectFollowUp({ status: "applied", updatedAt: "2026-10-20T00:00:00.000Z" }, "2026-10-06T00:00:00.000Z"))
      .toEqual({ kind: "none" });
  });
});
