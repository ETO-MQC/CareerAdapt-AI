import { expect, test } from "@playwright/test";

test("profile items edit in place and support archive, delete, and batch delete", async ({ page }) => {
  await page.goto("/profile");
  await page.locator('[data-section-type="skill"]').click();

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
