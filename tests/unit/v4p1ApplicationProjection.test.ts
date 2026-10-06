import { describe, expect, it } from "vitest";
import {
  APPLICATION_TRANSITIONS,
  applicationStatusTerminal,
  applicationTransitionError,
  projectFollowUp
} from "@/domain/jobAssets/applicationProjection";
import type { ApplicationStatus } from "@/domain/schemas/application";

const STATUSES: ApplicationStatus[] = [
  "discovered", "preparing", "ready", "applied", "interviewing",
  "offer", "rejected", "withdrawn", "archived"
];

describe("V4-P1 stage 4: application transition projection", () => {
  it("advances along the forward chain onto the existing ApplicationStatus set", () => {
    expect(APPLICATION_TRANSITIONS.discovered).toContain("preparing");
    expect(APPLICATION_TRANSITIONS.preparing).toContain("ready");
    expect(APPLICATION_TRANSITIONS.ready).toContain("applied");
    expect(APPLICATION_TRANSITIONS.applied).toContain("interviewing");
    expect(APPLICATION_TRANSITIONS.interviewing).toEqual(expect.arrayContaining(["offer", "rejected", "withdrawn"]));
  });

  it("never introduces the reference statuses submitted/acknowledged/interview_completed", () => {
    const allTargets = new Set(STATUSES.flatMap((status) => [...APPLICATION_TRANSITIONS[status]]));
    expect(allTargets.has("submitted" as ApplicationStatus)).toBe(false);
    expect(allTargets.has("acknowledged" as ApplicationStatus)).toBe(false);
    expect(allTargets.has("interview_completed" as ApplicationStatus)).toBe(false);
    expect(STATUSES).not.toContain("submitted");
  });

  it("rejects backward jumps and skips, allowing only forward moves and archiving", () => {
    expect(applicationTransitionError("applied", "preparing")).toBe("invalid_application_transition");
    expect(applicationTransitionError("discovered", "applied")).toBe("invalid_application_transition");
    expect(applicationTransitionError("ready", "interviewing")).toBe("invalid_application_transition");
    expect(applicationTransitionError("applied", "offer")).toBe("invalid_application_transition");
    expect(applicationTransitionError("preparing", "archived")).toBeUndefined();
    expect(applicationTransitionError("applied", "interviewing")).toBeUndefined();
  });

  it("keeps terminal statuses terminal except for archiving", () => {
    for (const terminal of ["offer", "rejected", "withdrawn"] as ApplicationStatus[]) {
      expect(applicationStatusTerminal(terminal)).toBe(true);
      expect(applicationTransitionError(terminal, "interviewing")).toBe("invalid_application_transition");
      expect(applicationTransitionError(terminal, "archived")).toBeUndefined();
    }
    expect(APPLICATION_TRANSITIONS.archived).toEqual([]);
  });

  it("defines transitions for every existing status (exhaustive table)", () => {
    for (const status of STATUSES) {
      expect(Array.isArray(APPLICATION_TRANSITIONS[status])).toBe(true);
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
