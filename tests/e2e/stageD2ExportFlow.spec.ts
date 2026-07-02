import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

async function createC2DraftForSelectedJob(page: Page) {
  await page.locator("button").filter({ hasText: "C1" }).first().click();
  await expect(page.locator(".match-row").first()).toBeVisible();
  await page.locator("button").filter({ hasText: "C2" }).first().click();
  await expect(page.locator(".notice")).toContainText("C2");
}

async function createD2Branch(page: Page) {
  await page.goto("/jobs");
  await createC2DraftForSelectedJob(page);
  await page.goto("/resume");
  await page.locator("label").filter({ hasText: "C2" }).locator("select").selectOption({ index: 0 });
  await page.locator("article.panel").first().locator("input").fill("D2 Export Branch");
  await page.locator("article.panel").first().locator("button.primary-button").click();
  await expect(page.locator(".branch-list .match-row").filter({ hasText: "D2 Export Branch" })).toBeVisible();
  await expect(page.getByTestId("resume-a4-page")).toBeVisible();
}

async function ensureSinglePage(page: Page) {
  const status = page.getByTestId("overflow-status");
  await expect(status).toBeVisible();
  if ((await status.innerText()).includes("overflow")) {
    const toggles = page.locator(".branch-editor input[type='checkbox']");
    const count = await toggles.count();
    for (let index = count - 1; index >= 2; index--) {
      await toggles.nth(index).uncheck();
      await page.waitForTimeout(250);
      if (!(await status.innerText()).includes("overflow")) {
        return;
      }
    }
  }
  await expect(status).not.toContainText("overflow");
}

function assertPdf(path: string, expectedTexts: string[]) {
  const info = execFileSync("pdfinfo", [path], { encoding: "utf8" });
  expect(info).toContain("Pages:           1");
  const pageSize = info.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/);
  expect(pageSize).not.toBeNull();
  expect(Number(pageSize![1])).toBeGreaterThan(594);
  expect(Number(pageSize![1])).toBeLessThan(596);
  expect(Number(pageSize![2])).toBeGreaterThan(841);
  expect(Number(pageSize![2])).toBeLessThan(843);
  expect(info).toContain("A4");

  const text = execFileSync("pdftotext", [path, "-"], { encoding: "utf8" });
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

    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("modern-operations");
    await expect(preview).toHaveClass(/template-modern-operations/);
    await page.reload();
    await expect(page.locator("label").filter({ hasText: "模板" }).locator("select")).toHaveValue("modern-operations");
    await ensureSinglePage(page);

    await page.locator(".resume-export-panel button.primary-button").click();
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
    await page.pdf({ path: modernPdf, format: "A4", printBackground: true, preferCSSPageSize: true });
    assertPdf(modernPdf, ["陈同学", "Stata"]);

    await page.emulateMedia({ media: "screen" });
    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("classic-technical");
    await ensureSinglePage(page);
    await page.emulateMedia({ media: "print" });
    const classicPdf = resolve(outputDir, "d2-template-classic.pdf");
    await page.pdf({ path: classicPdf, format: "A4", printBackground: true, preferCSSPageSize: true });
    assertPdf(classicPdf, ["陈同学", "Stata"]);
  });
});
