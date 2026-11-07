import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { readStore } from "./support/p51CoreWorkflow";
import { prepareA2Source } from "./support/ux013A2Fixture";
import type { AgentSession } from "@/agent/contracts/agentSession";

test("A2 real Hermes local Scripted Provider proposes four selected operations without source authority", async ({ page }, info) => {
  page.setDefaultTimeout(15_000);
  const directory = process.env.UX013_A2_SCRIPTED_DIR!;
  const provider = process.env.HERMES_INTEGRATION_PROVIDER_URL!, key = process.env.HERMES_INTEGRATION_PROVIDER_KEY!;
  expect(provider).toMatch(/^http:\/\/127\.0\.0\.1:/u);
  if (!directory || !provider || !key) throw new Error("isolated_scripted_provider_required");
  await mkdir(directory, { recursive: true });
  await page.goto("/setup");
  // Initialize the already configured synthetic server runtime before the separate credential-apply action.
  // Keep the existing 60s readiness budget; do not overlap cold startup with Setup configuration verification.
  await expect.poll(async () => {
    const response = await page.request.get("/api/agent/runtime/hermes/control");
    return response.ok() && (await response.json()).snapshot?.runReady === true;
  }, { timeout: 60_000 }).toBe(true);
  await page.getByLabel("API 密钥", { exact: true }).fill(key);
  await page.getByLabel("API 地址", { exact: true }).fill(provider);
  await page.getByLabel("模型名称", { exact: true }).fill("careeradapt-test");
  await page.getByRole("button", { name: "开始使用", exact: true }).click();
  await expect(page).not.toHaveURL(/\/setup$/u);
  await page.goto("/ai-workspace");
  await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u, { timeout: 60_000 });
  const ready = await (await page.request.get("/api/agent/runtime/hermes/control")).json();
  expect(ready.snapshot).toMatchObject({ runReady: true, careerMcpReady: true, toolSurfaceReady: true });
  await writeFile(`${directory}/ready.json`, JSON.stringify(ready, null, 2));
  const selected = await prepareA2Source(page);
  await page.goto("/ai-workspace");
  await page.getByRole("button", { name: "新任务", exact: true }).click();
  const panel = page.getByTestId("structured-resume-editor"); await panel.locator("summary").first().click();
  const activeSession = async () => (await readStore(page, "agentSessions")).find(s => s.activeProfileId === selected.profileId && !!s.taskState) as unknown as AgentSession | undefined;
  const snapshot = async () => ({ profiles: await readStore(page, "profiles"), branches: await readStore(page, "resumeBranches"), revisions: await readStore(page, "resumeRevisions"),
    operations: await readStore(page, "resumeBranchOperations"), appMeta: await readStore(page, "appMeta"), session: await activeSession() });
  const kinds = ["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"];
  for (const kind of kinds) {
    if (kind !== kinds[0]) await panel.getByRole("button", { name: "开始另一项结构化操作", exact: true }).click();
    await panel.getByLabel("结构化修改简历", { exact: true }).selectOption(selected.branchId);
    await panel.getByLabel("结构化操作", { exact: true }).selectOption(kind);
    const target = panel.getByLabel("结构化修改目标", { exact: true }), options = await target.locator("option").allTextContents();
    const index = kind === "fact_correction" ? options.findIndex(t => t.includes("项目名称")) : kind === "bullet_removal" ? options.findIndex(t => t.includes("要点 3")) : 1;
    expect(index).toBeGreaterThan(0); await target.selectOption({ index });
    if (kind === "fact_correction") await panel.getByLabel("我的纠正内容", { exact: true }).fill("Scripted 用户原始纠正名称");
    await panel.getByRole("button", { name: "选择目标，交给 AI", exact: true }).click();
    await expect(panel.getByText(/目标已选择/u)).toBeVisible();
    const before = await snapshot();
    const text = kind === "fact_correction" ? "UX013-A2-F 请把选中的项目名称更正为我刚刚直接提交的纠正内容，仅修改当前简历。"
      : kind === "confirmed_skill_addition" ? "UX013-A2-S 请把选中的已确认技能加入当前简历，等待审核，不同步资料库。"
        : kind === "bullet_removal" ? "UX013-A2-D 请删除选中的第三条要点，其他内容保持不变，先给我提案。"
          : "UX013-A2-R 请把所选经历的第二条要点移到第一条，原第一条排第二，文字不改，等待我确认。";
    await page.getByLabel("描述你的求职任务").fill(text);
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(panel.getByRole("region", { name: "结构化修改审核" })).toBeVisible();
    expect((await snapshot()).revisions).toEqual(before.revisions);
    const proposed = await snapshot();
    expect(proposed.session?.pendingConfirmation?.status).toBe("pending");
    await expect.poll(async () => (await activeSession())?.hermesRun?.status).toBe("completed");
    await page.screenshot({ path: info.outputPath(`${kind}-scripted-proposal.png`), fullPage: true });
    await page.reload(); await panel.locator("summary").first().click();
    await panel.getByRole("button", { name: "确认结构化修改", exact: true }).click();
    await expect(panel.getByText(/已保存版本：/u)).toBeVisible();
    const after = await snapshot();
    expect(after.profiles).toEqual(before.profiles);
    expect(after.branches.filter(b => b.id !== selected.branchId)).toEqual(before.branches.filter(b => b.id !== selected.branchId));
    expect(after.revisions).toHaveLength(before.revisions.length + 1);
    const receipt = after.operations.find(o => !before.operations.some(p => p.id === o.id)); expect(receipt?.revisionId).toBeTruthy();
    expect(after.revisions.filter(r => r.id !== receipt!.revisionId)).toEqual(before.revisions);
    const slot = proposed.session!.taskState!.knownSlots.preciseResumeEdit as { proposal: { operation: { type: string; factProposal?: { source: { turnId: string; messageId: string; content: string } } }; turnId: string } };
    expect(slot.proposal.operation.type).toBe(kind);
    if (kind === "fact_correction") {
      expect(slot.proposal.operation.factProposal?.source.content).toBe("Scripted 用户原始纠正名称");
      expect(slot.proposal.operation.factProposal?.source.turnId).not.toBe(slot.proposal.turnId);
    }
    await page.reload(); await panel.locator("summary").first().click();
    await expect(panel.getByText(`已保存版本：${receipt!.revisionId}`, { exact: true })).toBeVisible();
    expect((await snapshot()).revisions).toEqual(after.revisions);
    await writeFile(`${directory}/${kind}.json`, JSON.stringify({ before, proposed, after, receipt }, null, 2));
  }
});
