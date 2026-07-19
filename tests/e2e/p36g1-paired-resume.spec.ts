import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { wenmoPairedJsonFixture } from "../fixtures/resume-import/wenmo-paired";

const realPdfPath = process.env.P36G1_WENMO_PDF;
const pdfPath = realPdfPath ?? resolve("tests/fixtures/pdf/chinese-resume-edge.pdf");
const jsonPayload = process.env.P36G1_WENMO_JSON
  ? readFileSync(process.env.P36G1_WENMO_JSON, "utf8")
  : JSON.stringify(wenmoPairedJsonFixture);

type MutableImportItem = { structuredItem?: unknown; [key: string]: unknown };
type MutableImportSection = { items: MutableImportItem[]; [key: string]: unknown };
type MutableFieldCandidate = { id: string; targetFieldId: string; [key: string]: unknown };
type MutableImportDraft = { sections: MutableImportSection[]; fieldCandidates: MutableFieldCandidate[] };
type ImportDraftMetaEntry = { key: string; value: MutableImportDraft };

test.describe("P3.6g1 paired resume understanding", () => {
  test("external Wenmo JSON maps to canonical v2 and keeps abnormal phone for review", async ({ page }) => {
    const dialog = await openImport(page);
    await dialog.getByLabel("选择要导入的简历文件").setInputFiles({
      name: "wenmo-resume.json",
      mimeType: "application/json",
      buffer: Buffer.from(jsonPayload)
    });
    await expect(dialog.locator(".import-review-grid")).toBeVisible({ timeout: 60_000 });
    await expect(dialog.locator('input[name="import-basic-phone"]')).toHaveValue("138001380000");
    await expectCounts(dialog, { summary: 1, education: 1, internship: 2, project: 3, skills: 4, certificates: 0, experience: 0 });
    await expect(dialog.locator(".import-field-candidate-list")).toContainText("138001380000");
    await expect(dialog.locator(".import-field-candidate-list")).toContainText("待确认");
    await expect(dialog.locator(".import-structure-panel")).toContainText("示例大学");
    await expect(dialog.locator(".import-structure-panel")).toContainText("计算机相关专业");
    await expect(dialog.locator(".import-structure-panel")).toContainText("本科");
  });

  test("PDF layout graph separates Wenmo sections, project roles and bullet bodies", async ({ page }) => {
    test.skip(!realPdfPath, "requires the paired Wenmo PDF");
    test.setTimeout(90_000);
    const dialog = await openImport(page);
    await dialog.getByLabel("选择要导入的简历文件").setInputFiles(pdfPath);
    await expect(dialog.locator(".import-review-toolbar")).toContainText("结构条目", { timeout: 60_000 });

    await expectCounts(dialog, { summary: 1, education: 1, internship: 2, project: 3, skills: 4, certificates: 0, experience: 0 });
    await expect(dialog.locator('input[name="import-basic-phone"]')).toHaveValue("13800138000");
    const fields = await structuredFields(dialog);
    expect(fields.education?.[0]).toEqual(expect.arrayContaining([
      { term: "学校", value: "示例大学" }, { term: "学历", value: "本科" }, { term: "专业", value: "计算机相关专业" }
    ]));
    expect(fields.project?.map((item) => item.find((field) => field.term === "标题")?.value)).toEqual([
      "示例任务系统 — AI驱动桌面任务与学习规划系统",
      "示例学习助手 — RAG学习助手复刻与增强",
      "示例内容分析系统"
    ]);
    expect(fields.project?.map((item) => item.find((field) => field.term === "角色")?.value)).toEqual(["全栈开发", "独立开发者", "独立开发"]);
    const bodyValues = await dialog.locator(".import-item-row textarea").evaluateAll((inputs) => inputs.map((input) => (input as HTMLTextAreaElement).value));
    expect(bodyValues.every((value) => !value.includes("•"))).toBe(true);
    const highlightsBySection = await highlightLinesBySection(dialog);
    expect(highlightsBySection.internship?.map((lines) => lines.length)).toEqual([3, 2]);
    expect(highlightsBySection.project?.map((lines) => lines.length)).toEqual([4, 4, 4]);
    for (const lines of [...(highlightsBySection.internship ?? []), ...(highlightsBySection.project ?? [])]) {
      expect(new Set(lines).size).toBe(lines.length);
      expect(lines.some((line) => ["AI", "RAG", "SQLite", "Markdown", "KaTeX"].includes(line))).toBe(false);
      expect(lines.every((line) => !line.includes("•"))).toBe(true);
    }
    const skillItems = await itemFieldsAndBodies(dialog, "skills");
    expect(skillItems).toHaveLength(4);
    for (const skill of skillItems) {
      const name = skill.fields.find((field) => field.term === "名称")?.value ?? "";
      expect(name).not.toContain("：");
      expect(name).not.toContain(":");
      expect(skill.body.startsWith(`${name}：`) || skill.body.startsWith(`${name}:`)).toBe(false);
    }
    await expect(dialog.locator('input[name="import-basic-summary"]')).toHaveValue("");
    expect((await itemFieldsAndBodies(dialog, "summary"))[0]?.body).not.toContain("个人总结");
  });

  test("semantic review confirms into Profile, Branch and Revision and survives refresh", async ({ page }) => {
    test.skip(!realPdfPath, "requires the paired Wenmo PDF");
    test.setTimeout(90_000);
    const profileName = `P36g12 ${Date.now()}`;
    let dialog = await openImport(page);
    await dialog.getByLabel("选择要导入的简历文件").setInputFiles(pdfPath);
    await expect(dialog.locator(".import-review-toolbar")).toContainText("0 项待处理", { timeout: 60_000 });
    await mutateLatestImportDraft(page, "ambiguous");
    await dialog.getByRole("button", { name: "关闭导入窗口" }).click();
    dialog = await openImport(page);
    const toolbar = dialog.locator(".import-review-toolbar");
    await expect(toolbar).toContainText(/结构条目 [1-9]\d* 项待确认/, { timeout: 60_000 });
    const structureCount = Number((await toolbar.textContent())?.match(/结构条目 (\d+) 项待确认/)?.[1] ?? "0");
    await expect(dialog.getByRole("button", { name: "采用此条" })).toHaveCount(structureCount);
    await dialog.getByRole("button", { name: "确认全部当前结构" }).click();
    await expect(toolbar).toContainText("0 项待处理");
    await expect(toolbar).toContainText("结构条目 0 项待确认");
    await mutateLatestImportDraft(page, "conflict");
    await dialog.getByRole("button", { name: "关闭导入窗口" }).click();
    dialog = await openImport(page);
    await expect(dialog.locator(".import-review-toolbar")).toContainText(/结构冲突 [1-9]\d* 项/);
    await expect(dialog.locator(".import-review-footer")).toContainText("结构冲突需处理");
    await expect(dialog.getByRole("button", { name: "确认导入", exact: true })).toBeDisabled();
    await mutateLatestImportDraft(page, "clear_conflict");
    await dialog.getByRole("button", { name: "关闭导入窗口" }).click();
    dialog = await openImport(page);
    await expect(dialog.locator(".import-review-toolbar")).toContainText("0 项待处理");
    await dialog.getByLabel("创建新人物").check();
    await dialog.locator("input[name='new-profile-name']").fill(profileName);
    const confirm = dialog.getByRole("button", { name: "确认导入", exact: true });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });

    const profile = (await readStore<{ id: string; name: string }>(page, "profiles")).find((entry) => entry.name === profileName);
    expect(profile).toBeDefined();
    const branch = (await readStore<{ id: string; profileId: string; sourceImportId?: string }>(page, "resumeBranches"))
      .find((entry) => entry.profileId === profile!.id && entry.sourceImportId);
    expect(branch).toBeDefined();
    expect((await readStore<{ branchId: string }>(page, "resumeRevisions")).some((entry) => entry.branchId === branch!.id)).toBe(true);

    await page.reload();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
    expect((await readStore<{ id: string }>(page, "profiles")).some((entry) => entry.id === profile!.id)).toBe(true);
    expect((await readStore<{ id: string }>(page, "resumeBranches")).some((entry) => entry.id === branch!.id)).toBe(true);

  });
});

async function openImport(page: Page): Promise<Locator> {
  await page.goto("/resume");
  await page.getByTestId("resume-entry-import-primary").click();
  return page.getByRole("dialog", { name: "导入简历" });
}

async function expectCounts(dialog: Locator, expected: Record<string, number>) {
  const counts = await dialog.locator("article.review-row").evaluateAll((sections) => Object.fromEntries(
    ["summary", "education", "internship", "project", "skills", "certificates", "experience"].map((type) => [type, sections
      .filter((section) => (section.querySelector("select[name^='import-section-'][name$='-type']") as HTMLSelectElement | null)?.value === type)
      .reduce((sum, section) => sum + section.querySelectorAll(".import-item-row").length, 0)])
  ));
  expect(counts).toEqual(expected);
}

async function structuredFields(dialog: Locator) {
  const entries = await dialog.locator("article.review-row").evaluateAll((sections) => sections.map((section) => ({
    type: (section.querySelector("select[name^='import-section-'][name$='-type']") as HTMLSelectElement | null)?.value ?? "unknown",
    items: Array.from(section.querySelectorAll(".import-item-structured-fields")).map((fields) => Array.from(fields.querySelectorAll("div")).map((row) => ({
      term: row.querySelector("dt")?.textContent?.trim() ?? "",
      value: row.querySelector("dd")?.textContent?.trim() ?? ""
    })))
  })));
  return Object.fromEntries(entries.map((entry) => [entry.type, entry.items])) as Record<string, Array<Array<{ term: string; value: string }>>>;
}

async function highlightLinesBySection(dialog: Locator) {
  const entries = await dialog.locator("article.review-row").evaluateAll((sections) => sections.map((section) => ({
    type: (section.querySelector("select[name^='import-section-'][name$='-type']") as HTMLSelectElement | null)?.value ?? "unknown",
    items: Array.from(section.querySelectorAll(".import-item-row textarea")).map((input) => (input as HTMLTextAreaElement).value.split(/\n+/).map((line) => line.trim()).filter(Boolean))
  })));
  return Object.fromEntries(entries.map((entry) => [entry.type, entry.items])) as Record<string, string[][]>;
}

async function itemFieldsAndBodies(dialog: Locator, sectionType: string) {
  return dialog.locator("article.review-row").evaluateAll((sections, expectedType) => sections
    .filter((section) => (section.querySelector("select[name^='import-section-'][name$='-type']") as HTMLSelectElement | null)?.value === expectedType)
    .flatMap((section) => Array.from(section.querySelectorAll(".import-item-row")).map((item) => ({
      fields: Array.from(item.querySelectorAll(".import-item-structured-fields div")).map((row) => ({
        term: row.querySelector("dt")?.textContent?.trim() ?? "",
        value: row.querySelector("dd")?.textContent?.trim() ?? ""
      })),
      body: (item.querySelector("textarea") as HTMLTextAreaElement | null)?.value ?? ""
    }))), sectionType);
}

async function readStore<T>(page: Page, storeName: string): Promise<T[]> {
  return page.evaluate((name) => new Promise<T[]>((resolveRows, reject) => {
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
  }), storeName);
}

async function mutateLatestImportDraft(page: Page, mode: "ambiguous" | "conflict" | "clear_conflict") {
  await page.evaluate((mutationMode) => new Promise<void>((resolveMutation, reject) => {
    const request = indexedDB.open("CareerAdaptDb");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("appMeta", "readwrite");
      const store = tx.objectStore("appMeta");
      const getAll = store.getAll();
      getAll.onerror = () => reject(getAll.error);
      getAll.onsuccess = () => {
        const entry = (getAll.result as ImportDraftMetaEntry[]).find((row) => row.key.startsWith("importedResumeDraft:"));
        if (!entry) return reject(new Error("import draft not found"));
        if (mutationMode === "ambiguous") {
          let remaining = 2;
          entry.value.sections = entry.value.sections.map((section) => ({
            ...section,
            items: section.items.map((item) => {
              if (!item.structuredItem || remaining === 0) return item;
              remaining -= 1;
              return { ...item, sourceStatus: "ambiguous", included: true, userEdited: false };
            })
          }));
        } else if (mutationMode === "conflict") {
          const candidate = entry.value.fieldCandidates[0];
          const alternateTarget = candidate.targetFieldId === "basics.email" ? "basics.phone" : "basics.email";
          entry.value.fieldCandidates.push({
            ...candidate,
            id: `${candidate.id}:invariant-conflict`,
            targetFieldId: alternateTarget,
            needsConfirmation: false,
            userConfirmed: true,
            reviewStatus: "accepted"
          });
        } else {
          entry.value.fieldCandidates = entry.value.fieldCandidates.filter((candidate) => !candidate.id.endsWith(":invariant-conflict"));
        }
        store.put(entry);
      };
      tx.oncomplete = () => { db.close(); resolveMutation(); };
      tx.onerror = () => reject(tx.error);
    };
  }), mode);
}
