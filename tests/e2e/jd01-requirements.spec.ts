import { expect, test } from "@playwright/test";

test("JD-01 AI source segments survive confirmation, formal save and browser reload", async ({ page }) => {
  let calls = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/ai/structured", async (route) => {
    calls += 1;
    const request = route.request().postDataJSON();
    expect(request.task).toBe("jd-analyzer");
    const units = request.input.sourceUnits as { id: string; text: string }[];
    const unitAssignments = units.map((unit) => unit.text.includes("，") ? {
      sourceUnitId: unit.id, verdict: "override", confidence: 0.95,
      segments: [{ start: 0, end: 8, section: "required", exactKeywords: ["接口"] }, { start: 8, end: unit.text.length, section: "required" }]
    } : { sourceUnitId: unit.id, verdict: "accept" });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, task: request.task, promptVersion: "jd01-synthetic", output: { unitAssignments, groupAdjustments: [], riskNotes: [] }, meta: { provider: "synthetic", model: "fixture", inputLength: 100, outputLength: 100, latencyMs: 1 } }) });
  });
  await page.goto("/jobs");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) { await skip.click(); await page.goto("/jobs"); }
  await expect(page.locator(".jobs-workspace")).toBeVisible();
  const rawText = "任职要求\n能完成接口设计，能定位生产故障并撰写技术文档";
  await page.getByTestId("job-title-input").fill("JD01 合成岗位");
  await page.getByTestId("job-company-input").fill("JD01 合成公司");
  await page.getByTestId("job-raw-textarea").fill(rawText);
  await page.getByTestId("save-job-raw-input").click();
  const dialog = page.getByRole("dialog", { name: "JD01 合成岗位" });
  await dialog.getByRole("button", { name: "同意脱敏并解析" }).click();
  await expect(dialog.locator(".review-row")).toHaveCount(2);
  await expect(dialog.locator(".review-row input[type=checkbox]").first()).not.toBeChecked();
  await dialog.getByRole("button", { name: "全选", exact: true }).click();
  await dialog.getByTestId("commit-job").click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("tab", { name: "岗位要求", exact: true }).click();
  await expect(page.locator("[data-requirement-id]")).toHaveCount(2);
  await expect(page.locator(".job-requirement-cards")).toContainText("2 条已确认要求");
  const readJob = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open("CareerAdaptDb"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    try { return await new Promise<{ rawText: string; requirements: { id: string; description: string }[]; requirementGraph: { requirements: { id: string; statement: string }[] } }>((resolve, reject) => { const req = db.transaction("jobDescriptions").objectStore("jobDescriptions").getAll(); req.onsuccess = () => resolve(req.result.find((job) => job.title === "JD01 合成岗位")); req.onerror = () => reject(req.error); }); } finally { db.close(); }
  });
  const saved = await readJob();
  expect(saved.rawText).toBe(rawText);
  expect(saved.requirements.map((node) => node.id)).toEqual(saved.requirementGraph.requirements.map((node) => node.id));
  expect(saved.requirements.map((node) => node.description)).toEqual(saved.requirementGraph.requirements.map((node) => node.statement));
  await expect(page).toHaveURL(/jobId=/);
  await page.reload();
  await page.getByRole("tab", { name: "岗位要求", exact: true }).click();
  await expect(page.locator("[data-requirement-id]")).toHaveCount(saved.requirementGraph.requirements.length);
  expect(await readJob()).toEqual(saved);
  await page.locator("[data-requirement-id]").first().locator("summary").click();
  await expect(page.locator(".job-requirement-cards")).toContainText("来源段落：能完成接口设计，能定位生产故障并撰写技术文档");
  await page.screenshot({ path: "docs/quality/jd-01-logs/jobs-requirements.png", fullPage: true });
  expect(calls).toBe(1);
  expect(errors).toEqual([]);
});
