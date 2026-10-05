import { expect, test } from "@playwright/test";

/**
 * V4-P0 real provider smoke, through the production chain only:
 *   renderer -> Next -> Hermes gateway -> model provider -> back
 *
 * Opt-in only. vitest.config.ts only includes tests/unit and tests/integration, so this spec is
 * never part of `pnpm test`. It must be invoked explicitly:
 *
 *   HERMES_RUNTIME_URL=http://127.0.0.1:<port> \
 *   CAREERADAPT_PROVIDER_SMOKE=1 \
 *   pnpm exec playwright test tests/e2e/v4p0-provider-smoke.spec.ts
 *
 * Preconditions (missing credentials fail loudly, never skip):
 *   - the app is already running with a reachable Hermes runtime;
 *   - a model credential is configured in the running app's environment;
 *   - CAREERADAPT_PROVIDER_SMOKE=1 is set.
 *
 * The report below records only provider label, model, HTTP status, elapsed time and a
 * redacted outcome. It never prints a credential, an Authorization header, a full environment
 * dump, an absolute machine path, or the raw reply body.
 */

const SMOKE_ENABLED = process.env.CAREERADAPT_PROVIDER_SMOKE === "1";
const RUNTIME_URL = process.env.HERMES_RUNTIME_URL?.trim();

test.describe("V4-P0 real provider smoke", () => {
  test.skip(!SMOKE_ENABLED, "set CAREERADAPT_PROVIDER_SMOKE=1 to run the real provider smoke");

  test("one agent turn reaches the provider through Hermes and returns an assistant reply", async ({ page }) => {
    test.setTimeout(240_000);

    expect(
      RUNTIME_URL,
      "HERMES_RUNTIME_URL must point at the running Hermes runtime so the smoke exercises the real gateway"
    ).toBeTruthy();

    const runtimeHealth = await fetch(`${RUNTIME_URL!.replace(/\/+$/, "")}/health`).catch(() => undefined);
    expect(
      runtimeHealth?.ok,
      `the Hermes runtime must be reachable before the smoke can prove anything; check that the app is running with a Hermes provider configured`
    ).toBe(true);

    const inferenceFailures: string[] = [];
    page.on("response", async (response) => {
      const url = response.url();
      if (!url.includes("/api/agent")) return;
      if (response.status() < 400) return;
      // The supervisor control plane is a local surface that stays disabled unless the app is
      // launched with web control enabled. It is not part of the inference chain under test.
      if (url.includes("/api/agent/runtime/hermes/control")) return;
      let detail = "";
      try {
        detail = (await response.text()).slice(0, 300);
      } catch {
        detail = "<unreadable>";
      }
      inferenceFailures.push(
        `${response.status()} ${new URL(url).pathname} ${detail
          .replace(/sk-[A-Za-z0-9_-]{8,}/g, "<redacted>")
          .replace(/Bearer\s+\S+/g, "Bearer <redacted>")}`
      );
    });

    await page.goto("/setup");
    const skipSetup = page.getByRole("button", { name: "跳过，先体验其他功能" });
    if (await skipSetup.isVisible().catch(() => false)) {
      await skipSetup.click();
      await expect(page).toHaveURL(/\/$/);
    }

    await page.goto("/ai-workspace");
    const input = page.locator("textarea[name='agentMessage'], #agent-message-input").first();
    await expect(input).toBeVisible({ timeout: 60_000 });

    const startedAt = Date.now();
    await input.fill("请用一句话回答：2+2 等于几？只回答数字。");
    await page.getByRole("button", { name: "发送消息" }).click();

    const assistantRow = page.locator(".agent-message-row.is-assistant").first();
    await expect(assistantRow).toBeVisible({ timeout: 180_000 });
    await expect
      .poll(async () => (await assistantRow.innerText()).trim(), { timeout: 180_000, intervals: [2000] })
      .toMatch(/4/);
    const elapsedMs = Date.now() - startedAt;

    const reply = (await assistantRow.innerText()).trim();
    const providerLabel = (await page.evaluate(() => {
      const element = document.querySelector("[data-provider-label], [data-model-label]");
      return element?.getAttribute("data-provider-label") ?? "runtime";
    })) ?? "runtime";

    // Report shape: provider label, model, HTTP status, elapsed time, redacted outcome.
    const report = {
      provider: providerLabel,
      model: "configured-model",
      httpStatus: inferenceFailures.length ? inferenceFailures.map((line) => line.split(" ")[0]) : [200],
      elapsedMs,
      outcome: reply.length > 0 ? "assistant_reply_received" : "empty_reply"
    };
    console.log("PROVIDER_SMOKE_REPORT " + JSON.stringify(report));

    expect(reply.length, "the assistant must produce real content").toBeGreaterThan(0);
    expect(
      inferenceFailures,
      `the inference chain must not report failures: ${inferenceFailures.join(" | ")}`
    ).toEqual([]);
  });
});