import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAiDiagnosticsTab, openManualContentTab, openManualPageTab, openManualTypographyTab } from "./support/g7b2Ui";

type VisualMetric = {
  viewport: string;
  state: string;
  screenshot: string;
  horizontalOverflow: number;
  verticalOverflow: number;
  buttonHitWarnings: string[];
  visibleButtonCount: number;
};

const VIEWPORTS = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1024x768", width: 1024, height: 768 }
];

const OUTPUT_DIR = resolve(process.cwd(), "artifacts", "g7b2-visual-acceptance");

test.describe("V2-G7b.2 visual acceptance evidence", () => {
  test.skip(process.env.G7B2_VISUAL_ACCEPTANCE !== "1", "Set G7B2_VISUAL_ACCEPTANCE=1 to refresh screenshot artifacts.");
  test.setTimeout(300_000);

  test("captures requested viewport matrix for core workspaces and import states", async ({ page }) => {
    ensureOutputDir();
    const metrics: VisualMetric[] = [];
    const branchName = `G7b2 visual ${Date.now()}`;

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await page.goto("/resume");
      await page.getByTestId("resume-entry-import-primary").click();
      await expect(page.getByRole("dialog", { name: "导入简历" })).toBeVisible();
      await capture(page, viewport.name, "resume-import", metrics);

      await page.locator(".import-json-details summary").click();
      await page.locator(".import-json-details textarea").fill(JSON.stringify(sampleStructuredResumeJson(), null, 2));
      await page.locator(".import-json-details button.primary-button").click();
      await expect(page.getByTestId("import-quality-report")).toBeVisible({ timeout: 15_000 });
      await capture(page, viewport.name, "resume-json-review", metrics);
    }

    await page.setViewportSize({ width: 1366, height: 768 });
    await createBranchFromDraft(page, branchName);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await openResumeBranch(page, branchName);
      await openManualContentTab(page);
      await capture(page, viewport.name, "resume-manual-content", metrics);

      await openManualTypographyTab(page);
      await capture(page, viewport.name, "resume-manual-typography", metrics);

      await openManualParagraphTab(page);
      await capture(page, viewport.name, "resume-manual-paragraph", metrics);

      await openManualPageTab(page);
      await page.getByTestId("page-policy-selector").selectOption("up_to_two_pages");
      await capture(page, viewport.name, "resume-page-controls", metrics);

      await openAiSuggestionsTab(page);
      await capture(page, viewport.name, "resume-ai-suggestions", metrics);

      await openAiDiagnosticsTab(page);
      await capture(page, viewport.name, "resume-ai-quality", metrics);

      await openInlineEditor(page);
      await capture(page, viewport.name, "resume-a4-inline-edit", metrics);
      await page.keyboard.press("Escape");

      await page.goto("/profile");
      await expect(page.locator(".profile-manager-grid")).toBeVisible({ timeout: 15_000 });
      await capture(page, viewport.name, "profile-library", metrics);

      await page.goto("/jobs");
      await expect(page.locator(".jobs-manager-grid")).toBeVisible({ timeout: 15_000 });
      await capture(page, viewport.name, "jobs-workspace", metrics);

      await openApplicationFromResume(page, branchName);
      await capture(page, viewport.name, "application-overview", metrics);

      await page.goto("/settings");
      await expect(page.locator(".settings-layout")).toBeVisible({ timeout: 15_000 });
      await page.locator(".settings-panel select").first().selectOption("light");
      await capture(page, viewport.name, "settings-light", metrics);
      await page.locator(".settings-panel select").first().selectOption("dark");
      await capture(page, viewport.name, "settings-dark", metrics);
      await page.locator(".settings-panel select").first().selectOption("system");
    }

    writeFileSync(resolve(OUTPUT_DIR, "metrics.json"), JSON.stringify(metrics, null, 2));
    expect(metrics).toHaveLength(VIEWPORTS.length * 15);
    expect(metrics.every((metric) => metric.horizontalOverflow <= 1)).toBe(true);
  });
});

async function createBranchFromDraft(page: Page, branchName: string) {
  await page.goto("/jobs");
  await page.getByTestId("run-experience-match").click();
  await expect(page.locator(".match-layout .match-list .match-row").first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("create-suggestion-draft").click();
  await expect(page.locator(".notice")).toBeVisible({ timeout: 15_000 });

  await page.goto("/resume");
  await page.getByTestId("job-suggestion-draft-select").first().selectOption({ index: 0 });
  await page.getByTestId("new-resume-branch-name").first().fill(branchName);
  await page.getByTestId("create-job-resume").first().click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
}

async function openResumeBranch(page: Page, branchName: string) {
  await page.goto("/resume");
  const branchRow = page.locator(".branch-list .match-row").filter({ hasText: branchName }).first();
  await expect(branchRow).toBeVisible({ timeout: 15_000 });
  await branchRow.click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
}

async function openManualParagraphTab(page: Page) {
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
  await page.locator(".resume-mode-rail button").first().click();
  await page.locator(".resume-inspector .inspector-tablist button").nth(2).click();
  await expect(page.getByTestId("resume-property-panel")).toBeVisible({ timeout: 15_000 });
}

async function openAiSuggestionsTab(page: Page) {
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
  await page.locator(".resume-mode-rail button").nth(1).click();
  await page.locator(".resume-inspector .inspector-tablist button").nth(1).click();
  await expect(page.getByTestId("job-optimization-panel")).toBeVisible({ timeout: 15_000 });
}

async function openInlineEditor(page: Page) {
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
  const a4Page = page.locator(".resume-preview-stage [data-testid='resume-a4-page']:visible").first();
  await a4Page.locator("[data-source-item-id='profile:name']").first().click();
  await expect(page.getByTestId("resume-studio-editor").locator("textarea")).toBeVisible({ timeout: 15_000 });
}

async function openApplicationFromResume(page: Page, branchName: string) {
  await openResumeBranch(page, branchName);
  await page.getByTestId("open-or-create-application").click();
  await expect(page).toHaveURL(/\/applications\?applicationId=/, { timeout: 15_000 });
  await expect(page.getByTestId("application-detail")).toBeVisible({ timeout: 15_000 });
}

async function capture(page: Page, viewport: string, state: string, metrics: VisualMetric[]) {
  const screenshotName = `${viewport}-${state}.png`;
  const screenshotPath = resolve(OUTPUT_DIR, screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const domMetric = await page.evaluate(() => {
    const root = document.documentElement;
    const visibleButtons = Array.from(document.querySelectorAll("button"))
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        const style = window.getComputedStyle(button);
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const inViewport = centerX >= 0 && centerY >= 0 && centerX <= window.innerWidth && centerY <= window.innerHeight;
        const insideClosedDetails = Boolean(button.closest("details:not([open])"));
        return rect.width > 0
          && rect.height > 0
          && inViewport
          && !insideClosedDetails
          && style.visibility !== "hidden"
          && style.display !== "none"
          && style.pointerEvents !== "none";
      });
    const buttonHitWarnings = visibleButtons.flatMap((button, index) => {
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
        return [];
      }
      const hit = document.elementFromPoint(x, y);
      if (hit === button || button.contains(hit)) {
        return [];
      }
      return [`${index}:${button.textContent?.trim() ?? "button"}`];
    });
    return {
      horizontalOverflow: Math.max(0, root.scrollWidth - window.innerWidth),
      verticalOverflow: Math.max(0, root.scrollHeight - window.innerHeight),
      buttonHitWarnings,
      visibleButtonCount: visibleButtons.length
    };
  });
  metrics.push({
    viewport,
    state,
    screenshot: `artifacts/g7b2-visual-acceptance/${screenshotName}`,
    ...domMetric
  });
}

function ensureOutputDir() {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function sampleStructuredResumeJson() {
  return {
    schemaVersion: "structured-resume-draft-v1",
    basics: {
      name: "Visual Candidate",
      email: "visual@example.com",
      phone: "13800138000",
      location: "Shanghai",
      summary: "Data analysis student."
    },
    sections: [
      {
        title: "Projects",
        sectionType: "experience",
        items: ["Cleaned provincial panel data with Stata and produced weekly reporting."]
      },
      {
        title: "Skills",
        sectionType: "skills",
        items: ["Excel", "Stata", "SQL"]
      }
    ]
  };
}
