import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/agent/runtime/hermes/route";
import { careerSessionCheckpoint } from "@/agent/runtime/careerSessionCheckpoint";
import { AgentTaskStateSchema } from "@/agent/contracts/agentSession";
import { executeCareerWorkflowFacade } from "@/agent/workflows/CareerWorkflowFacade";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each(["job", "resume"])("does not resume an old tailoring proposal after switching the selected %s", async kind => {
  const task = AgentTaskStateSchema.parse({ rootGoal: "tailor_existing_resume", activeGoal: "tailor_existing_resume",
    workflowId: "tailor_existing_resume", stage: "generate_changes", updatedAt: "2026-10-29T00:00:00.000Z",
    selectedEntities: { profileId: "profile", jobId: kind === "job" ? "new-job" : "old-job",
      sourceResumeId: kind === "resume" ? "new-resume" : "old-resume" },
    knownSlots: { tailoringSession: { id: "old-proposal", profile: { id: "profile" }, branch: { id: "old-resume" }, job: { id: "old-job" } } } });
  const call = vi.fn();
  const result = await executeCareerWorkflowFacade("career.workflow.tailor_resume", { checkpointId: "old-proposal" },
    { authoritativeTaskState: task }, "core02-target-switch", call);
  expect(result.data).toMatchObject({ status: "failed", safeError: { code: "tailoring_checkpoint_target_mismatch" } });
  expect(call).not.toHaveBeenCalled();
});

it("carries Host-selected IDs across Runs without serializing known facts or old tool payloads", async () => {
  const state = AgentTaskStateSchema.parse({ rootGoal: "tailor_existing_resume", activeGoal: "tailor_existing_resume",
    workflowId: "tailor_existing_resume", stage: "analyze_job_fit", updatedAt: "2026-10-29T00:00:00.000Z",
    selectedEntities: { profileId: "anonymous-profile", sourceResumeId: "anonymous-resume", jobId: "anonymous-job", jobRevision: "2026-10-29T00:00:00.000Z" },
    knownSlots: { fullProfile: "MUST_NOT_SEND_FULL_FACTS", oldToolResult: "MUST_NOT_SEND_HISTORY" } });
  const checkpoint = careerSessionCheckpoint(state)!;
  const serialized = JSON.stringify(checkpoint);
  expect(serialized).not.toContain("MUST_NOT_SEND");
  expect(checkpoint.jobId).toBe("anonymous-job");
  vi.stubEnv("HERMES_RUNTIME_URL", "http://127.0.0.1:19001");
  vi.stubEnv("API_SERVER_KEY", "synthetic-control-key");
  vi.stubEnv("HERMES_RUNTIME_PROTOCOL", "official");
  let forwarded: Record<string, unknown> = {};
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    forwarded = JSON.parse(String(init.body));
    return Response.json({ run_id: "anonymous-run", status: "queued" });
  }));
  const response = await POST(new NextRequest("http://localhost/api/agent/runtime/hermes", {
    method: "POST", body: JSON.stringify({ action: "run_start", sessionId: "anonymous-session", userMessage: "那按它帮我改简历", careerCheckpoint: checkpoint })
  }));
  expect(response.status).toBe(200);
  expect(forwarded.career_context).toMatchObject({ workflow_checkpoint: { jobId: "anonymous-job", sourceResumeId: "anonymous-resume" } });
  expect(forwarded.instructions).toContain("Long-term Memory may contain only stable lightweight preferences");
  expect(forwarded.instructions).toContain("anonymous-job");
  expect(JSON.stringify(forwarded)).not.toContain("MUST_NOT_SEND");
});

it("rejects a checkpoint with injected facts at the HTTP boundary", async () => {
  vi.stubEnv("HERMES_RUNTIME_URL", "http://127.0.0.1:19001");
  const mock = vi.fn();
  vi.stubGlobal("fetch", mock);
  const response = await POST(new NextRequest("http://localhost/api/agent/runtime/hermes", {
    method: "POST", body: JSON.stringify({ action: "run_start", careerCheckpoint: { workflowId: "resume", stage: "review", fullProfile: "untrusted" } })
  }));
  expect(response.status).toBe(400);
  expect(mock).not.toHaveBeenCalled();
});
