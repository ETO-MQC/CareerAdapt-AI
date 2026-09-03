import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  HERMES_PRODUCTION_TOOL_PROFILE,
  hermesRegisteredCareerToolName
} from "../../src/agent/runtime/hermes/HermesCareerToolCatalog";

const SCENARIOS = [
  { id: "R1", prompt: "你好" },
  { id: "R2", prompt: "大学生找工作应该怎么准备？" },
  { id: "R3", prompt: "我目前有几个项目经历？" },
  { id: "R4", prompt: "我没有任何资料，从零开始帮我整理。" },
  { id: "R5", prompt: "我在课程项目里和同学一起做了一个数据看板，我主要整理数据、核对结果，最后做了汇报。" },
  { id: "R6", prompt: "根据我的资料生成一份通用简历。" },
  { id: "R7", prompt: "分析一下我和这个岗位匹不匹配。" },
  { id: "R8", prompt: "岗位 JD：数据分析实习生，负责数据清洗、统计分析和周报支持，要求 Python 和 SQL。帮我生成岗位简历。" }
] as const;

type RealScenarioResult = {
  caseId: string;
  provider: string;
  model: string;
  durationMs: number;
  toolNames: string[];
  terminalResult: { present: boolean; chars: number };
  status: "completed" | "failed" | "harness_error";
  error?: string;
};

test.describe.serial("P4.7b optional real-provider micro-evaluation", () => {
  test("runs only sanitized scenarios and records safe telemetry", async ({ browser }) => {
    test.setTimeout(1_800_000);
    const settings = readRealProviderSettings();
    const results: RealScenarioResult[] = [];

    for (const scenario of SCENARIOS) {
      const context = await browser.newContext({
        baseURL: process.env.HERMES_INTEGRATION_BASE_URL || "http://127.0.0.1:3010"
      });
      const page = await context.newPage();
      try {
        await installProviderSettings(page, settings);
        results.push(await runScenario(page, scenario.id, scenario.prompt, settings));
      } catch (error) {
        results.push({
          caseId: scenario.id,
          provider: settings.provider,
          model: settings.model,
          durationMs: 0,
          toolNames: [],
          terminalResult: { present: false, chars: 0 },
          status: "harness_error",
          error: safeError(error)
        });
      } finally {
        await context.close();
      }
    }

    const report = {
      schemaVersion: "career-agent-real-eval.v1",
      generatedAt: new Date().toISOString(),
      provider: settings.provider,
      model: settings.model,
      scenarioTotal: results.length,
      completed: results.filter((result) => result.status === "completed").length,
      failed: results.filter((result) => result.status !== "completed").length,
      scenarios: results,
      notes: [
        "Scenarios are synthetic and contain no personal profile, employer, credential, or API endpoint data.",
        "The report records response presence and length only; assistant text and credentials are intentionally omitted.",
        "This optional micro-evaluation is observational and is not a subjective quality-closure gate."
      ]
    };
    const outputPath = path.resolve(process.cwd(), "artifacts", "evals", "career-agent-real-latest.json");
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    expect(results).toHaveLength(SCENARIOS.length);
    console.log(`[Career Agent Real Eval] ${report.completed}/${report.scenarioTotal} scenarios completed; report=${outputPath}`);
  });
});

function readRealProviderSettings() {
  const baseUrl = process.env.HERMES_INTEGRATION_REAL_PROVIDER_URL?.trim();
  const apiKey = process.env.HERMES_INTEGRATION_REAL_PROVIDER_KEY?.trim();
  const model = process.env.HERMES_INTEGRATION_REAL_PROVIDER_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) throw new Error("career_agent_real_provider_settings_missing");
  return { baseUrl, apiKey, model, provider: "openai-compatible" };
}

async function installProviderSettings(page: Page, settings: ReturnType<typeof readRealProviderSettings>) {
  await page.addInitScript(({ baseUrl, apiKey, model }) => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
      baseUrl,
      apiKey,
      model,
      provider: "openai-compatible",
      credentialAction: "replace"
    }));
    localStorage.setItem("careeradapt.agent.activeSessionId", "__careeradapt_new_task__");
  }, settings);
}

async function runScenario(page: Page, caseId: string, prompt: string, settings: ReturnType<typeof readRealProviderSettings>): Promise<RealScenarioResult> {
  const startedAt = Date.now();
  const trace = observeRuntimeAndBridge(page);
  try {
    await page.goto("/ai-workspace");
    await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /AI Runtime Hermes，状态 Ready/u, { timeout: 180_000 });
    const assistantCount = await page.locator('[data-message-role="assistant"]').count();
    await send(page, prompt);
    const terminal = await waitForAssistantTurnTerminal(page, assistantCount);
    await page.waitForTimeout(250);
    return {
      caseId,
      provider: settings.provider,
      model: settings.model,
      durationMs: Date.now() - startedAt,
      toolNames: trace.toolRequests.map((request) => stableToolName(request.name)),
      terminalResult: { present: terminal.text.length > 0, chars: terminal.text.length },
      status: terminal.status === "complete" ? "completed" : "failed"
    };
  } catch (error) {
    return {
      caseId,
      provider: settings.provider,
      model: settings.model,
      durationMs: Date.now() - startedAt,
      toolNames: trace.toolRequests.map((request) => stableToolName(request.name)),
      terminalResult: { present: false, chars: 0 },
      status: "harness_error",
      error: safeError(error)
    };
  }
}

async function send(page: Page, message: string) {
  const composer = page.getByLabel("描述你的求职任务");
  const sendButton = page.getByRole("button", { name: /^(发送消息|排队发送消息)$/u });
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await expect(composer).toBeEnabled({ timeout: 30_000 });
  await composer.fill(message);
  await expect(sendButton).toBeEnabled({ timeout: 30_000 });
  await sendButton.click({ timeout: 30_000 });
}

async function waitForAssistantTurnTerminal(page: Page, previousCount: number) {
  const assistants = page.locator('[data-message-role="assistant"]');
  await expect.poll(() => assistants.count(), {
    timeout: 180_000,
    intervals: [500, 1_000, 2_000]
  }).toBeGreaterThan(previousCount);
  const latest = assistants.last();
  await expect.poll(() => latest.getAttribute("data-message-status"), {
    timeout: 180_000,
    intervals: [500, 1_000, 2_000]
  }).toMatch(/^(complete|failed)$/u);
  const status = await latest.getAttribute("data-message-status");
  const text = ((await latest.textContent()) ?? "").trim();
  return { status: status === "complete" ? "complete" as const : "failed" as const, text };
}

function observeRuntimeAndBridge(page: Page) {
  const toolRequests: Array<{ id: string; name: string }> = [];
  const observedRequestIds = new Set<string>();
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (!url.pathname.endsWith("/api/agent/mcp") || url.searchParams.get("bridge") !== "1" || response.request().method() !== "GET") return;
    const payload = await response.json().catch(() => undefined) as { requests?: Array<{ id?: string; name?: string }> } | undefined;
    for (const request of payload?.requests ?? []) {
      if (typeof request.id !== "string" || typeof request.name !== "string" || observedRequestIds.has(request.id)) continue;
      observedRequestIds.add(request.id);
      toolRequests.push({ id: request.id, name: request.name });
    }
  });
  return { toolRequests };
}

function stableToolName(name: string) {
  for (const stableName of HERMES_PRODUCTION_TOOL_PROFILE) {
    if (name === stableName || name === hermesRegisteredCareerToolName(stableName)) return stableName;
  }
  return name;
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n", 1)[0].replace(/https?:\/\/\S+/gu, "<url>").slice(0, 240);
}
