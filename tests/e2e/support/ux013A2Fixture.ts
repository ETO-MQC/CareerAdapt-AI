import { expect, type Page } from "@playwright/test";
import { readStore } from "./p51CoreWorkflow";
export async function prepareA2Source(page: Page) {
  await page.goto("/resume");
  await page.getByRole("button", { name: /导入已有简历/ }).click();
  let dialog = page.getByRole("dialog", { name: "导入简历" });
  await dialog.getByText("粘贴 JSON", { exact: true }).click();
  await dialog.getByLabel("JSON 内容").fill(JSON.stringify({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN",
    basics: { name: "A2匿名候选人", email: "a2@example.org", portfolioLinks: [], otherLinks: [], customFields: [] },
    sections: [{ id: "project", sectionType: "project", title: "项目经历", order: 0, visible: true, items: [{ id: "a2-project", sectionType: "project",
      title: "原项目名称", role: "项目成员", startDate: "2025-01", endDate: "2025-06", current: false,
      description: "参与接口测试。", highlights: ["执行接口测试。", "SQL 查询验证。", "执行接口测试。"], tools: [], outcomes: [], customFields: [] }] }], unclassifiedBlocks: [] }));
  await dialog.getByRole("button", { name: "导入 JSON", exact: true }).click();
  await dialog.locator("label.import-target-option").filter({ hasText: "创建新人物" }).click();
  for (let i = 0; i < 40 && await page.getByRole("button", { name: "确认此字段", exact: true }).count(); i++) await page.getByRole("button", { name: "确认此字段", exact: true }).first().click();
  for (let i = 0; i < 40 && await page.getByRole("button", { name: "核对并保留来源", exact: true }).count(); i++) await page.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
  await dialog.locator(".import-review-footer button.primary-button").click();
  const open = page.getByRole("button", { name: "打开", exact: true }); if (await open.isVisible()) await open.click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  // Explicit Branch URL waits for hydration instead of racing the transient list/restore view.
  const profileId = (await readStore(page, "profiles")).find(p => p.name === "A2匿名候选人")!.id as string;
  const sourceId = (await readStore(page, "resumeBranches")).find(b => b.branchPurpose === "general" && b.profileId === profileId)!.id as string;
  await page.goto(`/resume?branchId=${encodeURIComponent(sourceId)}`);
  await page.locator("details.toolbar-more > summary").click();
  await page.getByTestId("open-resume-import").click();
  dialog = page.getByRole("dialog", { name: "导入另一份简历" });
  await dialog.getByText("粘贴 JSON", { exact: true }).click();
  await dialog.getByLabel("JSON 内容").fill(JSON.stringify({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN",
    basics: { name: "A2匿名候选人", portfolioLinks: [], otherLinks: [], customFields: [] },
    sections: [{ id: "skills", sectionType: "skills", title: "专业技能", order: 0, visible: true,
      items: [{ id: "a2-sql", sectionType: "skills", name: "SQL", description: "使用 SQL 执行查询验证。", customFields: [] }] }], unclassifiedBlocks: [] }));
  await dialog.getByRole("button", { name: "导入 JSON", exact: true }).click();
  await dialog.locator("label.import-target-option").filter({ hasText: "导入到已有资料" }).click();
  await dialog.locator('input[name="import-create-general-resume"]').uncheck();
  for (let i = 0; i < 40 && await page.getByRole("button", { name: "确认此字段", exact: true }).count(); i++) await page.getByRole("button", { name: "确认此字段", exact: true }).first().click();
  for (let i = 0; i < 40 && await page.getByRole("button", { name: "核对并保留来源", exact: true }).count(); i++) await page.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
  await dialog.locator(".import-review-footer button.primary-button").click();
  await expect.poll(async () => (await readStore(page, "profiles")).some(p => (p.skills as Array<{ name: string }>).some(s => s.name === "SQL"))).toBe(true);
  return { branchId: sourceId, profileId };
}
