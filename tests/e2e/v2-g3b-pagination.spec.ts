import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

type DbExportRecord = {
  exportStatus?: string;
  exportMethod?: string;
  pagePolicy?: string;
  actualPageCount?: number;
  requestedMaxPages?: number;
  paginationHash?: string;
  exceededPageLimit?: boolean;
  paginationSnapshot?: {
    actualPageCount?: number;
    requestedMaxPages?: number;
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

const PDFINFO = resolvePopplerBinary("pdfinfo");
const PDFTOTEXT = resolvePopplerBinary("pdftotext");

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

async function cloneExperienceItems(page: Page, branchName: string, cloneCount: number) {
  await page.evaluate(async ({ targetName, count }) => {
    type ContentItem = {
      id: string;
      itemType: string;
      text: string;
      originalText: string;
      order: number;
      visible: boolean;
    };
    type Branch = {
      id: string;
      name: string;
      currentRevisionId?: string;
      contentItems: ContentItem[];
      updatedAt: string;
    };
    type Revision = {
      id: string;
      snapshot: { contentItems: ContentItem[] };
      updatedAt: string;
    };
    const request = indexedDB.open("CareerAdaptDb");
    await new Promise<void>((resolveOpen, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolveOpen();
    });
    const db = request.result;
    const tx = db.transaction(["resumeBranches", "resumeRevisions"], "readwrite");
    const done = new Promise<void>((resolveDone, reject) => {
      tx.oncomplete = () => resolveDone();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    const branches = tx.objectStore("resumeBranches");
    const revisions = tx.objectStore("resumeRevisions");
    const allBranches = await new Promise<Branch[]>((resolveAll, reject) => {
      const getAll = branches.getAll();
      getAll.onerror = () => reject(getAll.error);
      getAll.onsuccess = () => resolveAll(getAll.result as Branch[]);
    });
    const branch = allBranches.find((candidate) => candidate.name === targetName);
    if (!branch) {
      throw new Error("branch_not_found");
    }
    const source = branch.contentItems.find((item) => item.visible && item.itemType === "experience") ?? branch.contentItems.find((item) => item.visible);
    if (!source) {
      throw new Error("source_item_not_found");
    }
    const maxOrder = Math.max(...branch.contentItems.map((item) => item.order));
    const text = "负责数据清洗、指标拆解、报表自动化和跨团队沟通，沉淀可复用分析方法并支持业务决策。";
    const clones = Array.from({ length: count }, (_, index) => ({
      ...source,
      id: `${source.id}-g3b-clone-${index}`,
      itemType: "experience",
      text: `${text}${text}${text}`,
      originalText: `${text}${text}${text}`,
      order: maxOrder + index + 1,
      visible: true
    }));
    const nextItems = [...branch.contentItems, ...clones];
    branch.contentItems = nextItems;
    branch.updatedAt = new Date().toISOString();
    await new Promise<void>((resolvePut, reject) => {
      const put = branches.put(branch);
      put.onerror = () => reject(put.error);
      put.onsuccess = () => resolvePut();
    });
    const currentRevisionId = branch.currentRevisionId;
    if (currentRevisionId) {
      const revision = await new Promise<Revision | undefined>((resolveRevision, reject) => {
        const get = revisions.get(currentRevisionId);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => resolveRevision(get.result as Revision | undefined);
      });
      if (revision) {
        revision.snapshot.contentItems = nextItems;
        revision.updatedAt = branch.updatedAt;
        await new Promise<void>((resolvePut, reject) => {
          const put = revisions.put(revision);
          put.onerror = () => reject(put.error);
          put.onsuccess = () => resolvePut();
        });
      }
    }
    await done;
    db.close();
  }, { targetName: branchName, count: cloneCount });
}

async function setPagePolicy(page: Page, policy: "one_page_strict" | "up_to_two_pages") {
  const selector = page.getByTestId("page-policy-selector");
  await expect(selector).toBeEnabled();
  if (await selector.inputValue() !== policy) {
    await selector.selectOption(policy);
  }
  await expect(selector).toHaveValue(policy);
}

async function downloadDirectPdf(page: Page, filePrefix: string) {
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST"
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 PDF" }).click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  expect(response.status()).toBe(200);
  const outputPath = resolve(getOutputDir(), `${filePrefix}.pdf`);
  await download.saveAs(outputPath);
  return outputPath;
}

async function latestExportRecord(page: Page): Promise<DbExportRecord> {
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
          const records = (getAll.result as Array<DbExportRecord & { exportedAt?: string }>)
            .sort((left, right) => String(right.exportedAt ?? "").localeCompare(String(left.exportedAt ?? "")));
          resolveRecord(records[0] ?? {});
        };
        tx.oncomplete = () => db.close();
      };
    });
  });
}

function expectPdfPages(path: string, pages: number) {
  const info = execFileSync(PDFINFO, [path], { encoding: "utf8" });
  expect(info).toContain(`Pages:           ${pages}`);
  expect(info).toContain("A4");
  const text = execFileSync(PDFTOTEXT, [path, "-"], { encoding: "utf8" });
  expect(text).toContain("陈同学");
  expect(text).not.toContain("第 1 页");
  expect(text).not.toContain("下载 PDF");
}

test.describe("V2-G3b pagination policy", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {
        document.body.setAttribute("data-print-invoked", "true");
      };
    });
  });

  test("page-policy-selector, two-page-preview-stack and two-page-direct-pdf", async ({ page }) => {
    const branchName = `V2 G3b 两页 ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    await cloneExperienceItems(page, branchName, 16);
    await page.reload();

    await expect(page.getByTestId("overflow-status")).toContainText("fits_two_pages", { timeout: 10_000 });
    await expect(page.getByRole("button", { name: "下载 PDF" })).toBeDisabled();

    await setPagePolicy(page, "up_to_two_pages");
    await expect(page.getByTestId("overflow-status")).toContainText("fits_two_pages");
    await expect(page.getByTestId("resume-a4-page")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "下载 PDF" })).toBeEnabled();

    const pdfPath = await downloadDirectPdf(page, "g3b-two-page");
    expectPdfPages(pdfPath, 2);
    const record = await latestExportRecord(page);
    expect(record.exportStatus).toBe("direct_pdf_success");
    expect(record.pagePolicy).toBe("up_to_two_pages");
    expect(record.actualPageCount).toBe(2);
    expect(record.requestedMaxPages).toBe(2);
    expect(record.paginationHash).toBeTruthy();
    expect(record.exceededPageLimit).toBe(false);
  });

  test("exceeds-two-pages-blocks-direct-pdf", async ({ page }) => {
    const branchName = `V2 G3b 超两页 ${Date.now()}`;
    await createBranchFromDraft(page, branchName);
    await cloneExperienceItems(page, branchName, 45);
    await page.reload();
    await setPagePolicy(page, "up_to_two_pages");

    await expect(page.getByTestId("overflow-status")).toContainText("exceeds_two_pages", { timeout: 10_000 });
    await expect(page.getByRole("button", { name: "下载 PDF" })).toBeDisabled();
    await page.getByRole("button", { name: "打印 / 保存 PDF" }).click();
    await expect(page.getByTestId("pdf-export-status")).toContainText("已阻止");
    const record = await latestExportRecord(page);
    expect(record.exportStatus).toBe("blocked_overflow");
    expect(record.pagePolicy).toBe("up_to_two_pages");
    expect(record.actualPageCount).toBe(3);
    expect(record.exceededPageLimit).toBe(true);
  });
});
