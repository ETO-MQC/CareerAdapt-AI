import { expect, test } from "@playwright/test";

async function createC2DraftForSelectedJob(page: import("@playwright/test").Page) {
  await page.locator("button").filter({ hasText: "C1" }).first().click();
  await expect(page.locator(".match-row").first()).toBeVisible();
  await page.locator("button").filter({ hasText: "C2" }).first().click();
  await expect(page.locator(".notice")).toContainText("C2");
}

test.describe("Stage D1 resume branches", () => {
  test("creates two isolated branches, edits one, restores, undoes, and refreshes sync status", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page.locator("main")).toBeVisible();

    await createC2DraftForSelectedJob(page);

    await page.locator("label").filter({ hasText: "D1" }).locator("select").selectOption({ index: 1 });
    await createC2DraftForSelectedJob(page);

    await page.goto("/resume");
    await expect(page.getByRole("heading", { name: /.+/ }).first()).toBeVisible();

    await page.locator("label").filter({ hasText: "C2" }).locator("select").selectOption({ index: 0 });
    await page.locator("article.panel").first().locator("input").fill("D1 Branch A");
    await page.locator("article.panel").first().locator("button.primary-button").click();
    await expect(page.locator(".branch-list .match-row").filter({ hasText: "D1 Branch A" })).toBeVisible();

    await page.locator("label").filter({ hasText: "C2" }).locator("select").selectOption({ index: 1 });
    await page.locator("article.panel").first().locator("input").fill("D1 Branch B");
    await page.locator("article.panel").first().locator("button.primary-button").click();
    await expect(page.locator(".branch-list .match-row").filter({ hasText: "D1 Branch B" })).toBeVisible();

    await expect(page.locator(".branch-list .match-row")).toHaveCount(2);

    await page.locator(".branch-list .match-row").filter({ hasText: "D1 Branch A" }).click();
    const branchATextarea = page.locator(".branch-editor textarea").first();
    const originalA = await branchATextarea.inputValue();
    const editedA = `${originalA}.`;
    await branchATextarea.fill(editedA);
    await page.locator(".branch-editor .suggestion-card").first().locator("button.primary-button").click();
    await expect(page.locator(".notice")).toContainText("Fact Guard");
    await expect(page.locator(".revision-list .review-row").filter({ hasText: "revision 1" })).toBeVisible();

    await page.locator(".branch-list .match-row").filter({ hasText: "D1 Branch B" }).click();
    await expect(page.locator(".branch-editor textarea").first()).not.toHaveValue(editedA);

    await page.locator(".branch-list .match-row").filter({ hasText: "D1 Branch A" }).click();
    await page.locator(".revision-list .review-row").filter({ hasText: "revision 0" }).locator("button").click();
    await expect(page.locator(".notice")).toContainText("restore revision");
    await page.locator("section.panel").filter({ hasText: "D1 Branch A" }).locator(".section-heading .action-row button").nth(1).click();
    await expect(page.locator(".notice")).toContainText("previousRevisionId");
    await expect(page.locator(".branch-editor textarea").first()).toHaveValue(editedA);

    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("CareerAdaptDb");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("profiles", "readwrite");
          const store = tx.objectStore("profiles");
          const getRequest = store.get("profile-demo-student");
          getRequest.onerror = () => reject(getRequest.error);
          getRequest.onsuccess = () => {
            const profile = getRequest.result;
            profile.version += 1;
            profile.updatedAt = new Date().toISOString();
            store.put(profile);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    });

    await page.locator("section.panel").filter({ hasText: "D1 Branch A" }).locator(".section-heading .action-row button").first().click();
    await expect(page.getByText("Career profile has updates", { exact: false })).toBeVisible();
  });
});
