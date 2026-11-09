import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { readStore, prepareCoreSourceResume } from "./support/p51CoreWorkflow";
import { JOB_INTAKE_INCIDENT_JD } from "../fixtures/jobIntakeIncident";
import type { AgentSession } from "@/agent/contracts/agentSession";

test("Lifecycle isolation real Hermes + Scripted: delete, hide, resubmit as new Job", async ({ page }) => {
  const directory = process.env.JOB_HOTFIX_DIR!;
  const provider = process.env.HERMES_INTEGRATION_PROVIDER_URL!, key = process.env.HERMES_INTEGRATION_PROVIDER_KEY!;
  expect(provider).toMatch(/^http:\/\/127\.0\.0\.1:/u);
  await page.goto("/setup");
  await expect.poll(async () => {
    const response = await page.request.get("/api/agent/runtime/hermes/control");
    return response.ok() && (await response.json()).snapshot?.runReady === true;
  }, { timeout: 60_000 }).toBe(true);
  await page.getByLabel("API 密钥", { exact: true }).fill(key);
  await page.getByLabel("API 地址", { exact: true }).fill(provider);
  await page.getByLabel("模型名称", { exact: true }).fill("careeradapt-test");
  await page.getByRole("button", { name: "开始使用", exact: true }).click();
  await expect(page).not.toHaveURL(/\/setup$/u);
  await prepareCoreSourceResume(page);
  const baselineJobIds = (await readStore(page, "jobDescriptions")).map(job => job.id);
  const before = { jobs: await readStore(page, "jobDescriptions"), profiles: await readStore(page, "profiles"), branches: await readStore(page, "resumeBranches"), revisions: await readStore(page, "resumeRevisions") };
  await page.goto("/ai-workspace");
  await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u, { timeout: 60_000 });
  const previousSessionIds = (await readStore(page, "agentSessions")).map(s => s.id);
  await page.getByRole("button", { name: "新任务", exact: true }).click();
  await expect.poll(async () => (await readStore(page, "agentSessions")).some(s => !previousSessionIds.includes(s.id))).toBe(true);
  const jobs = async () => (await readStore(page, "jobDescriptions")).filter(job => !baselineJobIds.includes(job.id));
  const sessions = async () => (await readStore(page, "agentSessions")) as unknown as AgentSession[];
  const send = async (text: string, company: string | null) => {
    const previousRuns = (await sessions()).map(s => s.hermesRun?.runId);
    await page.getByLabel("描述你的求职任务").fill(text);
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect.poll(async () => {
      const list = await jobs();
      const session = (await sessions()).find(s => s.taskState?.workflowId === "job_ingestion");
      return list.length === 1 && list[0].company === company && session?.hermesRun?.status === "completed"
        && !previousRuns.includes(session.hermesRun.runId)
        && session.taskState?.knownSlots.jobPersistenceVerified === true;
    }).toBe(true).catch(async error => {
      await writeFile(`${directory}/failure-observation.json`, JSON.stringify({ jobs: await jobs(), sessions: await sessions() }, null, 2));
      throw error;
    });
    const observed = (await sessions()).find(s => s.taskState?.workflowId === "job_ingestion");
    await writeFile(`${directory}/turn-${observed?.hermesRun?.runId}.json`, JSON.stringify({ jobs: await jobs(), session: observed }, null, 2));
    expect(observed?.pendingConfirmation).toBeUndefined();
    expect(await page.getByRole("region", { name: "AI 对话" }).locator("section.agent-confirmation").count()).toBe(0);
    expect((await page.locator(".agent-tool-status-row").allTextContents()).join(" ")).not.toMatch(/career\.workflow|operationId|commit_job/);
  };
  await send(`先保存岗位。\n${JOB_INTAKE_INCIDENT_JD}`, null);
  const saved = (await jobs())[0];
  expect(saved.rawText).toBe(JOB_INTAKE_INCIDENT_JD);

  await page.goto("/jobs");
  const card = page.locator(".job-card").filter({ hasText: "岗位名称待补充" });
  await expect(card).toHaveCount(1);
  page.on("dialog", dialog => dialog.accept());
  await card.getByRole("button", { name: /删除/ }).click();
  await expect(card).toHaveCount(0);
  const bin = (await readStore(page, "appMeta")).find(item => item.key === "workspaceRecycleBin:v1");
  expect(JSON.stringify(bin)).toContain(saved.id);
  await page.goto("/ai-workspace");
  await expect(page.getByRole("region", { name: "AI 对话" })).toContainText("先保存岗位");
  const previousRuns = (await sessions()).map(s => s.hermesRun?.runId);
  await page.getByLabel("描述你的求职任务").fill(`先保存岗位。\n${JOB_INTAKE_INCIDENT_JD}`);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect.poll(async () => (await jobs()).length).toBe(2);
  await expect.poll(async () => (await sessions()).some(s => s.hermesRun?.status === "completed" && !previousRuns.includes(s.hermesRun.runId))).toBe(true);
  const fresh = (await jobs()).find(job => job.id !== saved.id)!;
  expect(fresh.rawText).toBe(saved.rawText);
  expect((await jobs()).find(job => job.id === saved.id)).toEqual(saved);
  await page.goto("/jobs");
  await expect(page.locator(".job-card").filter({ hasText: "岗位名称待补充" })).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".job-card").filter({ hasText: "岗位名称待补充" })).toHaveCount(1);
  expect(await readStore(page, "profiles")).toEqual(before.profiles);
  await writeFile(`${directory}/repository-evidence.json`, JSON.stringify({ before, saved, fresh, finalJobs: await jobs(), sessions: await sessions() }, null, 2));
});
