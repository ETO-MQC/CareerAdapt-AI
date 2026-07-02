import { expect, test } from "@playwright/test";

test.describe("Stage C1 evidence matcher flow", () => {
  test("runs rule matching, AI explanation, manual overrides, and stale display", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page.getByText("岗位JD解析")).toBeVisible();

    await page.getByRole("button", { name: "运行C1规则匹配" }).click();
    await expect(page.getByText("C1规则匹配完成", { exact: false })).toBeVisible();
    await expect(page.locator(".match-row").first()).toBeVisible();

    await page.getByRole("button", { name: "运行AI解释" }).click();
    await expect(page.getByText("C1 AI解释完成", { exact: false })).toBeVisible({ timeout: 15_000 });

    await page.locator(".match-row").first().click();
    await page.locator(".manual-override select").nth(0).selectOption("strong");
    await page.locator(".manual-override select").nth(1).selectOption("low");
    await page.locator(".manual-override select").nth(2).selectOption({ index: 1 });
    await page.locator(".manual-override textarea").fill("人工确认该岗位要求可由已确认事实支持。");
    await page.getByRole("button", { name: "保存人工覆盖" }).click();
    await expect(page.getByText("人工覆盖已保存", { exact: false })).toBeVisible();

    await page.locator(".match-row").nth(1).click();
    await page.locator(".manual-override select").nth(0).selectOption("none");
    await page.locator(".manual-override textarea").fill("当前正式事实中没有足够证据。");
    await page.getByRole("button", { name: "保存人工覆盖" }).click();
    await expect(page.getByText("人工覆盖已保存", { exact: false })).toBeVisible();

    await page.reload();
    await expect(page.locator(".match-row").first()).toBeVisible();

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

    await page.reload();
    await expect(page.locator(".match-row").filter({ hasText: "stale" }).first()).toBeVisible();
    await expect(page.getByText("该匹配已过期", { exact: false })).toBeVisible();
  });
});
