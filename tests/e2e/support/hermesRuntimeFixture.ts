import type { Page } from "@playwright/test";

type HermesRun = {
  userMessage: string;
  output: string;
  tailor: boolean;
  toolCallId?: string;
};

export type HermesRuntimeFixture = {
  runStarts: string[];
  eventRunIds: string[];
  actions: string[];
};

/**
 * Small browser-only fixture for the production Hermes Runs contract.
 * It deliberately exercises the same three requests as the real bridge and
 * emits official Hermes event names, including the Career workflow facade
 * boundary used by the explicit tailoring tests.
 */
export async function installHermesRuntimeFixture(page: Page): Promise<HermesRuntimeFixture> {
  const runs = new Map<string, HermesRun>();
  const fixture: HermesRuntimeFixture = { runStarts: [], eventRunIds: [], actions: [] };
  let sequence = 0;

  await page.route("**/api/agent/runtime/hermes/health", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        available: true,
        runtimeId: "hermes",
        model: "test-model",
        providerStatus: "ready",
        mcpConnected: true,
        discoveredToolCount: 1,
        runtimeHealth: {
          runtimeId: "hermes",
          runtimeAvailable: true,
          companionReady: true,
          providerConfigured: true,
          providerReachable: true,
          providerReady: true,
          mcpConnected: true,
          mcpReady: true,
          mcpToolCount: 1,
          toolCallingAvailable: true,
          careerSkillsLoaded: true,
          browserCareerDomainHostConnected: true,
          careerMcpServerReachable: true,
          careerMcpContractCount: 1,
          hermesMcpRegistered: true,
          hermesMcpToolCount: 1,
          hermesCareerFacadeCount: 1,
          requiredCareerFacadesMissing: [],
          careerGatewayContracts: ["career.workflow.tailor_resume"],
          careerMcpExposedTools: ["career.workflow.tailor_resume"],
          hermesRegisteredToolsets: ["careeradapt"],
          hermesVisibleTools: ["career.workflow.tailor_resume"],
          runReady: true,
          lastCheckedAt: new Date().toISOString()
        }
      })
    });
  });

  await page.route("**/api/agent/runtime/hermes", async (route) => {
    const body = route.request().postDataJSON() as {
      action?: string;
      runId?: string;
      userMessage?: string;
    };
    const action = String(body.action ?? "");
    fixture.actions.push(action);

    if (action === "run_start") {
      sequence += 1;
      const runId = `hermes-e2e-run-${sequence}`;
      const userMessage = String(body.userMessage ?? "");
      const tailor = userMessage.includes("优化已有简历");
      const output = tailor
        ? "已进入岗位定制流程，请先选择用于定制的通用简历。"
        : userMessage.includes("整理项目经历")
          ? "可以。请先选择一段你确认真实存在的经历，我会按背景、职责、成果逐步提问。"
          : "好的。请先提供这项任务需要的真实材料，我会逐步与你核对。";
      const toolCallId = tailor ? `tool-call-${sequence}` : undefined;
      runs.set(runId, { userMessage, output, tailor, toolCallId });
      fixture.runStarts.push(runId);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { runId, status: "started" } })
      });
      return;
    }

    if (action === "run_events") {
      const runId = String(body.runId ?? "");
      const run = runs.get(runId);
      fixture.eventRunIds.push(runId);
      await new Promise((resolve) => setTimeout(resolve, run?.tailor ? 350 : 300));
      const events = [
        "event: message.delta",
        `data: ${JSON.stringify({ run_id: runId, delta: "正在准备当前任务…" })}`,
        "",
        ...(run?.tailor ? tailoringEvents(runId, run.toolCallId ?? `tool-call-${sequence}`) : []),
        "event: run.completed",
        `data: ${JSON.stringify({ run_id: runId, output: run?.output ?? "当前任务已完成。" })}`,
        ""
      ];
      await route.fulfill({
        contentType: "text/event-stream",
        body: events.join("\n")
      });
      return;
    }

    if (action === "run_status") {
      const runId = String(body.runId ?? "");
      const run = runs.get(runId);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            run_id: runId,
            status: "completed",
            output: run?.output ?? "当前任务已完成。"
          }
        })
      });
      return;
    }

    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: {} }) });
  });

  return fixture;
}

function tailoringEvents(runId: string, toolCallId: string) {
  const operationId = `operation-${toolCallId}`;
  const checkpoint = {
    kind: "tailoring_source_selection",
    workflowStage: "choose_resume_source",
    contextBindingState: "bound",
    profileId: "fixture-profile",
    resumeCandidateSetRevision: "fixture-resume-candidates-v1",
    resumeCandidates: [{
      id: "fixture-resume",
      name: "测试通用简历",
      profileId: "fixture-profile",
      purpose: "general",
      branchPurpose: "general",
      lifecycleStatus: "active",
      migrationStatus: "verified",
      revision: 1,
      currentRevisionId: "fixture-resume-revision"
    }]
  };
  const result = {
    ok: true,
    data: {
      status: "waiting_for_user",
      workflowStage: "choose_resume_source",
      userPrompt: "请选择用于岗位定制的通用简历。",
      workflowCheckpoint: checkpoint
    },
    artifacts: [],
    receipt: { operationId, status: "completed" }
  };
  return [
    "event: tool.started",
    `data: ${JSON.stringify({
      run_id: runId,
      tool_name: "career.workflow.tailor_resume",
      tool_call_id: toolCallId,
      operation_id: operationId,
      input: {}
    })}`,
    "",
    "event: tool.completed",
    `data: ${JSON.stringify({
      run_id: runId,
      tool_name: "career.workflow.tailor_resume",
      tool_call_id: toolCallId,
      operation_id: operationId,
      result
    })}`,
    ""
  ];
}
