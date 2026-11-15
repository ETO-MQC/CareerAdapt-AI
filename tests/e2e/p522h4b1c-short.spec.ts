import { expect, test } from "@playwright/test";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { derivePendingInteraction } from "@/agent/runtime/agentTurnLifecycle";
import { readStore } from "./support/p51CoreWorkflow";

test("H4B1-C review, edit, save, resume continuity and independent recall", async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  await page.addInitScript(({ baseUrl }) => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
    baseUrl, model: "careeradapt-test", provider: "openai-compatible", apiKeyConfigured: true
  })), { baseUrl: process.env.HERMES_INTEGRATION_PROVIDER_URL! });
  await page.goto("/h4b1c-fixture");
  await page.getByRole("button", { name: "Seed preference fixture" }).click();
  await expect(page.getByTestId("seed-result")).toContainText("profileId");
  const seeded = JSON.parse((await page.getByTestId("seed-result").textContent())!) as {
    profileId: string; revision: number; profileVersionNumber: number; resumeId: string; revisionId: string
  };
  const before = (await readStore(page, "profiles")).find(row => row.id === seeded.profileId)!;
  const branchesBefore = await readStore(page, "resumeBranches");
  const revisionsBefore = await readStore(page, "resumeRevisions");
  await page.goto("/ai-workspace");
  await expect.poll(async () => {
    const state = (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot;
    return state?.processReady && state?.apiReady && state?.providerReady && state?.careerMcpReady && state?.toolSurfaceReady;
  }, { timeout: 60_000 }).toBe(true);
  const sessions = async () => await readStore(page, "agentSessions") as unknown as AgentSession[];
  async function newSession() {
    const beforeIds = new Set((await sessions()).map(session => session.id));
    await page.getByRole("button", { name: "新任务", exact: true }).click();
    await expect.poll(async () => (await sessions()).filter(session => !beforeIds.has(session.id)).length).toBe(1);
    return (await sessions()).find(session => !beforeIds.has(session.id))!.id;
  }
  async function current(id: string) {
    const session = (await sessions()).find(item => item.id === id)!;
    const records = await readStore(page, "agentMessages");
    const messages = records.filter(record => record.sessionId === id).sort((a, b) => Number(a.sequence) - Number(b.sequence))
      .map(({ sessionId: _sessionId, sequence: _sequence, ...message }) => { void _sessionId; void _sequence; return message; });
    return { ...session, messages } as AgentSession;
  }
  async function send(text: string) {
    await page.getByLabel("描述你的求职任务").fill(text);
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
  }
  const first = await newSession();
  await send("我最近也开始考虑跨境电商运营，地点还是优先郑州。");
  await expect.poll(async () => derivePendingInteraction(await current(first))?.kind, { timeout: 60_000 }).toBe("confirmation");
  await expect(page.getByText("跨境电商运营", { exact: false }).last()).toBeVisible();
  for (const label of ["保存", "修改", "先不保存"]) await expect(page.getByRole("button", { name: label, exact: true }).last()).toBeVisible();
  await expect(page.getByText("批准工具调用", { exact: false })).toHaveCount(0);
  await expect(page.getByText("确认当前变更", { exact: false })).toHaveCount(0);
  expect((await readStore(page, "profiles")).find(row => row.id === seeded.profileId)).toEqual(before);
  expect(await readStore(page, "resumeBranches")).toEqual(branchesBefore);
  expect(await readStore(page, "resumeRevisions")).toEqual(revisionsBefore);
  await page.getByRole("button", { name: "修改", exact: true }).last().click();
  await send("城市再加上海");
  await expect.poll(async () => derivePendingInteraction(await current(first))?.kind, { timeout: 60_000 }).toBe("confirmation");
  await expect(page.locator("article").filter({ hasText: "要保存到职业资料吗" }).last()).toContainText("上海", { timeout: 60_000 });
  expect((await readStore(page, "profiles")).find(row => row.id === seeded.profileId)).toEqual(before);
  expect(await readStore(page, "resumeBranches")).toEqual(branchesBefore);
  expect(await readStore(page, "resumeRevisions")).toEqual(revisionsBefore);
  await page.getByRole("button", { name: "保存", exact: true }).last().click();
  await expect.poll(async () => ((await readStore(page, "profiles")).find(row => row.id === seeded.profileId)?.version)).toBe(seeded.revision + 1);
  const after = (await readStore(page, "profiles")).find(row => row.id === seeded.profileId)!;
  expect(after).toMatchObject({ id: seeded.profileId, profileVersionNumber: seeded.profileVersionNumber,
    preference: { targetRoles: ["供应链助理", "跨境电商运营"], targetCities: ["郑州", "上海"] } });
  expect(await readStore(page, "resumeBranches")).toEqual(branchesBefore);
  expect(await readStore(page, "resumeRevisions")).toEqual(revisionsBefore);
  expect((await current(first)).profileRevision).toBe(seeded.revision + 1);
  await page.goto("/resume");
  const resumeCard = page.locator(".resume-card").filter({ hasText: "合成通用简历" });
  await expect(resumeCard).toBeVisible({ timeout: 30_000 });
  await resumeCard.getByRole("button", { name: "打开", exact: true }).click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 30_000 });
  expect((await readStore(page, "resumeBranches")).find(row => row.id === seeded.resumeId)).toMatchObject({ profileId: seeded.profileId, currentRevisionId: seeded.revisionId });
  await page.goto("/ai-workspace");
  const second = await newSession();
  expect(second).not.toBe(first);
  expect((await current(second)).messages).toHaveLength(0);
  await send("我现在主要考虑哪些求职方向？");
  await expect(page.getByText(/供应链助理.*跨境电商运营.*郑州.*上海/u).last()).toBeVisible({ timeout: 60_000 });
  expect((await current(second)).messages.some(message => message.role === "user" && message.content.includes("城市再加上海"))).toBe(false);
});
