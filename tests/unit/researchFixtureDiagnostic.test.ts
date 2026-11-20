import "fake-indexeddb/auto";
import { test } from "vitest";
import { researchSeedPayload } from "../e2e/support/researchPaginationFixture";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import { ResumeBranchSchema, CareerProfileSchema } from "@/domain/schemas";
test("inspect research fixture", async () => {
  const payload = await researchSeedPayload();
  const branch = ResumeBranchSchema.parse(payload.rows.resumeBranches[0]);
  const profile = CareerProfileSchema.parse(payload.rows.profiles[0]);
  mapBranchToResumeRenderModel({ branch, profile });
});
