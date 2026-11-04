import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { CareerProfileSchema, ResumeBranchSchema, ResumeRevisionSchema, JobDescriptionSchema } from "@/domain/schemas";

test("JD02-B1 confirmed SQL experience remains partial support beside a skill declaration", async ({ page }) => {
  const trace = JSON.parse(readFileSync("docs/quality/jd-02-b1-logs/sql-qualified-trace.json", "utf8"));
  const f = { profile: CareerProfileSchema.parse(trace.profileSnapshot), branch: ResumeBranchSchema.parse(trace.branchSnapshot), revision: ResumeRevisionSchema.parse(trace.firstRevision), job: JobDescriptionSchema.parse(trace.rawJob) };
  let calls = 0; const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/ai/**", async route => { calls++; await route.abort(); });
  await page.goto("/jobs");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) { await skip.click(); await page.goto("/jobs"); }
  await expect(page.locator(".jobs-workspace")).toBeVisible();
  await page.evaluate(async f => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("CareerAdaptDb"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["profiles", "resumeBranches", "resumeRevisions", "jobDescriptions", "appMeta"], "readwrite");
      tx.objectStore("profiles").put(f.profile); tx.objectStore("resumeBranches").put(f.branch); tx.objectStore("resumeRevisions").put(f.revision); tx.objectStore("jobDescriptions").put(f.job);
      const personId = f.profile.personId!; const now = f.profile.updatedAt;
      const put = (key: string, value: unknown) => tx.objectStore("appMeta").put({ key, value, updatedAt: now });
      put(`careerPerson:v1:${personId}`, { id: personId, displayName: f.profile.basics.name, currentProfileId: f.profile.id, createdAt: f.profile.createdAt, updatedAt: now });
      put("activeCareerContext:v1", { schemaVersion: "active-career-v1", personId, profileId: f.profile.id, profileVersionNumber: f.profile.profileVersionNumber ?? 1, profileRevision: f.profile.version, selectedAt: now });
      put("activeProfileContext:v1", { schemaVersion: "active-profile-v1", profileId: f.profile.id });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); } finally { db.close(); }
  }, f);
  const snapshot = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("CareerAdaptDb"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await Promise.all(["profiles", "resumeBranches", "resumeRevisions", "requirementMatches"].map(name => new Promise<unknown[]>((resolve, reject) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }))); } finally { db.close(); }
  });
  await page.goto(`/jobs?jobId=${f.job.id}&sourceMode=resume&resumeId=${f.branch.id}`);
  await expect(page.getByLabel("来源通用简历")).toHaveValue(f.branch.id);
  const before = await snapshot();
  const open = async () => { await page.getByRole("tab", { name: "岗位要求", exact: true }).click(); await page.locator('[data-requirement-id="req-sql-reporting"] summary').click(); };
  await open();
  const card = page.locator('[data-requirement-id="req-sql-reporting"]');
  await expect(card).toContainText("有部分证据支持");
  await expect(card).not.toContainText("可能具备，但缺少证据");
  await expect(card).not.toContainText("不是带项目来源的已证明经历");
  await expect(card).toContainText("Built weekly SQL reports for operation teams.");
  await expect(card).toContainText("原始来源：ACME Analytics | Data Analyst");
  await page.getByRole("tab", { name: "生成岗位简历", exact: true }).click();
  await page.getByRole("radio", { name: /从资料库生成/ }).click(); await open();
  await expect(card).toContainText("有部分证据支持");
  await page.reload(); await open(); await expect(card).toContainText("有部分证据支持");
  expect(await snapshot()).toEqual(before); expect(calls).toBe(0); expect(errors).toEqual([]);
});
