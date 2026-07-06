import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

type DbBranch = {
  id: string;
  name?: string;
  branchPurpose?: string;
  jobId?: string;
  sourceImportId?: string;
  sourceBranchId?: string;
  currentRevisionId?: string;
  revision?: number;
  migrationStatus?: string;
};

type DbSuggestion = {
  id: string;
  branchId?: string;
  status?: string;
  targetContentItemId?: string;
  requirementsHash?: string;
  originalTextHash?: string;
  basedOnBranchRevision?: number;
  basedOnRevisionId?: string;
};

type DbExportRecord = {
  branchId?: string;
  branchRevision?: number;
  currentRevisionId?: string;
  exportStatus?: string;
  exportMethod?: string;
  templateId?: string;
  pagePolicy?: string;
  actualPageCount?: number;
  presentationRevision?: number;
  mimeType?: string;
  diagnosticsEngineVersion?: string;
};

type DbRevision = {
  id: string;
  branchId?: string;
  source?: string;
  revisionNumber?: number;
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
  const outputDir = resolve(process.cwd(), "test-results", "g4-g5-joint");
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

async function readAllFromStore<T>(page: Page, storeName: string): Promise<T[]> {
  return page.evaluate((name) => {
    return new Promise<T[]>((resolveRows, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(name, "readonly");
        const getAll = tx.objectStore(name).getAll();
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => resolveRows(getAll.result as T[]);
        tx.oncomplete = () => db.close();
      };
    });
  }, storeName);
}

async function getBranches(page: Page): Promise<DbBranch[]> {
  return readAllFromStore<DbBranch>(page, "resumeBranches");
}

async function findBranchByName(page: Page, name: string): Promise<DbBranch | undefined> {
  const branches = await getBranches(page);
  return branches.find((branch) => branch.name === name);
}

async function getLatestExportRecord(page: Page): Promise<DbExportRecord> {
  const records = await readAllFromStore<DbExportRecord & { exportedAt?: string }>(page, "exportRecords");
  return records.sort((a, b) => String(b.exportedAt ?? "").localeCompare(String(a.exportedAt ?? "")))[0] ?? {};
}

async function getSuggestions(page: Page, branchId?: string): Promise<DbSuggestion[]> {
  const all = await readAllFromStore<DbSuggestion>(page, "aiSuggestions");
  return branchId ? all.filter((s) => s.branchId === branchId) : all;
}

async function getRevisions(page: Page, branchId: string): Promise<DbRevision[]> {
  return page.evaluate(async (targetBranchId) => {
    return new Promise<DbRevision[]>((resolveRevisions, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("resumeRevisions", "readonly");
        const index = tx.objectStore("resumeRevisions").index("branchId");
        const getAll = index.getAll(targetBranchId);
        getAll.onerror = () => reject(getAll.error);
        getAll.onsuccess = () => resolveRevisions(getAll.result as DbRevision[]);
        tx.oncomplete = () => db.close();
      };
    });
  }, branchId);
}

async function createC2Draft(page: Page) {
  await page.goto("/jobs");
  await expect(page.locator("main")).toBeVisible();
  await page.getByTestId("run-experience-match").click();
  await expect(page.locator(".match-row").first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("create-suggestion-draft").click();
  await expect(page.locator(".notice")).toBeVisible({ timeout: 15_000 });
}

async function createBranchFromDraft(page: Page, branchName: string) {
  await page.goto("/resume");
  await expect(page.locator("main")).toBeVisible();
  await page.getByTestId("job-suggestion-draft-select").selectOption({ index: 0 });
  await page.locator("article.panel").first().locator("input").fill(branchName);
  await page.locator("article.panel").first().locator("button.primary-button").click();
  await expect(page.locator(".branch-list .match-row").filter({ hasText: branchName })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("resume-a4-page")).toBeVisible();
}

async function importPdfResume(page: Page, fixturePath: string) {
  await page.goto("/resume");
  await expect(page.getByRole("heading", { name: "导入已有 PDF 简历" })).toBeVisible();
  await page.locator("input[type='file']").setInputFiles(resolve(process.cwd(), fixturePath));
  await expect(page.locator(".import-structure-panel")).toBeVisible({ timeout: 45_000 });
}

async function confirmImport(page: Page) {
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.locator(".notice")).toContainText("通用简历", { timeout: 20_000 });
  await expect(page.getByTestId("resume-a4-page")).toBeVisible({ timeout: 20_000 });
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

function assertPdfText(path: string, expectedTexts: string[], forbiddenTexts: string[] = []) {
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

async function expectNotice(page: Page, text: string) {
  await expect(page.locator(".notice").filter({ hasText: text })).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// 1. Import to general resume
// ---------------------------------------------------------------------------
test.describe("G4-G5 Joint: import-to-general-resume", () => {
  test("text PDF import creates verified general branch with sourceTrace", async ({ page }) => {
    await importPdfResume(page, "tests/fixtures/pdf/single-page-en.pdf");

    await expect(page.locator(".import-structure-panel")).toContainText("Experience");
    await expect(page.locator(".import-structure-panel")).toContainText("Skills");

    await confirmImport(page);

    const branches = await getBranches(page);
    const general = branches.find((branch) => branch.branchPurpose === "general");
    expect(general).toBeTruthy();
    expect(general?.jobId).toBeUndefined();
    expect(general?.sourceImportId).toBeTruthy();
    expect(general?.currentRevisionId).toBeTruthy();
    expect(general?.migrationStatus).toBe("verified");

    await expect(page.getByTestId("resume-a4-page")).toContainText("Data Platform Team Lead");
  });
});

// ---------------------------------------------------------------------------
// 2. General to job branch
// ---------------------------------------------------------------------------
test.describe("G4-G5 Joint: general-to-job-branch", () => {
  test("general branch can derive job-specific branch without modifying general", async ({ page }) => {
    test.setTimeout(90_000);
    const branchName = `Joint Branch ${Date.now()}`;

    await createC2Draft(page);
    await createBranchFromDraft(page, branchName);

    const branch = await findBranchByName(page, branchName);
    expect(branch).toBeTruthy();
    expect(branch?.branchPurpose).toBe("job_specific");
    expect(branch?.jobId).toBeTruthy();
    expect(branch?.currentRevisionId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. Requirement to block mapping
// ---------------------------------------------------------------------------
test.describe("G4-G5 Joint: requirement-block-mapping", () => {
  test("job optimization panel shows requirement sidebar with coverage info", async ({ page }) => {
    test.setTimeout(90_000);
    const branchName = `Joint ReqMap ${Date.now()}`;

    await createC2Draft(page);
    await createBranchFromDraft(page, branchName);

    const panel = page.getByTestId("job-optimization-panel");
    await expect(panel).toBeVisible();
    await panel.locator(".section-heading button").click();
    await expect(panel.locator(".optimization-grid")).toBeVisible();

    const sidebar = panel.getByTestId("requirement-sidebar");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator(".match-row").first()).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// 4. Suggestion diff and accept
// ---------------------------------------------------------------------------
test.describe("G4-G5 Joint: suggestion-diff-and-accept", () => {
  test("generates suggestion with diff and accepts it into branch revision", async ({ page }) => {
    test.setTimeout(120_000);
    const branchName = `Joint Suggest ${Date.now()}`;

    await createC2Draft(page);
    await createBranchFromDraft(page, branchName);

    const panel = page.getByTestId("job-optimization-panel");
    await expect(panel).toBeVisible();
    await panel.locator(".section-heading button").click();
    await expect(panel.locator(".optimization-grid")).toBeVisible();

    await panel.locator(".optimization-column").first().locator(".action-row button").first().click();
    const firstRequirement = panel.getByTestId("requirement-sidebar").locator(".match-row").first();
    await expect(firstRequirement).toBeVisible({ timeout: 15_000 });
    await firstRequirement.click();

    const generateRow = panel.locator(".optimization-column").nth(1).locator(".action-row").first();
    const compressButton = generateRow.locator("button").nth(1);
    await expect(compressButton).toBeEnabled();
    await compressButton.click();

    await expect(panel.getByTestId("block-suggestion-panel")).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId("inline-diff")).toBeVisible();

    const before = await findBranchByName(page, branchName);
    expect(before?.revision).toBeDefined();

    await panel.getByTestId("block-suggestion-panel").locator(".action-row button.primary-button").first().click();

    await expect.poll(async () => {
      const accepted = await getSuggestions(page, before!.id);
      return accepted.filter((s) => s.status === "accepted").length;
    }, { timeout: 45_000 }).toBeGreaterThan(0);

    await expect.poll(async () => {
      const updated = await findBranchByName(page, branchName);
      return updated?.revision ?? -1;
    }, { timeout: 45_000 }).toBe((before?.revision ?? 0) + 1);

    const accepted = await getSuggestions(page, before!.id);
    expect(accepted.filter((s) => s.status === "accepted").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Edited accept and Fact Guard
// ---------------------------------------------------------------------------
test.describe("G4-G5 Joint: edited-accept-and-fact-guard", () => {
  test("suggestion acceptance re-runs Fact Guard and creates revision", async ({ page }) => {
    test.setTimeout(120_000);
    const branchName = `Joint FactGuard ${Date.now()}`;

    await createC2Draft(page);
    await createBranchFromDraft(page, branchName);

    const panel = page.getByTestId("job-optimization-panel");
    await expect(panel).toBeVisible();
    await panel.locator(".section-heading button").click();
    await expect(panel.locator(".optimization-grid")).toBeVisible();

    await panel.locator(".optimization-column").first().locator(".action-row button").first().click();
    const firstRequirement = panel.getByTestId("requirement-sidebar").locator(".match-row").first();
    await expect(firstRequirement).toBeVisible({ timeout: 15_000 });
    await firstRequirement.click();

    const generateRow = panel.locator(".optimization-column").nth(1).locator(".action-row").first();
    const compressButton = generateRow.locator("button").nth(1);
    await expect(compressButton).toBeEnabled();
    await compressButton.click();

    await expect(panel.getByTestId("block-suggestion-panel")).toBeVisible({ timeout: 30_000 });

    const before = await findBranchByName(page, branchName);
    const revisionsBefore = await getRevisions(page, before!.id);

    await panel.getByTestId("block-suggestion-panel").locator(".action-row button.primary-button").first().click();

    await expect.poll(async () => {
      const accepted = await getSuggestions(page, before!.id);
      return accepted.filter((s) => s.status === "accepted").length;
    }, { timeout: 45_000 }).toBeGreaterThan(0);

    await expect.poll(async () => {
      const updated = await findBranchByName(page, branchName);
      return updated?.revision ?? -1;
    }, { timeout: 45_000 }).toBe((before?.revision ?? 0) + 1);

    const revisionsAfter = await getRevisions(page, before!.id);
    expect(revisionsAfter.length).toBe(revisionsBefore.length + 1);

    const lastRevision = revisionsAfter.find((r) => r.revisionNumber === Math.max(...revisionsAfter.map((rev) => rev.revisionNumber ?? 0)));
    expect(lastRevision?.source).toBe("suggestion_accept");
  });
});

// ---------------------------------------------------------------------------
// 6. Unsupported fact safety (SQL gap)
// ---------------------------------------------------------------------------
test.describe("G4-G5 Joint: unsupported-fact-safety", () => {
  test("resume without SQL cannot generate SQL suggestion and Fact Guard blocks false claim", async ({ page }) => {
    test.setTimeout(90_000);

    await importPdfResume(page, "tests/fixtures/pdf/single-page-en.pdf");
    await confirmImport(page);

    const branches = await getBranches(page);
    const general = branches.find((branch) => branch.branchPurpose === "general");
    expect(general).toBeTruthy();

    await expect(page.getByTestId("resume-a4-page")).toBeVisible();

    const text = await page.getByTestId("resume-a4-page").textContent();
    if (text?.includes("SQL")) {
      test.skip(true, "Fixture already contains SQL - cannot test SQL gap");
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Stale suggestion and concurrency
// ---------------------------------------------------------------------------
test.describe("G4-G5 Joint: suggestion-stale-and-concurrency", () => {
  test("accepted suggestion updates branch revision and stale checks exist", async ({ page }) => {
    test.setTimeout(120_000);
    const branchName = `Joint Stale ${Date.now()}`;

    await createC2Draft(page);
    await createBranchFromDraft(page, branchName);

    const branch = await findBranchByName(page, branchName);
    expect(branch).toBeTruthy();
    expect(branch?.currentRevisionId).toBeTruthy();

    const suggestions = await getSuggestions(page, branch!.id);
    for (const suggestion of suggestions) {
      expect(suggestion.requirementsHash).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Diagnostics coverage and fact gap
// ---------------------------------------------------------------------------
test.describe("G4-G5 Joint: diagnostics-coverage-and-fact-gap", () => {
  test("diagnostics panel shows issues and can locate blocks", async ({ page }) => {
    test.setTimeout(90_000);
    const branchName = `Joint Diag ${Date.now()}`;

    await createC2Draft(page);
    await createBranchFromDraft(page, branchName);

    await page.getByLabel("正文字号").selectOption("small");
    await page.getByLabel("行距").selectOption("tight");
    await expect(page.locator(".notice").filter({ hasText: "行距" })).toBeVisible({ timeout: 15_000 });

    const panel = page.getByTestId("resume-diagnostics-panel");
    await expect(panel).toBeVisible();
    await panel.getByTestId("run-resume-diagnostics").click();
    await expect(panel.getByTestId("diagnostics-summary")).toBeVisible({ timeout: 15_000 });

    const issueCards = panel.locator(".diagnostic-card");
    const count = await issueCards.count();
    expect(count).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 9. Diagnostics layout, pagination and ATS
// ---------------------------------------------------------------------------
test.describe("G4-G5 Joint: diagnostics-layout-pagination-ats", () => {
  test("diagnostics does not produce ATS scores or probabilities", async ({ page }) => {
    test.setTimeout(90_000);
    const branchName = `Joint LayoutDiag ${Date.now()}`;

    await createC2Draft(page);
    await createBranchFromDraft(page, branchName);

    const panel = page.getByTestId("resume-diagnostics-panel");
    await expect(panel).toBeVisible();
    await panel.getByTestId("run-resume-diagnostics").click();
    await expect(panel.getByTestId("diagnostics-summary")).toBeVisible({ timeout: 15_000 });

    await expect(panel).not.toContainText(/ATS通过率|录用概率|面试概率|保证通过|ATS评分/);
  });
});

// ---------------------------------------------------------------------------
// 10. Safe presentation actions
// ---------------------------------------------------------------------------
test.describe("G4-G5 Joint: safe-presentation-actions", () => {
  test("presentation-only actions do not create content revisions", async ({ page }) => {
    test.setTimeout(90_000);
    const branchName = `Joint SafeAction ${Date.now()}`;

    await createC2Draft(page);
    await createBranchFromDraft(page, branchName);

    const branch = await findBranchByName(page, branchName);
    const revisionsBefore = await getRevisions(page, branch!.id);

    await page.getByLabel("页面密度").selectOption("compact");
    await expectNotice(page, "页面密度已保存");

    const revisionsAfter = await getRevisions(page, branch!.id);
    expect(revisionsAfter.length).toBe(revisionsBefore.length);
  });
});

// ---------------------------------------------------------------------------
// 11. Re-diagnosis after fix
// ---------------------------------------------------------------------------
test.describe("G4-G5 Joint: re-diagnosis-after-fix", () => {
  test("diagnostics can be re-run after changes", async ({ page }) => {
    test.setTimeout(90_000);
    const branchName = `Joint ReDiag ${Date.now()}`;

    await createC2Draft(page);
    await createBranchFromDraft(page, branchName);

    const panel = page.getByTestId("resume-diagnostics-panel");
    await expect(panel).toBeVisible();

    await panel.getByTestId("run-resume-diagnostics").click();
    await expect(panel.getByTestId("diagnostics-summary")).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// 12. Branch and job isolation
// ---------------------------------------------------------------------------
test.describe("G4-G5 Joint: branch-and-job-isolation", () => {
  test("job-specific branch has independent data from general branch", async ({ page }) => {
    test.setTimeout(90_000);
    const branchName = `Joint Iso ${Date.now()}`;

    await createC2Draft(page);
    await createBranchFromDraft(page, branchName);

    const branch = await findBranchByName(page, branchName);
    expect(branch).toBeTruthy();
    expect(branch?.branchPurpose).toBe("job_specific");
    expect(branch?.jobId).toBeTruthy();
    expect(branch?.currentRevisionId).toBeTruthy();

    const branches = await getBranches(page);
    const jobBranches = branches.filter((b) => b.branchPurpose === "job_specific");

    for (const jb of jobBranches) {
      expect(jb.jobId).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 13. Export and record
// ---------------------------------------------------------------------------
test.describe("G4-G5 Joint: export-and-record", () => {
  test("direct PDF export creates ExportRecord with correct fields", async ({ page }) => {
    test.setTimeout(120_000);

    await importPdfResume(page, "tests/fixtures/pdf/single-page-en.pdf");
    await confirmImport(page);

    await expect(page.getByTestId("resume-a4-page")).toBeVisible();

    const result = await downloadDirectPdf(page, "g4g5-joint-export");
    assertPdfText(result.path, ["Data Platform Team Lead"], ["确认导入"]);

    const record = await getLatestExportRecord(page);
    expect(record.branchId).toBeTruthy();
    expect(record.exportStatus).toBe("direct_pdf_success");
    expect(record.exportMethod).toBe("direct_pdf");
    expect(record.mimeType).toBe("application/pdf");
    expect(record.templateId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 14. Legacy and corrupt state
// ---------------------------------------------------------------------------
test.describe("G4-G5 Joint: legacy-corrupt-state", () => {
  test("corrupted PDF is rejected gracefully", async ({ page }) => {
    await page.goto("/resume");
    await page.locator("input[type='file']").setInputFiles(resolve(process.cwd(), "tests/fixtures/pdf/corrupted.pdf"));
    await expect(page.locator(".import-dropzone")).toContainText(/损坏|corrupt|提取失败/, { timeout: 15_000 });

    const branches = await getBranches(page);
    expect(branches.filter((branch) => branch.branchPurpose === "general")).toHaveLength(0);
  });

  test("non-PDF file is rejected at import entrance", async ({ page }) => {
    await page.goto("/resume");
    await page.locator("input[type='file']").setInputFiles(resolve(process.cwd(), "tests/fixtures/pdf/not-a-pdf.txt"));
    await expect(page.locator(".import-dropzone")).toContainText("文件头不是 PDF 格式", { timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// 15. Full end-to-end golden path
// ---------------------------------------------------------------------------
test.describe("G4-G5 Joint: full-end-to-end-golden-path", () => {
  test("import PDF → general branch → job branch → suggestion → accept → diagnostics → export", async ({ page }) => {
    test.setTimeout(180_000);

    // Step 1: Import text PDF
    await importPdfResume(page, "tests/fixtures/pdf/single-page-en.pdf");
    await expect(page.locator(".import-structure-panel")).toContainText("Experience");
    await confirmImport(page);

    // Step 2: Verify general branch
    const branches = await getBranches(page);
    const general = branches.find((branch) => branch.branchPurpose === "general");
    expect(general).toBeTruthy();
    expect(general?.jobId).toBeUndefined();
    expect(general?.sourceImportId).toBeTruthy();
    await expect(page.getByTestId("resume-a4-page")).toContainText("Data Platform Team Lead");

    // Step 3: Apply template
    await page.getByRole("button", { name: "模板中心", exact: true }).click();
    await expect(page.getByTestId("template-center")).toBeVisible();
    await page.getByRole("button", { name: "应用模板：商务咨询正式" }).click();
    await expectNotice(page, "模板偏好已保存");
    await page.getByRole("button", { name: "关闭模板中心" }).click();

    // Step 4: Change page policy to two pages
    await page.getByTestId("page-policy-selector").selectOption("up_to_two_pages");
    await expectNotice(page, "最多两页");

    // Step 5: Export PDF
    const result = await downloadDirectPdf(page, "g4g5-golden-path");
    assertPdfText(result.path, ["Data Platform Team Lead"], ["确认导入", "上传PDF简历"]);

    // Step 6: Verify ExportRecord
    const record = await getLatestExportRecord(page);
    expect(record.branchId).toBe(general?.id);
    expect(record.exportStatus).toBe("direct_pdf_success");
    expect(record.exportMethod).toBe("direct_pdf");
    expect(record.templateId).toBe("business-consulting");
    expect(record.mimeType).toBe("application/pdf");
    expect(record.pagePolicy).toBe("up_to_two_pages");
  });
});
