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
    expect(result.draft.parserVersion).toContain("resume-document-mapper.v5-canonical-v2");
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

test("P4.3c.5 local real files preserve equivalent canonical semantics", async ({ page }) => {
  const missing = cases.filter((realCase) => !realCase.path).map((realCase) => realCase.format);
  test.skip(missing.length > 0, `Set P43C4 paths for all formats: ${missing.join(", ")}.`);
  test.setTimeout(720_000);

  const results = [];
  for (const realCase of cases) {
    const startedAt = new Date().toISOString();
    await importResume(page, realCase.path!);
    const result = await latestImportGateResult(page, startedAt);
    const counts = semanticCounts(result.draft);
    results.push({ format: realCase.format, counts, logs: result.logs });
  }

  const reference = results[0]!.counts;
  for (const result of results.slice(1)) {
    expect(result.counts.itemsBySection).toEqual(reference.itemsBySection);
    expect(result.counts.educationIdentity).toEqual(reference.educationIdentity);
    expect(result.counts.projectTitles).toEqual(reference.projectTitles);
    expect(result.counts.workEntities).toEqual(reference.workEntities);
    expect(result.counts.skillInventory).toEqual(reference.skillInventory);
  }

  console.info("[resume-document-mapper:p43c5-equivalence-gate]", results.map((result) => ({
    format: result.format,
    sections: result.counts.sectionCount,
    itemsBySection: result.counts.itemsBySection,
    educationIdentity: result.counts.educationIdentity,
    projectTitles: result.counts.projectTitles,
    workEntities: result.counts.workEntities,
    skillInventory: result.counts.skillInventory,
    unclassifiedCount: result.counts.unclassifiedCount,
    providerAttemptCount: result.logs.reduce((sum, log) => sum + (log.attemptCount ?? 1), 0),
    providerOutputChars: result.logs.reduce((sum, log) => sum + (log.outputLength ?? 0), 0),
    localNormalizationMs: result.logs.reduce((sum, log) => sum + (log.localNormalizationMs ?? 0), 0)
  })));
});

type SafeMapperLog = {
  task: string;
  provider: string;
  model?: string;
  latencyMs?: number;
  outputLength?: number;
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

type DraftForGate = {
  sourceKind: string;
  parserVersion: string;
  sourceBlocks: Array<{ position?: Record<string, number> }>;
  basics?: { headline?: { value?: string }; targetRole?: { value?: string } };
  sections?: Array<{
    sectionType: string;
    items: Array<{
      structuredItem?: Record<string, unknown>;
      normalizedText?: string;
    }>;
  }>;
  unclassifiedBlocks?: unknown[];
};

async function importResume(page: Page, filePath: string) {
  await page.goto("/resume");
  await page.getByRole("button", { name: "导入", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入简历" });
  await dialog.getByRole("button", { name: "使用 AI 智能识别", exact: true }).click();
  await dialog.getByLabel("选择要导入的简历文件").setInputFiles(filePath);
  await expect(dialog.locator(".import-review-footer")).toBeVisible({ timeout: 210_000 });
  await expect(dialog.locator(".import-recognition-recovery")).toHaveCount(0);
}

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
    const rows = await readAll<{ key: string; value: DraftForGate; updatedAt: string }>("appMeta");
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

function semanticCounts(draft: DraftForGate) {
  const sections = draft.sections ?? [];
  const itemsBySection = Object.fromEntries(sections.map((section): [string, number] => [
    section.sectionType,
    section.items.length
  ]).sort(([left], [right]) => left.localeCompare(right)));
  const structuredItems = sections.flatMap((section) =>
    section.items.map((item) => ({
      sectionType: section.sectionType,
      item: item.structuredItem ?? {}
    }))
  );
  return {
    sectionCount: sections.length,
    itemsBySection,
    unclassifiedCount: draft.unclassifiedBlocks?.length ?? 0,
    headlinePresent: Boolean(draft.basics?.headline?.value ?? draft.basics?.targetRole?.value),
    educationIdentity: structuredItems
      .filter(({ sectionType }) => sectionType === "education")
      .map(({ item }) => compactIdentity(item, ["school", "major", "degree", "startDate", "endDate"]))
      .sort(),
    workEntities: structuredItems
      .filter(({ sectionType }) => sectionType === "work" || sectionType === "internship")
      .map(({ item }) => compactIdentity(item, ["organization", "role", "startDate", "endDate", "current"]))
      .sort(),
    projectTitles: structuredItems
      .filter(({ sectionType }) => sectionType === "project")
      .map(({ item }) => compactIdentity(item, ["title", "role", "startDate", "endDate", "current"]))
      .sort(),
    skillInventory: structuredItems
      .filter(({ sectionType }) => sectionType === "skills")
      .map(({ item }) => compactIdentity(item, ["category", "name", "level", "description"]))
      .sort()
  };
}

function compactIdentity(item: Record<string, unknown>, keys: string[]) {
  return keys.map((key) => {
    const value = item[key];
    return Array.isArray(value) ? value.join("/") : String(value ?? "");
  }).join("|");
}
