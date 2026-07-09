import { expect, test, type Page } from "@playwright/test";

test.describe("V2-G7b.2 gap closure", () => {
  test("inline-edit-name-contact-section-and-description-with-one-content-revision", async ({ page }) => {
    const branchName = `G7b2 inline ${Date.now()}`;
    await createBranchFromDraft(page, branchName);

    const branchBefore = await findBranchByName(page, branchName);
    expect(branchBefore?.revision).toBeDefined();

    const a4Page = page.locator(".resume-preview-pages").getByTestId("resume-a4-page").first();
    const nameTarget = a4Page.locator("[data-source-item-id='profile:name']").first();
    // Double-click to start editing (single click only selects in new UI)
    await nameTarget.dblclick();
    await expect(page.getByTestId("resume-studio-editor").locator("textarea")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("resume-studio-editor").locator("textarea").fill("Temporary Cancelled Name");
    await page.getByTestId("resume-studio-editor").locator("textarea").press("Escape");
    await expect(page.getByTestId("resume-studio-editor").locator("textarea")).toHaveCount(0);
    await expect(nameTarget).not.toContainText("Temporary Cancelled Name");

    await page.getByTestId("resume-studio-editor").locator("button.primary-button").click();
    await page.getByTestId("resume-studio-editor").locator("textarea").fill("G7b2 Inline Candidate");
    await page.getByTestId("resume-studio-editor").locator("button.primary-button").click();
    await expect(nameTarget).toContainText("G7b2 Inline Candidate");

    const emailTarget = a4Page.locator("[data-source-item-id='profile:email']").first();
    await emailTarget.dblclick();
    await expect(page.getByTestId("resume-studio-editor").locator("textarea")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("resume-studio-editor").locator("textarea").fill("g7b2-inline@example.com");
    await page.getByTestId("resume-studio-editor").locator("button.primary-button").click();
    await expect(emailTarget).toContainText("g7b2-inline@example.com");

    const sectionTitle = a4Page.locator("[data-section-title-id]").first();
    await sectionTitle.dblclick();
    await expect(page.getByTestId("resume-studio-editor").locator("textarea")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("resume-studio-editor").locator("textarea").press("Control+Enter");
    await expect(sectionTitle).toContainText("G7B2 Section");

    const block = a4Page.locator(".resume-template-item[data-source-item-id]").first();
    const originalText = (await block.innerText()).trim();
    await block.dblclick();
    const editorTextArea = page.getByTestId("resume-studio-editor").locator("textarea");
    await expect(editorTextArea).toBeVisible({ timeout: 5000 });
    await editorTextArea.dispatchEvent("compositionstart");
    await editorTextArea.fill(`${originalText} Updated.`);
    await editorTextArea.dispatchEvent("compositionend");
    await editorTextArea.press("Control+Enter");

    await expect.poll(async () => {
      const branch = await findBranchByName(page, branchName);
      return branch?.revision ?? -1;
    }, { timeout: 20_000 }).toBe((branchBefore?.revision ?? 0) + 1);
    await expect(block).toContainText("Updated.");
  });

  test("manual and AI resume studio secondary navigation is isolated", async ({ page }) => {
    await createBranchFromDraft(page, `G7b2 split ${Date.now()}`);

    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
    await expect(page.getByTestId("resume-section-nav")).toBeVisible();
    await expect(page.locator(".branch-editor")).toBeVisible();
    await expect(page.locator(".presentation-history-actions")).toHaveCount(0);

    await page.locator(".resume-mode-rail button").nth(2).click();
    await expect(page.locator(".resume-inspector .inspector-tablist button")).toHaveText(["模板", "颜色", "字体", "页面"]);
    await page.locator(".resume-inspector .inspector-tablist button").nth(3).click();
    await expect(page.getByTestId("resume-property-panel")).toBeVisible();
    await expect(page.locator(".branch-editor")).toHaveCount(0);

    await page.locator(".resume-mode-rail button").nth(1).click();
    await expect(page.locator(".branch-editor")).toHaveCount(0);
    await expect(page.locator(".property-panel-body")).toHaveCount(0);
    await expect(page.locator(".presentation-history-actions")).toHaveCount(0);
    await expect(page.getByTestId("job-optimization-panel")).toBeVisible();

    await page.locator(".resume-inspector .inspector-tablist button").nth(2).click();
    await expect(page.getByTestId("resume-diagnostics-panel")).toBeVisible();
    await expect(page.locator(".property-panel-body")).toHaveCount(0);
    await page.locator(".resume-mode-rail button").first().click();
    await expect(page.getByTestId("resume-section-nav")).toBeVisible();
    await expect(page.locator(".branch-editor")).toBeVisible();
    await expect(page.getByTestId("job-optimization-panel")).toHaveCount(0);
    await expect(page.getByTestId("resume-diagnostics-panel")).toHaveCount(0);
  });

  test("resume studio keeps import access visible and swaps mode/tool placement", async ({ page }) => {
    await createBranchFromDraft(page, `G7b2 toolbar ${Date.now()}`);

    await expect(page.getByTestId("open-resume-import")).toBeVisible();
    await page.getByTestId("open-resume-import").click();
    await expect(page.locator(".import-source-actions")).toBeVisible();
    await expect(page.locator(".import-source-actions button").first()).toContainText("PDF");

    const placement = await page.evaluate(() => {
      const mode = document.querySelector(".resume-mode-rail");
      const inspector = document.querySelector(".resume-inspector");
      const tabs = document.querySelector("[data-testid='resume-section-nav']");
      const heading = document.querySelector(".resume-inspector .property-panel-heading");
      const rect = (node: Element | null) => {
        const box = node?.getBoundingClientRect();
        return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : undefined;
      };
      return {
        mode: rect(mode),
        inspector: rect(inspector),
        tabs: rect(tabs),
        heading: rect(heading)
      };
    });

    expect(placement.mode?.y ?? 9999).toBeLessThan(placement.inspector?.y ?? 0);
    expect(placement.tabs?.x ?? 9999).toBeLessThan(placement.heading?.x ?? 0);
    expect(placement.tabs?.width ?? 0).toBeLessThan(230);
  });

  test("profile-category-crud-archive-restore-search", async ({ page }) => {
    const skillName = `Gap Skill ${Date.now()}`;
    const updatedName = `${skillName} Updated`;

    await page.goto("/profile");
    await expect(page.locator(".profile-manager-grid")).toBeVisible();
    await page.locator(".profile-category-button").nth(7).click();
    await page.locator(".profile-list-panel button.primary-button").click();

    const detail = page.locator(".profile-detail-panel");
    await detail.locator("input").first().fill(skillName);
    await detail.locator("select").first().selectOption("proficient");
    await detail.locator("textarea").fill(`Evidence for ${skillName}`);
    await detail.locator("button.primary-button").last().click();
    await expect(page.getByTestId("profile-managed-list")).toContainText(skillName);

    await page.locator(".profile-list-panel input").fill("Gap Skill");
    await expect(page.getByTestId("profile-managed-list")).toContainText(skillName);
    await page.locator(".profile-managed-row").filter({ hasText: skillName }).click();
    await detail.locator(".profile-detail-actions button").first().click();
    await detail.locator("input").first().fill(updatedName);
    await detail.locator("textarea").fill(`Updated evidence for ${skillName}`);
    await detail.locator("button.primary-button").last().click();
    await expect(page.getByTestId("profile-managed-list")).toContainText(updatedName);

    await page.locator(".profile-managed-row").filter({ hasText: updatedName }).click();
    await detail.locator(".profile-detail-actions button").nth(1).click();
    await expect(page.getByTestId("profile-managed-list")).toContainText(updatedName);
    await detail.locator(".profile-detail-actions button").first().click();
    await page.locator(".profile-list-panel select").selectOption("all");
    await expect(page.getByTestId("profile-managed-list")).toContainText(updatedName);
  });

  test("jobs workspace has list, tabs, detail, archive and restore controls", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page.locator(".jobs-manager-grid")).toBeVisible();
    await expect(page.locator(".jobs-list-panel")).toBeVisible();
    await expect(page.locator(".jobs-tab-panel")).toBeVisible();
    await expect(page.locator(".jobs-detail-panel")).toBeVisible();

    await page.locator(".jobs-tablist button").nth(1).click();
    await expect(page.locator(".jobs-tab-content .requirement-list")).toBeVisible();

    await page.locator(".jobs-detail-panel button").first().click();
    await expect(page.locator(".notice")).toBeVisible();
    await page.locator(".job-list-filter button").nth(1).click();
    await expect(page.locator(".jobs-detail-panel button").first()).toBeVisible();
    await page.locator(".jobs-detail-panel button").first().click();
    await page.locator(".job-list-filter button").first().click();
    await expect(page.locator(".jobs-detail-panel button").first()).toBeVisible();

    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page.locator(".jobs-detail-panel button").nth(1).click();
    await expect(page.locator(".notice")).toBeVisible();

    const layout = await page.locator(".jobs-tab-content").evaluate((node) => {
      const style = window.getComputedStyle(node as HTMLElement);
      return {
        overflowY: style.overflowY,
        clientHeight: (node as HTMLElement).clientHeight
      };
    });
    expect(layout.clientHeight).toBeGreaterThan(120);
    expect(["auto", "scroll"]).toContain(layout.overflowY);
  });

  test("application detail uses overview, resume, materials and timeline tabs", async ({ page }) => {
    await createBranchFromDraft(page, `G7b2 app ${Date.now()}`);
    await page.getByTestId("open-or-create-application").click();
    await expect(page).toHaveURL(/\/applications\?applicationId=/);
    await expect(page.getByTestId("application-detail")).toBeVisible();
    await expect(page.locator(".application-detail-tablist")).toBeVisible();

    await page.locator(".application-detail-tablist button").nth(1).click();
    await expect(page.locator(".application-detail-grid")).toBeVisible();
    await page.locator(".application-detail-tablist button").nth(2).click();
    await expect(page.locator(".application-materials-panel")).toBeVisible();
    await page.locator(".application-detail-tablist button").nth(3).click();
    await expect(page.getByTestId("application-timeline")).toBeVisible();
  });

  test("settings uses category navigation and one theme dropdown", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator(".settings-layout")).toBeVisible();
    await expect(page.locator(".settings-nav")).toBeVisible();
    await expect(page.locator(".settings-panel select").first()).toHaveValue(/system|light|dark/);
    await page.locator(".settings-panel select").first().selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator(".settings-panel select").first().selectOption("system");
  });

  test("resume import marks OCR as experimental and keeps button spacing", async ({ page }) => {
    await page.goto("/resume");
    await expect(page.locator(".import-source-actions")).toBeVisible();
    await expect(page.locator(".import-source-actions button").nth(2)).toContainText("OCR");
    await expect(page.locator(".section-heading").first()).toContainText("OCR");
    await page.locator(".import-source-actions button").filter({ hasText: "OCR Benchmark" }).click();
    await expect(page.getByTestId("ocr-benchmark-report")).toContainText("状态 B");
    await expect(page.getByTestId("ocr-benchmark-report")).toContainText("Tesseract OCR");
    await expect(page.getByTestId("ocr-benchmark-report")).toContainText("双栏顺序 未通过");

    const spacing = await page.locator(".import-source-actions").evaluate((node) => {
      const style = window.getComputedStyle(node as HTMLElement);
      return {
        gap: style.gap,
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft
      };
    });
    expect(spacing.gap).not.toBe("0px");
    expect([spacing.paddingTop, spacing.paddingRight, spacing.paddingBottom, spacing.paddingLeft]).not.toContain("0px");
  });
});

async function createBranchFromDraft(page: Page, branchName: string) {
  await page.goto("/jobs");
  await page.getByTestId("run-experience-match").click();
  await expect(page.locator(".match-row").first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("create-suggestion-draft").click();
  await expect(page.locator(".notice")).toBeVisible({ timeout: 15_000 });

  await page.goto("/resume");
  await page.getByTestId("resume-import-strip").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("job-suggestion-draft-select").first().selectOption({ index: 0 });
  await page.getByTestId("new-resume-branch-name").first().fill(branchName);
  await page.getByTestId("create-job-resume").first().click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
}

type DbBranch = {
  id: string;
  name?: string;
  revision?: number;
};

async function findBranchByName(page: Page, name: string): Promise<DbBranch | undefined> {
  const branches = await readAllFromStore<DbBranch>(page, "resumeBranches");
  return branches.find((branch) => branch.name === name);
}

async function readAllFromStore<T>(page: Page, storeName: string): Promise<T[]> {
  return await page.evaluate((store) => new Promise<T[]>((resolve, reject) => {
    const request = indexedDB.open("CareerAdaptDb");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(store, "readonly");
      const storeRef = tx.objectStore(store);
      const getAll = storeRef.getAll();
      getAll.onerror = () => reject(getAll.error);
      getAll.onsuccess = () => resolve(getAll.result as T[]);
    };
  }), storeName);
}
