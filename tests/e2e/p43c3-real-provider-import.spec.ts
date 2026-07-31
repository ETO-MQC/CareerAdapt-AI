import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const cases = [
  {
    format: "Markdown",
    fixture: "tests/fixtures/resume-import/semantic-single-column.md",
    sourceKind: "markdown"
  },
  {
    format: "DOCX",
    fixture: "tests/fixtures/resume-import/ordinary.docx",
    sourceKind: "docx"
  },
  {
    format: "PDF",
    fixture: "tests/fixtures/pdf/two-column-reportlab.pdf",
    sourceKind: "complex_digital_pdf"
  }
] as const;

for (const realCase of cases) {
  test(`real provider ${realCase.format} import reaches Review`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/resume");
    await page.getByRole("button", { name: "导入", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "导入简历" });
    await dialog.getByRole("button", { name: "使用 AI 智能识别", exact: true }).click();
    await dialog.getByLabel("选择要导入的简历文件").setInputFiles(
      resolve(process.cwd(), realCase.fixture)
    );
    await expect(dialog.locator(".import-review-footer")).toBeVisible({ timeout: 210_000 });
    await expect(dialog.locator(".import-recognition-recovery")).toHaveCount(0);

    const result = await latestImportGateResult(page);
    const counts = semanticCounts(result.draft);
    expect(result.draft.sourceKind).toBe(realCase.sourceKind);
    expect(result.draft.parserVersion).toContain("resume-document-mapper.v6-canonical-v2");
    expect(counts.structuredItemCount).toBe(counts.itemCount);
    expect(result.logs.length).toBeGreaterThan(0);
    expect(result.logs.every((log) => log.status === "success")).toBe(true);
    if (realCase.format === "PDF") {
      const positioned = result.draft.sourceBlocks.filter((block) => block.position);
      expect(positioned.length).toBeGreaterThan(0);
      expect(positioned.every((block) =>
        Object.values(block.position!).every((value) => typeof value === "number" && Number.isFinite(value))
      )).toBe(true);
    }
    console.info("[resume-document-mapper:e2e-real-gate]", {
      format: realCase.format,
      provider: result.logs[0]?.provider,
      model: result.logs[0]?.model,
      latencyMs: result.logs.reduce((sum, log) => sum + (log.latencyMs ?? 0), 0),
      attemptCount: result.logs.reduce((sum, log) => sum + (log.attemptCount ?? 1), 0),
      batchCount: result.logs.length,
      counts
    });
  });
}

type DraftForGate = {
  sourceKind: string;
  parserVersion: string;
  sourceBlocks: Array<{ position?: Record<string, number> }>;
  sections?: Array<{
    sectionType: string;
    items: Array<{
      structuredItem?: Record<string, unknown>;
    }>;
  }>;
  unclassifiedBlocks?: unknown[];
};

async function latestImportGateResult(page: Page) {
  return page.evaluate(async () => {
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
    const rows = await readAll<{ key: string; value: DraftForGate; updatedAt: string }>("appMeta");
    const draft = rows
      .filter((row) => row.key.startsWith("importedResumeDraft:"))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]!.value;
    const logs = (await readAll<{
      task: string;
      provider: string;
      model?: string;
      latencyMs?: number;
      attemptCount?: number;
      status: string;
      createdAt: string;
    }>("aiLogs"))
      .filter((log) => log.task === "resume-document-mapper")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    database.close();
    return { draft, logs };
  });
}

function semanticCounts(draft: DraftForGate) {
  const sections = draft.sections ?? [];
  const itemCount = sections.reduce((sum, section) => sum + section.items.length, 0);
  return {
    sectionCount: sections.length,
    itemCount,
    structuredItemCount: sections.reduce(
      (sum, section) => sum + section.items.filter((item) => item.structuredItem).length,
      0
    ),
    itemsBySection: Object.fromEntries(sections.map((section): [string, number] => [
      section.sectionType,
      section.items.length
    ]).sort(([left], [right]) => left.localeCompare(right))),
    unclassifiedCount: draft.unclassifiedBlocks?.length ?? 0
  };
}
