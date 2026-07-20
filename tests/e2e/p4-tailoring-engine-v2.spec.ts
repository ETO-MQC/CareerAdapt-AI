import { expect, test, type Page } from "@playwright/test";

type DbBranch = { id: string; revision: number; currentRevisionId?: string; sourceBranchId?: string; contentItems: Array<{ id: string; text: string }> };

test("three tailoring intensities produce real deltas, apply a revision, and reject empty AI output", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/resume");
  await page.getByRole("button").filter({ hasText: "从个人资料库创建" }).click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
  await page.goto("/jobs");
  await page.getByRole("radio", { name: /优化已有简历/ }).check();
  const sourceSelect = page.getByLabel("来源通用简历");
  await expect(sourceSelect).toBeVisible({ timeout: 20_000 });
  await sourceSelect.selectOption({ index: 1 });
  const sourceBranchId = await sourceSelect.inputValue();
  const sourceBefore = await readFromStore<DbBranch>(page, "resumeBranches", sourceBranchId);
  const generateJobResume = page.getByRole("button", { name: "分析并生成岗位简历", exact: true });
  await expect(generateJobResume).toBeEnabled({ timeout: 20_000 });
  await generateJobResume.click();
  await expect(page).toHaveURL(/\/resume\?.*branchId=/, { timeout: 20_000 });
  const branchId = new URL(page.url()).searchParams.get("branchId")!;
  const branchBefore = await readFromStore<DbBranch>(page, "resumeBranches", branchId);

  await page.getByTitle("AI岗位优化").first().click();
  const panel = page.getByTestId("job-optimization-panel");
  await expect(panel).toBeVisible();
  const results = new Map<string, string>();
  for (const intensity of ["conservative", "balanced", "proactive"] as const) {
    await panel.getByLabel("推荐改写力度").selectOption(intensity);
    await panel.getByRole("button", { name: /生成改写建议/ }).click();
    const cards = panel.locator(".tailoring-suggestion-card");
    await expect(cards.first()).toBeVisible({ timeout: 60_000 });
    const deltas = await cards.evaluateAll((nodes) => nodes.map((node) => {
      const blocks = Array.from(node.children).filter((child) => child.tagName === "DIV");
      return { before: blocks[1]?.querySelector("p")?.textContent?.trim() ?? "", after: blocks[2]?.querySelector("p")?.textContent?.trim() ?? "" };
    }));
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.every((delta) => delta.after.length > 0 && delta.after !== delta.before)).toBe(true);
    results.set(intensity, deltas.map((delta) => delta.after).join("\n"));
    if (intensity !== "proactive") await panel.getByRole("button", { name: /1 匹配概览/ }).click();
  }
  expect(new Set(results.values()).size).toBe(3);
  await expect(panel.getByText("自我评价", { exact: true })).toBeVisible();

  await panel.getByRole("button", { name: /采用全部可直接应用建议/ }).click();
  await panel.getByRole("button", { name: "确认并应用", exact: true }).click();
  await expect(panel.getByText(/将修改/)).toBeVisible();
  await panel.getByRole("button", { name: /应用选择并保存新版本/ }).click();
  await expect.poll(async () => (await readFromStore<DbBranch>(page, "resumeBranches", branchId))?.revision, { timeout: 60_000 }).toBe((branchBefore?.revision ?? 0) + 1);
  const sourceAfter = await readFromStore<DbBranch>(page, "resumeBranches", sourceBranchId);
  expect(sourceAfter).toMatchObject({ revision: sourceBefore?.revision, currentRevisionId: sourceBefore?.currentRevisionId, contentItems: sourceBefore?.contentItems });

  await page.route("**/api/ai/structured", async (route) => {
    const body = route.request().postDataJSON() as { task?: string };
    if (body.task !== "resume-tailor") return route.continue();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, task: "resume-tailor", promptVersion: "resume-tailor.v2-empty-e2e", output: { suggestions: [] }, meta: { provider: "mock", model: "empty", inputLength: 1, outputLength: 1, latencyMs: 1 } }) });
  });
  await panel.getByRole("button", { name: /1 匹配概览/ }).click();
  await panel.getByRole("button", { name: /生成改写建议/ }).click();
  await expect(panel.getByRole("alert")).toContainText("AI 未生成有效改写", { timeout: 60_000 });
  await expect(panel.locator(".tailoring-suggestion-card")).toHaveCount(0);
});

async function readFromStore<T>(page: Page, storeName: string, key: string): Promise<T | undefined> {
  return page.evaluate(async ({ storeName, key }) => new Promise<T | undefined>((resolve, reject) => {
    const request = indexedDB.open("CareerAdaptDb");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const get = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
      get.onerror = () => reject(get.error);
      get.onsuccess = () => { resolve(get.result as T | undefined); database.close(); };
    };
  }), { storeName, key });
}
