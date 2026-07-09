import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openManualContentTab, openManualPageTab, openManualTemplateTab } from "./support/g7b2Ui";

/**
 * Resolve a working pdftotext/pdfinfo binary.
 * Git/mingw64 bundles poppler v4.00 which cannot extract CID CJK fonts.
 * Prefer a modern poppler (≥23.x) from MiKTeX, conda/poppler, or PATH.
 */
function resolvePopplerBinary(name: "pdftotext" | "pdfinfo"): string {
  const candidates =
    name === "pdftotext"
      ? [
          "E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe",
          "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe",
        ]
      : [
          "E:/Pycharm/Lib/poppler/Library/bin/pdfinfo.exe",
          "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdfinfo.exe",
        ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return name; // fallback to PATH
}

const PDFTOTEXT = resolvePopplerBinary("pdftotext");
const PDFINFO = resolvePopplerBinary("pdfinfo");

async function createC2DraftForSelectedJob(page: Page) {
  await page.getByTestId("run-experience-match").click();
  await expect(page.locator(".match-row").first()).toBeVisible();
  await page.getByTestId("create-suggestion-draft").click();
  await expect(page.locator(".notice")).toBeVisible();
}

async function createD2Branch(page: Page) {
  await page.goto("/jobs");
  await createC2DraftForSelectedJob(page);
  await page.goto("/resume");
  await page.getByTestId("resume-import-strip").waitFor({ state: "visible" });
  await page.getByTestId("job-suggestion-draft-select").selectOption({ index: 0 });
  await page.getByTestId("new-resume-branch-name").fill("D2 Export Branch");
  await page.getByTestId("create-job-resume").click();
  await expect(page.locator(".branch-list .match-row").filter({ hasText: "D2 Export Branch" })).toBeVisible();
  await expect(page.getByTestId("resume-a4-page")).toBeVisible();
}

async function ensureSinglePage(page: Page) {
  await openManualPageTab(page);
  const status = page.getByTestId("overflow-status");
  await expect(status).toBeVisible();
  if ((await status.innerText()).includes("overflow")) {
    await openManualContentTab(page);
    const toggles = page.locator(".branch-editor input[type='checkbox']");
    const count = await toggles.count();
    for (let index = count - 1; index >= 2; index--) {
      await toggles.nth(index).uncheck();
      await page.waitForTimeout(250);
      await openManualPageTab(page);
      if (!(await status.innerText()).includes("overflow")) {
        return;
      }
      await openManualContentTab(page);
    }
  }
  await openManualPageTab(page);
  await expect(status).not.toContainText("overflow");
}

async function generatePdfWithRetry(page: Page, path: string, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.waitForTimeout(1000);
      await page.pdf({ path, format: "A4", printBackground: true, preferCSSPageSize: true });
      return;
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await page.waitForTimeout(2000 * attempt);
    }
  }
}

function assertPdf(path: string, expectedTexts: string[]) {
  const info = execFileSync(PDFINFO, [path], { encoding: "utf8" });
  expect(info).toContain("Pages:           1");
  const pageSize = info.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/);
  expect(pageSize).not.toBeNull();
  expect(Number(pageSize![1])).toBeGreaterThan(594);
  expect(Number(pageSize![1])).toBeLessThan(596);
  expect(Number(pageSize![2])).toBeGreaterThan(841);
  expect(Number(pageSize![2])).toBeLessThan(843);
  expect(info).toContain("A4");

  const text = execFileSync(PDFTOTEXT, [path, "-"], { encoding: "utf8" });
  for (const expected of expectedTexts) {
    expect(text).toContain(expected);
  }
  expect(text).not.toContain("项目空间");
  expect(text).not.toContain("打印 / 保存 PDF");
  expect(text).not.toContain("规则 Fact Guard");
}

test.describe("Stage D2 template preview and PDF export", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {
        document.body.setAttribute("data-print-invoked", "true");
      };
    });
  });

  test("switches templates, persists preference, records export, and generates selectable A4 PDFs", async ({ page }) => {
    await createD2Branch(page);
    await ensureSinglePage(page);

    const preview = page.getByTestId("resume-a4-page");
    await expect(preview).toContainText("陈同学");
    await expect(preview).toContainText("Stata");

    await openManualTemplateTab(page);
    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("modern-operations");
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await expect(preview).toHaveClass(/template-modern-operations/);
    await page.reload();
    await openManualTemplateTab(page);
    await expect(page.locator("label").filter({ hasText: "模板" }).locator("select")).toHaveValue("modern-operations");
    await ensureSinglePage(page);

    await openManualPageTab(page);
    await page.getByRole("button", { name: "打印 / 保存 PDF" }).click();
    await expect(page.locator(".notice")).toContainText("浏览器打印");
    await expect(page.locator("body")).toHaveAttribute("data-print-invoked", "true");

    const exportCount = await page.evaluate(async () => {
      return new Promise<number>((resolveCount, reject) => {
        const request = indexedDB.open("CareerAdaptDb");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("exportRecords", "readonly");
          const countRequest = tx.objectStore("exportRecords").count();
          countRequest.onerror = () => reject(countRequest.error);
          countRequest.onsuccess = () => resolveCount(countRequest.result);
          tx.oncomplete = () => db.close();
        };
      });
    });
    expect(exportCount).toBeGreaterThan(0);

    const outputDir = resolve(process.cwd(), "test-results");
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    await page.emulateMedia({ media: "print" });
    const modernPdf = resolve(outputDir, "d2-template-modern.pdf");
    await generatePdfWithRetry(page, modernPdf);
    assertPdf(modernPdf, ["陈同学", "Stata"]);

    await page.emulateMedia({ media: "screen" });
    await openManualTemplateTab(page);
    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("classic-technical");
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    await ensureSinglePage(page);
    await page.emulateMedia({ media: "print" });
    const classicPdf = resolve(outputDir, "d2-template-classic.pdf");
    await generatePdfWithRetry(page, classicPdf);
    assertPdf(classicPdf, ["陈同学", "Stata"]);
  });
});
