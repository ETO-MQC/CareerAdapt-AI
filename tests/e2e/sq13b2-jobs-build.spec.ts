import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

test("production JobsWorkspace saves browser SHA-256 candidate and restores it without Provider", async ({ page }) => {
  const errors: string[] = [];
  let providerRequests = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/ai/**", async (route) => {
    providerRequests += 1;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "test_provider_disabled" } }) });
  });
  await page.goto("/jobs");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) { await skip.click(); await page.goto("/jobs"); }
  await expect(page.locator(".jobs-workspace")).toBeVisible();
  const title = "SQ13B2 Go 工程师";
  const company = "SQ13B2 合成公司";
  const raw = "职责：\n负责后端接口开发，复核数据查询。\n要求：\n熟悉 Go 和 SQL。";
  await page.getByTestId("job-title-input").fill(title);
  await page.getByTestId("job-company-input").fill(company);
  await page.getByTestId("job-raw-textarea").fill(raw);
  await page.getByTestId("save-job-raw-input").click();
  await expect(page.getByTestId("candidate-status")).toContainText("local.manual");
  await expect(page.locator(".job-analysis-dialog")).toBeVisible();
  const snapshot = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction(["jobListings", "jobSnapshots"], "readonly");
      const read = (store: string) => new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = transaction.objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [listings, snapshots] = await Promise.all([read("jobListings"), read("jobSnapshots")]);
      return { listings, snapshots };
    } finally { database.close(); }
  });
  const hash = createHash("sha256").update(raw, "utf8").digest("hex");
  const identity = createHash("sha256").update(`${title.toLowerCase()}␟${company.toLowerCase()}`, "utf8").digest("hex");
  expect(snapshot.listings).toEqual(expect.arrayContaining([expect.objectContaining({ id: `listing-manual-${identity}`, contentFingerprint: hash, companyTitleFingerprint: identity })]));
  expect(snapshot.snapshots).toEqual(expect.arrayContaining([expect.objectContaining({ rawText: raw, contentHash: hash })]));
  await page.reload();
  await expect(page.locator(".jobs-workspace")).toBeVisible();
  await expect(page.getByTestId("job-title-input")).toHaveValue(title);
  expect(providerRequests).toBe(0);
  expect(errors).toEqual([]);
});
