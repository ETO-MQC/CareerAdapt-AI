import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

const TEMPLATE_IDS = [
  "classic-technical",
  "modern-operations",
  "ats-minimal",
  "business-consulting",
  "campus-clean",
  "professional-classic"
] as const;

function resolvePdfTextBinary() {
  const candidates = [
    "E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe",
    "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? "pdftotext";
}

const PDFTOTEXT = resolvePdfTextBinary();

async function bypassSetupIfNeeded(page: Page) {
  await page.goto("/resume");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  const setupVisible = await skip.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
  if (setupVisible) {
    await skip.click();
    await expect(skip).toBeHidden({ timeout: 10_000 });
    await page.goto("/resume");
  }
}

async function createGeneralResume(page: Page) {
  await bypassSetupIfNeeded(page);
  await page.getByRole("button", { name: /从个人资料库创建/ }).click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
}

async function openTemplateCenter(page: Page) {
  const styleButton = page.getByRole("button", { name: "样式", exact: true });
  await expect(styleButton).toBeVisible({ timeout: 15_000 });
  await styleButton.click();
  await expect(page.locator(".resume-studio-shell-style")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "模板", exact: true }).click();
  await page.getByRole("button", { name: "模板中心", exact: true }).click();
  await expect(page.getByTestId("template-center")).toBeVisible();
  await expect(page.locator("[data-testid^='template-card-']")).toHaveCount(6);
}

async function contentSignature(page: Page) {
  return page.locator(".resume-preview-stage [data-source-item-id]").evaluateAll((elements) =>
    [...new Set(elements.map((element) => (element as HTMLElement).dataset.sourceItemId ?? ""))]
      .sort()
      .join("\n")
  );
}

async function selectTemplate(page: Page, templateId: string) {
  const card = page.getByTestId(`template-card-${templateId}`);
  await expect(card).toBeVisible();
  const applyButton = card.getByRole("button", { name: /应用模板|当前使用/ }).first();
  if (!(await applyButton.isDisabled())) {
    await applyButton.click();
  }
  await expect(page.locator(".resume-preview-stage").getByTestId("resume-a4-page").first()).toHaveClass(new RegExp(templateId));
  await expect(card).toHaveAttribute("aria-current", "true");
}

async function exportPdf(page: Page, templateId: string, expectedName: string) {
  const downloadButton = page.getByRole("button", { name: "下载 PDF", exact: true });
  await expect(downloadButton).toBeEnabled({ timeout: 30_000 });
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST"
  );
  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");

  const outputDir = resolve(process.cwd(), "test-results", "p4-8b-template-acceptance");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, `${templateId}.pdf`);
  await download.saveAs(outputPath);
  const pdf = await PDFDocument.load(await response.body());
  expect(pdf.getPageCount()).toBeGreaterThan(0);
  const text = execFileSync(PDFTOTEXT, [outputPath, "-"], { encoding: "utf8" });
  expect(text).toContain(expectedName);
  expect(text).not.toContain("模板中心");
  expect(text).not.toContain("编辑区块");
  return { pageCount: pdf.getPageCount(), text };
}

test.describe("P4.8b template and presentation acceptance", () => {
  test("switches all six templates without content or AI-call changes and exports six PDFs", async ({ page }) => {
    test.setTimeout(180_000);
    await createGeneralResume(page);

    let aiCallCount = 0;
    let templateSwitchInProgress = false;
    const templateSwitchAgentRequests: string[] = [];
    const navigations: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/ai(?:\/|$)|\/api\/agent\/(?:turn|stream)(?:\/|$)|\/api\/agent\/runtime\/hermes\/control/.test(request.url())) {
        aiCallCount += 1;
        if (templateSwitchInProgress) templateSwitchAgentRequests.push(request.url());
      }
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });

    await openTemplateCenter(page);
    const initialSignature = await contentSignature(page);
    const expectedName = await page.locator(".resume-preview-stage h1").first().innerText();
    const initialUrl = page.url();
    const aiCallsBeforeSwitch = aiCallCount;
    const renderedClasses: string[] = [];

    for (const templateId of TEMPLATE_IDS) {
      templateSwitchInProgress = true;
      await selectTemplate(page, templateId);
      templateSwitchInProgress = false;
      const pageElement = page.locator(".resume-preview-stage").getByTestId("resume-a4-page").first();
      renderedClasses.push((await pageElement.getAttribute("class")) ?? "");
      expect(await contentSignature(page)).toBe(initialSignature);
      expect(page.url()).toBe(initialUrl);
    }

    expect(new Set(renderedClasses).size).toBe(6);
    expect(templateSwitchAgentRequests).toEqual([]);
    expect(aiCallCount).toBeGreaterThanOrEqual(aiCallsBeforeSwitch);
    expect(navigations).toEqual([]);

    await page.getByRole("button", { name: "关闭模板中心", exact: true }).click();
    await page.getByRole("tab", { name: "页面", exact: true }).click();

    const exported = new Map<string, number>();
    for (const templateId of TEMPLATE_IDS) {
      await page.getByRole("tab", { name: "模板", exact: true }).click();
      await page.getByRole("button", { name: "模板中心", exact: true }).click();
      await expect(page.getByTestId("template-center")).toBeVisible();
      await selectTemplate(page, templateId);
      await page.getByRole("button", { name: "关闭模板中心", exact: true }).click();
      await page.getByRole("tab", { name: "页面", exact: true }).click();
      const result = await exportPdf(page, templateId, expectedName);
      exported.set(templateId, result.pageCount);
    }

    expect(exported.size).toBe(6);
    for (const pageCount of exported.values()) {
      expect(pageCount).toBeGreaterThan(0);
      expect(pageCount).toBeLessThanOrEqual(2);
    }
  });
});
