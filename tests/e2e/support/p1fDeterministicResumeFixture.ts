import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { CareerProfileSchema, type CareerProfile } from "@/domain/schemas";
import { demoCareerProfile } from "@/data/demoProfile";

/**
 * Deterministic E2E fixture. Every write goes through the public WorkspaceRepository path, so
 * CAS, operation-id and Fact Guard rules still apply. It never calls the model provider and
 * never touches a real workspace: the database name is unique per call and deleted afterwards.
 */

/** Two author-typed paragraphs. The renderer must neither split them further nor merge them. */
export const AUTHOR_NEWLINE_SUMMARY = [
  "第一段说明：负责支付平台的稳定性治理与容量规划。",
  "第二段说明：主导了三次大促的全链路压测与预案演练。"
].join("\n");

/** A single paragraph holding several sentences and no author newline. */
export const SINGLE_PARAGRAPH_TEXT = "负责支付平台核心链路的稳定性治理。主导了三次大促的全链路压测。";

export function buildFixtureProfile(): CareerProfile {
  return CareerProfileSchema.parse({
    ...demoCareerProfile,
    id: `profile-p1f-${crypto.randomUUID()}`,
    name: "P1F Closure",
    basics: {
      ...demoCareerProfile.basics,
      name: "P1F Closure",
      summary: AUTHOR_NEWLINE_SUMMARY
    },
    version: 1
  });
}

export type SeededBranch = {
  branchId: string;
  revision: number;
  profileId: string;
  personId: string;
  databaseName: string;
  cleanup: () => Promise<void>;
};

/**
 * Creates a general resume branch from the fixture profile and makes that profile the active
 * career context. ResumeWorkspace lists branches by `activeCareerContext.profileId`, so a
 * branch whose profileId is not active is filtered out and the canvas never renders.
 */
export async function seedDeterministicResume(): Promise<SeededBranch> {
  const databaseName = `CareerAdaptP1F-${crypto.randomUUID()}`;
  const db = new CareerAdaptDb(databaseName);
  const repository = new WorkspaceRepository(db);
  const profile = buildFixtureProfile();

  const savedProfile = await repository.saveProfile(profile);
  const personId = savedProfile.personId;
  if (!personId) throw new Error("p1f_fixture_person_id_missing");
  await repository.setActiveCareerContext({ personId, profileId: savedProfile.id });

  const created = await repository.createGeneralResumeBranch({
    profileId: savedProfile.id,
    operationId: "p1f-create-general",
    name: "P1F Closure Resume",
    includeProfileFacts: true,
    includeProfileBasics: true
  });

  const branch = created.branch;
  return {
    branchId: branch.id,
    revision: branch.revision,
    profileId: savedProfile.id,
    personId,
    databaseName,
    cleanup: async () => {
      db.close();
      await db.delete();
    }
  };
}

/** Opens a read-only handle on a seeded branch for assertions. */
export async function readSeededBranch(databaseName: string, branchId: string) {
  const db = new CareerAdaptDb(databaseName);
  const branch = await db.resumeBranches.get(branchId);
  return {
    branch,
    close: () => db.close()
  };
}

/**
 * Serialisable snapshot of the seeded rows. Playwright cannot reach the Node-side Dexie
 * handle, so the browser leg seeds the same rows through `page.addInitScript`. The values
 * come from a repository-committed branch, not from hand-written fixtures.
 */
export async function exportSeedPayload() {
  const seeded = await seedDeterministicResume();
  const db = new CareerAdaptDb(seeded.databaseName);
  try {
    const profile = await db.profiles.get(seeded.profileId);
    const branch = await db.resumeBranches.get(seeded.branchId);
    const revisions = await db.resumeRevisions.where("branchId").equals(seeded.branchId).toArray();
    const meta = await db.appMeta.toArray();
    return {
      databaseName: "CareerAdaptDb",
      expectedProfileId: seeded.profileId,
      expectedPersonId: seeded.personId,
      expectedBranchId: seeded.branchId,
      rows: {
        profiles: profile ? [profile as unknown as Record<string, unknown>] : [],
        resumeBranches: branch ? [branch as unknown as Record<string, unknown>] : [],
        resumeRevisions: revisions as unknown as Record<string, unknown>[],
        appMeta: meta as unknown as Record<string, unknown>[]
      }
    };
  } finally {
    db.close();
    await db.delete();
  }
}