import { expect, test, type Page } from "@playwright/test";
import { createRuleRequirementMatches } from "@/domain/match/matcher";
import { jd02Fixture } from "../fixtures/jd02";
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("CareerAdaptDb"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const names = ["profiles", "resumeBranches", "resumeRevisions", "requirementMatches"];
    try { return await Promise.all(names.map(name => new Promise<unknown[]>((resolve, reject) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }))); } finally { db.close(); }
  });
}
test("JD02 read-only Fit isolates F1/F2, switches job/resume/source, restores and locates evidence", async ({ page }) => {
  test.setTimeout(90_000);
  let calls = 0; const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/ai/**", async route => { calls++; await route.abort(); });
  await page.goto("/jobs");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) { await skip.click(); await page.goto("/jobs"); }
  await expect(page.locator(".jobs-workspace")).toBeVisible();
  const fixture = jd02Fixture();
  const staleMatches = createRuleRequirementMatches({ profile: fixture.profile, job: fixture.jobs[0], branch: fixture.branches[0].branch }).map(match => ({ ...match, sourceResumeBranchId: fixture.branches[0].branch.id, sourceResumeBranchRevision: 0, sourceResumeRevisionId: "obsolete-revision", matcherVersion: "obsolete-matcher" }));
  await page.evaluate(async f => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("CareerAdaptDb"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["profiles", "resumeBranches", "resumeRevisions", "jobDescriptions", "requirementMatches"], "readwrite");
        tx.objectStore("profiles").put(f.profile);
        f.branches.forEach(({ branch, revision }) => { tx.objectStore("resumeBranches").put(branch); tx.objectStore("resumeRevisions").put(revision); });
        f.staleMatches.forEach(match => tx.objectStore("requirementMatches").put(match));
        f.jobs.forEach(job => tx.objectStore("jobDescriptions").put(job)); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, { ...fixture, staleMatches });
  await page.goto("/jobs?jobId=jd02-job-1&sourceMode=resume&resumeId=jd02-branch-1");
  await expect(page.getByLabel("来源通用简历")).toHaveValue("jd02-branch-1");
  const before = await snapshot(page);
  await page.getByRole("tab", { name: "岗位要求", exact: true }).click();
  await expect(page.getByText(/历史匹配已过期/)).toBeVisible();
  const cards = page.locator(".job-requirement-cards");
  await cards.locator("summary").first().click();
  await expect(cards).toContainText("有明确证据支持");
  await expect(cards).toContainText("使用 Python 完成项目开发");
  await expect(cards).not.toContainText("使用 JavaScript 完成项目开发");
  const identity = await cards.getByText(/分析版本/).textContent();
  await page.reload(); await page.getByRole("tab", { name: "岗位要求", exact: true }).click(); await cards.locator("summary").first().click();
  await expect(cards.getByText(/分析版本/)).toHaveText(identity!);
  await page.getByRole("tab", { name: "生成岗位简历", exact: true }).click();
  await page.getByLabel("来源通用简历").selectOption("jd02-branch-2");
  await page.getByRole("tab", { name: "岗位要求", exact: true }).click(); await cards.locator("summary").first().click();
  await expect(cards).toContainText("信息不足，需要澄清"); await expect(cards).not.toContainText("使用 Python 完成项目开发");
  await page.getByRole("tab", { name: "生成岗位简历", exact: true }).click();
  await page.getByRole("radio", { name: /从资料库生成/ }).click();
  await page.getByRole("tab", { name: "岗位要求", exact: true }).click(); await cards.locator("summary").first().click();
  await expect(cards).toContainText("有明确证据支持");
  await page.reload();
  await expect(page.getByRole("radio", { name: /从资料库生成/ })).toBeChecked();
  await page.locator(".job-card").filter({ hasText: "JD02 岗位 2" }).first().click();
  await page.getByRole("tab", { name: "岗位要求", exact: true }).click(); await cards.locator("summary").first().click();
  await expect(cards).toContainText("Java"); await expect(cards).not.toContainText("有明确证据支持");
  expect(await snapshot(page)).toEqual(before);
  await page.goto("/jobs?jobId=jd02-job-1&sourceMode=resume&resumeId=jd02-branch-1");
  await page.getByRole("tab", { name: "岗位要求", exact: true }).click(); await cards.locator("summary").first().click();
  await cards.getByText(/支持程度/).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "docs/quality/jd-02-b-logs/requirements.png", fullPage: true });
  await cards.getByRole("link", { name: "定位简历条目" }).first().click();
  await expect(page).toHaveURL(/itemId=/); await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  expect(calls).toBe(0); expect(errors).toEqual([]);
});
