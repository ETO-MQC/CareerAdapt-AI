import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openManualPageTab } from "./support/g7b2Ui";

type DbBranch = {
  id: string;
  branchPurpose?: string;
  jobId?: string;
  sourceImportId?: string;
  currentRevisionId?: string;
};

type DbExportRecord = {
  branchId?: string;
  exportStatus?: string;
  exportMethod?: string;
  templateId?: string;
  mimeType?: string;
  actualPageCount?: number;
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
  const outputDir = resolve(process.cwd(), "test-results", "g4a-resume-import");
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

test.describe("V2-G4a PDF resume import", () => {
  test("upload text PDF, review, confirm general branch, edit template and download PDF", async ({ page }) => {
    await page.goto("/resume");
    await page.getByRole("button", { name: "导入", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "导入简历" })).toBeVisible();

    const beforeBranches = await getBranches(page);
    expect(beforeBranches.filter((branch) => branch.branchPurpose === "general")).toHaveLength(0);

    await page.getByLabel("选择要导入的简历文件").setInputFiles(resolve(process.cwd(), "tests/fixtures/pdf/single-page-en.pdf"));
    await expect(page.locator(".import-structure-panel")).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(".import-structure-panel")).toContainText("工作经历");
    await expect(page.locator(".import-structure-panel")).toContainText("技能");

    await page.locator(".import-item-row").filter({ hasText: "Backend Engineer" }).locator("input[type='checkbox']").uncheck();
    await page.getByLabel("创建新人物").check();
    const fieldConfirmationButtons = page.getByRole("button", { name: "确认此字段", exact: true });
    while (await fieldConfirmationButtons.count()) {
      await fieldConfirmationButtons.first().click();
    }
    const unclassifiedConfirmationButtons = page.getByRole("button", { name: "核对并保留来源", exact: true });
    while (await unclassifiedConfirmationButtons.count()) {
      await unclassifiedConfirmationButtons.first().click();
    }
    await page.getByRole("button", { name: "确认导入", exact: true }).click();
    await expect(page.locator(".app-notification-success").filter({ hasText: "通用简历" }).last()).toBeVisible({ timeout: 20_000 });
    const openImportedResume = page.getByRole("button", { name: "打开", exact: true });
    if (await openImportedResume.isVisible()) await openImportedResume.click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("resume-a4-page")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("resume-a4-page")).toContainText("Data Platform Team Lead");
    await expect(page.getByTestId("resume-a4-page")).not.toContainText("Backend Engineer");

    const branches = await getBranches(page);
    const general = branches.find((branch) => branch.branchPurpose === "general");
    expect(general).toBeTruthy();
    expect(general?.jobId).toBeUndefined();
    expect(general?.sourceImportId).toBeTruthy();
    expect(general?.currentRevisionId).toBeTruthy();

    await applyTemplate(page, "business-consulting");
    await expect(page.getByTestId("resume-a4-page")).toHaveClass(/template-business-consulting/);
    await openManualPageTab(page);
    const preferOnePage = page.getByTestId("page-policy-selector");
    await preferOnePage.selectOption("natural");
    await expect(preferOnePage).toHaveValue("natural");

    const result = await downloadDirectPdf(page, "g4a-imported-general");
    assertPdf(result.path, ["Data Platform Team Lead", "Python", "SQL"], ["Backend Engineer", "确认导入", "上传PDF简历"]);
    const record = await getLatestExportRecord(page);
    expect(record.branchId).toBe(general?.id);
    expect(record.exportStatus).toBe("direct_pdf_success");
    expect(record.exportMethod).toBe("direct_pdf");
    expect(record.templateId).toBe("business-consulting");
    expect(record.mimeType).toBe("application/pdf");
  });

  test("rejects non-pdf file at the import entrance", async ({ page }) => {
    await page.goto("/resume");
    await page.getByRole("button", { name: "导入", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "导入简历" })).toBeVisible();
    await page.getByLabel("选择要导入的简历文件").setInputFiles(resolve(process.cwd(), "tests/fixtures/pdf/not-a-pdf.txt"));
    await expect(page.locator(".import-dropzone")).toContainText("当前仅支持 PDF、DOCX 和 JSON 简历文件", { timeout: 10_000 });
    const branches = await getBranches(page);
    expect(branches.filter((branch) => branch.branchPurpose === "general")).toHaveLength(0);
  });
});

async function applyTemplate(page: Page, templateId: string) {
  await page.locator(".resume-mode-rail button").nth(2).click();
  await page.getByRole("button", { name: "模板中心", exact: true }).click();
  await expect(page.getByTestId("template-center")).toBeVisible();
  await page.getByRole("button", { name: `应用模板：${templateName(templateId)}` }).click();
  await expect(page.locator(".app-notification-success").filter({ hasText: "模板偏好已保存" }).last()).toBeVisible();
  await page.getByRole("button", { name: "关闭模板中心" }).click();
}

function templateName(id: string): string {
  const map: Record<string, string> = {
    "classic-technical": "稳重技术",
    "modern-operations": "简洁现代",
    "ats-minimal": "ATS极简单栏",
    "business-consulting": "商务咨询正式"
  };
  return map[id] ?? id;
}

async function downloadDirectPdf(page: Page, filePrefix: string) {
  await openManualPageTab(page);
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

function assertPdf(path: string, expectedTexts: string[], forbiddenTexts: string[]) {
  const info = execFileSync(PDFINFO, [path], { encoding: "utf8" });
  expect(info).toContain("A4");
  const text = execFileSync(PDFTOTEXT, [path, "-"], { encoding: "utf8" });
  for (const expected of expectedTexts) {
    expect(text).toContain(expected);
  }
  for (const forbidden of forbiddenTexts) {
    expect(text).not.toContain(forbidden);
  }
}

async function getBranches(page: Page): Promise<DbBranch[]> {
  return page.evaluate(async () => {
    return new Promise<DbBranch[]>((resolveBranches, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("resumeBranches", "readonly");
        const getAll = tx.objectStore("resumeBranches").getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => resolveBranches(getAll.result as DbBranch[]);
        tx.oncomplete = () => db.close();
      };
    });
  });
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
          const records = (getAll.result as DbExportRecord[]).sort((left, right) =>
            String((right as { exportedAt?: string }).exportedAt ?? "").localeCompare(String((left as { exportedAt?: string }).exportedAt ?? ""))
          );
          resolveRecord(records[0] ?? {});
        };
        tx.oncomplete = () => db.close();
      };
    });
  });
}
