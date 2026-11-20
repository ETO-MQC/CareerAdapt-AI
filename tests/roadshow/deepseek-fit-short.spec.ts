import { expect, test } from "@playwright/test";
import { readStore } from "../e2e/support/p51CoreWorkflow";

test("DeepSeek independently analyzes an existing demo job and resume", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/");
  await page.getByRole("button", { name: "跳过，先体验其他功能" }).click();
  await page.getByRole("link", { name: "我的简历", exact: true }).click();
  await page.getByRole("button", { name: /从个人资料库创建/ }).click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  const branches = await readStore(page, "resumeBranches");
  const branch = branches.find(row => row.branchPurpose === "general" && row.currentRevisionId)!;
  const jobs = await readStore(page, "jobDescriptions");
  const job = jobs.find(row => String(row.title).includes("数据分析"))!;
  expect(job).toBeTruthy();
  const receipts: string[] = [];
  page.on("request", request => {
    if (request.method() !== "POST" || !request.url().includes("/api/agent/mcp?bridge=1")) return;
    const body = request.postDataJSON() as { action?: string; result?: { ok?: boolean; receipt?: { toolName?: string } } };
    if (body.action === "result" && body.result?.ok && body.result.receipt?.toolName) receipts.push(body.result.receipt.toolName);
  });
  await page.getByRole("link", { name: "AI 助手", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot?.runReady, { timeout: 60_000 }).toBe(true);
  await page.getByRole("button", { name: "新任务", exact: true }).click();
  await page.getByLabel("描述你的求职任务").fill(`请分析已保存的${String(job.title)}岗位是否适合当前人物，结合我的通用简历指出匹配、缺口和证据。`);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect.poll(async () => {
    const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    const session = (await readStore(page, "agentSessions")).find(row => row.id === id);
    const task = session?.taskState as { workflowId?: string; completionStatus?: string; selectedEntities?: { jobId?: string; resumeId?: string; revisionId?: string } } | undefined;
    return task?.workflowId === "analyze_job_fit" && task.completionStatus === "completed" && task.selectedEntities?.jobId === job.id
      && task.selectedEntities?.resumeId === branch.id && task.selectedEntities?.revisionId === branch.currentRevisionId;
  }, { timeout: 70_000 }).toBe(true);
  expect(receipts).toContain("career.workflow.job_fit");
  await page.getByRole("button", { name: "查看匹配分析" }).click();
  await expect(page.getByRole("complementary", { name: "任务产物" }).getByRole("list", { name: "岗位要求与证据" })).toBeVisible();
  await expect.poll(async () => {
    const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    const session = (await readStore(page, "agentSessions")).find(row => row.id === id);
    return (session?.hermesRun as { status?: string } | undefined)?.status;
  }, { timeout: 60_000 }).toBe("completed");
  const send = async (text: string) => {
    await page.getByLabel("描述你的求职任务").fill(text);
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
  };
  await send("好");
  await expect(page.getByText("你想继续哪一步？", { exact: true })).toBeVisible({ timeout: 25_000 });
  await send("第一个");
  await expect.poll(async () => {
    const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    const session = (await readStore(page, "agentSessions")).find(row => row.id === id);
    return (session?.taskState as { workflowId?: string } | undefined)?.workflowId;
  }, { timeout: 25_000 }).toBe("tailor_existing_resume");
});
