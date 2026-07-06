import { afterEach, describe, expect, it } from "vitest";
import {
  editCoverLetterMaterial,
  generateCoverLetterMaterial,
  rebaseApplicationPreparationPack
} from "@/domain/applicationPreparation";
import { CareerAdaptDb } from "@/services/storage/db";
import {
  cleanupApplicationPreparationFixture,
  setupApplicationPreparationFixture
} from "./applicationPreparationFixtures";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  await cleanupApplicationPreparationFixture(db);
  db = undefined;
});

describe("Application material stale and version history", () => {
  it("marks generated materials stale after selected ResumeRevision changes", async () => {
    const fixture = await setupApplicationPreparationFixture();
    db = fixture.db;
    const pack = generateCoverLetterMaterial({ pack: fixture.pack, context: fixture.context, language: "zh" });
    await fixture.repository.saveApplicationPreparationPack({
      applicationId: fixture.application.id,
      expectedVersion: fixture.pack.version,
      operationId: "g6b-stale-save",
      pack
    });

    const edited = await fixture.repository.editResumeBranch({
      branchId: fixture.branch.id,
      expectedRevision: fixture.branch.revision,
      operationId: "g6b-stale-edit-branch",
      edits: [{
        itemId: fixture.branch.contentItems[0].id,
        text: `${fixture.branch.contentItems[0].text}。`
      }]
    });
    const latestApp = await fixture.repository.getApplication(fixture.application.id);
    const linked = await fixture.repository.linkApplicationRevision({
      applicationId: fixture.application.id,
      expectedVersion: latestApp!.version,
      operationId: "g6b-stale-link-latest",
      revisionId: edited.branch.currentRevisionId!
    });
    expect(linked.application.selectedRevisionId).toBe(edited.branch.currentRevisionId);

    const loaded = await fixture.repository.loadApplicationPreparationPack(fixture.application.id);
    expect(loaded.pack?.materials.coverLetters.zh?.status).toBe("stale");
  });

  it("does not mark materials stale for presentation-only changes", async () => {
    const fixture = await setupApplicationPreparationFixture();
    db = fixture.db;
    const pack = generateCoverLetterMaterial({ pack: fixture.pack, context: fixture.context, language: "zh" });
    const rebased = rebaseApplicationPreparationPack({
      pack,
      context: {
        ...fixture.context,
        presentationRevision: fixture.context.presentationRevision + 1
      }
    });
    expect(rebased.materials.coverLetters.zh?.status).toBe("draft");
  });

  it("keeps at most five material history versions", async () => {
    const fixture = await setupApplicationPreparationFixture();
    db = fixture.db;
    let pack = generateCoverLetterMaterial({ pack: fixture.pack, context: fixture.context, language: "zh" });
    for (let index = 0; index < 7; index += 1) {
      const current = pack.materials.coverLetters.zh!.currentContent;
      pack = editCoverLetterMaterial({
        pack,
        context: fixture.context,
        language: "zh",
        content: {
          ...current,
          closing: `${current.closing} ${index}`
        }
      });
    }
    expect(pack.materials.coverLetters.zh?.history).toHaveLength(5);
    expect(pack.materials.coverLetters.zh?.generationVersion).toBe(8);
  });
});
