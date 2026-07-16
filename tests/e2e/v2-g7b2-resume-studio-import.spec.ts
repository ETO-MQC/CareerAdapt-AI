import { expect, test, type Page } from "@playwright/test";

test.describe("V2-G7b.2 Resume Studio and import IA", () => {
  test("separates manual editing tools from AI optimization tools", async ({ page }) => {
    await createBranchFromJsonImport(page, `G7b2 mode split ${Date.now()}`);

    await expect(page.locator(".resume-inspector")).toBeVisible();
    await expect(page.getByTestId("resume-section-nav")).toBeVisible();
    await expect(page.locator(".branch-editor")).toBeVisible();
    await expect(page.locator(".presentation-history-actions")).toHaveCount(0);

    await page.locator(".resume-mode-rail button").nth(2).click();
    await expect(page.locator(".resume-inspector .inspector-tablist button")).toHaveText(["模板", "颜色", "字体", "页面"]);
    await page.getByRole("tab", { name: "模板", exact: true }).click();
    await expect(page.getByLabel("模板")).toBeVisible();
    await page.getByRole("tab", { name: "颜色", exact: true }).click();
    await expect(page.getByText("主色", { exact: true })).toBeVisible();
    await expect(page.getByText("分隔线颜色", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "字体", exact: true }).click();
    await expect(page.getByLabel("中文字体")).toBeVisible();
    await expect(page.getByLabel("英文字体")).toBeVisible();
    await page.getByRole("tab", { name: "页面", exact: true }).click();
    await expect(page.getByLabel("页边距")).toBeVisible();
    await expect(page.getByLabel("建议页数", { exact: true })).toBeVisible();
    await expect(page.getByTestId("resume-property-panel")).toBeVisible();
    await expect(page.locator(".branch-editor")).toHaveCount(0);

    await page.locator(".resume-mode-rail button").nth(1).click();
    await expect(page.locator(".branch-editor")).toHaveCount(0);
    await expect(page.locator(".presentation-history-actions")).toHaveCount(0);
    await expect(page.locator(".property-panel-body")).toHaveCount(0);
    await expect(page.getByTestId("resume-ai-summary")).toBeVisible();
    const aiScroll = await page.getByTestId("job-optimization-panel").evaluate((panel) => ({
      overflowY: getComputedStyle(panel).overflowY,
      minHeight: getComputedStyle(panel).minHeight,
      tabIndex: panel.tabIndex
    }));
    expect(aiScroll).toEqual({ overflowY: "auto", minHeight: "0px", tabIndex: 0 });
  });

  test("imports structured JSON into the same review flow before confirmation", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/resume");
    await page.getByRole("button", { name: "粘贴 JSON", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "导入简历" });
    await expect(dialog).toBeVisible();
    const dialogPosition = await dialog.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        centerOffsetX: Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2),
        centerOffsetY: Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2)
      };
    });
    expect(dialogPosition.centerOffsetX).toBeLessThan(2);
    expect(dialogPosition.centerOffsetY).toBeLessThan(2);
    await page.locator(".import-json-details textarea").fill(JSON.stringify({
      schemaVersion: "structured-resume-draft-v1",
      basics: {
        name: "JSON Candidate",
        email: "demo.student@example.com",
        summary: "Data analysis student."
      },
      sections: [{
        title: "Projects",
        sectionType: "experience",
        items: ["Cleaned provincial panel data with Stata."]
      }]
    }));
    await page.locator(".import-json-details button.primary-button").click();

    await expect(page.getByText("识别质量", { exact: true })).toHaveCount(0);
    await expect(page.locator(".import-source-text")).toContainText("JSON Candidate");
    const mismatch = page.locator(".import-name-mismatch");
    const mismatchBox = await mismatch.boundingBox();
    const emailBox = await page.getByLabel("邮箱").boundingBox();
    const mismatchButtons = mismatch.getByRole("button");
    expect(mismatchBox).not.toBeNull();
    expect(emailBox).not.toBeNull();
    expect(mismatchBox!.y + mismatchBox!.height).toBeLessThanOrEqual(emailBox!.y);
    await expect(mismatchButtons).toHaveCount(2);
    const firstButtonBox = await mismatchButtons.nth(0).boundingBox();
    const secondButtonBox = await mismatchButtons.nth(1).boundingBox();
    expect(Math.abs((firstButtonBox!.y + firstButtonBox!.height / 2) - (secondButtonBox!.y + secondButtonBox!.height / 2))).toBeLessThan(2);
    await mismatch.getByRole("button", { name: "改为创建新人物", exact: true }).press("Enter");
    await expect(page.getByLabel("创建新人物")).toBeChecked();
    await expect(page.locator(".import-review-footer button.primary-button")).toBeVisible();
    await page.locator(".import-review-footer button.primary-button").click();
    await expect(page.getByText("已进入导入生成的通用简历，可继续编辑、换模板、调整分页并下载 PDF。")).toBeVisible();
    await page.getByRole("button", { name: "打开", exact: true }).click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
    const educationBox = await page.getByRole("button", { name: "教育经历", exact: true }).boundingBox();
    const workBox = await page.getByRole("button", { name: "工作经历 / 实习经历", exact: true }).boundingBox();
    const projectBox = await page.getByRole("button", { name: "项目经历 / 项目成果", exact: true }).boundingBox();
    const skillBox = await page.getByRole("button", { name: "技能", exact: true }).boundingBox();
    expect(educationBox!.y).toBeLessThan(workBox!.y);
    expect(workBox!.y).toBeLessThan(projectBox!.y);
    expect(projectBox!.y).toBeLessThan(skillBox!.y);
  });

  test("keeps malformed JSON available for correction and reports its location", async ({ page }) => {
    await openJsonImport(page);
    const textarea = page.locator(".import-json-details textarea");
    const malformed = '{"name":"Candidate",}';
    await textarea.fill(malformed);
    await page.locator(".import-json-details button.primary-button").click();

    await expect(page.locator(".app-notification-error")).toContainText(/JSON 格式错误/);
    await expect(page.locator(".app-notification-error")).toContainText(/第 1 行|位置/);
    await expect(textarea).toHaveValue(malformed);
  });

  test("maps external JSON deterministically and preserves trace and unclassified fields", async ({ page }) => {
    await page.route("**/api/ai/structured", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          task: "resume-json-mapper",
          promptVersion: "resume-json-mapper.v1",
          output: {
            structuredDraft: {
              basics: {
                name: {
                  value: "External Candidate",
                  mapping: { sourcePaths: ["profile.name"], sourceValues: ["External Candidate"], confidenceLevel: "high", confidenceReason: "Exact field", needsConfirmation: true }
                }
              },
              sections: [{
                title: "项目经历",
                category: "project",
                sectionType: "experience",
                items: [{
                  text: "Built a verified dashboard.",
                  mapping: { sourcePaths: ["projects[0].description"], sourceValues: ["Built a verified dashboard."], confidenceLevel: "high", confidenceReason: "Exact field", needsConfirmation: true }
                }]
              }]
            },
            unclassifiedBlocks: [{ sourcePath: "vendorMetadata.source", sourceValue: "another-resume-site", reason: "No supported destination" }]
          },
          meta: { provider: "mock", model: "mock-json-mapper", inputLength: 200, outputLength: 300, latencyMs: 1 }
        })
      });
    });
    await openJsonImport(page);
    await page.locator(".import-json-details textarea").fill(JSON.stringify({
      profile: { name: "External Candidate", email: "external@example.com" },
      projects: [{ projectName: "External Project", description: "Built a verified dashboard." }],
      vendorMetadata: { source: "another-resume-site" }
    }));
    await page.locator(".import-json-details button.primary-button").click();

    await expect(page.locator(".mapping-trace").first()).toContainText("来源：");
    await expect(page.getByText(/未识别内容（\d+）/)).toBeVisible();
    await expect(page.locator(".ai-mapping-consent")).toContainText("脱敏");
    await page.locator(".ai-mapping-consent input").check();
    await page.getByRole("button", { name: "使用 AI 智能映射", exact: true }).click();
    await expect(page.locator(".import-review-footer")).toContainText("AI 映射结果已通过 Schema 校验");
    await expect(page.locator(".mapping-trace").first()).toContainText("需要确认");
  });

  test("keeps import review panels reachable without overlap at supported desktop viewports", async ({ page }) => {
    await openJsonImport(page);
    await page.getByRole("button", { name: "填入示例", exact: true }).click();
    await page.locator(".import-json-details button.primary-button").click();
    await expect(page.locator(".import-review-grid")).toBeVisible();

    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 1280, height: 720 },
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 }
    ]) {
      await page.setViewportSize(viewport);
      const layout = await page.locator(".import-review-grid").evaluate((grid) => {
        const source = grid.querySelector<HTMLElement>(".import-source-panel")!;
        const structure = grid.querySelector<HTMLElement>(".import-structure-panel")!;
        const sourceRect = source.getBoundingClientRect();
        const structureRect = structure.getBoundingClientRect();
        return {
          sourceRight: sourceRect.right,
          structureLeft: structureRect.left,
          structureClientHeight: structure.clientHeight,
          structureScrollHeight: structure.scrollHeight,
          structureOverflowY: getComputedStyle(structure).overflowY,
          dialogBottom: grid.closest("[role=dialog]")!.getBoundingClientRect().bottom,
          viewportHeight: window.innerHeight
        };
      });
      expect(layout.structureLeft).toBeGreaterThanOrEqual(layout.sourceRight);
      expect(layout.structureClientHeight).toBeGreaterThan(100);
      expect(layout.structureScrollHeight).toBeGreaterThan(layout.structureClientHeight);
      expect(layout.structureOverflowY).toBe("auto");
      expect(layout.dialogBottom).toBeLessThanOrEqual(layout.viewportHeight);
      await expect(page.locator(".import-review-footer button.primary-button")).toBeVisible();
    }
  });

  test("keeps target choice and confirmation footer reachable at 1024px", async ({ page }) => {
    await openJsonImport(page);
    await page.getByRole("button", { name: "填入示例", exact: true }).click();
    await page.locator(".import-json-details button.primary-button").click();
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.locator(".import-target-picker")).toBeVisible();
    await expect(page.locator(".import-review-footer")).toBeVisible();
    const metrics = await page.evaluate(() => {
      const footer = document.querySelector<HTMLElement>(".import-review-footer")!;
      const grid = document.querySelector<HTMLElement>(".import-review-grid")!;
      return {
        footerBottom: footer.getBoundingClientRect().bottom,
        viewportHeight: innerHeight,
        gridHeight: grid.clientHeight,
        rootOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyHeight: document.querySelector<HTMLElement>(".resume-import-modal-body")!.clientHeight,
        overlappingInputs: Array.from(document.querySelectorAll<HTMLElement>(
          ".import-structure-panel input, .import-structure-panel select, .import-structure-panel textarea"
        )).flatMap((element, index, elements) => {
          const first = element.getBoundingClientRect();
          return elements.slice(index + 1).filter((candidate) => {
            const second = candidate.getBoundingClientRect();
            return first.left < second.right && first.right > second.left
              && first.top < second.bottom && first.bottom > second.top;
          }).map((candidate) => `${element.tagName}:${index}-${candidate.tagName}`);
        })
      };
    });
    expect(metrics.footerBottom).toBeLessThanOrEqual(metrics.viewportHeight);
    expect(metrics.gridHeight).toBeGreaterThan(100);
    expect(metrics.gridHeight / metrics.bodyHeight).toBeGreaterThanOrEqual(0.70);
    expect(metrics.rootOverflow).toBe(0);
    expect(metrics.overlappingInputs).toEqual([]);
  });

  test("retains raw external JSON when AI mapping is unavailable", async ({ page }) => {
    await page.route("**/api/ai/structured", (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: { code: "provider_unavailable", message: "Unavailable" } })
    }));
    await openJsonImport(page);
    const rawText = JSON.stringify({ fullName: "Retry Candidate", workExperience: ["Kept source content"] });
    await page.locator(".import-json-details textarea").fill(rawText);
    await page.locator(".import-json-details button.primary-button").click();
    await page.locator(".ai-mapping-consent input").check();
    await page.getByRole("button", { name: "使用 AI 智能映射", exact: true }).click();

    await expect(page.locator(".app-notification-error")).toContainText("AI 映射失败");
    await page.getByText("查看原始 JSON", { exact: true }).click();
    await expect(page.locator(".import-source-footer pre")).toContainText(rawText);
    await expect(page.getByRole("button", { name: "使用 AI 智能映射", exact: true })).toBeEnabled();
  });

  test("exports the active resume as structured JSON", async ({ page }) => {
    await createBranchFromJsonImport(page, `G7b2 JSON export ${Date.now()}`);

    // Open the "更多" dropdown to access JSON export
    const workbar = page.getByTestId("resume-studio-workbar");
    await workbar.locator(".toolbar-more summary").click();
    const downloadPromise = page.waitForEvent("download");
    await workbar.locator(".toolbar-more-popover").getByRole("button", { name: /JSON/ }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const exported = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      schemaVersion: string;
      sections: Array<{ sectionType: string; items: unknown[] }>;
    };

    expect(download.suggestedFilename()).toContain("structured-resume.json");
    expect(exported.schemaVersion).toBe("careeradapt-resume-v2");
    expect(exported.sections).toContainEqual(expect.objectContaining({
      sectionType: "project",
      items: expect.any(Array)
    }));
    await expect(page.locator(".app-notification-success").filter({ hasText: "结构化 JSON" }).last()).toBeVisible();
  });
});

async function openJsonImport(page: Page) {
  await page.goto("/resume");
  await page.getByRole("button", { name: "粘贴 JSON", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "导入简历" })).toBeVisible();
}

async function createBranchFromJsonImport(page: Page, candidateName: string) {
  await openJsonImport(page);
  await page.locator(".import-json-details textarea").fill(JSON.stringify({
    schemaVersion: "structured-resume-draft-v1",
    basics: { name: candidateName },
    sections: [{ title: "Projects", category: "project", sectionType: "experience", items: ["Created a verified project result."] }]
  }));
  await page.locator(".import-json-details button.primary-button").click();
  await page.getByLabel("创建新人物").check();
  await page.locator(".import-review-footer button.primary-button").click();
  await page.getByRole("button", { name: "打开", exact: true }).click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
}
