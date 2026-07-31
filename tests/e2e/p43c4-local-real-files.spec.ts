import { expect, test, type Page } from "@playwright/test";

const cases = [
  {
    format: "Markdown",
    path: process.env.P43C4_MD_PATH,
    sourceKind: "markdown"
  },
  {
    format: "PDF",
    path: process.env.P43C4_PDF_PATH,
    sourceKind: "complex_digital_pdf"
  },
  {
    format: "DOCX",
    path: process.env.P43C4_DOCX_PATH,
    sourceKind: "docx"
  }
] as const;

for (const realCase of cases) {
  test(`P4.3c.4 local ${realCase.format} reaches Review`, async ({ page }) => {
    test.skip(!realCase.path, `Set the P43C4_${realCase.format.toUpperCase()}_PATH environment variable.`);
    test.setTimeout(240_000);
    const startedAt = new Date().toISOString();
    await page.goto("/resume");
    await page.getByRole("button", { name: "导入", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "导入简历" });
    await dialog.getByRole("button", { name: "使用 AI 智能识别", exact: true }).click();
    await dialog.getByLabel("选择要导入的简历文件").setInputFiles(realCase.path!);
    await expect(dialog.locator(".import-review-footer")).toBeVisible({ timeout: 210_000 });
    await expect(dialog.locator(".import-recognition-recovery")).toHaveCount(0);

    const result = await latestImportGateResult(page, startedAt);
    expect(result.draft.sourceKind).toBe(realCase.sourceKind);
    expect(result.draft.parserVersion).toContain("resume-document-mapper.v4-boundary");
    expect(result.logs.length).toBeGreaterThan(0);
    expect(result.logs.every((log) => log.status === "success")).toBe(true);
    expect(result.logs.reduce(
      (sum, log) => sum + (log.attemptCount ?? 1),
      0
    )).toBe(result.logs.length);
    console.info("[resume-document-mapper:p43c4-local-gate]", {
      format: realCase.format,
      reviewResult: "Review",
      provider: result.logs[0]?.provider,
      model: result.logs[0]?.model,
      providerLatencyMs: result.logs.reduce((sum, log) => sum + (log.latencyMs ?? 0), 0),
      providerAttemptCount: result.logs.reduce(
        (sum, log) => sum + (log.attemptCount ?? 1),
        0
      ),
      batchCount: result.logs.length,
      localNormalizationMs: result.logs.reduce(
        (sum, log) => sum + (log.localNormalizationMs ?? 0),
        0
      ),
      shapeRepairs: Array.from(new Set(result.logs.flatMap((log) => log.shapeRepairs ?? []))),
      evidenceRepairs: Array.from(new Set(
        result.logs.flatMap((log) => log.evidenceRepairs ?? [])
      )),
      rejectedFields: result.logs.flatMap((log) => log.rejectedFields ?? []),
      groundedFieldCount: result.logs.reduce(
        (sum, log) => sum + (log.groundedFieldCount ?? 0),
        0
      ),
      repairedFieldCount: result.logs.reduce(
        (sum, log) => sum + (log.repairedFieldCount ?? 0),
        0
      ),
      rejectedFieldCount: result.logs.reduce(
        (sum, log) => sum + (log.rejectedFieldCount ?? 0),
        0
      )
    });
  });
}

type SafeMapperLog = {
  task: string;
  provider: string;
  model?: string;
  latencyMs?: number;
  attemptCount?: number;
  status: string;
  createdAt: string;
  localNormalizationMs?: number;
  groundedFieldCount?: number;
  repairedFieldCount?: number;
  rejectedFieldCount?: number;
  shapeRepairs?: string[];
  evidenceRepairs?: string[];
  rejectedFields?: Array<{ path: string; reason: string }>;
};

async function latestImportGateResult(page: Page, startedAt: string) {
  return page.evaluate(async ({ cutoff }) => {
    const database = await new Promise<IDBDatabase>((resolveDb, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolveDb(request.result);
      request.onerror = () => reject(request.error);
    });
    const readAll = <T>(storeName: string) => new Promise<T[]>((resolveRows, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).getAll();
      request.onsuccess = () => resolveRows(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await readAll<{ key: string; value: {
      sourceKind: string;
      parserVersion: string;
    }; updatedAt: string }>("appMeta");
    const draft = rows
      .filter((row) => row.key.startsWith("importedResumeDraft:") && row.updatedAt >= cutoff)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]!.value;
    const logs = (await readAll<SafeMapperLog>("aiLogs"))
      .filter((log) => log.task === "resume-document-mapper" && log.createdAt >= cutoff)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    database.close();
    return { draft, logs };
  }, { cutoff: startedAt });
}
