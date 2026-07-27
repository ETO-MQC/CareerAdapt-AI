import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

type ProfileSnapshot = {
  id: string;
  version: number;
  experiences: unknown[];
  skills: Array<{ name: string }>;
  certificates: unknown[];
  structuredFacts?: unknown[];
};

test.describe("P4.2a.3d profile reconciliation", () => {
  test("S/V same resume twice keeps Profile and general Resume semantically idempotent", async ({ page }) => {
    await importAsNewProfile(page);
    const before = await profileSnapshot(page, "核对测试用户");
    const branchCount = await activeGeneralBranchCount(page, before.id);

    await openImport(page);
    await page.getByLabel("导入到已有资料").check();
    await page.getByLabel("目标人物").selectOption(before.id);
    await uploadAndReview(page, fixturePath());

    const overview = page.getByRole("region", { name: "资料库导入核对" });
    await expect(overview).toBeVisible();
    await expect(overview.getByText("需确认").locator("..")).toContainText("0");
    await page.getByRole("button", { name: "确认导入", exact: true }).click();
    await expect(page.locator(".app-notification-success").last()).toBeVisible();

    expect(await profileSnapshot(page, "核对测试用户")).toEqual(before);
    expect(await activeGeneralBranchCount(page, before.id)).toBe(branchCount);
    expect(before.skills.map((skill) => skill.name)).toEqual(["Python", "SQL", "Stata"]);
  });

  test("T/W revised resume restores unresolved conflict after reload and commits only the real delta", async ({ page }) => {
    await importAsNewProfile(page);
    const before = await profileSnapshot(page, "核对测试用户");
    const revised = JSON.parse(await readFile(fixturePath(), "utf8")) as Record<string, unknown>;
    const sections = revised.sections as Array<Record<string, unknown>>;
    const project = (sections[0].items as Array<Record<string, unknown>>)[0];
    project.startDate = "2025-02";
    const skill = (sections[1].items as Array<Record<string, unknown>>)[0];
    skill.name = "Python、SQL、Stata、Rust";

    await openImport(page);
    await page.getByLabel("导入到已有资料").check();
    await page.getByLabel("目标人物").selectOption(before.id);
    await uploadAndReview(page, {
      name: "reconciliation-v2-revised.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(revised))
    });
    const overview = page.getByRole("region", { name: "资料库导入核对" });
    await expect(overview.getByText("字段冲突", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "确认导入", exact: true })).toBeDisabled();
    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 }
    ]) {
      await page.setViewportSize(viewport);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({
        path: `test-results/p42a3d-reconciliation-${viewport.width}x${viewport.height}.png`,
        fullPage: true
      });
    }

    await page.reload();
    await page.getByRole("button", { name: "导入", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "导入简历" })).toBeVisible();
    await expect(page.getByRole("region", { name: "资料库导入核对" }).getByText("字段冲突", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "保留原数据", exact: true }).click();
    await expect(page.getByRole("button", { name: "确认导入", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "确认导入", exact: true }).click();
    await expect(page.locator(".app-notification-success").last()).toBeVisible();

    const after = await profileSnapshot(page, "核对测试用户");
    expect(after.experiences).toHaveLength(before.experiences.length);
    expect(after.certificates).toHaveLength(before.certificates.length);
    expect(after.skills.map((item) => item.name)).toEqual(["Python", "SQL", "Stata", "Rust"]);
    expect(JSON.stringify(after.structuredFacts)).toContain("2025-01");
    expect(JSON.stringify(after.structuredFacts)).not.toContain("2025-02");
  });
});

async function importAsNewProfile(page: Page) {
  await openImport(page);
  await uploadAndReview(page, fixturePath());
  await page.getByLabel("创建新人物").check();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.locator(".app-notification-success").last()).toBeVisible({ timeout: 20_000 });
  await page.goto("/resume");
}

async function openImport(page: Page) {
  await page.goto("/resume");
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "导入简历" })).toBeVisible();
}

async function uploadAndReview(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer }
) {
  await page.getByLabel("选择要导入的简历文件").setInputFiles(file);
  await expect(page.locator(".import-structure-panel")).toBeVisible({ timeout: 45_000 });
  const fieldButtons = page.getByRole("button", { name: "确认此字段", exact: true });
  while (await fieldButtons.count()) await fieldButtons.first().click();
  const structureButton = page.getByRole("button", { name: "确认全部当前结构", exact: true });
  if (await structureButton.isVisible()) await structureButton.click();
  const unclassifiedButtons = page.getByRole("button", { name: "核对并保留来源", exact: true });
  while (await unclassifiedButtons.count()) await unclassifiedButtons.first().click();
}

function fixturePath() {
  return resolve(process.cwd(), "tests/fixtures/resume-import/reconciliation-v2.json");
}

async function profileSnapshot(page: Page, name: string): Promise<ProfileSnapshot> {
  return page.evaluate(async (profileName) => {
    const db = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolveDatabase(request.result);
    });
    const tx = db.transaction("profiles", "readonly");
    const request = tx.objectStore("profiles").getAll();
    const profiles = await new Promise<ProfileSnapshot[]>((resolveProfiles, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolveProfiles(request.result as ProfileSnapshot[]);
    });
    db.close();
    const profile = profiles.find((item) => (item as ProfileSnapshot & { name?: string }).name === profileName);
    if (!profile) throw new Error("profile_not_found");
    return profile;
  }, name);
}

async function activeGeneralBranchCount(page: Page, profileId: string) {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolveDatabase(request.result);
    });
    const tx = db.transaction("resumeBranches", "readonly");
    const request = tx.objectStore("resumeBranches").getAll();
    const branches = await new Promise<Array<{ profileId: string; branchPurpose: string; lifecycleStatus: string }>>((resolveBranches, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolveBranches(request.result as Array<{ profileId: string; branchPurpose: string; lifecycleStatus: string }>);
    });
    db.close();
    return branches.filter((branch) =>
      branch.profileId === id && branch.branchPurpose === "general" && branch.lifecycleStatus === "active"
    ).length;
  }, profileId);
}
