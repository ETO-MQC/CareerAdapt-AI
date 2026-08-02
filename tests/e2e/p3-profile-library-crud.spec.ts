import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
      baseUrl: "",
      apiKey: "mock-key",
      model: "",
      provider: "mock"
    }));
  });
});

test("canonical profile categories preserve structured fields, identities, and section types after reload", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByLabel("选择人物")).toBeVisible();
  await expect(page.getByLabel("选择人物").locator("option")).not.toHaveCount(0);
  const seeded = await seedCanonicalProfileFacts(page);
  await page.reload();

  const edits = [
    { category: "project", sectionType: "project", selector: "#profile-project-organization", before: "Canonical Project A", after: "Canonical Project A RC2", id: "canonical-project-a", field: "title" },
    { category: "award", sectionType: "awards", selector: "#profile-award-title", before: "Canonical Award", after: "Canonical Award RC2", id: "canonical-award", field: "name" },
    { category: "skill", sectionType: "skills", selector: "#profile-skill-title", before: "Canonical Skill", after: "Canonical Skill RC2", id: "canonical-skill", field: "name" },
    { category: "certificate", sectionType: "certificates", selector: "#profile-certificate-title", before: "Canonical Certificate", after: "Canonical Certificate RC2", id: "canonical-certificate", field: "name" },
    { category: "language", sectionType: "languages", selector: "#profile-language-title", before: "Canonical Language", after: "Canonical Language RC2", id: "canonical-language", field: "language" }
  ] as const;

  for (const edit of edits) {
    const category = page.locator(`[data-profile-category="${edit.category}"]`);
    await expect(category).toHaveAttribute("data-section-type", edit.sectionType);
    await category.click();
    const row = page.getByTestId("profile-managed-list").locator(".profile-managed-row").filter({ hasText: edit.before });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: `编辑 ${edit.before}` }).click();
    await page.locator(edit.selector).fill(edit.after);
    await page.locator(".profile-detail-panel").getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByTestId("profile-managed-list")).toContainText(edit.after);

    if (edit.category === "project") {
      await page.getByTestId("profile-managed-list").locator(".profile-managed-row").filter({ hasText: "Canonical Project B" }).click();
      await page.getByTestId("profile-managed-list").locator(".profile-managed-row").filter({ hasText: edit.after }).click();
      await expect(page.locator(".profile-detail-panel")).toContainText(edit.after);
    }
  }

  await page.reload();
  const stored = await readProfileRecord(page, seeded.profileId);
  expect(stored.version).toBe(seeded.version + edits.length);
  for (const edit of edits) {
    const entry = stored.structuredFacts.find((item) => item.data.id === edit.id);
    expect(entry?.data.sectionType).toBe(edit.sectionType);
    expect(entry?.data[edit.field]).toBe(edit.after);
    expect(entry?.factIds).toEqual([`fact-${edit.id}`]);
    expect(entry?.mappingTrace).toEqual([]);
  }
  expect(stored.structuredFacts.find((item) => item.data.id === "canonical-project-b")?.data.title).toBe("Canonical Project B");
});

test("profile items edit in place and support archive, delete, and batch delete", async ({ page }) => {
  await page.goto("/profile");
  await page.locator('[data-profile-category="skill"]').click();

  const list = page.getByTestId("profile-managed-list");
  const rows = list.locator(".profile-managed-row");
  const initialCount = await rows.count();
  expect(initialCount).toBeGreaterThanOrEqual(2);

  const originalTitle = (await rows.first().locator("strong").innerText()).trim();
  const editedTitle = `${originalTitle} 编辑验证`;
  await rows.first().getByRole("button", { name: `编辑 ${originalTitle}` }).click();
  const detail = page.locator(".profile-detail-panel");
  await detail.locator("input").first().fill(editedTitle);
  await detail.getByRole("button", { name: "保存", exact: true }).click();
  await expect(rows).toHaveCount(initialCount);
  await expect(list).toContainText(editedTitle);

  const editedRow = rows.filter({ hasText: editedTitle });
  await editedRow.getByRole("button", { name: `归档 ${editedTitle}` }).click();
  await expect(editedRow).toHaveCount(0);
  await page.locator(".profile-list-panel select").selectOption("archived");
  const archivedRow = rows.filter({ hasText: editedTitle });
  await expect(archivedRow).toBeVisible();
  await archivedRow.getByRole("button", { name: `删除 ${editedTitle}` }).click();
  await expect(archivedRow).toHaveCount(0);

  await page.locator(".profile-list-panel select").selectOption("all");
  const remainingCount = await rows.count();
  expect(remainingCount).toBeGreaterThan(0);
  await page.getByRole("button", { name: "批量删除" }).click();
  await rows.first().click();
  await page.getByRole("button", { name: /删除选中/ }).click();
  await expect(rows).toHaveCount(remainingCount - 1);
});

test("structured profile categories delete to recycle bin and restore without field loss", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByLabel("选择人物")).toBeVisible();
  await expect(page.getByLabel("选择人物").locator("option")).not.toHaveCount(0);
  const seeded = await seedCanonicalProfileFacts(page);
  await page.reload();

  await page.locator('[data-profile-category="publications"]').click();
  const publication = page.getByTestId("profile-managed-list").locator(".profile-managed-row").filter({ hasText: "Canonical Publication" });
  await publication.getByRole("button", { name: "删除 Canonical Publication" }).click();
  await expect(publication).toHaveCount(0);

  await page.goto("/recycle");
  const recycled = page.locator(".recycle-row").filter({ hasText: "Canonical Publication" });
  await expect(recycled).toBeVisible();
  await recycled.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(recycled).toHaveCount(0);

  await page.goto("/profile");
  await page.locator('[data-profile-category="publications"]').click();
  await expect(page.getByTestId("profile-managed-list")).toContainText("Canonical Publication");
  const restored = await readProfileRecord(page, seeded.profileId);
  expect(restored.structuredFacts.find((item) => item.data.id === "canonical-publication")).toMatchObject({
    data: {
      sectionType: "publications",
      doi: "10.0000/canonical",
      publisher: "Canonical Journal"
    },
    factIds: ["fact-canonical-publication"],
    sourceBlockIds: ["block-canonical-publication"]
  });
});

test("exports only the selected person's complete profile library as JSON", async ({ page }) => {
  await page.goto("/profile");
  const selectedProfileId = await page.getByLabel("选择人物").inputValue();
  const selectedProfileName = await page.getByLabel("选择人物").locator("option:checked").innerText();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();

  expect(download.suggestedFilename()).toMatch(/^careeradapt-profile-.*-\d{4}-\d{2}-\d{2}\.json$/);
  expect(downloadPath).not.toBeNull();
  const payload = JSON.parse(await readFile(downloadPath!, "utf8")) as {
    format: string;
    profile: { id: string; name: string; structuredBasics: unknown; structuredFacts: unknown[] };
    archive: { experiences: unknown[]; certificates: unknown[]; skills: unknown[]; customBlocks: unknown[] };
  };
  expect(payload).toMatchObject({
    format: "careeradapt-profile-export-v1",
    profile: {
      id: selectedProfileId,
      name: selectedProfileName
    },
    archive: {
      experiences: expect.any(Array),
      certificates: expect.any(Array),
      skills: expect.any(Array),
      customBlocks: expect.any(Array)
    }
  });
  expect(payload.profile.structuredBasics).toBeDefined();
  expect(payload.profile.structuredFacts).toEqual(expect.any(Array));
  expect(payload).not.toHaveProperty("resumes");
  expect(payload).not.toHaveProperty("agentSessions");
  await expect(page.getByText(`已导出 ${selectedProfileName} 的完整资料库 JSON。`)).toBeVisible();
});

test("deletes the current profile from the top bar through the guarded delete flow", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByLabel("选择人物").locator("option:checked")).toHaveText("同学");

  const deleteButton = page.getByTestId("profile-delete-topbar");
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();

  const dialog = page.getByRole("dialog", { name: "删除当前个人资料？" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "确认删除" }).click();

  await expect(page.getByText("资料已删除")).toBeVisible();
  await expect(deleteButton).toBeDisabled();
  await expect(page.getByRole("heading", { name: "还没有个人资料" })).toBeVisible();
});

type StoredProfile = {
  id: string;
  version: number;
  structuredFacts: Array<{
    data: Record<string, unknown> & { id: string; sectionType: string };
    factIds: string[];
    sourceBlockIds: string[];
    mappingTrace: unknown[];
  }>;
};

async function seedCanonicalProfileFacts(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("CareerAdaptDb");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("profiles", "readwrite");
    const store = transaction.objectStore("profiles");
    const profiles = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const get = store.getAll();
      get.onsuccess = () => resolve(get.result as Array<Record<string, unknown>>);
      get.onerror = () => reject(get.error);
    });
    const profile = profiles[0];
    const version = Number(profile.version);
    const entry = (data: Record<string, unknown> & { id: string; sectionType: string }) => ({
      data,
      factIds: [`fact-${data.id}`],
      sourceBlockIds: [`block-${data.id}`],
      sourceRanges: [],
      mappingTrace: []
    });
    const common = { customFields: [] };
    const structuredFacts = [
      entry({ ...common, id: "canonical-project-a", sectionType: "project", title: "Canonical Project A", role: "Owner", startDate: "2025-01", current: true, tools: ["TypeScript"], highlights: ["Structured project description"], outcomes: [] }),
      entry({ ...common, id: "canonical-project-b", sectionType: "project", title: "Canonical Project B", role: "Reviewer", startDate: "2024-01", endDate: "2024-12", current: false, tools: [], highlights: ["Sibling item"], outcomes: [] }),
      entry({ ...common, id: "canonical-award", sectionType: "awards", name: "Canonical Award", issuer: "RC Committee", awardedAt: "2025-05", description: "Award description" }),
      entry({ ...common, id: "canonical-skill", sectionType: "skills", name: "Canonical Skill", category: "Engineering", description: "Skill description" }),
      entry({ ...common, id: "canonical-certificate", sectionType: "certificates", name: "Canonical Certificate", issuer: "RC Institute", issuedAt: "2025-04", description: "Certificate description" }),
      entry({ ...common, id: "canonical-language", sectionType: "languages", language: "Canonical Language", level: "Professional", description: "Language description" }),
      entry({ ...common, id: "canonical-publication", sectionType: "publications", title: "Canonical Publication", authors: ["陈同学"], publisher: "Canonical Journal", doi: "10.0000/canonical", description: "Publication description" })
    ];
    store.put({
      ...profile,
      experiences: [],
      skills: [],
      certificates: [],
      structuredFacts,
      version,
      updatedAt: new Date().toISOString()
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    return { profileId: String(profile.id), version };
  });
}

async function readProfileRecord(page: import("@playwright/test").Page, profileId: string) {
  return page.evaluate(async (id) => {
    const request = indexedDB.open("CareerAdaptDb");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const profile = await new Promise<StoredProfile>((resolve, reject) => {
      const get = database.transaction("profiles", "readonly").objectStore("profiles").get(id);
      get.onsuccess = () => resolve(get.result as StoredProfile);
      get.onerror = () => reject(get.error);
    });
    database.close();
    return profile;
  }, profileId);
}
