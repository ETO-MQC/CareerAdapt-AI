import { expect, test, type Page } from "@playwright/test";
import {
  hermesCareerAgentEvalCases,
  mappedCareerAgentEvalCases,
  type CareerAgentEvalCase
} from "../agent-eval/cases";
import {
  buildCareerAgentEvalReport,
  evaluateCareerAgentCase,
  type CareerAgentEvalCaseResult,
  type CareerAgentEvalObservation,
  mappedCareerAgentCaseResult,
  writeCareerAgentEvalReport
} from "../agent-eval/report";
import {
  HERMES_PRODUCTION_TOOL_PROFILE,
  hermesRegisteredCareerToolName
} from "../../src/agent/runtime/hermes/HermesCareerToolCatalog";

const results: CareerAgentEvalCaseResult[] = [];
const selectedHermesCases = selectHermesCases();

test.describe.serial("P4.7b Career Agent Evaluation", () => {
  test("runs the data-driven hermetic Career Agent baseline", async ({ browser }) => {
    test.setTimeout(1_200_000);

    for (const caseDef of selectedHermesCases) {
      const context = await browser.newContext({
        baseURL: process.env.HERMES_INTEGRATION_BASE_URL || "http://127.0.0.1:3010"
      });
      const page = await context.newPage();
      try {
        await installProviderSettings(page);
        const observation = await runCase(page, caseDef);
        results.push(evaluateCareerAgentCase(caseDef, observation));
      } finally {
        await context.close();
      }
    }

    const failures = results.filter((result) => result.status === "failed");
    expect(failures, failures.map((result) => `${result.caseId}: ${result.hardFailures.join("; ")}`).join("\n")).toHaveLength(0);
  });

  test.afterAll(() => {
    const mapped = mappedCareerAgentEvalCases.map(mappedCareerAgentCaseResult);
    const report = buildCareerAgentEvalReport([...results, ...mapped], process.env.CAREER_AGENT_EVAL_PHASE === "closure" ? "closure" : "baseline");
    const paths = writeCareerAgentEvalReport(report);
    console.log(`[Career Agent Eval] ${report.phase} ${report.summary.passed}/${report.suite.executedCaseTotal} executed cases passed; report=${paths.latestPath}`);
  });
});

async function installProviderSettings(page: Page) {
  const baseUrl = process.env.HERMES_INTEGRATION_PROVIDER_URL;
  const apiKey = process.env.HERMES_INTEGRATION_PROVIDER_KEY;
  if (!baseUrl || !apiKey) throw new Error("hermes_integration_provider_settings_missing");
  await page.addInitScript(({ providerBaseUrl, providerApiKey }) => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
      baseUrl: providerBaseUrl,
      apiKey: providerApiKey,
      model: "careeradapt-test",
      provider: "openai-compatible",
      credentialAction: "replace"
    }));
  }, { providerBaseUrl: baseUrl, providerApiKey: apiKey });
}

async function runCase(page: Page, caseDef: CareerAgentEvalCase): Promise<CareerAgentEvalObservation> {
  const startedAt = Date.now();
  const trace = observeRuntimeAndBridge(page);
  let before: Record<string, unknown[]> | undefined;

  try {
    await openWorkspaceForCase(page, true);
    before = caseDef.expectedStateChanges === "none" ? await readDomainSnapshot(page) : undefined;
    for (const userTurn of caseDef.userTurns) {
      await waitForComposerIdle(page);
      const assistantCount = await page.locator('[data-message-role="assistant"]').count();
      await send(page, userTurn);
      await waitForAssistantTurnTerminal(page, assistantCount);
      await waitForComposerIdle(page);
      trace.assistantTexts.push((await page.locator('[data-message-role="assistant"]').last().textContent())?.trim() ?? "");
    }

    const actualTools = () => trace.toolRequests.map((request) => stableToolName(request.name));
    await expect.poll(actualTools, { timeout: 20_000, intervals: [100, 250, 500] }).toEqual(caseDef.expectedTools);
    const after = before ? await readDomainSnapshot(page) : undefined;
    const domainStateChanged = before !== undefined && JSON.stringify(before) !== JSON.stringify(after);
    if (domainStateChanged && before && after) {
      const beforeSnapshot = before;
      const afterSnapshot = after;
      const changedStores = Object.keys(beforeSnapshot).filter((storeName) => JSON.stringify(beforeSnapshot[storeName]) !== JSON.stringify(afterSnapshot[storeName]));
      console.log(`[Career Agent Eval] ${caseDef.id} changed stores: ${changedStores.join(",")}`);
    }
    const safetyViolation = caseDef.id === "H2"
      && trace.toolRequests.some((request) => JSON.stringify(request.input).includes("Tableau"))
      ? "unconfirmed_tool_claim_in_tool_input"
      : undefined;
    return {
      toolNames: actualTools(),
      assistantTexts: trace.assistantTexts,
      durationMs: Date.now() - startedAt,
      domainStateChanged,
      ...(safetyViolation ? { safetyViolation } : {})
    };
  } catch (error) {
    return {
      toolNames: trace.toolRequests.map((request) => stableToolName(request.name)),
      assistantTexts: trace.assistantTexts,
      durationMs: Date.now() - startedAt,
      harnessError: error instanceof Error ? error.message : String(error)
    };
  }
}

async function openWorkspaceForCase(page: Page, restartRuntime: boolean) {
  await page.goto("/ai-workspace");
  await page.evaluate(() => localStorage.setItem("careeradapt.agent.activeSessionId", "__careeradapt_new_task__"));
  await page.reload();
  await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /AI Runtime Hermes，状态 Ready/u, { timeout: 90_000 });
  if (restartRuntime) {
    const response = await page.request.post("/api/agent/runtime/hermes/control", { data: { action: "restart" } });
    expect(response.ok()).toBe(true);
    await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /AI Runtime Hermes，状态 Ready/u, { timeout: 90_000 });
  }
  await waitForComposerIdle(page);
  let settledSnapshot = await readDomainSnapshot(page);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.waitForTimeout(500);
    const nextSnapshot = await readDomainSnapshot(page);
    if (JSON.stringify(nextSnapshot) === JSON.stringify(settledSnapshot)) break;
    settledSnapshot = nextSnapshot;
  }
}

async function waitForComposerIdle(page: Page) {
  const composer = page.getByLabel("描述你的求职任务");
  await expect(composer).toBeVisible({ timeout: 15_000 });
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  const sendButton = page.getByRole("button", { name: /^(发送消息|排队发送消息)$/u });
  await expect(sendButton).toBeVisible({ timeout: 15_000 });
}

async function waitForAssistantTurnTerminal(page: Page, previousCount: number) {
  const assistants = page.locator('[data-message-role="assistant"]');
  await expect.poll(() => assistants.count(), {
    timeout: 90_000,
    intervals: [250, 500, 1_000]
  }).toBeGreaterThan(previousCount);
  const latest = assistants.last();
  await expect.poll(() => latest.getAttribute("data-message-status"), {
    timeout: 90_000,
    intervals: [250, 500, 1_000]
  }).toMatch(/^(complete|failed)$/u);
  await expect.poll(async () => (await latest.textContent())?.trim() ?? "", {
    timeout: 90_000,
    intervals: [250, 500, 1_000]
  }).not.toBe("");
}

async function send(page: Page, message: string) {
  const composer = page.getByLabel("描述你的求职任务");
  const sendButton = page.getByRole("button", { name: /^(发送消息|排队发送消息)$/u });
  await expect(composer).toBeEnabled({ timeout: 15_000 });
  await composer.fill(message);
  await expect(sendButton).toBeEnabled({ timeout: 15_000 });
  await sendButton.click({ timeout: 15_000 });
}

function selectHermesCases() {
  const requested = process.env.CAREER_AGENT_EVAL_CASE_IDS?.split(",").map((value) => value.trim()).filter(Boolean);
  if (!requested?.length) return hermesCareerAgentEvalCases;
  const selected = hermesCareerAgentEvalCases.filter((caseDef) => requested.includes(caseDef.id));
  if (selected.length !== requested.length) throw new Error(`unknown_career_agent_eval_case_ids:${requested.join(",")}`);
  return selected;
}

function observeRuntimeAndBridge(page: Page) {
  const runtimeActions: string[] = [];
  const toolRequests: Array<{ id: string; name: string; input: unknown }> = [];
  const observedRequestIds = new Set<string>();
  const assistantTexts: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.endsWith("/api/agent/runtime/hermes")) return;
    const body = parseJson(request.postData());
    if (typeof body?.action === "string") runtimeActions.push(body.action);
  });
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.pathname.endsWith("/api/agent/mcp") && url.searchParams.get("bridge") === "1" && response.request().method() === "GET") {
      const payload = await response.json().catch(() => undefined) as { requests?: Array<{ id?: string; name?: string; input?: unknown }> } | undefined;
      for (const request of payload?.requests ?? []) {
        if (typeof request.id !== "string" || typeof request.name !== "string") continue;
        if (observedRequestIds.has(request.id)) continue;
        observedRequestIds.add(request.id);
        toolRequests.push({ id: request.id, name: request.name, input: request.input });
      }
    }
  });
  return { runtimeActions, toolRequests, assistantTexts };
}

function stableToolName(name: string) {
  for (const stableName of HERMES_PRODUCTION_TOOL_PROFILE) {
    if (name === stableName || name === hermesRegisteredCareerToolName(stableName)) return stableName;
  }
  return name;
}

async function readDomainSnapshot(page: Page) {
  return page.evaluate(() => new Promise<Record<string, unknown[]>>((resolve, reject) => {
    const request = indexedDB.open("CareerAdaptDb");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const storeNames = ["profiles", "jobDescriptions", "resumeBranches", "resumeRevisions", "exportRecords"];
      const snapshot: Record<string, unknown[]> = {};
      Promise.all(storeNames.map((storeName) => new Promise<void>((storeResolve, storeReject) => {
        const get = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
        get.onerror = () => storeReject(get.error);
        get.onsuccess = () => {
          snapshot[storeName] = get.result as unknown[];
          storeResolve();
        };
      }))).then(() => {
        database.close();
        resolve(snapshot);
      }, (error) => {
        database.close();
        reject(error);
      });
    };
  }));
}

function parseJson(value: string | null) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}
