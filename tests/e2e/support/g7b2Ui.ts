import { expect, type Page } from "@playwright/test";

export async function openManualContentTab(page: Page) {
  await openResumeEditMode(page);
  await expect(page.locator(".branch-editor").first()).toBeVisible({ timeout: 15_000 });
}

export async function openManualTypographyTab(page: Page) {
  await openResumeStyleTab(page, 2);
  await expect(page.getByLabel("正文字号")).toBeVisible({ timeout: 15_000 });
}

export async function openManualLayoutTab(page: Page) {
  await openResumeStyleTab(page, 1);
  await expect(page.getByTestId("resume-property-panel")).toBeVisible({ timeout: 15_000 });
}

export async function openManualPageTab(page: Page) {
  await openResumeStyleTab(page, 3);
  await expect(page.getByTestId("page-policy-selector")).toBeVisible({ timeout: 15_000 });
}

export async function openManualTemplateTab(page: Page) {
  await openResumeStyleTab(page, 0);
  await expect(page.locator(".template-center-entry")).toBeVisible({ timeout: 15_000 });
}

export async function openManualHistoryTab(page: Page) {
  await expect(page.getByTestId("resume-studio-workbar")).toBeVisible({ timeout: 15_000 });
  await page.locator(".toolbar-more summary").click();
  await expect(page.locator(".toolbar-more-popover")).toBeVisible({ timeout: 15_000 });
}

export async function openAiDiagnosticsTab(page: Page) {
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
  const modeRail = page.locator(".resume-mode-rail button");
  await expect(modeRail.nth(1)).toBeVisible({ timeout: 15_000 });
  await modeRail.nth(1).click();
  const aiTabs = page.locator(".resume-inspector .inspector-tablist button");
  await expect(aiTabs.nth(2)).toBeVisible({ timeout: 15_000 });
  await aiTabs.nth(2).click();
  await expect(page.getByTestId("resume-diagnostics-panel")).toBeVisible({ timeout: 15_000 });
}

export async function openApplicationMaterialsTab(page: Page) {
  const detail = page.getByTestId("application-detail");
  await expect(detail).toBeVisible({ timeout: 15_000 });
  const tabs = detail.locator(".application-detail-tablist button");
  await expect(tabs.nth(2)).toBeVisible({ timeout: 15_000 });
  await tabs.nth(2).click();
  await expect(detail.getByTestId("application-materials-panel")).toBeVisible({ timeout: 15_000 });
}

export async function openApplicationOverviewTab(page: Page) {
  const detail = page.getByTestId("application-detail");
  await expect(detail).toBeVisible({ timeout: 15_000 });
  const tabs = detail.locator(".application-detail-tablist button");
  await expect(tabs.first()).toBeVisible({ timeout: 15_000 });
  await tabs.first().click();
  await expect(detail.getByLabel("当前状态")).toBeVisible({ timeout: 15_000 });
}

export async function openApplicationResumeTab(page: Page) {
  const detail = page.getByTestId("application-detail");
  await expect(detail).toBeVisible({ timeout: 15_000 });
  const tabs = detail.locator(".application-detail-tablist button");
  await expect(tabs.nth(1)).toBeVisible({ timeout: 15_000 });
  await tabs.nth(1).click();
  await expect(detail.getByText("关联简历与导出")).toBeVisible({ timeout: 15_000 });
}

export async function openApplicationTimelineTab(page: Page) {
  const detail = page.getByTestId("application-detail");
  await expect(detail).toBeVisible({ timeout: 15_000 });
  const tabs = detail.locator(".application-detail-tablist button");
  await expect(tabs.nth(3)).toBeVisible({ timeout: 15_000 });
  await tabs.nth(3).click();
  await expect(page.getByTestId("application-timeline")).toBeVisible({ timeout: 15_000 });
}

async function openResumeEditMode(page: Page) {
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
  const modeRail = page.locator(".resume-mode-rail button");
  await expect(modeRail.first()).toBeVisible({ timeout: 15_000 });
  await modeRail.first().click();
}

async function openResumeStyleTab(page: Page, index: number) {
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
  const modeRail = page.locator(".resume-mode-rail button");
  await expect(modeRail.nth(2)).toBeVisible({ timeout: 15_000 });
  await modeRail.nth(2).click();
  const styleTabs = page.locator(".resume-inspector .inspector-tablist button");
  await expect(styleTabs.nth(index)).toBeVisible({ timeout: 15_000 });
  await styleTabs.nth(index).click();
}
