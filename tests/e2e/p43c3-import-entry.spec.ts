import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 1600, height: 900 },
  { width: 1024, height: 768 }
]) {
  test(`import entry is symmetric and compact at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/resume");
    await page.getByRole("button", { name: "导入", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "导入简历" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("PDF · DOCX · Markdown · TXT · JSON")).toBeVisible();

    const target = dialog.locator(".import-target-picker");
    const recognition = dialog.locator(".import-recognition-panel");
    const dropzone = dialog.locator(".import-dropzone");
    await expect(target).toBeVisible();
    await expect(recognition).toBeVisible();
    await expect(dropzone).toBeVisible();

    const targetBox = await target.boundingBox();
    const recognitionBox = await recognition.boundingBox();
    const dropzoneBox = await dropzone.boundingBox();
    expect(targetBox).toBeTruthy();
    expect(recognitionBox).toBeTruthy();
    expect(dropzoneBox).toBeTruthy();
    expect(Math.abs(targetBox!.width - recognitionBox!.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(targetBox!.y - recognitionBox!.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(targetBox!.height - recognitionBox!.height)).toBeLessThanOrEqual(8);
    expect(dropzoneBox!.height).toBeGreaterThanOrEqual(140);
    expect(dropzoneBox!.height).toBeLessThanOrEqual(160);
    expect(dropzoneBox!.y + dropzoneBox!.height).toBeLessThanOrEqual(viewport.height);
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox!.height).toBeLessThanOrEqual(560);

    await page.screenshot({
      path: testInfo.outputPath(`import-entry-${viewport.width}x${viewport.height}.png`),
      fullPage: false
    });
  });
}
