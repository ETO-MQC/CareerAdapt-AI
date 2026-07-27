import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

test.describe("P4.2a.3d profile reconciliation", () => {
  test("OpenDataLoader PDF keeps reviewable provenance through confirmation and reload", async ({ page }) => {
    await enableOpenDataLoader(page);
    await page.route("**/api/resume-import/opendataloader", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          engine: "opendataloader",
          engineVersion: "test-1.0",
          text: "Projects\n示例任务系统 AI Engineer 2024-09 - Present\nBuilt AI Command Stream with React\nSkills\nPython, SQL",
          blocks: [
            sourceBlock("odl-heading-projects", "Projects", "heading", 0),
            sourceBlock("odl-project", "示例任务系统 AI Engineer 2024-09 - Present", "list_item", 1),
            sourceBlock("odl-project-fact", "Built AI Command Stream with React", "list_item", 2),
            sourceBlock("odl-heading-skills", "Skills", "heading", 3),
            sourceBlock("odl-skills", "Python, SQL", "list_item", 4)
          ],
          warnings: []
        })
      });
    });

    await page.goto("/resume");
    await page.getByRole("button", { name: "导入", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "导入简历" });
    await dialog.getByLabel("选择要导入的简历文件").setInputFiles(
      resolve("tests/fixtures/pdf/two-column-pdflib.pdf")
    );

    await expect(dialog.locator(".import-routing-panel")).toContainText("OpenDataLoader", { timeout: 30_000 });
    await expect(dialog.locator(".import-item-row").filter({ hasText: "示例任务系统" })).toBeVisible();
    const sourceReview = dialog.locator(".import-item-row")
      .filter({ hasText: "示例任务系统" })
      .getByText("查看来源原文", { exact: true });
    await sourceReview.click();
    await expect(dialog.locator(".import-item-row").filter({ hasText: "示例任务系统" }))
      .toContainText("示例任务系统 AI Engineer");

    await page.getByLabel("创建新人物").check();
    await resolveImportReview(page);
    await page.getByRole("button", { name: "确认导入", exact: true }).click();
    await expect(page.locator(".app-notification-success").filter({ hasText: "通用简历" }).last())
      .toBeVisible({ timeout: 20_000 });

    const beforeReload = await readOpenDataLoaderProvenance(page);
    expect(beforeReload.provenance).toMatchObject({
      sourceType: "pdf_import",
      sourceSessionId: expect.any(String),
      fileName: "two-column-pdflib.pdf",
      sourceLocatorStatus: "located",
      sourceQuote: expect.stringContaining("AI Command Stream")
    });
    expect(beforeReload.session).toMatchObject({
      id: beforeReload.provenance.sourceSessionId,
      status: "committed",
      committedProfileId: beforeReload.profileId
    });
    expect(beforeReload.pageText).toContain(beforeReload.provenance.sourceQuote);

    await page.reload();
    const afterReload = await readOpenDataLoaderProvenance(page);
    expect(afterReload).toEqual(beforeReload);
  });
});

async function enableOpenDataLoader(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("careeradapt.documentRecognition", JSON.stringify({
      schemaVersion: "document-recognition-preferences-v1",
      parsingMode: "auto",
      localOcrEnabled: true,
      modelDirectory: "",
      openDataLoaderExperimental: true,
      allowManualRouteSelection: true
    }));
  });
}

async function resolveImportReview(page: Page) {
  const fieldButtons = page.getByRole("button", { name: "确认此字段", exact: true });
  while (await fieldButtons.count()) await fieldButtons.first().click();
  const sourceButtons = page.getByRole("button", { name: "核对并保留来源", exact: true });
  while (await sourceButtons.count()) await sourceButtons.first().click();
}

function sourceBlock(
  id: string,
  text: string,
  blockType: "heading" | "list_item",
  order: number
) {
  return {
    id,
    page: 1,
    text,
    rawText: text,
    blockType,
    position: { x: order % 2 ? 320 : 20, y: 40 + order * 24, width: 280, height: 18 },
    order
  };
}

async function readOpenDataLoaderProvenance(page: Page) {
  return page.evaluate(async () => new Promise<{
    profileId: string;
    provenance: {
      sourceType: string;
      sourceSessionId: string;
      fileName: string;
      sourceLocatorStatus: string;
      sourceQuote: string;
    };
    session: Record<string, unknown>;
    pageText: string;
  }>((resolveResult, reject) => {
    const request = indexedDB.open("CareerAdaptDb");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(["profiles", "pdfImportSessions", "pdfPageTexts"], "readonly");
      const profilesRequest = transaction.objectStore("profiles").getAll();
      const sessionsRequest = transaction.objectStore("pdfImportSessions").getAll();
      const pagesRequest = transaction.objectStore("pdfPageTexts").getAll();
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        const profiles = profilesRequest.result as Array<{
          id: string;
          experiences: Array<{ facts: Array<{ provenance: Array<Record<string, unknown>> }> }>;
          skills: Array<{ fact?: { provenance: Array<Record<string, unknown>> } }>;
        }>;
        const facts = profiles.flatMap((profile) => [
          ...profile.experiences.flatMap((experience) => experience.facts),
          ...profile.skills.flatMap((skill) => skill.fact ? [skill.fact] : [])
        ]);
        const provenance = facts.flatMap((fact) => fact.provenance)
          .find((item) => item.sourceType === "pdf_import" && item.fileName === "two-column-pdflib.pdf") as {
            sourceType: string;
            sourceSessionId: string;
            fileName: string;
            sourceLocatorStatus: string;
            sourceQuote: string;
          } | undefined;
        if (!provenance) {
          reject(new Error("OpenDataLoader provenance missing"));
          return;
        }
        const profile = profiles.find((candidate) => [
          ...candidate.experiences.flatMap((experience) => experience.facts),
          ...candidate.skills.flatMap((skill) => skill.fact ? [skill.fact] : [])
        ].some((fact) => fact.provenance.includes(provenance)));
        const session = (sessionsRequest.result as Array<Record<string, unknown>>)
          .find((item) => item.id === provenance.sourceSessionId);
        const pageText = (pagesRequest.result as Array<{ sessionId: string; cleanedPageText: string }>)
          .filter((item) => item.sessionId === provenance.sourceSessionId)
          .map((item) => item.cleanedPageText)
          .join("\n");
        db.close();
        resolveResult({
          profileId: profile?.id ?? "",
          provenance,
          session: session ?? {},
          pageText
        });
      };
    };
  }));
}
