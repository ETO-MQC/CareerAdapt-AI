import { afterEach, describe, expect, it } from "vitest";
import {
  computeApplicationPreparationChecklist,
  editCoverLetterMaterial,
  generateApplicationEmailMaterial,
  generateCoverLetterMaterial,
  generateInterviewQuestionMaterial,
  generateSelfIntroductionMaterial,
  generateStarStoryMaterial,
  markApplicationMaterialCompleted,
  markApplicationMaterialNotNeeded,
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

describe("Application materials readiness", () => {
  it("reports not started and partial draft states without hiring probabilities", async () => {
    const fixture = await setupApplicationPreparationFixture();
    db = fixture.db;
    const emptyChecklist = computeApplicationPreparationChecklist(fixture.pack);
    expect(emptyChecklist.level).toBe("needs_attention");
    expect(emptyChecklist.items.some((item) => item.status === "not_started")).toBe(true);

    const pack = generateCoverLetterMaterial({ pack: fixture.pack, context: fixture.context, language: "zh" });
    const checklist = computeApplicationPreparationChecklist(pack);
    expect(checklist.level).toBe("needs_attention");
    expect(JSON.stringify(checklist)).not.toMatch(/概率|通过率|录用/);
  });

  it("distinguishes stale, blocked and not_needed material states", async () => {
    const fixture = await setupApplicationPreparationFixture();
    db = fixture.db;
    let pack = generateCoverLetterMaterial({ pack: fixture.pack, context: fixture.context, language: "zh" });
    pack = rebaseApplicationPreparationPack({
      pack,
      context: {
        ...fixture.context,
        revisionId: "new-revision",
        branchRevision: fixture.context.branchRevision + 1
      }
    });
    expect(computeApplicationPreparationChecklist(pack).items.find((item) => item.id === "cover_letter")?.status).toBe("stale");

    let blockedPack = generateCoverLetterMaterial({ pack: fixture.pack, context: fixture.context, language: "zh" });
    blockedPack = editCoverLetterMaterial({
      pack: blockedPack,
      context: fixture.context,
      language: "zh",
      content: {
        ...blockedPack.materials.coverLetters.zh!.currentContent,
        bodyParagraphs: ["我熟练掌握SQL。"]
      }
    });
    expect(computeApplicationPreparationChecklist(blockedPack).level).toBe("blocked");

    const notNeeded = markApplicationMaterialNotNeeded({
      pack: generateCoverLetterMaterial({ pack: fixture.pack, context: fixture.context, language: "zh" }),
      materialId: generateCoverLetterMaterial({ pack: fixture.pack, context: fixture.context, language: "zh" }).materials.coverLetters.zh!.id
    });
    expect(computeApplicationPreparationChecklist(notNeeded).items.find((item) => item.id === "cover_letter")?.level).toBe("ready");
  });

  it("can become ready when generated materials are completed or not needed and gaps are resolved", async () => {
    const fixture = await setupApplicationPreparationFixture();
    db = fixture.db;
    let pack = generateCoverLetterMaterial({ pack: fixture.pack, context: fixture.context, language: "zh" });
    pack = generateApplicationEmailMaterial({ pack, context: fixture.context, language: "zh", tone: "brief" });
    pack = generateSelfIntroductionMaterial({ pack, context: fixture.context, language: "zh", durationSeconds: 60 });
    pack = generateInterviewQuestionMaterial({ pack, context: fixture.context });
    pack = generateStarStoryMaterial({ pack, context: fixture.context });

    for (const material of [
      pack.materials.coverLetters.zh!,
      pack.materials.applicationEmails.zh_brief!,
      pack.materials.selfIntroductions.zh60!,
      pack.materials.interviewQuestions[0],
      pack.materials.starStories[0]
    ]) {
      if (material.guardStatus === "allowed") {
        pack = markApplicationMaterialCompleted({ pack, materialId: material.id });
      }
    }
    pack = {
      ...pack,
      factGaps: pack.factGaps.map((gap) => ({ ...gap, status: "ignored" as const }))
    };
    expect(computeApplicationPreparationChecklist(pack).level).toBe("ready");
  });
});
