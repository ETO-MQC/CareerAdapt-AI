import { expect, test, type Page } from "@playwright/test";
import { prepareCoreSourceResume, completeCoreResumeWorkflow, readStore, verifyCoreResumePdf } from "./support/p51CoreWorkflow";

test.use({ actionTimeout: 15_000 });

async function setup(page: Page) {
  await page.goto("/setup");
  await expect.poll(async () => (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot?.apiReady, { timeout: 90_000 }).toBe(true);
  await page.getByLabel("API 密钥", { exact: true }).fill(process.env.HERMES_INTEGRATION_PROVIDER_KEY!);
  await page.getByLabel("API 地址", { exact: true }).fill(process.env.HERMES_INTEGRATION_PROVIDER_URL!);
  await page.getByLabel("模型名称", { exact: true }).fill("careeradapt-test");
  await page.getByRole("button", { name: "开始使用", exact: true }).click();
  await expect(page).not.toHaveURL(/\/setup$/u, { timeout: 90_000 });
}

async function snapshot(page: Page): Promise<Record<string, Array<Record<string, unknown>>>> {
  return Object.fromEntries(await Promise.all(["profiles", "resumeBranches", "resumeRevisions", "jobDescriptions", "exportRecords"].map(async name => [name, await readStore(page, name)])));
}

test("E2E-A: official import, General PDF, Job A and Job B confirmed revisions remain isolated", async ({ page }, info) => {
  test.setTimeout(300_000);
  await setup(page);
  await prepareCoreSourceResume(page);
  const general = (await readStore(page, "resumeBranches")).find(b => b.branchPurpose === "general")!;
  expect(general).toBeTruthy();
  const baseline = await snapshot(page);
  await verifyCoreResumePdf(page, String(general.id));
  await info.attach("general-preview", { body: await page.screenshot(), contentType: "image/png" });
  let previous: Awaited<ReturnType<typeof snapshot>> | undefined;
  for (const suffix of ["A", "B"]) {
    await page.goto("/jobs");
    await page.getByTestId("job-title-input").fill(`AI 应用开发 P522-${suffix}`);
    await page.getByTestId("job-company-input").fill(`合成公司 ${suffix}`);
    await page.getByTestId("job-raw-textarea").fill(`岗位：AI 应用开发 P522-${suffix}\n岗位职责\n1. 参与 AI 应用需求梳理和功能验收。\n任职要求\n1. 熟悉 Python 或 SQL。\n2. 团队协作能力优先。`);
    await page.getByTestId("save-job-raw-input").click();
    await page.getByTestId("job-manual-mode-dialog").click();
    const dialog = page.getByRole("dialog");
    const checks = dialog.getByRole("checkbox");
    for (let i = 0; i < await checks.count(); i++) await checks.nth(i).check();
    await dialog.getByTestId("commit-job").click();
    await expect(page.getByTestId("conversion-result")).toBeVisible();
    const job = (await readStore(page, "jobDescriptions")).find(j => String(j.title).includes(`P522-${suffix}`))!;
    await completeCoreResumeWorkflow(page, String(job.id));
    const after = await snapshot(page);
    expect(after.profiles).toEqual(baseline.profiles);
    expect(after.resumeBranches.find(b => b.id === general.id)).toEqual(general);
    if (previous) {
      for (const branch of previous.resumeBranches) expect(after.resumeBranches.find(b => b.id === branch.id)).toEqual(branch);
      for (const revision of previous.resumeRevisions) expect(after.resumeRevisions.find(r => r.id === revision.id)).toEqual(revision);
    }
    previous = after;
    await info.attach(`job-${suffix}-preview`, { body: await page.screenshot(), contentType: "image/png" });
  }
  expect(previous!.resumeBranches.filter(b => b.profileId === general.profileId)).toHaveLength(3);
  await info.attach("business-before-after", { body: JSON.stringify({ baseline, after: previous }, null, 2), contentType: "application/json" });
});

test("E2E-B: material edit/reject, refresh confirmation, Agent stop and edited-message recovery", async ({ page }, info) => {
  test.setTimeout(240_000);
  await setup(page);
  await page.goto("/resume");
  const open = async () => {
    await page.getByRole("button", { name: "导入资料", exact: false }).click();
    return page.getByRole("dialog", { name: "导入资料", exact: true });
  };
  let dialog = await open();
  await dialog.getByLabel("识别方式").selectOption("local");
  const material = { schemaVersion: "careeradapt-resume-v2", locale: "zh-CN", basics: { portfolioLinks: [], otherLinks: [], customFields: [] }, sections: [
    { id: "cert", sectionType: "certificates", title: "证书", order: 0, visible: true, items: [{ id: "cert1", sectionType: "certificates", name: "P522 合成资格证书", issuer: "原机构", customFields: [] }] },
    { id: "award", sectionType: "awards", title: "奖项", order: 1, visible: true, items: [{ id: "award1", sectionType: "awards", name: "不应入库奖项", customFields: [] }] }
  ], unclassifiedBlocks: [] };
  await dialog.getByLabel("选择职业材料").setInputFiles({ name: "p522-material.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(material)) });
  await expect(dialog.getByLabel("材料候选证书名称")).toHaveValue("P522 合成资格证书");
  const before = await snapshot(page);
  await dialog.getByText("创建新人物", { exact: true }).click();
  await dialog.locator('input[name="new-profile-name"]').fill("P522 合成人物");
  const certificate = () => dialog.locator("article.review-row").filter({ has: page.locator('select[aria-label="证书栏目类型"]') });
  const issuer = certificate().getByLabel("材料候选颁发方", { exact: true });
  await issuer.fill("人工核对机构"); await issuer.blur();
  await dialog.getByRole("button", { name: "采用此条", exact: true }).click();
  await dialog.locator("article.review-row").filter({ has: page.locator('select[aria-label="奖项栏目类型"]') }).locator('input[name$="-included"]').last().uncheck();
  expect(await snapshot(page)).toEqual(before);
  await page.reload(); dialog = await open();
  await expect(certificate().getByLabel("材料候选颁发方", { exact: true })).toHaveValue("人工核对机构");
  await expect(dialog.locator('input[name="import-create-general-resume"]').first()).not.toBeChecked();
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  const saved = await snapshot(page);
  expect(saved.resumeBranches).toEqual(before.resumeBranches);
  expect(saved.resumeRevisions).toEqual(before.resumeRevisions);
  const profile = saved.profiles.find(p => p.name === "P522 合成人物")!;
  expect(JSON.stringify(profile)).toContain("人工核对机构");
  expect(JSON.stringify(profile)).not.toContain("不应入库奖项");
  await page.goto("/ai-workspace");
  await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u, { timeout: 90_000 });
  await page.getByLabel("描述你的求职任务").fill("P512-QUEUE-FIRST P522-STOP-A 读取当前资料，不要修改。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const sessions = () => readStore(page, "agentSessions");
  await expect.poll(async () => (await sessions()).some(s => (s.hermesRun as { status?: string })?.status === "running"), { timeout: 60_000 }).toBe(true);
  await page.getByRole("button", { name: "停止运行", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止运行", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "编辑并重发", exact: true }).last().click();
  await page.getByLabel("编辑消息", { exact: true }).fill("P522-EDIT-B 读取当前资料，仅概览。");
  await page.getByRole("button", { name: "确认并重发", exact: true }).click();
  await expect.poll(async () => (await sessions()).some(s => ["completed", "failed"].includes((s.activeTurn as { status: string })?.status)), { timeout: 90_000 }).toBe(true);
  const edited = (await sessions()).find(s => JSON.stringify(s).includes("P522-EDIT-B"));
  if ((edited?.activeTurn as { status?: string })?.status === "failed") {
    await expect(page.getByText("本轮回答失败，可重试", { exact: true })).toBeVisible();
    expect(await snapshot(page)).toEqual(saved);
    await expect.poll(async () => (await (await page.request.get("/api/agent/runtime/hermes/health")).json()).available, { timeout: 60_000 }).toBe(true);
    await page.getByRole("button", { name: "重试", exact: true }).click();
  }
  await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("P522 当前资料已读取", { timeout: 90_000 });
  await page.reload();
  await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("P522 当前资料已读取");
  expect(await snapshot(page)).toEqual(saved);
  await info.attach("material-agent-before-after", { body: JSON.stringify({ before, saved, sessions: await sessions() }, null, 2), contentType: "application/json" });
  await info.attach("recovered-workspace", { body: await page.screenshot(), contentType: "image/png" });
});
