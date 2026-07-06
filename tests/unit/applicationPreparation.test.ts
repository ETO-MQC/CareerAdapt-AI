import { afterEach, describe, expect, it } from "vitest";
import {
  ApplicationPreparationPackSchema
} from "@/domain/schemas";
import {
  generateApplicationEmailMaterial,
  generateCoverLetterMaterial,
  generateInterviewQuestionMaterial,
  generateSelfIntroductionMaterial,
  generateStarStoryMaterial
} from "@/domain/applicationPreparation";
import { CareerAdaptDb } from "@/services/storage/db";
import {
  cleanupApplicationPreparationFixture,
  createSecondApplication,
  setupApplicationPreparationFixture
} from "./applicationPreparationFixtures";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  await cleanupApplicationPreparationFixture(db);
  db = undefined;
});

describe("ApplicationPreparationPack schema and repository", () => {
  it("creates a minimal valid pack in appMeta and isolates applications by typed key", async () => {
    const fixture = await setupApplicationPreparationFixture();
    db = fixture.db;
    const parsed = ApplicationPreparationPackSchema.parse(fixture.pack);
    expect(parsed.schemaVersion).toBe("application-preparation-v1");
    expect(parsed.applicationId).toBe(fixture.application.id);
    expect(parsed.basedOn.revisionId).toBe(fixture.application.selectedRevisionId);

    const second = await createSecondApplication(fixture.repository);
    const loadedSecond = await fixture.repository.loadApplicationPreparationPack(second.applicationId);
    expect(loadedSecond.pack?.applicationId).toBe(second.applicationId);
    expect(loadedSecond.pack?.applicationId).not.toBe(parsed.applicationId);
    expect(await fixture.repository.getMeta(`applicationPreparationPack:${fixture.application.id}`)).toBeTruthy();
    expect(await fixture.repository.getMeta(`applicationPreparationPack:${second.applicationId}`)).toBeTruthy();
  });

  it("uses expectedVersion and operationId idempotency when saving packs", async () => {
    const fixture = await setupApplicationPreparationFixture();
    db = fixture.db;
    const generated = generateCoverLetterMaterial({
      pack: fixture.pack,
      context: fixture.context,
      language: "zh"
    });
    const saved = await fixture.repository.saveApplicationPreparationPack({
      applicationId: fixture.application.id,
      expectedVersion: fixture.pack.version,
      operationId: "g6b-save-pack",
      pack: generated
    });
    const repeated = await fixture.repository.saveApplicationPreparationPack({
      applicationId: fixture.application.id,
      expectedVersion: fixture.pack.version,
      operationId: "g6b-save-pack",
      pack: generated
    });

    expect(saved.idempotent).toBe(false);
    expect(repeated.idempotent).toBe(true);
    await expect(fixture.repository.saveApplicationPreparationPack({
      applicationId: fixture.application.id,
      expectedVersion: fixture.pack.version,
      operationId: "g6b-version-conflict",
      pack: generated
    })).rejects.toThrow("version_conflict");
  });

  it("safely degrades corrupted packs and rejects forbidden payload keys", async () => {
    const fixture = await setupApplicationPreparationFixture();
    db = fixture.db;
    await fixture.repository.setMeta(`applicationPreparationPack:${fixture.application.id}`, {
      schemaVersion: "broken",
      pdfBlob: "not allowed"
    });
    const loaded = await fixture.repository.loadApplicationPreparationPack(fixture.application.id);
    expect(loaded.corrupted).toBe(true);
    expect(loaded.pack?.materials.coverLetters.zh).toBeUndefined();

    const badPack = {
      ...loaded.pack!,
      materials: {
        ...loaded.pack!.materials,
        coverLetters: {
          zh: {
            ...(generateCoverLetterMaterial({
              pack: loaded.pack!,
              context: loaded.context!,
              language: "zh"
            }).materials.coverLetters.zh!),
            apiKey: "test-api-key-never-stored"
          }
        }
      }
    };
    await expect(fixture.repository.saveApplicationPreparationPack({
      applicationId: fixture.application.id,
      expectedVersion: loaded.pack!.version,
      operationId: "g6b-forbidden-payload",
      pack: badPack as never
    })).rejects.toThrow("forbidden_preparation_payload");
  });
});

describe("Application material generation", () => {
  it("generates typed cover letters, email, introductions, questions and STAR without PDF blobs", async () => {
    const fixture = await setupApplicationPreparationFixture({ withExport: false });
    db = fixture.db;
    let pack = generateCoverLetterMaterial({ pack: fixture.pack, context: fixture.context, language: "zh" });
    pack = generateCoverLetterMaterial({ pack, context: fixture.context, language: "en" });
    pack = generateApplicationEmailMaterial({ pack, context: fixture.context, language: "en", tone: "formal" });
    pack = generateSelfIntroductionMaterial({ pack, context: fixture.context, language: "zh", durationSeconds: 30 });
    pack = generateSelfIntroductionMaterial({ pack, context: fixture.context, language: "zh", durationSeconds: 60 });
    pack = generateInterviewQuestionMaterial({ pack, context: fixture.context });
    pack = generateStarStoryMaterial({ pack, context: fixture.context });

    expect(pack.materials.coverLetters.zh?.currentContent.bodyParagraphs.length).toBeGreaterThan(0);
    expect(pack.materials.coverLetters.en?.language).toBe("en");
    expect(pack.materials.applicationEmails.en_formal?.currentContent.attachmentMentions).toEqual([]);
    expect(pack.materials.selfIntroductions.zh30?.currentContent.estimatedSeconds).toBeGreaterThan(0);
    expect(pack.materials.selfIntroductions.zh60?.currentContent.relevantExperience.length)
      .toBeGreaterThanOrEqual(pack.materials.selfIntroductions.zh30!.currentContent.relevantExperience.length);
    expect(pack.materials.interviewQuestions[0].currentContent.questions.some((question) => question.category === "behavioral")).toBe(true);
    expect(pack.materials.starStories[0].currentContent.sourceContentItemIds.length).toBeGreaterThan(0);
    expect(JSON.stringify(pack)).not.toContain("pdfBlob");
    expect(JSON.stringify(pack)).not.toContain("sk-");
  });
});
