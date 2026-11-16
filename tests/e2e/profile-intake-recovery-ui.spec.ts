import { expect, test } from "@playwright/test";
import type { ProfileIntakeOperationRequest } from "@/services/storage/repositories";

type BrowserHarness = {
  prepareUi(name: string, committed: boolean): Promise<{ request: ProfileIntakeOperationRequest; personId: string;
    sessionId: string; sessionRevision: number; before: { branches: unknown; revisions: unknown } }>;
  read(name: string): Promise<{ version: number; itemCount: number }>;
  inspectUi(name: string, request: ProfileIntakeOperationRequest, personId: string): Promise<{
    version: number; itemCount: number; branches: unknown; revisions: unknown; receiptOperationId?: string; receiptFingerprint?: string }>;
  advanceProfile(name: string): Promise<unknown>;
  seedLegacy(name: string): Promise<void>;
  simulateLateOutcome(name: string, sessionId: string, revision: number): Promise<string>;
};
declare global { interface Window { intakeRecoveryUiHarness: BrowserHarness } }

for (const committed of [true, false]) {
  test(`original operation is queried from the agent workspace (${committed ? "committed" : "not sent"})`, async ({ page }) => {
    await page.goto("/ai-workspace");
    const skipSetup = page.getByRole("button", { name: "跳过，先体验其他功能" });
    if (await skipSetup.isVisible()) await skipSetup.click();
    await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
    await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
    const prepared = await page.evaluate(async (wasCommitted) => {
      const harness = (window as unknown as { intakeConcurrency: BrowserHarness }).intakeConcurrency;
      return harness.prepareUi("CareerAdaptDb", wasCommitted);
    }, committed);
    await page.reload();
    await expect.poll(async () => (await skipSetup.isVisible()) || (await page.getByRole("button", { name: "重新查询保存状态" }).isVisible())).toBe(true);
    if (await skipSetup.isVisible()) await skipSetup.click();
    const status = committed ? "资料已保存，并已读取核实。" : "保存结果尚未核实，原始操作已保留。请查询保存状态。";
    await expect(page.getByText("保存结果尚未核实，原始操作已保留。请查询保存状态。")).toBeVisible();
    await page.getByRole("button", { name: "重新查询保存状态" }).click();
    await expect(page.getByText(status)).toBeVisible();
    await page.reload();
    await expect.poll(async () => (await skipSetup.isVisible()) || (await page.getByText(status).isVisible())).toBe(true);
    if (await skipSetup.isVisible()) await skipSetup.click();
    await expect(page.getByText(status)).toBeVisible();
    await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
    await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
    const result = await page.evaluate(async (input) => (window as unknown as { intakeConcurrency: BrowserHarness })
      .intakeConcurrency.inspectUi("CareerAdaptDb", input.request, input.personId), prepared);
    expect(result).toMatchObject({ version: committed ? 2 : 1, itemCount: committed ? 1 : 0,
      receiptOperationId: committed ? "browser-ui-original-operation" : undefined,
      receiptFingerprint: committed ? prepared.request.frozen?.fingerprint : undefined,
      branches: prepared.before.branches, revisions: prepared.before.revisions });
  });
}

test("receipt lookup failure keeps the original operation unknown without writing", async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      if (localStorage.getItem("test-receipt-unavailable") === "1" && typeof key === "string" && key.startsWith("profileIntakeOperation:v1:")) {
        throw new Error("test_receipt_unavailable");
      }
      return original.call(this, key);
    };
  });
  await page.goto("/ai-workspace");
  const skipSetup = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skipSetup.isVisible()) await skipSetup.click();
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  await page.evaluate(async () => { await (window as unknown as { intakeConcurrency: BrowserHarness }).intakeConcurrency.prepareUi("CareerAdaptDb", false);
    localStorage.setItem("test-receipt-unavailable", "1"); });
  await page.reload();
  if (await skipSetup.isVisible()) await skipSetup.click();
  await page.getByRole("button", { name: "重新查询保存状态" }).click();
  await expect(page.getByRole("button", { name: "重新查询保存状态" })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("test-receipt-unavailable"));
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  expect(await page.evaluate(async () => (window as unknown as { intakeConcurrency: BrowserHarness }).intakeConcurrency.read("CareerAdaptDb")))
    .toEqual({ version: 1, itemCount: 0 });
  await page.getByRole("button", { name: "重新查询保存状态" }).click();
  await expect(page.getByRole("button", { name: "重新查询保存状态" })).toBeVisible();
});

test("a changed Profile is not overwritten by the original recovery", async ({ page }) => {
  await page.goto("/ai-workspace");
  const skipSetup = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skipSetup.isVisible()) await skipSetup.click();
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  await page.evaluate(async () => { const harness = (window as unknown as { intakeConcurrency: BrowserHarness }).intakeConcurrency;
    await harness.prepareUi("CareerAdaptDb", false); await harness.advanceProfile("CareerAdaptDb"); });
  await page.reload();
  if (await skipSetup.isVisible()) await skipSetup.click();
  await page.getByRole("button", { name: "重新查询保存状态" }).click();
  await expect(page.getByText("保存结果尚未核实，原始操作已保留。请查询保存状态。")).toBeVisible();
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  expect(await page.evaluate(async () => (window as unknown as { intakeConcurrency: BrowserHarness }).intakeConcurrency.read("CareerAdaptDb")))
    .toEqual({ version: 2, itemCount: 0 });
});

test("two workspace pages query the same unknown operation without writing", async ({ page, context }) => {
  await page.goto("/ai-workspace");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.isVisible()) await skip.click();
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  const prepared = await page.evaluate(async () => (window as unknown as { intakeConcurrency: BrowserHarness })
    .intakeConcurrency.prepareUi("CareerAdaptDb", false));
  await page.reload();
  if (await skip.isVisible()) await skip.click();
  await expect(page.getByRole("button", { name: "重新查询保存状态" })).toBeVisible();
  const second = await context.newPage();
  await second.goto("/ai-workspace");
  const secondSkip = second.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await secondSkip.isVisible()) await secondSkip.click();
  await expect(second.getByRole("button", { name: "重新查询保存状态" })).toBeVisible();
  await Promise.all([page.getByRole("button", { name: "重新查询保存状态" }).click(),
    second.getByRole("button", { name: "重新查询保存状态" }).click()]);
  await expect(page.getByText("保存结果尚未核实，原始操作已保留。请查询保存状态。")).toBeVisible();
  await second.reload();
  if (await secondSkip.isVisible()) await secondSkip.click();
  await expect(second.getByText("保存结果尚未核实，原始操作已保留。请查询保存状态。")).toBeVisible();
  await second.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await second.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  const result = await second.evaluate(async (input) => (window as unknown as { intakeConcurrency: BrowserHarness })
    .intakeConcurrency.inspectUi("CareerAdaptDb", input.request, input.personId), prepared);
  expect(result).toMatchObject({ version: 1, itemCount: 0, receiptOperationId: undefined,
    branches: prepared.before.branches, revisions: prepared.before.revisions });
  const late = await second.evaluate(async (input) => (window as unknown as { intakeConcurrency: BrowserHarness })
    .intakeConcurrency.simulateLateOutcome("CareerAdaptDb", input.sessionId, input.sessionRevision), prepared);
  expect(late).toBe("revision_conflict");
  await second.reload();
  if (await secondSkip.isVisible()) await secondSkip.click();
  await expect(second.getByText("保存结果尚未核实，原始操作已保留。请查询保存状态。")).toBeVisible();
});

test("a legacy receipt requires a manual Profile check", async ({ page }) => {
  await page.goto("/ai-workspace");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.isVisible()) await skip.click();
  await page.addScriptTag({ url: "http://127.0.0.1:5188/profile-intake-concurrency.ts", type: "module" });
  await page.waitForFunction(() => Boolean((window as unknown as { intakeConcurrency?: unknown }).intakeConcurrency));
  await page.evaluate(async () => { const harness = (window as unknown as { intakeConcurrency: BrowserHarness }).intakeConcurrency;
    await harness.prepareUi("CareerAdaptDb", false); await harness.seedLegacy("CareerAdaptDb"); });
  await page.reload();
  if (await skip.isVisible()) await skip.click();
  await page.getByRole("button", { name: "重新查询保存状态" }).click();
  await expect(page.getByText("这条历史记录缺少完整核验信息，无法自动判断是否已经保存。")).toBeVisible();
  await expect(page.getByRole("button", { name: "恢复原保存操作" })).toHaveCount(0);
  await page.getByRole("button", { name: "查看资料库" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
