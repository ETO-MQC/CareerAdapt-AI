import { describe, expect, it } from "vitest";
import {
  AUTHOR_NEWLINE_SUMMARY,
  readSeededBranch,
  seedDeterministicResume
} from "../e2e/support/p1fDeterministicResumeFixture";

describe("P-1F deterministic E2E fixture", () => {
  it("seeds a branch whose summary keeps the author newline", async () => {
    const seeded = await seedDeterministicResume();
    const handle = await readSeededBranch(seeded.databaseName, seeded.branchId);
    try {
      const items = handle.branch?.structuredContentItems ?? [];
      const summary = items.find((item) => item.data.sectionType === "summary");
      expect(summary, `sections=${JSON.stringify(items.map((i) => i.data.sectionType))}`).toBeTruthy();
      expect(summary && "text" in summary.data ? summary.data.text : null).toBe(AUTHOR_NEWLINE_SUMMARY);
    } finally {
      handle.close();
      await seeded.cleanup();
    }
  }, 60_000);
});