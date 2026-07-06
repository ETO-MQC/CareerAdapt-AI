import { afterEach, describe, expect, it } from "vitest";
import {
  editCoverLetterMaterial,
  generateApplicationEmailMaterial,
  generateCoverLetterMaterial,
  markApplicationMaterialCompleted
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

describe("Application material Fact Guard", () => {
  it("re-runs guard after user edits and blocks unsupported SQL claims", async () => {
    const fixture = await setupApplicationPreparationFixture();
    db = fixture.db;
    let pack = generateCoverLetterMaterial({
      pack: fixture.pack,
      context: fixture.context,
      language: "zh"
    });
    const letter = pack.materials.coverLetters.zh!;
    expect(letter.guardStatus).toBe("allowed");

    pack = editCoverLetterMaterial({
      pack,
      context: fixture.context,
      language: "zh",
      content: {
        ...letter.currentContent,
        bodyParagraphs: [...letter.currentContent.bodyParagraphs, "我熟练掌握SQL并可独立负责复杂建模。"]
      }
    });

    expect(pack.materials.coverLetters.zh?.guardStatus).toBe("blocked");
    expect(pack.materials.coverLetters.zh?.guardReasons.join(" ")).toContain("新增工具或技能");
    expect(() => markApplicationMaterialCompleted({
      pack,
      materialId: pack.materials.coverLetters.zh!.id
    })).toThrow("guard_blocked");
  });

  it("does not treat JD requirements as user facts", async () => {
    const fixture = await setupApplicationPreparationFixture();
    db = fixture.db;
    const pack = generateCoverLetterMaterial({
      pack: fixture.pack,
      context: fixture.context,
      language: "zh"
    });
    const text = pack.materials.coverLetters.zh!.currentContent.bodyParagraphs.join("\n");
    expect(text).not.toContain("熟悉 Excel 或 Stata");
  });

  it("only claims attachments when the Application has a successful PDF export", async () => {
    const noPdfFixture = await setupApplicationPreparationFixture({ withExport: false });
    db = noPdfFixture.db;
    const noPdfPack = generateApplicationEmailMaterial({
      pack: noPdfFixture.pack,
      context: noPdfFixture.context,
      language: "zh",
      tone: "brief"
    });
    expect(noPdfPack.materials.applicationEmails.zh_brief?.currentContent.attachmentMentions).toEqual([]);
    await cleanupApplicationPreparationFixture(db);

    const withPdfFixture = await setupApplicationPreparationFixture({ withExport: true });
    db = withPdfFixture.db;
    const withPdfPack = generateApplicationEmailMaterial({
      pack: withPdfFixture.pack,
      context: withPdfFixture.context,
      language: "zh",
      tone: "brief"
    });
    expect(withPdfPack.materials.applicationEmails.zh_brief?.currentContent.attachmentMentions.join(" ")).toContain("PDF");
  });
});
