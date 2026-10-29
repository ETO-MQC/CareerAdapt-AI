import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, route: string) {
  await page.goto(route);
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能", exact: true });
  if (await skip.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) { await skip.click(); await page.goto(route); }
}

test("material center opens the shared review with Profile-only default", async ({ page }, testInfo) => {
  await open(page, "/resume");
  await expect(page.getByRole("button", { name: /导入资料/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("material-center-entry.png"), fullPage: true });
  await page.getByRole("button", { name: "导入资料", exact: false }).click();
  const dialog = page.getByRole("dialog", { name: "导入资料", exact: true });
  await dialog.getByLabel("识别方式").selectOption("local");
  await dialog.getByLabel("选择职业材料").setInputFiles({ name: "certificate.txt", mimeType: "text/plain", buffer: Buffer.from("证书\n大学英语六级 2025-06") });
  await expect(dialog.locator('input[name="import-create-general-resume"]').first()).toBeVisible();
  await expect(dialog.locator('input[name="import-create-general-resume"]').first()).not.toBeChecked();
  await dialog.locator("label.import-target-option").filter({ hasText: "创建新人物" }).click();
  await expect(dialog.locator('input[name="import-create-general-resume"]').first()).not.toBeChecked();
  await expect(dialog.getByText("certificate.txt", { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("material-center-review.png"), fullPage: true });
});

test("Workspace stages, previews, restores and removes files dropped across the conversation", async ({ page }, testInfo) => {
  await open(page, "/ai-workspace");
  await page.locator(".agent-conversation-panel").dispatchEvent("drop", { dataTransfer: await page.evaluateHandle(() => {
    const transfer = new DataTransfer(); transfer.items.add(new File(["证书\n大学英语六级"], "certificate.txt", { type: "text/plain" })); return transfer;
  }) });
  await expect(page.getByRole("button", { name: "预览附件 certificate.txt", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "预览附件 certificate.txt", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "certificate.txt", exact: true }).getByText("大学英语六级", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("CareerAdaptDb"); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const result = db.transaction("appMeta", "readonly").objectStore("appMeta").getAll();
      result.onsuccess = () => { db.close(); resolve(result.result.filter(row => row.key.startsWith("composer-attachments:") && row.value.length).length); };
    };
  }))).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "预览附件 certificate.txt", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("workspace-restored-attachment.png"), fullPage: true });
  await page.getByRole("button", { name: "移除附件 certificate.txt", exact: true }).click();
  await expect(page.getByRole("button", { name: "预览附件 certificate.txt", exact: true })).toHaveCount(0);
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 400; canvas.height = 240;
    const context = canvas.getContext("2d")!; context.fillStyle = "#e9eee8"; context.fillRect(0, 0, 400, 240);
    context.fillStyle = "#244a38"; context.font = "24px sans-serif"; context.fillText("SAMPLE AWARD", 80, 120);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator('.agent-composer input[type="file"]').setInputFiles({ name: "award.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") });
  await expect(page.locator(".agent-attachment-thumbnail")).toBeVisible();
  await page.getByRole("button", { name: "预览附件 award.png", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "award.png", exact: true }).getByRole("img", { name: "award.png" })).toBeVisible();
  await expect.poll(() => page.getByRole("img", { name: "award.png", exact: true }).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 400)).toBe(true);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: testInfo.outputPath("workspace-image-preview-1024.png"), fullPage: true });
});
