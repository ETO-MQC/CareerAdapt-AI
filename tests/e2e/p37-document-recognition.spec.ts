import { expect, test } from "@playwright/test";
import path from "node:path";

const digitalPdf = path.resolve("tests/fixtures/pdf/single-page-en.pdf");
const scannedPdf = path.resolve("tests/fixtures/pdf/empty-page.pdf");

test.describe("P3.7 document recognition settings and routing", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
        baseUrl: "http://mock.local/v1",
        apiKey: "test-key",
        model: "mock-model",
        provider: "openai-compatible"
      }));
    });
  });

  test("changes parsing mode, checks engines, and keeps settings after reload", async ({ page }) => {
    await page.route("**/api/document-engines/health", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          paddleOcr: { engine: "paddleocr-vl-local", status: "ready", version: "1.6", message: "sidecar ready" },
          modelDirectory: { engine: "paddleocr-vl-model", status: "ready", version: "1.6", message: "config.json ready" },
          python: { engine: "python", status: "ready", version: "3.12.7", message: "python ready" },
          suggestedModelDirectories: ["D:\\Models\\PaddleOCR-VL-1.6"]
        })
      });
    });
    await page.goto("/settings");
    await page.getByRole("button", { name: /文档识别/ }).click();
    await page.getByLabel("默认路线").selectOption("local_ocr");
    await page.getByRole("button", { name: "检测模型" }).click();
    await expect(page.getByText("检查完成。模型只在实际识别时加载。")).toBeVisible();
    await expect(page.getByText("3.12.7", { exact: false })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /文档识别/ }).click();
    await expect(page.getByLabel("默认路线")).toHaveValue("local_ocr");
    await expect(page.getByLabel("模型目录")).toHaveValue("D:\\Models\\PaddleOCR-VL-1.6");
  });

  test("keeps the selected advanced recognition route", async ({ page }) => {
    await setDocumentPreferences(page, { parsingMode: "auto", allowManualRouteSelection: true });
    await page.goto("/resume");
    await page.getByRole("button", { name: "导入", exact: true }).click();
    const advanced = page.locator("details.import-recognition-advanced");
    await advanced.locator("summary").click();
    const manual = advanced.getByRole("button", { name: "人工核对" });
    const automatic = advanced.getByRole("button", { name: "自动提取" });
    await expect(automatic).toHaveAttribute("aria-pressed", "true");
    await manual.click();
    await expect(manual).toHaveAttribute("aria-pressed", "true");
    await expect(manual).toHaveClass(/active/);
    await expect(automatic).toHaveAttribute("aria-pressed", "false");
    await automatic.click();
    await expect(automatic).toHaveAttribute("aria-pressed", "true");
  });

  test("saves the downloaded OCR model directory", async ({ page }) => {
    await page.route("**/api/document-engines/download", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          modelDirectory: "C:\\Users\\Example\\AppData\\Roaming\\CareerAdapt AI\\ocr\\PaddleOCR-VL-1.6",
          downloadedFiles: 16,
          skippedFiles: 0,
          totalBytes: 1_917_255_968,
          message: "模型已下载。"
        })
      });
    });
    await page.goto("/settings");
    await page.getByRole("button", { name: /文档识别/ }).click();
    await page.getByRole("button", { name: "下载 OCR 模型" }).click();
    await expect(page.getByText("模型已下载。 接下来请检测本地环境。")).toBeVisible();
    await expect(page.getByLabel("模型目录")).toHaveValue(/PaddleOCR-VL-1\.6/);
  });

  test("shows PDF.js route for a digital PDF", async ({ page }) => {
    await setDocumentPreferences(page, { parsingMode: "auto" });
    await page.goto("/resume");
    await page.getByRole("button", { name: "导入", exact: true }).click();
    await page.getByRole("button", { name: "仅本地", exact: true }).click();
    await page.getByLabel("选择要导入的简历文件").setInputFiles(digitalPdf);
    await expect(page.locator(".import-routing-panel")).toContainText("PDF.js 文本层");
    await expect(page.locator(".import-routing-panel")).toContainText("坐标");
  });

  test("routes a scanned PDF to local OCR", async ({ page }) => {
    await setDocumentPreferences(page, { parsingMode: "auto", localOcrEnabled: true });
    await mockOcr(page, true);
    await page.goto("/resume");
    await page.getByRole("button", { name: "导入", exact: true }).click();
    await page.getByRole("button", { name: "仅本地", exact: true }).click();
    await page.getByLabel("选择要导入的简历文件").setInputFiles(scannedPdf);
    await expect(page.locator(".import-routing-panel")).toContainText("本地 OCR");
    await expect(page.locator(".import-source-text")).toContainText("OCR Candidate");
  });

  test("falls back to PDF.js when forced OCR is unavailable", async ({ page }) => {
    await setDocumentPreferences(page, { parsingMode: "local_ocr", localOcrEnabled: true });
    await mockOcr(page, false);
    await page.goto("/resume");
    await page.getByRole("button", { name: "导入", exact: true }).click();
    await page.getByRole("button", { name: "仅本地", exact: true }).click();
    await page.getByLabel("选择要导入的简历文件").setInputFiles(digitalPdf);
    await expect(page.locator(".import-routing-panel")).toContainText("PDF.js 文本层");
    await expect(page.locator(".import-routing-panel")).toContainText("回退");
  });
});

async function setDocumentPreferences(page: import("@playwright/test").Page, patch: Record<string, unknown>) {
  await page.addInitScript((nextPatch) => {
    localStorage.setItem("careeradapt.documentRecognition", JSON.stringify({
      schemaVersion: "document-recognition-preferences-v1",
      parsingMode: "auto",
      localOcrEnabled: true,
      modelDirectory: "",
      openDataLoaderExperimental: false,
      allowManualRouteSelection: true,
      ...nextPatch
    }));
  }, patch);
}

async function mockOcr(page: import("@playwright/test").Page, ready: boolean) {
  await page.route("**/api/resume-import/ocr", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: ready,
          engine: "paddleocr-vl-local",
          configured: ready,
          modelAvailable: ready,
          runtimeAvailable: ready,
          message: ready ? "ready" : "not configured"
        })
      });
      return;
    }
    await route.fulfill({
      status: ready ? 200 : 503,
      contentType: "application/json",
      body: ready ? JSON.stringify({
        ok: true,
        engine: "paddleocr-vl-local",
        engineVersion: "1.6",
        modelName: "PaddleOCR-VL-1.6",
        elapsedMs: 1200,
        pageCount: 1,
        text: "OCR Candidate\nocr@example.com",
        blocks: [{
          id: "ocr:1:block:0",
          page: 1,
          text: "OCR Candidate\nocr@example.com",
          rawText: "OCR Candidate\nocr@example.com",
          blockType: "text_block",
          order: 0,
          confidence: 0.8
        }],
        warnings: []
      }) : JSON.stringify({ message: "not configured" })
    });
  });
}
