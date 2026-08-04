import { expect, type Page } from "@playwright/test";

/**
 * Seeds only the isolated Playwright browser profile through the supported
 * Profile UI. It never writes IndexedDB directly and never touches a user's
 * real workspace.
 */
export async function bootstrapP43e1DisposableProfile(page: Page) {
  await page.goto("/profile");
  await expect(page.getByLabel("选择人物")).toBeVisible();
  await page.locator('[data-profile-category="basics"]').click();
  await page.locator(".profile-list-panel").getByRole("button", { name: "新增", exact: true }).click();
  await page.locator("#new-profile-name").fill("P43e1 Disposable");
  await page.getByRole("button", { name: "创建人物", exact: true }).click();
  await expect(page.getByLabel("选择人物")).toHaveValue(/profile-/);
  await expect(page.getByLabel("选择人物").locator("option:checked")).toHaveText("P43e1 Disposable");

  await page.locator('[data-profile-category="education"]').click();
  await page.locator(".profile-list-panel").getByRole("button", { name: "新增", exact: true }).click();
  await page.locator("#profile-education-organization").fill("P43e1 Example University");
  await page.locator("#profile-education-role").fill("Bachelor");
  await page.locator("#profile-education-major").fill("Example Major");
  await page.locator("#profile-education-start").fill("2024-09");
  await page.locator("#profile-education-end").fill("2028-06");
  await page.locator(".profile-detail-panel").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByTestId("profile-managed-list")).toContainText("P43e1 Example University");

  const profileId = await page.getByLabel("选择人物").inputValue();
  const versionBeforeRecycle = await readProfileVersion(page, profileId);
  const educationRow = page.getByTestId("profile-managed-list").locator(".profile-managed-row").filter({ hasText: "P43e1 Example University" });
  await educationRow.getByRole("button", { name: "删除 P43e1 Example University" }).click();
  await expect(educationRow).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("选择人物").locator("option:checked")).toHaveText("P43e1 Disposable");
  return {
    profileId,
    versionBeforeRecycle,
    versionAfterRecycle: await readProfileVersion(page, profileId),
    educationId: await readRecycledEducationId(page, profileId)
  };
}

export async function readProfileVersion(page: Page, profileId: string) {
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const openRequest = indexedDB.open("CareerAdaptDb");
      openRequest.onsuccess = () => resolve(openRequest.result);
      openRequest.onerror = () => reject(openRequest.error);
    });
    const profile = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const readRequest = database.transaction("profiles", "readonly").objectStore("profiles").get(id);
      readRequest.onsuccess = () => resolve(readRequest.result as Record<string, unknown> | undefined);
      readRequest.onerror = () => reject(readRequest.error);
    });
    database.close();
    return Number(profile?.version ?? 0);
  }, profileId);
}

export async function readRecycledEducationId(page: Page, profileId: string) {
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const openRequest = indexedDB.open("CareerAdaptDb");
      openRequest.onsuccess = () => resolve(openRequest.result);
      openRequest.onerror = () => reject(openRequest.error);
    });
    const meta = await new Promise<{ value?: { profileItems?: Array<{ profileId: string; kind: string; id: string }> } } | undefined>((resolve, reject) => {
      const readRequest = database.transaction("appMeta", "readonly").objectStore("appMeta").get("workspaceRecycleBin:v1");
      readRequest.onsuccess = () => resolve(readRequest.result as { value?: { profileItems?: Array<{ profileId: string; kind: string; id: string }> } } | undefined);
      readRequest.onerror = () => reject(readRequest.error);
    });
    database.close();
    return meta?.value?.profileItems?.find((item) => item.profileId === id && item.kind === "canonical")?.id;
  }, profileId);
}
