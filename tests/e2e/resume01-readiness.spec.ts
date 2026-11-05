import { writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { prepareCoreSourceResume, readStore } from "./support/p51CoreWorkflow";
async function openAiDiagnosticsTab(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "AI优化", exact: true }).click();
  await page.getByRole("button", { name: /投递\s*检查/ }).click();
  await expect(page.getByTestId("resume-diagnostics-panel")).toBeVisible();
}

test("RESUME-01 current revision review is read-only; real PDF has bound text inspection", async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.goto("/resume");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能", exact: true });
  if (await skip.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) { await skip.click(); await page.goto("/resume"); }
  await prepareCoreSourceResume(page);
  await openAiDiagnosticsTab(page);
  const branches = await readStore(page, "resumeBranches");
  const revisions = await readStore(page, "resumeRevisions");
  const profiles = await readStore(page, "profiles");
  const panel = page.getByTestId("resume-diagnostics-panel");
  await panel.getByTestId("review-general-resume").click();
  await expect(panel.getByTestId("general-resume-review")).toContainText("当前原文审阅");
  await expect(panel.getByTestId("general-resume-review")).toContainText("unknown");
  expect(await readStore(page, "resumeBranches")).toEqual(branches);
  expect(await readStore(page, "resumeRevisions")).toEqual(revisions);
  expect(await readStore(page, "profiles")).toEqual(profiles);
  const locate = panel.getByRole("button", { name: "定位原文", exact: true }).first();
  await expect(locate).toBeVisible();
  await locate.click();
  await page.screenshot({ path: info.outputPath("review-panel.png") });
  const responsePromise = page.waitForResponse(r => r.url().includes("/api/resume-export/pdf") && r.request().method() === "POST");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  const response = await responsePromise;
  expect(response.status(), await response.text().catch(() => "binary")).toBe(200);
  const readiness = JSON.parse(response.headers()["x-careeradapt-pdf-readiness"]);
  await info.attach("actual-pdf", { body: await response.body(), contentType: "application/pdf" });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: new Uint8Array(await response.body()), isEvalSupported: false }).promise;
  const extracted: string[] = [];
  for (let index = 1; index <= document.numPages; index++) {
    const content = await (await document.getPage(index)).getTextContent();
    extracted.push(content.items.flatMap(item => "str" in item ? [item.str] : []).join(""));
  }
  await document.destroy();
  await info.attach("text-inspection", { body: JSON.stringify({ readiness, extracted,
    preview: await page.getByTestId("resume-a4-page").allInnerTexts() }, null, 2), contentType: "application/json" });
  await writeFile(info.outputPath("inspection.json"), JSON.stringify({ readiness, extracted, preview: await page.getByTestId("resume-a4-page").allInnerTexts() }, null, 2));
  await writeFile(info.outputPath("actual.pdf"), await response.body());
  expect(readiness).toMatchObject({ textLayer: "pass", contentParity: "pass", readingOrder: "needs_review", thirdPartyAts: "unknown" });
  // Direct evidence: Chromium paints the section heading before the email in
  // its PDF stream. Full content is present, but the stream order must be flagged.
  expect(extracted[0].indexOf("项目经历")).toBeLessThan(extracted[0].indexOf("core@example.org"));
  const preview = (await page.getByTestId("resume-a4-page").allInnerTexts()).join("\n");
  expect(preview.indexOf("core@example.org")).toBeLessThan(preview.indexOf("项目经历"));
  const download = await downloadPromise;
  await download.saveAs(info.outputPath("resume01-actual.pdf"));
  const exports = await readStore(page, "exportRecords");
  expect(exports.some(e => e.revisionId === readiness.revisionId && JSON.stringify(e.pdfTextReadiness) === JSON.stringify(readiness))).toBe(true);
  await openAiDiagnosticsTab(page);
  await expect(panel.getByTestId("pdf-text-readiness")).toContainText("已检查实际导出文件");
  await page.reload();
  await openAiDiagnosticsTab(page);
  await expect(panel.getByTestId("pdf-text-readiness")).toContainText("已检查实际导出文件");
  await page.screenshot({ path: info.outputPath("pdf-diagnostics.png") });
});
