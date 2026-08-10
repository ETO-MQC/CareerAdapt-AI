import { expect, test, type Page } from "@playwright/test";

type DbBranch = {
  id: string;
  name?: string;
  revision: number;
  currentRevisionId?: string;
  branchPurpose?: string;
  sourceBranchId?: string;
  sourceRevisionId?: string;
  jobId?: string;
  contentItems: Array<{ id: string; text: string }>;
};

type DbSuggestion = {
  id: string;
  branchId?: string;
  status?: string;
  riskLevel?: string;
  targetContentItemId?: string;
  requirementsHash?: string;
};

test.describe("P3.4 job resume derivation and suggestion closure", () => {
  test("shows JD → evidence report → whole-resume optimization plan", async ({ page }) => {
    await ensureGeneralResume(page);
    await deriveSelectedJobResume(page);
    const panel = page.getByTestId("job-optimization-panel");
    await expect(panel.getByTestId("job-optimization-v2")).toBeVisible({ timeout: 20_000 });
    await panel.getByRole("tab", { name: /匹配报告/ }).click();
    const report = panel.getByTestId("optimization-v2-report");
    await expect(report).toContainText("岗位证据覆盖度");
    await expect(report).toContainText("不是 ATS 通过概率");
    await expect(report.getByTestId("requirement-v2-list").locator(".match-row").first()).toBeVisible();
    await report.getByTestId("requirement-v2-list").locator(".match-row").first().click();
    await expect(report.getByTestId("requirement-v2-detail")).toContainText("JD 原文");
    await panel.getByRole("tab", { name: /优化方案/ }).click();
    await expect(panel.getByTestId("optimization-v2-plan")).toContainText("本轮仅展示计划");
  });

  test("keeps hard gaps as questions and exposes no apply action in the V2 plan", async ({ page }) => {
    await ensureGeneralResume(page);
    await deriveSelectedJobResume(page);
    const panel = page.getByTestId("job-optimization-panel");
    await panel.getByRole("tab", { name: /优化方案/ }).click();
    const plan = panel.getByTestId("optimization-v2-plan");
    await expect(plan).toBeVisible({ timeout: 20_000 });
    await expect(plan).not.toContainText("拥有三年经验");
    await expect(plan.getByRole("button", { name: /应用|批量生成|写入简历/ })).toHaveCount(0);
  });

  test("explicitly selects a general resume, derives an isolated job branch, and accepts a guarded suggestion", async ({ page }) => {
    test.setTimeout(150_000);
    await setupStableAiMock(page);
    await ensureGeneralResume(page);
    await page.goto("/jobs");

    const sourceSelect = page.getByLabel("来源通用简历");
    await expect(sourceSelect).toHaveValue("");
    await expect(page.getByTestId("run-experience-match")).toBeDisabled();
    await expect(page.getByTestId("generate-job-resume")).toBeDisabled();

    await sourceSelect.selectOption({ index: 1 });
    const sourceBranchId = await sourceSelect.inputValue();
    const sourceBefore = await readFromStore<DbBranch>(page, "resumeBranches", sourceBranchId);
    expect(sourceBefore?.branchPurpose).toBe("general");

    await page.getByTestId("run-experience-match").click();
    await expect(page.getByText("匹配可用于生成", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("generate-job-resume")).toBeEnabled();
    await page.getByTestId("generate-job-resume").click();

    await expect(page).toHaveURL(/\/resume\?.*branchId=/, { timeout: 20_000 });
    await expect(page.getByTestId("resume-job-context")).toBeVisible();
    await expect(page.getByTestId("resume-job-context")).toContainText("来源通用简历");

    const derivedId = new URL(page.url()).searchParams.get("branchId")!;
    const derivedBefore = await readFromStore<DbBranch>(page, "resumeBranches", derivedId);
    expect(derivedBefore?.branchPurpose).toBe("job_specific");
    expect(derivedBefore?.sourceBranchId).toBe(sourceBranchId);
    expect(derivedBefore?.sourceRevisionId).toBe(sourceBefore?.currentRevisionId);

    const panel = page.getByTestId("job-optimization-panel");
    await expect(panel).toBeVisible();
    await panel.getByRole("tab", { name: /岗位匹配/ }).click();
    const firstMatchedRequirement = panel.getByTestId("requirement-sidebar").locator(".match-row").filter({ hasNotText: "无证据" }).first();
    await expect(firstMatchedRequirement).toBeVisible({ timeout: 20_000 });
    await firstMatchedRequirement.click();
    await panel.getByRole("button", { name: "压缩表达", exact: true }).click();
    const suggestionCard = panel.getByTestId("block-suggestion-panel");
    await expect(suggestionCard).toBeVisible({ timeout: 60_000 });
    await expect(suggestionCard).toContainText("事实安全检查");

    const mediumConfirmation = suggestionCard.getByRole("checkbox");
    if (await mediumConfirmation.count()) await mediumConfirmation.check();
    const accept = suggestionCard.getByRole("button", { name: /^(接受|编辑后接受)$/ });
    await expect(accept).toBeEnabled();
    await accept.click();

    await expect.poll(async () => (await readFromStore<DbBranch>(page, "resumeBranches", derivedId))?.revision, { timeout: 60_000 })
      .toBe((derivedBefore?.revision ?? 0) + 1);
    const accepted = (await readAllFromStore<DbSuggestion>(page, "aiSuggestions"))
      .filter((suggestion) => suggestion.branchId === derivedId && suggestion.status === "accepted");
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted[0].requirementsHash).toBeTruthy();
    const derivedAfter = await readFromStore<DbBranch>(page, "resumeBranches", derivedId);
    const acceptedText = derivedAfter?.contentItems.find((item) => item.id === accepted[0].targetContentItemId)?.text;
    expect(acceptedText).toBeTruthy();
    await expect(page.getByTestId("resume-a4-page").first()).toContainText(acceptedText!);

    const sourceAfter = await readFromStore<DbBranch>(page, "resumeBranches", sourceBranchId);
    expect(sourceAfter?.revision).toBe(sourceBefore?.revision);
    expect(sourceAfter?.currentRevisionId).toBe(sourceBefore?.currentRevisionId);
    expect(sourceAfter?.contentItems).toEqual(sourceBefore?.contentItems);
  });

  test("does not create another branch silently for the same source revision", async ({ page }) => {
    test.setTimeout(90_000);
    await ensureGeneralResume(page);
    await page.goto("/jobs");
    const sourceSelect = page.getByLabel("来源通用简历");
    await sourceSelect.selectOption({ index: 1 });
    await page.getByTestId("run-experience-match").click();
    await expect(page.getByTestId("generate-job-resume")).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId("generate-job-resume").click();
    await expect(page).toHaveURL(/\/resume\?.*branchId=/, { timeout: 20_000 });
    const firstBranchId = new URL(page.url()).searchParams.get("branchId")!;
    const first = await readFromStore<DbBranch>(page, "resumeBranches", firstBranchId);

    await page.getByRole("button", { name: "返回岗位" }).click();
    await expect(page.getByTestId("job-resume-flow")).toBeVisible();
    await sourceSelect.selectOption(first!.sourceBranchId!);
    await expect(page.getByTestId("generate-job-resume")).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId("generate-job-resume").click();

    await expect(page.getByRole("dialog")).toContainText("已存在基于当前通用简历版本生成的岗位简历");
    await expect(page.getByRole("button", { name: "打开已有岗位简历" })).toBeVisible();
    await expect(page.getByRole("button", { name: "重新生成新分支" })).toBeVisible();
  });

  test("blocks a high-risk suggestion without changing the formal branch", async ({ page }) => {
    await setupHighRiskAiMock(page);
    await ensureGeneralResume(page);
    const { derivedId } = await deriveSelectedJobResume(page);
    const before = await readFromStore<DbBranch>(page, "resumeBranches", derivedId);

    const panel = page.getByTestId("job-optimization-panel");
    await panel.getByRole("tab", { name: /岗位匹配/ }).click();
    await panel.getByTestId("requirement-sidebar").locator(".match-row").first().click();
    await panel.getByRole("button", { name: "生成内容建议", exact: true }).click();
    const suggestionCard = panel.getByTestId("block-suggestion-panel");
    await expect(suggestionCard).toContainText("已阻止接受", { timeout: 20_000 });
    await expect(suggestionCard.getByRole("button", { name: /^(接受|编辑后接受)$/ })).toHaveCount(0);

    const after = await readFromStore<DbBranch>(page, "resumeBranches", derivedId);
    expect(after?.revision).toBe(before?.revision);
    expect(after?.currentRevisionId).toBe(before?.currentRevisionId);
  });

  test("keeps two job branches and their general source isolated", async ({ page }) => {
    await ensureGeneralResume(page);
    const first = await deriveSelectedJobResume(page);
    const branchABefore = await readFromStore<DbBranch>(page, "resumeBranches", first.derivedId);

    await page.getByRole("button", { name: "返回岗位" }).click();
    const jobRows = page.locator(".jobs-list-panel .job-list .match-row");
    await expect(jobRows).toHaveCount(2);
    await jobRows.nth(1).click();
    const second = await deriveSelectedJobResume(page, first.sourceBranchId);
    const branchBBefore = await readFromStore<DbBranch>(page, "resumeBranches", second.derivedId);
    const sourceBefore = await readFromStore<DbBranch>(page, "resumeBranches", first.sourceBranchId);

    await page.goto(`/resume?branchId=${encodeURIComponent(first.derivedId)}`);
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByTestId("resume-section-nav").getByRole("button", { name: /工作.*经历/ }).click();
    const fields = page.getByTestId("resume-active-section-fields");
    const company = fields.getByLabel("公司 / 组织").first();
    await company.fill(`${await company.inputValue()}（岗位 A）`);
    await fields.getByRole("button", { name: "保存", exact: true }).first().click();
    const choice = page.getByRole("dialog", { name: "是否同步到个人资料库？" });
    if (await choice.count()) await choice.getByRole("button", { name: "仅保存到简历", exact: true }).click();
    await expect.poll(async () => (await readFromStore<DbBranch>(page, "resumeBranches", first.derivedId))?.revision)
      .toBe((branchABefore?.revision ?? 0) + 1);

    expect(await readFromStore<DbBranch>(page, "resumeBranches", second.derivedId)).toEqual(branchBBefore);
    expect(await readFromStore<DbBranch>(page, "resumeBranches", first.sourceBranchId)).toEqual(sourceBefore);
  });

  test("marks a suggestion stale after a manual formal edit and prevents acceptance", async ({ page }) => {
    await setupStableAiMock(page);
    await ensureGeneralResume(page);
    const { derivedId } = await deriveSelectedJobResume(page);
    const panel = page.getByTestId("job-optimization-panel");
    await panel.getByRole("tab", { name: /岗位匹配/ }).click();
    await panel.getByTestId("requirement-sidebar").locator(".match-row").first().click();
    await panel.getByRole("button", { name: "压缩表达", exact: true }).click();
    await expect(panel.getByTestId("block-suggestion-panel")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByTestId("resume-section-nav").getByRole("button", { name: /工作.*经历/ }).click();
    const fields = page.getByTestId("resume-active-section-fields");
    const company = fields.getByLabel("公司 / 组织").first();
    await company.fill(`${await company.inputValue()}（已更新）`);
    await fields.getByRole("button", { name: "保存", exact: true }).first().click();
    const choice = page.getByRole("dialog", { name: "是否同步到个人资料库？" });
    if (await choice.count()) await choice.getByRole("button", { name: "仅保存到简历", exact: true }).click();
    const revised = await readFromStore<DbBranch>(page, "resumeBranches", derivedId);

    await page.getByRole("button", { name: "AI优化", exact: true }).click();
    const reloadedPanel = page.getByTestId("job-optimization-panel");
    await reloadedPanel.locator(".suggestion-list .match-row").first().click();
    const staleCard = reloadedPanel.getByTestId("block-suggestion-panel");
    await expect(staleCard).toContainText("建议已过期");
    await expect(staleCard.getByRole("button", { name: /^(接受|编辑后接受)$/ })).toBeDisabled();
    expect((await readFromStore<DbBranch>(page, "resumeBranches", derivedId))?.currentRevisionId).toBe(revised?.currentRevisionId);
  });
});

async function readFromStore<T>(page: Page, storeName: string, id: string): Promise<T | undefined> {
  return page.evaluate(({ name, key }) => new Promise<T | undefined>((resolve, reject) => {
    const request = indexedDB.open("CareerAdaptDb");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(name, "readonly");
      const get = tx.objectStore(name).get(key);
      get.onerror = () => reject(get.error);
      get.onsuccess = () => resolve(get.result as T | undefined);
      tx.oncomplete = () => db.close();
    };
  }), { name: storeName, key: id });
}

async function readAllFromStore<T>(page: Page, storeName: string): Promise<T[]> {
  return page.evaluate((name) => new Promise<T[]>((resolve, reject) => {
    const request = indexedDB.open("CareerAdaptDb");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(name, "readonly");
      const getAll = tx.objectStore(name).getAll();
      getAll.onerror = () => reject(getAll.error);
      getAll.onsuccess = () => resolve(getAll.result as T[]);
      tx.oncomplete = () => db.close();
    };
  }), storeName);
}

async function ensureGeneralResume(page: Page) {
  await page.goto("/resume");
  await page.getByRole("button").filter({ hasText: "从个人资料库创建" }).click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
}

async function deriveSelectedJobResume(page: Page, sourceBranchId?: string) {
  if (!page.url().includes("/jobs")) await page.goto("/jobs");
  const sourceSelect = page.getByLabel("来源通用简历");
  if (sourceBranchId) await sourceSelect.selectOption(sourceBranchId);
  else await sourceSelect.selectOption({ index: 1 });
  const selectedSourceId = await sourceSelect.inputValue();
  await page.getByTestId("run-experience-match").click();
  await expect(page.getByTestId("generate-job-resume")).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId("generate-job-resume").click();
  await expect(page).toHaveURL(/\/resume\?.*branchId=/, { timeout: 20_000 });
  return { sourceBranchId: selectedSourceId, derivedId: new URL(page.url()).searchParams.get("branchId")! };
}

async function setupStableAiMock(page: Page) {
  await page.route("**/api/ai/structured", async (route) => {
    const body = route.request().postDataJSON() as {
      task: string;
      input?: {
        sectionTexts?: Array<{ sectionId: string; text: string }>;
        matches?: Array<{ requirementId: string }>;
        allowedEvidenceRefs?: unknown[];
        ruleFindings?: unknown[];
      };
    };
    if (body.task === "resume-tailor") {
      const section = body.input?.sectionTexts?.[0];
      const match = body.input?.matches?.[0];
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          task: "resume-tailor",
          promptVersion: "resume-tailor.p34-e2e",
          output: {
            suggestions: [{
              type: "compress",
              targetSectionId: section?.sectionId,
              originalText: section?.text,
              suggestedText: section?.text ? `${section.text}。` : section?.text,
              reason: "保留已确认事实并压缩岗位相关表达。",
              requirementIds: match ? [match.requirementId] : [],
              usedEvidenceRefs: body.input?.allowedEvidenceRefs ?? [],
              riskLevel: "low"
            }]
          },
          meta: { provider: "mock", model: "mock-p34", inputLength: 1, outputLength: 1, latencyMs: 1 }
        })
      });
      return;
    }
    if (body.task === "fact-guard") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          task: "fact-guard",
          promptVersion: "fact-guard.p34-e2e",
          output: {
            status: "pass",
            riskLevel: "low",
            findings: body.input?.ruleFindings ?? [],
            explanation: "未检测到越界事实。"
          },
          meta: { provider: "mock", model: "mock-p34", inputLength: 1, outputLength: 1, latencyMs: 1 }
        })
      });
      return;
    }
    await route.continue();
  });
}

async function setupHighRiskAiMock(page: Page) {
  await page.route("**/api/ai/structured", async (route) => {
    const body = route.request().postDataJSON() as {
      task: string;
      input?: {
        sectionTexts?: Array<{ sectionId: string; text: string }>;
        matches?: Array<{ requirementId: string }>;
        allowedEvidenceRefs?: unknown[];
        ruleFindings?: unknown[];
      };
    };
    if (body.task === "resume-tailor") {
      const section = body.input?.sectionTexts?.[0];
      const match = body.input?.matches?.[0];
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          task: "resume-tailor",
          promptVersion: "resume-tailor.p34-high-risk-e2e",
          output: { suggestions: [{
            type: "rewrite",
            targetSectionId: section?.sectionId,
            originalText: section?.text,
            suggestedText: `${section?.text ?? ""} 主导项目并提升 999%。`,
            reason: "高风险固定建议，用于验证阻止写入。",
            requirementIds: match ? [match.requirementId] : [],
            usedEvidenceRefs: body.input?.allowedEvidenceRefs ?? [],
            riskLevel: "high"
          }] },
          meta: { provider: "mock", model: "mock-p34", inputLength: 1, outputLength: 1, latencyMs: 1 }
        })
      });
      return;
    }
    if (body.task === "fact-guard") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          task: "fact-guard",
          promptVersion: "fact-guard.p34-high-risk-e2e",
          output: {
            status: "blocked_high_risk",
            riskLevel: "high",
            findings: body.input?.ruleFindings ?? [],
            explanation: "检测到未经确认的数字和责任升级。"
          },
          meta: { provider: "mock", model: "mock-p34", inputLength: 1, outputLength: 1, latencyMs: 1 }
        })
      });
      return;
    }
    await route.continue();
  });
}
