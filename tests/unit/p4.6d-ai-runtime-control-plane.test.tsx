import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/app/settings/page";
import { createInitialHermesControlSnapshot } from "@/services/agent/hermesControl";

const mocks = vi.hoisted(() => ({
  reconnect: vi.fn(async () => undefined),
  refreshHermesHealth: vi.fn(async () => undefined),
  configUpdate: vi.fn(),
  providerTest: vi.fn(),
  configReset: vi.fn(),
  environmentReload: vi.fn(),
  interruptRun: vi.fn(async () => undefined),
  activeSession: undefined as unknown,
  host: undefined as unknown
}));

vi.mock("@/components/agent/runtime/AgentRuntimeProvider", () => ({
  useAgentHost: () => mocks.host
}));

vi.mock("@/services/agent/hermesControl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/agent/hermesControl")>();
  return {
    ...actual,
    requestHermesConfigUpdate: mocks.configUpdate,
    requestHermesProviderTest: mocks.providerTest,
    requestHermesConfigReset: mocks.configReset,
    requestHermesEnvironmentReload: mocks.environmentReload
  };
});

vi.mock("@/services/storage/repositories", () => ({
  WorkspaceRepository: class {}
}));

vi.mock("@/services/agent/agentSessionStore", () => ({
  AgentSessionStore: class {}
}));

function readySnapshot(model = "mimo-v2.5-pro") {
  const initial = createInitialHermesControlSnapshot("web");
  const active = {
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    baseUrlHostPath: "openrouter.ai/api/v1",
    model,
    credentialConfigured: true,
    credentialSource: "managed_config" as const,
    configFingerprint: "active-fingerprint",
    configGeneration: 1,
    source: "runtime_readback" as const
  };
  return {
    ...initial,
    controlOwner: "web_supervisor" as const,
    supervisorExpected: true,
    serviceState: "running" as const,
    apiState: "reachable" as const,
    providerState: "ready" as const,
    careerIntegration: { mcpReady: true, toolSurfaceReady: true, requiredToolCount: 8, requiredToolTotal: 8 },
    apiReady: true,
    providerReady: true,
    careerMcpReady: true,
    toolSurfaceReady: true,
    runReady: true,
    ready: true,
    status: "ready" as const,
    provider: "openrouter",
    model,
    providerDiagnostic: {
      provider: "openrouter",
      model,
      credentialConfigured: true,
      credentialSource: "managed_config" as const,
      configFingerprint: "active-fingerprint",
      configGeneration: 1
    },
    runtimeConfig: {
      active,
      activeFingerprint: active.configFingerprint,
      activeGeneration: active.configGeneration,
      applyStatus: "applied" as const,
      restartPerformed: true,
      verified: true,
      rollbackOccurred: false
    },
    capabilities: {
      ...initial.capabilities,
      controlOwner: "web_supervisor" as const,
      canStartService: true,
      canStopService: true,
      canRestartService: true,
      canRecoverService: true
    }
  };
}

function candidateFailure() {
  return {
    ok: false,
    provider: "openrouter",
    model: "candidate/model",
    credentialConfigured: true,
    credentialSource: "custom_header" as const,
    checkedAt: new Date().toISOString(),
    httpStatus: 401,
    safeErrorCode: "provider_http_401"
  };
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.configUpdate.mockReset();
  mocks.providerTest.mockReset();
  mocks.configReset.mockReset();
  mocks.environmentReload.mockReset();
  mocks.interruptRun.mockClear();
  mocks.reconnect.mockClear();
  mocks.refreshHermesHealth.mockClear();
  mocks.activeSession = undefined;
  mocks.configUpdate.mockResolvedValue({ ok: true, controlSnapshot: readySnapshot("new-model") });
  mocks.providerTest.mockResolvedValue(candidateFailure());
  mocks.configReset.mockResolvedValue({ ok: true, controlSnapshot: readySnapshot() });
  mocks.environmentReload.mockResolvedValue({ ok: true, controlSnapshot: readySnapshot() });

  const controlSnapshot = readySnapshot();
  const runtimeStatusSnapshot = { controlSnapshot, candidateProviderTest: undefined };
  const runtimeStatus = {
    subscribe: vi.fn(() => () => undefined),
    getSnapshot: vi.fn(() => runtimeStatusSnapshot),
    recordCandidateProviderTest: vi.fn(),
    recordControlSnapshot: vi.fn(),
    recordSupervisorStatus: vi.fn()
  };
  mocks.host = {
    runtimeStatus,
    mcpBridge: { reconnect: mocks.reconnect },
    refreshHermesHealth: mocks.refreshHermesHealth,
    state: {
      getSnapshot: () => ({ activeSession: mocks.activeSession }),
      interrupt: mocks.interruptRun
    },
    interruptRun: mocks.interruptRun,
    careerToolGateway: { listContracts: () => [] }
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("P4.6d AI runtime control plane", () => {
  it("keeps Settings navigation observational across 20 AI/Agent switches", () => {
    render(<SettingsPage />);
    const ai = screen.getByRole("button", { name: /AI 配置/ });
    const agent = screen.getByRole("button", { name: /AI Agent服务/ });

    for (let index = 0; index < 20; index += 1) {
      fireEvent.click(ai);
      fireEvent.click(agent);
    }

    expect(screen.getByRole("heading", { name: "AI Agent" })).toBeInTheDocument();
    expect(mocks.reconnect).not.toHaveBeenCalled();
    expect(mocks.refreshHermesHealth).not.toHaveBeenCalled();
    expect(mocks.configUpdate).not.toHaveBeenCalled();
    expect(mocks.providerTest).not.toHaveBeenCalled();
  });

  it("keeps candidate provider tests local and leaves active runtime state untouched", async () => {
    let resolveTest!: (result: ReturnType<typeof candidateFailure>) => void;
    mocks.providerTest.mockReturnValue(new Promise((resolve) => { resolveTest = resolve; }));
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /AI 配置/ }));

    const testButton = screen.getByRole("button", { name: "测试候选配置" });
    fireEvent.click(testButton);
    expect(screen.getByRole("button", { name: "候选测试中…" })).toBeDisabled();

    resolveTest(candidateFailure());
    await screen.findByText(/候选配置未通过：API Key 无效或已过期/u, { selector: "p" });
    mocks.providerTest.mockResolvedValue(candidateFailure());
    for (let index = 1; index < 5; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "测试候选配置" }));
      await screen.findByText(/候选配置未通过：API Key 无效或已过期/u, { selector: "p" });
    }
    expect(screen.getByText("mimo-v2.5-pro")).toBeInTheDocument();
    expect(mocks.providerTest).toHaveBeenCalledTimes(5);
    expect(mocks.configUpdate).not.toHaveBeenCalled();
    expect(mocks.reconnect).not.toHaveBeenCalled();
    expect(mocks.refreshHermesHealth).not.toHaveBeenCalled();
  });

  it("shows only the compact AI configuration and moves protocol/maintenance into More", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /AI 配置/ }));

    expect(screen.getByText("mimo-v2.5-pro")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "API 地址" })).toHaveAttribute("type", "url");
    expect(screen.getByLabelText("API Key")).toHaveAttribute("type", "password");
    expect(screen.getByRole("textbox", { name: "模型" })).toBeInTheDocument();
    expect(screen.queryByText("Fingerprint")).not.toBeInTheDocument();
    expect(screen.queryByText("generation")).not.toBeInTheDocument();
    expect(screen.queryByText("CareerAdapt Domain tools")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("更多", { exact: true }));
    expect(screen.getByText(/协议：OpenAI 兼容接口/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复默认配置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "从环境加载" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "清除已保存 API Key" })).toBeInTheDocument();
  });

  it("keeps engineering telemetry collapsed but available in diagnostics", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /AI Agent服务/ }));

    const diagnostics = screen.getByText("诊断与运行时详情", { exact: true }).closest("details");
    const runtimeDetails = screen.getByText("运行时详情", { exact: true }).closest("details");
    expect(diagnostics).not.toHaveAttribute("open");
    expect(runtimeDetails).not.toHaveAttribute("open");

    fireEvent.click(screen.getByText("诊断与运行时详情", { exact: true }));
    expect(screen.getByText("Readiness dimensions")).toBeInTheDocument();
    expect(screen.getByText("CareerAdapt Domain tools")).toBeInTheDocument();
    expect(screen.getByText("Fingerprint")).toBeInTheDocument();
  });

  it("acknowledges Save & Apply immediately and sends one control command", async () => {
    let resolveApply!: (result: unknown) => void;
    mocks.configUpdate.mockReturnValue(new Promise((resolve) => { resolveApply = resolve; }));
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /AI 配置/ }));

    const saveButton = screen.getByRole("button", { name: "保存并应用" });
    for (let index = 0; index < 20; index += 1) fireEvent.click(saveButton);
    expect(screen.getByRole("button", { name: "正在应用…" })).toBeDisabled();
    expect(mocks.configUpdate).toHaveBeenCalledTimes(1);

    resolveApply({ ok: true, receipt: { applyStatus: "applied" }, controlSnapshot: readySnapshot("new-model") });
    await waitFor(() => expect(screen.getByRole("button", { name: "已应用 ✓" })).toBeEnabled());
    expect(mocks.reconnect).not.toHaveBeenCalled();
    expect(mocks.refreshHermesHealth).not.toHaveBeenCalled();
    expect(mocks.providerTest).not.toHaveBeenCalled();
  });

  it("interrupts an active semantic Run once before applying the new configuration", async () => {
    mocks.activeSession = {
      id: "session-1",
      activeTurn: { id: "turn-1", status: "running", incidentTraceId: "trace-1" },
      hermesRun: { runId: "run-1", status: "running" }
    };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /AI 配置/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存并应用" }));

    await waitFor(() => expect(mocks.configUpdate).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.interruptRun).toHaveBeenCalledTimes(1);
    expect(mocks.interruptRun).toHaveBeenCalledWith("session-1", expect.objectContaining({ reasonCode: "runtime_config_update" }));
  });

  it("continues the Supervisor-owned apply transaction after Settings routes away", async () => {
    let resolveApply!: (result: unknown) => void;
    const applyPromise = new Promise((resolve) => { resolveApply = resolve; });
    mocks.configUpdate.mockReturnValue(applyPromise);
    const view = render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /AI 配置/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存并应用" }));
    fireEvent.click(screen.getByRole("button", { name: /AI Agent服务/ }));
    expect(mocks.configUpdate).toHaveBeenCalledTimes(1);

    view.unmount();
    resolveApply({ ok: true, controlSnapshot: readySnapshot("new-model") });
    await applyPromise;
    expect(mocks.configUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.reconnect).not.toHaveBeenCalled();
  });
});
