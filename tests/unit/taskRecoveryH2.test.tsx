import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { AgentHostStore, branchSessionFromEditedUserMessage } from "@/agent/runtime/AgentHostStore";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { AgentToolRegistry } from "@/agent/tools/registry";
import { RuntimeStatusStore } from "@/agent/runtime/runtimeStatus";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { ACTIVE_SESSION_KEY } from "@/components/agent/shell/AgentSidebar";
import { AgentWorkspace } from "@/components/agent/AgentWorkspace";
import { careerSessionCheckpoint } from "@/agent/runtime/careerSessionCheckpoint";
import type { AgentArtifactRef } from "@/agent/contracts/agentArtifact";
import type { AgentSessionStore } from "@/services/agent/agentSessionStore";

const shared = vi.hoisted(() => ({ host: undefined as unknown }));
vi.mock("@/components/agent/runtime/AgentRuntimeProvider", () => ({ useAgentHost: () => shared.host }));
vi.mock("@/components/agent/workspace/AgentWorkspaceLayout", () => ({ AgentWorkspaceLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/agent/artifacts/AgentArtifactDrawer", () => ({ AgentArtifactDrawer: ({ artifacts }: { artifacts: AgentArtifactRef[] }) => <div data-testid="artifact-list">{artifacts.map(artifact => artifact.id).join(",")}</div> }));
vi.mock("@/components/career/CareerContextSelector", () => ({ CareerContextSelector: () => null }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
function setup() {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.spyOn(WorkspaceRepository.prototype, "listProfiles").mockResolvedValue([]);
  vi.spyOn(WorkspaceRepository.prototype, "getActiveCareerContext").mockResolvedValue(undefined);
  const original = AgentRuntime.createConversationSession("original task");
  const reducer = new AgentTaskStateReducer();
  original.taskState = reducer.create(original, "ingest_job", { workflowId: "job_ingestion", step: "parse_job" });
  original.taskState.knownSlots.rawText = "original durable JD";
  original.taskState.completionStatus = "completed";
  let resolve!: (value: typeof original | undefined) => void;
  let reject!: (reason: Error) => void;
  const pending = new Promise<typeof original | undefined>((yes, no) => { resolve = yes; reject = no; });
  const store = { get: vi.fn(() => pending), list: vi.fn(async () => [original]), save: vi.fn(async (value: typeof original) => value) };
  const executor = new AgentExecutor(new AgentToolRegistry([]));
  vi.spyOn(executor, "execute").mockResolvedValue({ ok: true, data: { resumes: [] }, toolName: "list_resumes", operationId: "read-resumes", artifactIds: [], completedAt: original.updatedAt });
  const state = new AgentHostStore({ executor, persistence: store as unknown as AgentSessionStore });
  const runTurn = vi.fn(async () => original);
  shared.host = { state, store, executor, runTurn, runtimeStatus: new RuntimeStatusStore({ preferredRuntime: "hermes", activeRuntime: "hermes", status: "ready" }) };
  localStorage.setItem(ACTIVE_SESSION_KEY, original.id);
  return { original, store, state, runTurn, resolve, reject };
}
it("T01 blocks early send, restores exact session/task/branch, then submits to that session", async () => {
  const f = setup();
  render(<AgentWorkspace />);
  expect(screen.getByText("正在恢复当前任务…")).toBeVisible();
  expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
  fireEvent.keyDown(screen.getByLabelText("描述你的求职任务"), { key: "Enter" });
  expect(f.runTurn).not.toHaveBeenCalled();
  expect(f.store.save).not.toHaveBeenCalled();
  await act(async () => f.resolve(f.original));
  await waitFor(() => expect(screen.getByTestId("agent-recovery-state")).toHaveAttribute("data-state", "ready"));
  expect(f.state.getSnapshot().activeSession?.id).toBe(f.original.id);
  expect(f.state.getSnapshot().activeSession?.activeBranchId).toBe(f.original.activeBranchId);
  expect(f.state.getSnapshot().activeTask?.knownSlots.rawText).toBe("original durable JD");
  fireEvent.change(screen.getByLabelText("描述你的求职任务"), { target: { value: "保存刚才这个岗位" } });
  fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
  await waitFor(() => expect(f.runTurn).toHaveBeenCalledWith(expect.objectContaining({ sessionId: f.original.id })));
});
it.each(["read_failure", "missing"])("T02 %s never creates or switches to another session", async failure => {
  const f = setup(); render(<AgentWorkspace />);
  await act(async () => { if (failure === "missing") f.resolve(undefined); else f.reject(new Error("synthetic storage read failure")); });
  await waitFor(() => expect(screen.getByText(/当前任务恢复失败/)).toBeVisible());
  expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
  expect(f.store.save).not.toHaveBeenCalled();
  expect(localStorage.getItem(ACTIVE_SESSION_KEY)).toBe(f.original.id);
});
it("T15 edit without checkpoint invalidates provisional task and pending confirmation", () => {
  const f = setup(); const s = f.original;
  s.messages = [{ id: "old", branchId: s.activeBranchId, role: "user", content: "old intent", createdAt: s.createdAt }];
  s.taskState!.knownSlots.nextAction = { kind: "job_fit" };
  s.pendingConfirmation = { id: "pending", operationId: "op", toolName: "compose_resume", title: "confirm", description: "proposal", requestedAt: s.createdAt, status: "pending", destructive: false };
  const edited = branchSessionFromEditedUserMessage(s, "old", "new intent")!;
  expect(edited.taskState).toBeUndefined();
  expect(edited.pendingConfirmation).toBeUndefined();
  expect(s.taskState!.knownSlots.nextAction).toEqual({ kind: "job_fit" });
});
it("T06/J bounded task memory describes business pause without source text or entity IDs", () => {
  const f = setup(); const task = f.original.taskState!;
  task.completionStatus = "waiting_for_confirmation";
  task.selectedEntities = { profileId: "secret-profile-id", jobId: "secret-job-id" };
  task.knownSlots.nextAction = { kind: "job_fit" };
  const checkpoint = careerSessionCheckpoint(task)!;
  expect(checkpoint.taskSummary).toContain("waiting_for_confirmation");
  expect(checkpoint.taskSummary).toContain("job-fit analysis");
  expect(checkpoint.taskSummary).not.toMatch(/secret-|original durable JD/);
  expect(checkpoint.profileId).toBe("secret-profile-id");
});

it("T20 refresh presents only the Fit artifact bound to the active session and exact revision", async () => {
  const f = setup(); const s = f.original;
  s.taskState!.workflowId = "analyze_job_fit";
  s.taskState!.rootGoal = "analyze_job_fit";
  s.taskState!.stage = "completed";
  s.taskState!.selectedEntities = { jobId: "job", resumeId: "resume", revisionId: "revision" };
  s.taskState!.knownSlots.fitAnalysis = { dependencies: { jobId: "job", resumeId: "resume", resumeRevisionId: "revision" } };
  const artifact: AgentArtifactRef = { id: "current-fit", kind: "job_fit_overview", title: "岗位匹配", entityType: "job", entityId: "job", status: "active", createdAt: s.createdAt, updatedAt: s.updatedAt,
    binding: { sessionId: s.id, branchId: s.activeBranchId, workflowId: "analyze_job_fit", jobId: "job", resumeBranchId: "resume", revisionId: "revision" } };
  s.artifactRefs = [artifact, { ...artifact, id: "wrong-revision", binding: { ...artifact.binding!, revisionId: "old-revision" } }, { ...artifact, id: "wrong-session", binding: { ...artifact.binding!, sessionId: "other-session" } }];
  render(<AgentWorkspace />);
  await act(async () => f.resolve(s));
  await waitFor(() => expect(screen.getByTestId("agent-recovery-state")).toHaveAttribute("data-state", "ready"));
  expect(screen.getByTestId("artifact-list")).toHaveTextContent(/^current-fit$/u);
});
