import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

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
