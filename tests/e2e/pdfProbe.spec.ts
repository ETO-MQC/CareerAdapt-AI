import { expect, test } from "@playwright/test";

test("A4 PDF probe renders one-page selectable Chinese text", async ({ page }) => {
  await page.goto("/export/probe");

  const a4Page = page.getByTestId("a4-page");
  await expect(a4Page).toBeVisible();
  await expect(a4Page).toContainText("陈同学");
  await expect(a4Page).toContainText("统计建模竞赛项目");
  await expect(a4Page).toContainText("Stata");

  const box = await a4Page.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width / box!.height).toBeCloseTo(210 / 297, 1);

  const overflow = await page.evaluate(() => {
    const element = document.querySelector<HTMLElement>("[data-testid='a4-page']");

    if (!element) {
      return null;
    }

    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      text: window.getSelection()?.toString() ?? element.innerText
    };
  });

  expect(overflow).not.toBeNull();
  expect(overflow!.scrollHeight).toBeLessThanOrEqual(overflow!.clientHeight + 2);

  await page.emulateMedia({ media: "print" });
  const printBox = await a4Page.boundingBox();
  expect(printBox).not.toBeNull();
  expect(printBox!.width / printBox!.height).toBeCloseTo(210 / 297, 1);
});
