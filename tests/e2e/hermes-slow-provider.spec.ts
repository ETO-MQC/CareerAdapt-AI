import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { readStore } from "./support/p51CoreWorkflow";

test("slow Provider stays running at 30/60/180s, reattaches after refresh and fences a cancelled late result", async ({ page }) => {
  const preflight = process.env.P518B_PREFLIGHT === "1";
  test.setTimeout(preflight ? 60000 : 300000);
  const evidence: Record<string, unknown> = { providerKind: "delayed_simulated", checkpoints: [], status: "RUNNING" };
  const output = `.tmp/p518b-slow-ux-${process.env.HERMES_INTEGRATION_RUN_ID}.json`;
  const save = () => fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
  const provider = async () => (await fetch(`${process.env.HERMES_INTEGRATION_PROVIDER_URL}/integration-evidence`, {
    signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${process.env.HERMES_INTEGRATION_PROVIDER_KEY}`, Connection: "close" }
  })).json() as Promise<{ requests: Array<{ at: string; finishedAt?: string }> }>;
  await page.addInitScript(baseUrl => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl, model: "careeradapt-test", provider: "openai-compatible", apiKeyConfigured: true, credentialAction: "unchanged" }));
  }, process.env.HERMES_INTEGRATION_PROVIDER_URL!);
  await page.goto("/ai-workspace");
  await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u, { timeout: 90000 });
  await expect.poll(async () => (await readStore(page, "appMeta")).some(row => row.key === "demoSeededAt")).toBe(true);
  await page.getByRole("button", { name: "新任务", exact: true }).click();
  const formal = async () => Object.fromEntries(await Promise.all(["profiles", "resumeBranches", "resumeRevisions", "jobDescriptions"].map(async name => [name, await readStore(page, name)])));
  const before = await formal();
  const send = async (target: Page) => {
    await target.getByLabel("描述你的求职任务").fill("你好");
    await target.getByRole("button", { name: "发送消息", exact: true }).click();
  };
  const current = async () => {
    const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    return (await readStore(page, "agentSessions")).find(row => row.id === id)!;
  };
  try {
    await send(page);
    await expect.poll(async () => (await provider()).requests.length).toBe(1);
    const started = Date.parse((await provider()).requests[0].at);
    const initial = (await current()).hermesRun as { runId: string; status: string };
    evidence.runId = initial.runId;
    for (const second of (preflight ? [1, 2, 3] : [30, 60, 180])) {
      await page.waitForTimeout(Math.max(0, started + second * 1000 - Date.now()));
      const run = (await current()).hermesRun as { runId: string; status: string };
      expect(run.runId).toBe(initial.runId);
      expect(run.status).toBe("running");
      await expect(page.getByRole("button", { name: "停止运行", exact: true })).toBeEnabled();
      await expect(page.getByText(/处理中|正在回复/u).first()).toBeVisible();
      expect((await provider()).requests.length).toBe(1);
      (evidence.checkpoints as unknown[]).push({ targetSeconds: second, elapsedMs: Date.now() - started, runStatus: run.status, providerCalls: 1 }); save();
      if (second === (preflight ? 2 : 60)) {
        await page.reload();
        await expect(page.getByLabel("描述你的求职任务")).toBeVisible();
        await expect.poll(async () => ((await current()).hermesRun as { runId: string }).runId).toBe(initial.runId);
      }
    }
    await expect.poll(async () => ((await current()).hermesRun as { status: string }).status, { timeout: 30000 }).toBe("completed");
    await expect(page.locator('[data-message-role="assistant"]').last()).toHaveAttribute("data-message-status", "complete");
    expect(await formal()).toEqual(before);
    expect(((await current()).hermesRun as { runId: string }).runId).toBe(initial.runId);
    expect((await provider()).requests.length).toBe(1);
    evidence.completedElapsedMs = Date.now() - started;
    evidence.preflight = preflight;
    const firstSessionId = (await current()).id;
    const firstMessages = (await readStore(page, "agentMessages")).filter(row => row.sessionId === firstSessionId);
    expect(firstMessages.filter(row => row.role === "user")).toHaveLength(1);
    const authoritative = await (await page.request.post("/api/agent/runtime/hermes", { timeout: 5000, data: { action: "run_status", runId: initial.runId } })).json();
    expect(authoritative.data.status).toBe("completed");
    evidence.firstRunCompleted = true;
    await page.getByRole("button", { name: "新任务", exact: true }).click();
    await send(page);
    await expect.poll(async () => (await provider()).requests.length).toBe(2);
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: "停止运行", exact: true }).click();
    await expect.poll(async () => ((await current()).hermesRun as { status: string }).status).toBe("cancelled");
    const cancelledId = ((await current()).hermesRun as { runId: string }).runId;
    await page.waitForTimeout(6500);
    const cancelled = (await current()).hermesRun as { runId: string; status: string };
    expect(cancelled).toMatchObject({ runId: cancelledId, status: "cancelled" });
    expect(await formal()).toEqual(before);
    expect((await provider()).requests.length).toBe(2);
    expect((await provider()).requests[1]).toHaveProperty("response");
    await expect(page.locator('[data-message-role="assistant"][data-message-status="complete"]')).toHaveCount(0);
    evidence.formalWrites = 0;
    evidence.providerEvidence = await provider();
    evidence.cancelledLateResultFenced = true;
    {
      const cancelledSessionId = (await current()).id;
      await page.getByRole("button", { name: "新任务", exact: true }).click();
      await send(page);
      await expect.poll(async () => (await provider()).requests.length).toBe(3);
      await expect.poll(async () => ((await current()).hermesRun as { status: string } | undefined)?.status).toBe("completed");
      expect((await provider()).requests.length).toBe(3);
      expect((await readStore(page, "agentSessions")).find(row => row.id === cancelledSessionId)?.hermesRun).toMatchObject({ runId: cancelledId, status: "cancelled" });
      expect(await formal()).toEqual(before);
      evidence.nextRunIsolated = true;
    }
    evidence.status = "PASS";
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally { save(); }
});
