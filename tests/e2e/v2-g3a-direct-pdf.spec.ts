import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

type DbExportRecord = {
  exportStatus?: string;
  exportMethod?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  templateId?: string;
  presentationRevision?: number;
  snapshotHash?: string;
  pdfContentHash?: string;
  failureCode?: string;
  presentationSnapshot?: {
    templateId?: string;
    hiddenItemIds?: string[];
    typography?: { lineHeight?: string };
    theme?: { accentColor?: string };
  };
};

function resolvePopplerBinary(name: "pdftotext" | "pdfinfo"): string {
  const candidates =
    name === "pdftotext"
      ? [
          "E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe",
          "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"
        ]
      : [
          "E:/Pycharm/Lib/poppler/Library/bin/pdfinfo.exe",
          "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdfinfo.exe"
        ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return name;
}

const PDFTOTEXT = resolvePopplerBinary("pdftotext");
const PDFINFO = resolvePopplerBinary("pdfinfo");

function getOutputDir() {
  const outputDir = resolve(process.cwd(), "test-results");
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

async function createBranchFromDraft(page: Page, branchName: string) {
  await page.goto("/jobs");
  await page.locator("button").filter({ hasText: "C1" }).first().click();
  await expect(page.locator(".match-row").first()).toBeVisible();
  await page.locator("button").filter({ hasText: "C2" }).first().click();
  await expect(page.locator(".notice")).toContainText("C2");

  await page.goto("/resume");
  await page.locator("label").filter({ hasText: "C2" }).locator("select").selectOption({ index: 0 });
  await page.locator("article.panel").first().locator("input").fill(branchName);
  await page.locator("article.panel").first().locator("button.primary-button").click();
  await expect(page.locator(".branch-list .match-row").filter({ hasText: branchName })).toBeVisible();
  await expect(page.getByTestId("resume-a4-page")).toBeVisible();
}

async function ensureSinglePage(page: Page) {
  const status = page.getByTestId("overflow-status");
  await expect(status).toBeVisible();
  if (!(await status.innerText()).includes("overflow")) {
    return;
  }
  const toggles = page.locator(".branch-editor input[type='checkbox']");
  const count = await toggles.count();
  for (let index = count - 1; index >= 2; index--) {
    await toggles.nth(index).uncheck();
    await page.waitForTimeout(250);
    if (!(await status.innerText()).includes("overflow")) {
      return;
    }
  }
  await expect(status).not.toContainText("overflow");
}

async function downloadDirectPdf(page: Page, filePrefix: string) {
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST"
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 PDF" }).click();
  await expect(page.getByTestId("pdf-export-status")).toContainText(/生成|下载|PDF/);
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  const outputPath = resolve(getOutputDir(), `${filePrefix}.pdf`);
  await download.saveAs(outputPath);
  return { path: outputPath, suggestedFilename: download.suggestedFilename() };
}

function assertPdf(path: string, expectedTexts: string[], forbiddenTexts: string[] = []) {
  const info = execFileSync(PDFINFO, [path], { encoding: "utf8" });
  expect(info).toContain("Pages:           1");
  expect(info).toContain("A4");
  const pageSize = info.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/);
  expect(pageSize).not.toBeNull();
  expect(Number(pageSize![1])).toBeGreaterThan(594);
  expect(Number(pageSize![1])).toBeLessThan(596);
  expect(Number(pageSize![2])).toBeGreaterThan(841);
  expect(Number(pageSize![2])).toBeLessThan(843);

  const text = extractPdfText(path);
  for (const expected of expectedTexts) {
    expect(text).toContain(expected);
  }
  for (const forbidden of forbiddenTexts) {
    expect(text).not.toContain(forbidden);
  }
  return text;
}

function extractPdfText(path: string) {
  return execFileSync(PDFTOTEXT, [path, "-"], { encoding: "utf8" });
}

async function getLatestExportRecord(page: Page): Promise<DbExportRecord> {
  return page.evaluate(async () => {
    return new Promise<DbExportRecord>((resolveRecord, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("exportRecords", "readonly");
        const getAll = tx.objectStore("exportRecords").getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => {
          const records = (getAll.result as DbExportRecord[])
            .sort((left, right) => String((right as { exportedAt?: string }).exportedAt ?? "").localeCompare(String((left as { exportedAt?: string }).exportedAt ?? "")));
          resolveRecord(records[0] ?? {});
        };
        tx.oncomplete = () => db.close();
      };
    });
  });
}

async function getExportRecords(page: Page): Promise<DbExportRecord[]> {
  return page.evaluate(async () => {
    return new Promise<DbExportRecord[]>((resolveRecords, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("exportRecords", "readonly");
        const getAll = tx.objectStore("exportRecords").getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => resolveRecords(getAll.result as DbExportRecord[]);
        tx.oncomplete = () => db.close();
      };
    });
  });
}

async function firstRenderedItem(page: Page) {
  return page.getByTestId("resume-a4-page").evaluate((pageElement) => {
    const item = pageElement.querySelector<HTMLElement>("[data-source-item-id]");
    if (!item?.dataset.sourceItemId) {
      throw new Error("rendered_item_not_found");
    }
    return {
      id: item.dataset.sourceItemId,
      text: item.innerText.trim()
    };
  });
}

test.describe("V2-G3a direct PDF download", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {
        document.body.setAttribute("data-print-invoked", "true");
      };
    });
  });

  test("direct-download-button-and-status, valid-pdf-response, filename-generation, Chinese-text-extractable", async ({ page }) => {
    await createBranchFromDraft(page, `V2 G3a 直接下载 ${Date.now()}`);
    await ensureSinglePage(page);

    await expect(page.getByRole("button", { name: "下载 PDF" })).toBeEnabled();
    const result = await downloadDirectPdf(page, "g3a-direct-basic");
    expect(result.suggestedFilename).toContain("陈同学");
    expect(result.suggestedFilename).toContain("数据分析实习生");
    expect(result.suggestedFilename).not.toContain("classic-technical");
    expect(result.suggestedFilename).toMatch(/\.pdf$/);
    assertPdf(result.path, ["陈同学", "demo.student@example.com", "Stata"], ["模板中心", "下载 PDF", "打印 / 保存 PDF", "编辑区块"]);

    const record = await getLatestExportRecord(page);
    expect(record.exportStatus).toBe("direct_pdf_success");
    expect(record.exportMethod).toBe("direct_pdf");
    expect(record.mimeType).toBe("application/pdf");
    expect(record.fileSize).toBeGreaterThan(0);
    expect(record.snapshotHash).toBeTruthy();
    expect(record.pdfContentHash).toBeTruthy();
  });

  test("classic-technical, modern-operations, ats-minimal and business-consulting direct exports", async ({ page }) => {
    await createBranchFromDraft(page, `V2 G3a 四模板 ${Date.now()}`);
    await ensureSinglePage(page);
    const templateIds = ["classic-technical", "modern-operations", "ats-minimal", "business-consulting"];

    for (const templateId of templateIds) {
      await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption(templateId);
      if (templateId !== "classic-technical") {
        await expect(page.locator(".notice")).toContainText("模板偏好已保存");
      }
      await ensureSinglePage(page);
      const result = await downloadDirectPdf(page, `g3a-${templateId}`);
      assertPdf(result.path, ["陈同学", "demo.student@example.com"], ["模板中心", "应用模板", "编辑区块"]);
      const record = await getLatestExportRecord(page);
      expect(record.templateId).toBe(templateId);
      expect(record.presentationSnapshot?.templateId).toBe(templateId);
    }
  });

  test("style-and-hidden-content-consistency and no-editor-controls-in-pdf", async ({ page }) => {
    await createBranchFromDraft(page, `V2 G3a 隐藏样式 ${Date.now()}`);
    await ensureSinglePage(page);

    await page.getByLabel("行距").selectOption("relaxed");
    await expect(page.locator(".notice")).toContainText("行距已保存");
    await page.getByLabel("主题强调色：蓝色").click();
    await expect(page.locator(".notice")).toContainText("主题强调色已保存");

    await page.locator("label").filter({ hasText: "预览区编辑" }).locator("input").check();
    const hidden = await firstRenderedItem(page);
    await page.getByTestId("resume-a4-page").locator(`[data-source-item-id="${hidden.id}"]`).first().click();
    await page.getByRole("button", { name: "Block" }).click();
    await page.getByTestId("block-style-panel").getByRole("button", { name: "隐藏" }).click();
    await expect(page.locator(".notice")).toContainText("内容已隐藏");

    const result = await downloadDirectPdf(page, "g3a-hidden-style");
    const text = assertPdf(result.path, ["陈同学"], ["模板中心", "编辑区块"]);
    expect(text).not.toContain(hidden.text.slice(0, 20));
    const record = await getLatestExportRecord(page);
    expect(record.presentationSnapshot?.hiddenItemIds).toContain(hidden.id);
    expect(record.presentationSnapshot?.typography?.lineHeight).toBe("relaxed");
    expect(record.presentationSnapshot?.theme?.accentColor).toBe("blue");
  });

  test("frozen-snapshot-during-template-switch", async ({ page }) => {
    await createBranchFromDraft(page, `V2 G3a 冻结模板 ${Date.now()}`);
    await ensureSinglePage(page);

    let continueRoute: (() => void) | undefined;
    let capturedTemplateId = "";
    await page.route("**/api/resume-export/pdf", async (route) => {
      capturedTemplateId = JSON.parse(route.request().postData() ?? "{}").snapshot.templateId;
      await new Promise<void>((resolveContinue) => {
        continueRoute = resolveContinue;
      });
      await route.continue();
    });

    const responsePromise = page.waitForResponse((response) => response.url().includes("/api/resume-export/pdf"));
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 PDF" }).click();
    await expect(page.getByTestId("pdf-export-status")).toContainText("正在生成");
    await page.locator("label").filter({ hasText: "模板" }).locator("select").selectOption("ats-minimal");
    await expect(page.locator(".notice")).toContainText("模板偏好已保存");
    continueRoute?.();
    const [response, download] = await Promise.all([responsePromise, downloadPromise]);
    expect(response.status()).toBe(200);
    await download.saveAs(resolve(getOutputDir(), "g3a-frozen-template.pdf"));

    expect(capturedTemplateId).toBe("classic-technical");
    const record = await getLatestExportRecord(page);
    expect(record.presentationSnapshot?.templateId).toBe("classic-technical");
    await page.unroute("**/api/resume-export/pdf");
  });

  test("overflow-block prevents direct download", async ({ page }) => {
    await createBranchFromDraft(page, `V2 G3a overflow ${Date.now()}`);
    await page.addStyleTag({
      content: ".resume-a4-page { height: 72mm !important; }"
    });
    await expect(page.getByTestId("overflow-status")).toContainText("overflow");
    await expect(page.getByRole("button", { name: "下载 PDF" })).toBeDisabled();
    await expect(page.locator(".warning-box")).toContainText("正式导出会被阻止");
  });

  test("export-record-failure, retry-after-failure and browser-print-fallback", async ({ page }) => {
    await createBranchFromDraft(page, `V2 G3a 失败重试 ${Date.now()}`);
    await ensureSinglePage(page);

    await page.route("**/api/resume-export/pdf", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "pdf_generation_failed" })
      });
    });
    await page.getByRole("button", { name: "下载 PDF" }).click();
    await expect(page.getByTestId("pdf-export-status")).toContainText("直接下载失败");
    let records = await getExportRecords(page);
    expect(records.some((record) => record.exportStatus === "direct_pdf_success")).toBe(false);
    expect(records.some((record) => record.exportStatus === "failed" && record.exportMethod === "direct_pdf")).toBe(true);

    await page.getByRole("button", { name: "打印 / 保存 PDF" }).click();
    await expect(page.locator("body")).toHaveAttribute("data-print-invoked", "true");
    records = await getExportRecords(page);
    expect(records.some((record) => record.exportStatus === "print_invoked" && record.exportMethod === "browser_print")).toBe(true);

    await page.unroute("**/api/resume-export/pdf");
    const result = await downloadDirectPdf(page, "g3a-retry-success");
    assertPdf(result.path, ["陈同学", "Stata"], ["模板中心", "编辑区块"]);
    const latest = await getLatestExportRecord(page);
    expect(latest.exportStatus).toBe("direct_pdf_success");
  });

  test("G2-template-center, G1b-style, G0a-edit and D2-print regressions stay usable", async ({ page }) => {
    await createBranchFromDraft(page, `V2 G3a 组合回归 ${Date.now()}`);
    await expect(page.getByRole("button", { name: "模板中心", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "模板中心", exact: true }).click();
    await expect(page.getByTestId("template-center")).toBeVisible();
    await page.getByRole("button", { name: "关闭模板中心" }).click();
    await expect(page.getByTestId("template-center")).toHaveCount(0);

    await page.getByLabel("行距").selectOption("tight");
    await expect(page.locator(".notice")).toContainText("行距已保存");
    await page.locator("label").filter({ hasText: "预览区编辑" }).locator("input").check();
    const item = await firstRenderedItem(page);
    await page.getByTestId("resume-a4-page").locator(`[data-source-item-id="${item.id}"]`).first().click();
    await expect(page.getByTestId("resume-studio-editor")).toBeVisible();

    await page.getByRole("button", { name: "打印 / 保存 PDF" }).click();
    await expect(page.locator("body")).toHaveAttribute("data-print-invoked", "true");
  });
});
