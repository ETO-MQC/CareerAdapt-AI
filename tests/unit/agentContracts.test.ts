import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentSessionSchema, serializeAgentSession } from "@/agent/contracts/agentSession";
import { AgentPageContextSchema, serializeAgentPageContext } from "@/agent/contracts/agentContext";

describe("agent contracts", () => {
  it("serializes a bounded lightweight session", () => {
    const session = AgentRuntime.create("tailor_existing_resume", "select_resume");
    const parsed = serializeAgentSession({
      ...session,
      workflowState: {
        ...session.workflowState,
        data: { resumeId: "resume-1", selectedIds: ["a", "b"] }
      }
    });
    expect(AgentSessionSchema.parse(parsed).workflowState.data.resumeId).toBe("resume-1");
    expect(() => AgentSessionSchema.parse({
      ...session,
      workflowState: { ...session.workflowState, data: { branch: { rawText: "forbidden copy" } } }
    })).toThrow();
  });

  it("serializes page context without DOM or entity copies", () => {
    const context = serializeAgentPageContext({
      pathname: "/ai-workspace",
      activeResumeId: "resume-1",
      query: { view: "artifact" }
    });
    expect(AgentPageContextSchema.parse(context)).toEqual(context);
    expect(() => AgentPageContextSchema.parse({ ...context, resume: { id: "resume-1" } })).toThrow();
  });

  it("keeps the planner API independent from Dexie and WorkspaceRepository", () => {
    const source = fs.readFileSync(path.resolve("src/app/api/agent/turn/route.ts"), "utf8");
    expect(source).not.toContain("Dexie");
    expect(source).not.toContain("WorkspaceRepository");
    expect(source).not.toContain("services/storage/db");
  });
});
