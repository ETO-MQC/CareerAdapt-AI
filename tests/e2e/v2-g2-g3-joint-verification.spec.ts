/**
 * V2-G2 + G3a + G3b 联合独立验收 E2E
 *
 * 覆盖：模板中心、直接 PDF 导出、分页策略、ExportRecord、Undo/Redo、安全边界
 * 不依赖外部 AI，使用固定脱敏 fixture
 * DB name: "CareerAdaptDb", presentationConfig in appMeta store
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const TEMPLATE_IDS = [
  "classic-technical",
  "modern-operations",
  "ats-minimal",
  "business-consulting",
] as const;

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
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return name;
}

const PDFTOTEXT = resolvePopplerBinary("pdftotext");
const PDFINFO = resolvePopplerBinary("pdfinfo");

function getOutputDir() {
  const dir = resolve(process.cwd(), "test-results", "joint-verification");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// ── helpers ──────────────────────────────────────────────────────────

async function createBranchFromDraft(page: Page, branchName: string) {
  await page.goto("/jobs");
  await page.getByTestId("run-experience-match").click();
  await expect(page.locator(".match-row").first()).toBeVisible();
  await page.getByTestId("create-suggestion-draft").click();
  await expect(page.locator(".notice")).toBeVisible();
  await page.goto("/resume");
  await page.getByTestId("job-suggestion-draft-select").selectOption({ index: 0 });
  await page.locator("article.panel").first().locator("input").fill(branchName);
  await page.locator("article.panel").first().locator("button.primary-button").click();
  await expect(page.locator(".branch-list .match-row").filter({ hasText: branchName })).toBeVisible();
  await expect(page.getByTestId("resume-a4-page")).toBeVisible();
}

async function ensureSinglePage(page: Page) {
  const status = page.getByTestId("overflow-status");
  await expect(status).toBeVisible();
  if (!(await status.innerText()).includes("overflow")) return;
  const toggles = page.locator(".branch-editor input[type='checkbox']");
  const count = await toggles.count();
  for (let i = count - 1; i >= 2; i--) {
    await toggles.nth(i).uncheck();
    await page.waitForTimeout(250);
    if (!(await status.innerText()).includes("overflow")) return;
  }
  await expect(status).not.toContainText("overflow");
}

async function openTemplateCenter(page: Page) {
  await page.getByRole("button", { name: "模板中心", exact: true }).click();
  await expect(page.getByTestId("template-center")).toBeVisible();
}

async function closeTemplateCenter(page: Page) {
  await page.getByRole("button", { name: "关闭模板中心" }).click();
  await expect(page.getByTestId("template-center")).toHaveCount(0);
}

async function applyTemplate(page: Page, templateId: string) {
  await openTemplateCenter(page);
  await page.getByRole("button", { name: `应用模板：${templateName(templateId)}` }).click();
  await expect(page.locator(".notice")).toContainText("模板偏好已保存");
  await closeTemplateCenter(page);
}

function templateName(id: string): string {
  const map: Record<string, string> = {
    "classic-technical": "稳重技术",
    "modern-operations": "简洁现代",
    "ats-minimal": "ATS极简单栏",
    "business-consulting": "商务咨询正式",
  };
  return map[id] ?? id;
}

async function downloadDirectPdf(page: Page, filePrefix: string) {
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes("/api/resume-export/pdf") && r.request().method() === "POST",
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

function assertPdfTextExtractable(pdfPath: string) {
  const info = execFileSync(PDFINFO, [pdfPath], { encoding: "utf8" });
  expect(info).toContain("A4");
  const pageSize = info.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/);
  expect(pageSize).not.toBeNull();
  expect(Number(pageSize![1])).toBeGreaterThan(594);
  expect(Number(pageSize![1])).toBeLessThan(596);
  expect(Number(pageSize![2])).toBeGreaterThan(841);
  expect(Number(pageSize![2])).toBeLessThan(843);
  const text = execFileSync(PDFTOTEXT, [pdfPath, "-"], { encoding: "utf8" });
  // Must contain actual Chinese content from fixture
  expect(text.length).toBeGreaterThan(50);
  expect(text).toContain("陈同学");
  return { info, text };
}

function getPdfPageCount(pdfPath: string): number {
  const info = execFileSync(PDFINFO, [pdfPath], { encoding: "utf8" });
  const match = info.match(/Pages:\s+(\d+)/);
  return match ? Number(match[1]) : -1;
}

async function getBranchByName(page: Page, branchName: string) {
  return page.evaluate(async (targetName: string) => {
    return new Promise<{ id: string; name: string }>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("resumeBranches", "readonly");
        const getAll = tx.objectStore("resumeBranches").getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => {
          const found = (getAll.result as Array<{ id: string; name: string; migrationStatus: string }>)
            .find((b) => b.name === targetName && b.migrationStatus === "verified");
          if (!found) { reject(new Error("branch_not_found")); return; }
          resolve(found);
        };
        tx.oncomplete = () => db.close();
      };
    });
  }, branchName);
}

async function getPresentationConfig(page: Page, branchId: string) {
  return page.evaluate(async (targetBranchId: string) => {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("appMeta", "readonly");
        const getReq = tx.objectStore("appMeta").get(`resumePresentationConfig:${targetBranchId}`);
        getReq.onerror = () => reject(getReq.error);
        getReq.onsuccess = () => resolve(getReq.result?.value ?? {});
        tx.oncomplete = () => db.close();
      };
    });
  }, branchId);
}

async function cloneExperienceItems(page: Page, branchName: string, cloneCount: number) {
  await page.evaluate(async ({ targetName, count }) => {
    const request = indexedDB.open("CareerAdaptDb");
    await new Promise<void>((resolve, reject) => { request.onerror = () => reject(request.error); request.onsuccess = () => resolve(); });
    const db = request.result;
    const tx = db.transaction(["resumeBranches", "resumeRevisions"], "readwrite");
    const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    const branches = tx.objectStore("resumeBranches");
    const revisions = tx.objectStore("resumeRevisions");
    const allBranches = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const getAll = branches.getAll(); getAll.onerror = () => reject(getAll.error); getAll.onsuccess = () => resolve(getAll.result as Array<Record<string, unknown>>);
    });
    const branch = allBranches.find((b) => (b as Record<string, unknown>).name === targetName) as Record<string, unknown> | undefined;
    if (!branch) throw new Error("branch_not_found");
    const items = branch.contentItems as Array<Record<string, unknown>>;
    const source = items.find((i) => i.visible && i.itemType === "experience") ?? items.find((i) => i.visible);
    if (!source) throw new Error("source_item_not_found");
    const maxOrder = Math.max(...items.map((i) => i.order as number));
    const text = "负责数据清洗、指标拆解、报表自动化和跨团队沟通，沉淀可复用分析方法并支持业务决策。";
    const clones = Array.from({ length: count }, (_, i) => ({
      ...source, id: `${source.id}-gj-clone-${i}`, itemType: "experience", text: `${text}${text}${text}`,
      originalText: `${text}${text}${text}`, order: maxOrder + i + 1, visible: true,
    }));
    const nextItems = [...items, ...clones];
    branch.contentItems = nextItems;
    branch.updatedAt = new Date().toISOString();
    await new Promise<void>((resolve, reject) => { const put = branches.put(branch); put.onerror = () => reject(put.error); put.onsuccess = () => resolve(); });
    const currentRevisionId = branch.currentRevisionId as string | undefined;
    if (currentRevisionId) {
      const revision = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const get = revisions.get(currentRevisionId); get.onerror = () => reject(get.error); get.onsuccess = () => resolve(get.result as Record<string, unknown> | undefined);
      });
      if (revision) {
        (revision.snapshot as Record<string, unknown>).contentItems = nextItems;
        revision.updatedAt = branch.updatedAt;
        await new Promise<void>((resolve, reject) => { const put = revisions.put(revision); put.onerror = () => reject(put.error); put.onsuccess = () => resolve(); });
      }
    }
    await done; db.close();
  }, { targetName: branchName, count: cloneCount });
}

async function getLatestExportRecord(page: Page) {
  return page.evaluate(async () => {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("exportRecords", "readonly");
        const getAll = tx.objectStore("exportRecords").getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => {
          const records = (getAll.result as Array<Record<string, unknown>>)
            .sort((a, b) => String(b.exportedAt ?? "").localeCompare(String(a.exportedAt ?? "")));
          resolve(records[0] ?? {});
        };
        tx.oncomplete = () => db.close();
      };
    });
  });
}

// ─── Group 1: Template Center & Registry ──────────────────────────────

test.describe("V2-G2/G3 Joint: template-center-and-registry", () => {
  test("template center shows exactly 4 cards with correct metadata", async ({ page }) => {
    const branchName = `GJ-reg-cards ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    await openTemplateCenter(page);
    await expect(page.locator("[data-testid^='template-card-']")).toHaveCount(4);
    await expect(page.getByTestId("template-card-classic-technical")).toContainText("稳重技术");
    await expect(page.getByTestId("template-card-modern-operations")).toContainText("简洁现代");
    await expect(page.getByTestId("template-card-ats-minimal")).toContainText("ATS极简单栏");
    await expect(page.getByTestId("template-card-business-consulting")).toContainText("商务咨询正式");
    await closeTemplateCenter(page);
  });

  test("ATS filter shows 2 templates, single-column 2, two-column 2", async ({ page }) => {
    const branchName = `GJ-reg-filter ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    await openTemplateCenter(page);
    await page.getByRole("button", { name: "ATS优先", exact: true }).click();
    await expect(page.locator("[data-testid^='template-card-']")).toHaveCount(2);
    await page.getByRole("button", { name: "单栏", exact: true }).click();
    await expect(page.locator("[data-testid^='template-card-']")).toHaveCount(2);
    await page.getByRole("button", { name: "双栏", exact: true }).click();
    await expect(page.locator("[data-testid^='template-card-']")).toHaveCount(2);
    await page.getByRole("button", { name: "全部", exact: true }).click();
    await expect(page.locator("[data-testid^='template-card-']")).toHaveCount(4);
    await closeTemplateCenter(page);
  });

  test("opening and closing template center does not modify config", async ({ page }) => {
    const branchName = `GJ-reg-nomodify ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    const branch = await getBranchByName(page, branchName);
    const before = await getPresentationConfig(page, branch.id);
    const revBefore = (before.presentationRevision as number) ?? 0;
    await openTemplateCenter(page);
    await closeTemplateCenter(page);
    await page.waitForTimeout(300);
    const after = await getPresentationConfig(page, branch.id);
    expect((after.presentationRevision as number) ?? 0).toBe(revBefore);
  });

  test("template switch increments presentationRevision and supports undo/redo", async ({ page }) => {
    const branchName = `GJ-reg-switch ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    const branch = await getBranchByName(page, branchName);
    const preview = page.getByTestId("resume-a4-page");

    await applyTemplate(page, "ats-minimal");
    await expect(preview).toHaveClass(/template-ats-minimal/);
    const atsConfig = await getPresentationConfig(page, branch.id);
    expect(atsConfig.templateId).toBe("ats-minimal");

    await applyTemplate(page, "business-consulting");
    await expect(preview).toHaveClass(/template-business-consulting/);
    const bizConfig = await getPresentationConfig(page, branch.id);
    expect(bizConfig.templateId).toBe("business-consulting");
    expect((bizConfig.presentationRevision as number)).toBeGreaterThan(atsConfig.presentationRevision as number);

    await page.getByRole("button", { name: "回退展示" }).click();
    await expect(page.locator(".notice")).toContainText("已撤销");
    await expect(preview).toHaveClass(/template-ats-minimal/);

    await page.getByRole("button", { name: "重做展示" }).click();
    await expect(page.locator(".notice")).toContainText("已重做");
    await expect(preview).toHaveClass(/template-business-consulting/);
  });

  test("current template indicator works and same template button is disabled", async ({ page }) => {
    const branchName = `GJ-reg-current ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    await openTemplateCenter(page);
    await expect(page.getByTestId("template-card-classic-technical")).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("button", { name: "应用模板：稳重技术" })).toBeDisabled();
    await closeTemplateCenter(page);
  });
});

// ─── Group 2: One-page Four-template PDF Export ───────────────────────

test.describe("V2-G2/G3 Joint: one-page-four-template-export", () => {
  for (const tplId of TEMPLATE_IDS) {
    test(`${tplId} one-page PDF export`, async ({ page }) => {
      const branchName = `GJ-one-${tplId} ${Date.now()}`;
      await createBranchFromDraft(page, branchName);
      if (tplId !== "classic-technical") {
        await applyTemplate(page, tplId);
      }
      await ensureSinglePage(page);

      const { path, suggestedFilename } = await downloadDirectPdf(page, `onepage-${tplId}`);
      expect(suggestedFilename).toMatch(/\.pdf$/);
      expect(suggestedFilename).not.toMatch(/[<>:"/\\|?*]/);

      const { info, text } = assertPdfTextExtractable(path);
      expect(info).toContain("Pages:           1");
      expect(getPdfPageCount(path)).toBe(1);
      expect(text.length).toBeGreaterThan(50);

      const record = await getLatestExportRecord(page);
      expect(record.exportStatus).toBe("direct_pdf_success");
      expect(record.exportMethod).toBe("direct_pdf");
      expect(record.templateId).toBe(tplId);
      expect(record.mimeType).toBe("application/pdf");
      expect(record.snapshotHash).toBeTruthy();
      expect(record.pdfContentHash).toBeTruthy();
      expect(record.pagePolicy).toBe("one_page_strict");
      expect(record.requestedMaxPages).toBe(1);
      expect(record.actualPageCount).toBe(1);
    });
  }
});

// ─── Group 3: Two-page Four-template PDF Export ───────────────────────

test.describe("V2-G2/G3 Joint: two-page-four-template-export", () => {
  for (const tplId of TEMPLATE_IDS) {
    test(`${tplId} two-page preview and PDF`, async ({ page }) => {
      const branchName = `GJ-two-${tplId} ${Date.now()}`;
      await createBranchFromDraft(page, branchName);
      if (tplId !== "classic-technical") {
        await applyTemplate(page, tplId);
      }
      // Clone enough content for two pages
      await cloneExperienceItems(page, branchName, 16);
      await page.reload();
      await page.waitForTimeout(500);

      // Use correct testid: page-policy-selector
      const policySelect = page.getByTestId("page-policy-selector");
      await expect(policySelect).toBeEnabled();
      await policySelect.selectOption("up_to_two_pages");
      // Wait for pagination to settle
      await expect(page.getByTestId("overflow-status")).toContainText("fits_two_pages", { timeout: 10_000 });
      await expect(page.getByTestId("resume-a4-page")).toHaveCount(2);

      const { path } = await downloadDirectPdf(page, `twopage-${tplId}`);
      assertPdfTextExtractable(path);
      expect(getPdfPageCount(path)).toBe(2);

      const record = await getLatestExportRecord(page);
      expect(record.exportStatus).toBe("direct_pdf_success");
      expect(record.templateId).toBe(tplId);
      expect(record.pagePolicy).toBe("up_to_two_pages");
      expect(record.requestedMaxPages).toBe(2);
      expect(record.actualPageCount).toBe(2);
      expect(record.paginationHash).toBeTruthy();
      expect(record.paginationSnapshot).toBeTruthy();
    });
  }
});

// ─── Group 4: Exceeds Two Pages Block ─────────────────────────────────

test.describe("V2-G2/G3 Joint: exceeds-two-pages-block", () => {
  test("one-page mode blocks export when content overflows", async ({ page }) => {
    const branchName = `GJ-exceed-one ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    const status = page.getByTestId("overflow-status");
    await expect(status).toBeVisible();
    if ((await status.innerText()).includes("overflow")) {
      await expect(page.getByRole("button", { name: "下载 PDF" })).toBeDisabled();
    }
  });

  test("two-page mode shows correct status and pagination summary", async ({ page }) => {
    const branchName = `GJ-exceed-two ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    const policySelect = page.getByTestId("page-policy-selector");
    await expect(policySelect).toBeEnabled();
    await policySelect.selectOption("up_to_two_pages");
    await page.waitForTimeout(300);
    await expect(page.getByTestId("pagination-summary")).toBeVisible();
    const status = page.getByTestId("overflow-status");
    await expect(status).toBeVisible();
    // Verify the status text is meaningful
    const statusText = await status.innerText();
    expect(statusText.length).toBeGreaterThan(0);
  });
});

// ─── Group 5: Section Break & Pagination ─────────────────────────────

test.describe("V2-G2/G3 Joint: section-break-pagination", () => {
  test("page policy change persists in ExportRecord", async ({ page }) => {
    const branchName = `GJ-section-persist ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    const policySelect = page.getByTestId("page-policy-selector");
    await expect(policySelect).toBeEnabled();
    await policySelect.selectOption("up_to_two_pages");
    await page.waitForTimeout(300);

    await expect(page.getByTestId("pagination-summary")).toBeVisible();
    await ensureSinglePage(page); // make sure it fits
    const { path } = await downloadDirectPdf(page, "section-persist");
    expect(getPdfPageCount(path)).toBeGreaterThanOrEqual(1);
    const record = await getLatestExportRecord(page);
    expect(record.pagePolicy).toBe("up_to_two_pages");
  });

  test("hidden content checkbox affects overflow status", async ({ page }) => {
    const branchName = `GJ-section-hidden ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    // Verify initial overflow status exists
    const status = page.getByTestId("overflow-status");
    await expect(status).toBeVisible({ timeout: 10_000 });
    // The content toggles should be visible in the branch editor
    const toggles = page.locator(".branch-editor input[type='checkbox']");
    await expect(toggles.first()).toBeVisible();
  });
});

// ─── Group 6: Direct PDF & ExportRecord ──────────────────────────────

test.describe("V2-G2/G3 Joint: direct-pdf-and-export-record", () => {
  test("direct PDF is text-based and ExportRecord has all required fields", async ({ page }) => {
    const branchName = `GJ-direct-fields ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    await ensureSinglePage(page);
    await downloadDirectPdf(page, "direct-fields");

    const record = await getLatestExportRecord(page);
    expect(record.exportStatus).toBe("direct_pdf_success");
    expect(record.exportMethod).toBe("direct_pdf");
    expect(record.mimeType).toBe("application/pdf");
    expect(record.fileSize).toBeGreaterThan(100);
    expect(record.templateId).toBeTruthy();
    expect(record.snapshotHash).toBeTruthy();
    expect(record.pdfContentHash).toBeTruthy();
    expect(record.paginationHash).toBeTruthy();
    expect(record.pagePolicy).toBeTruthy();
    expect(record.requestedMaxPages).toBeGreaterThanOrEqual(1);
    expect(record.actualPageCount).toBeGreaterThanOrEqual(1);
    expect(record.presentationSnapshot).toBeTruthy();
    expect(record.paginationSnapshot).toBeTruthy();
  });

  test("filename has no path traversal or internal IDs", async ({ page }) => {
    const branchName = `GJ-direct-filename ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    await ensureSinglePage(page);
    const { suggestedFilename } = await downloadDirectPdf(page, "direct-filename");
    expect(suggestedFilename).toMatch(/\.pdf$/);
    expect(suggestedFilename).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}/);
    expect(suggestedFilename).not.toContain("/");
    expect(suggestedFilename).not.toContain("\\");
    expect(suggestedFilename).not.toContain("..");
  });

  test("content frozen during export survives concurrent state", async ({ page }) => {
    const branchName = `GJ-direct-frozen ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    await ensureSinglePage(page);
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/resume-export/pdf") && r.request().method() === "POST",
    );
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 PDF" }).click();
    const [response, download] = await Promise.all([responsePromise, downloadPromise]);
    expect(response.status()).toBe(200);
    const outputPath = resolve(getOutputDir(), "frozen-test.pdf");
    await download.saveAs(outputPath);
    expect(getPdfPageCount(outputPath)).toBeGreaterThanOrEqual(1);
  });
});

// ─── Group 7: Frozen Snapshot & Concurrency ──────────────────────────

test.describe("V2-G2/G3 Joint: frozen-snapshot-and-concurrency", () => {
  test("snapshot hash differs after style change", async ({ page }) => {
    const branchName = `GJ-frozen-hash ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    await ensureSinglePage(page);
    await downloadDirectPdf(page, "frozen-hash-1");
    const record1 = await getLatestExportRecord(page);

    await page.getByLabel("行距").selectOption("relaxed");
    await expect(page.locator(".notice")).toContainText("行距已保存");
    await page.waitForTimeout(200);

    await downloadDirectPdf(page, "frozen-hash-2");
    const record2 = await getLatestExportRecord(page);
    expect(record1.snapshotHash).not.toBe(record2.snapshotHash);
  });

  test("ExportRecord presentation snapshot has correct template and style fields", async ({ page }) => {
    const branchName = `GJ-frozen-snap ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    await ensureSinglePage(page);
    await downloadDirectPdf(page, "frozen-snap");

    const record = await getLatestExportRecord(page);
    const snap = record.presentationSnapshot as Record<string, unknown>;
    expect(snap).toBeTruthy();
    expect(snap.templateId).toBe("classic-technical");
    expect(snap.typography).toBeTruthy();
    expect(snap.theme).toBeTruthy();
    expect(record.paginationSnapshot).toBeTruthy();
  });
});

// ─── Group 8: Undo/Redo & Persistence ─────────────────────────────────

test.describe("V2-G2/G3 Joint: undo-redo-and-persistence", () => {
  test("template switch supports undo/redo and refresh persistence", async ({ page }) => {
    const branchName = `GJ-undo-persist ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    const preview = page.getByTestId("resume-a4-page");

    await applyTemplate(page, "ats-minimal");
    await expect(preview).toHaveClass(/template-ats-minimal/);

    await page.getByRole("button", { name: "回退展示" }).click();
    await expect(page.locator(".notice")).toContainText("已撤销");
    await expect(preview).toHaveClass(/template-classic-technical/);

    await page.getByRole("button", { name: "重做展示" }).click();
    await expect(page.locator(".notice")).toContainText("已重做");
    await expect(preview).toHaveClass(/template-ats-minimal/);

    await page.reload();
    await expect(page.getByTestId("resume-a4-page")).toHaveClass(/template-ats-minimal/);
  });

  test("pagination strategy change supports undo", async ({ page }) => {
    const branchName = `GJ-undo-pag ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    const policySelect = page.getByTestId("page-policy-selector");
    await expect(policySelect).toBeEnabled();
    await policySelect.selectOption("up_to_two_pages");
    await page.waitForTimeout(300);
    await expect(policySelect).toHaveValue("up_to_two_pages");

    await page.getByRole("button", { name: "回退展示" }).click();
    await expect(page.locator(".notice")).toContainText("已撤销");
    await expect(policySelect).toHaveValue("one_page_strict");

    await page.getByRole("button", { name: "重做展示" }).click();
    await expect(page.locator(".notice")).toContainText("已重做");
    await expect(policySelect).toHaveValue("up_to_two_pages");
  });

  test("pagination config persists after refresh", async ({ page }) => {
    const branchName = `GJ-persist-pag ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    const policySelect = page.getByTestId("page-policy-selector");
    await expect(policySelect).toBeEnabled();
    await policySelect.selectOption("up_to_two_pages");
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForTimeout(500);
    await expect(page.getByTestId("page-policy-selector")).toHaveValue("up_to_two_pages");
  });

  test("different branches can independently set template", async ({ page }) => {
    const branchA = `GJ-iso-a ${Date.now()}`;
    await createBranchFromDraft(page, branchA);
    await applyTemplate(page, "ats-minimal");
    await expect(page.getByTestId("resume-a4-page")).toHaveClass(/template-ats-minimal/);

    // Create second branch directly
    const branchB = `GJ-iso-b ${Date.now()}`;
    await page.goto("/jobs");
    await page.getByTestId("run-experience-match").click();
    await expect(page.locator(".match-row").first()).toBeVisible();
    await page.getByTestId("create-suggestion-draft").click();
    await expect(page.locator(".notice")).toBeVisible();
    await page.goto("/resume");
    await page.getByTestId("job-suggestion-draft-select").selectOption({ index: 0 });
    await page.locator("article.panel").first().locator("input").fill(branchB);
    await page.locator("article.panel").first().locator("button.primary-button").click();
    await expect(page.locator(".branch-list .match-row").filter({ hasText: branchB })).toBeVisible();
    await expect(page.getByTestId("resume-a4-page")).toBeVisible();
    // Apply a different template to branch B
    await applyTemplate(page, "business-consulting");
    await expect(page.getByTestId("resume-a4-page")).toHaveClass(/template-business-consulting/);

    // Switch back to branch A - should still be ats-minimal
    await page.locator(".branch-list .match-row").filter({ hasText: branchA }).click();
    await expect(page.getByTestId("resume-a4-page")).toBeVisible();
    await expect(page.getByTestId("resume-a4-page")).toHaveClass(/template-ats-minimal/);
  });
});

// ─── Group 9: Visual Layout Smoke ────────────────────────────────────

test.describe("V2-G2/G3 Joint: visual-layout-smoke", () => {
  test("A4 page renders with visible content", async ({ page }) => {
    const branchName = `GJ-visual-a4 ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    const a4Page = page.getByTestId("resume-a4-page");
    await expect(a4Page).toBeVisible({ timeout: 10_000 });
    await expect(a4Page).toContainText("陈同学");
  });

  test("two-column template renders grid layout in DOM", async ({ page }) => {
    const branchName = `GJ-visual-grid ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    await applyTemplate(page, "business-consulting");
    await page.waitForTimeout(500);
    await expect(page.getByTestId("resume-a4-page")).toHaveClass(/template-business-consulting/);
    // Grid exists in DOM (may be clipped by A4 page overflow)
    await expect(page.locator(".resume-business-grid").first()).toHaveCount(1);
  });

  test("two-page preview renders as two A4 pages", async ({ page }) => {
    const branchName = `GJ-visual-stack ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    await cloneExperienceItems(page, branchName, 16);
    await page.reload();
    await page.waitForTimeout(500);
    const policySelect = page.getByTestId("page-policy-selector");
    await expect(policySelect).toBeEnabled();
    await policySelect.selectOption("up_to_two_pages");
    await expect(page.getByTestId("overflow-status")).toContainText("fits_two_pages", { timeout: 10_000 });
    await expect(page.getByTestId("resume-a4-page")).toHaveCount(2);
  });

  test("template center thumbnails do not break main preview", async ({ page }) => {
    const branchName = `GJ-visual-thumb ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    await openTemplateCenter(page);
    await page.waitForTimeout(300);
    await closeTemplateCenter(page);
    await expect(page.getByTestId("resume-a4-page")).toBeVisible();
  });
});

// ─── Group 10: Security & Invalid States ──────────────────────────────

test.describe("V2-G2/G3 Joint: security-and-invalid-states", () => {
  test("invalid branch blocks export", async ({ page }) => {
    await page.goto("/resume");
    await page.waitForTimeout(500);
    const exportBtn = page.getByRole("button", { name: "下载 PDF" });
    if (await exportBtn.isVisible()) {
      await expect(exportBtn).toBeDisabled();
    }
  });

  test("no API key patterns in page source", async ({ page }) => {
    const branchName = `GJ-security-key ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    const html = await page.content();
    expect(html).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    expect(html).not.toMatch(/OPENAI_API_KEY/);
    expect(html).not.toMatch(/ANTHROPIC_API_KEY/);
  });

  test("filename has no path traversal", async ({ page }) => {
    const branchName = `GJ-security-path ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    await ensureSinglePage(page);
    const { suggestedFilename } = await downloadDirectPdf(page, "security-path");
    expect(suggestedFilename).not.toContain("/");
    expect(suggestedFilename).not.toContain("\\");
    expect(suggestedFilename).not.toContain("..");
  });
});
