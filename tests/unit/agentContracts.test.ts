import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import {
  AgentSessionSchema,
  deriveAgentSessionTitle,
  getAgentSessionDisplayTitle,
  serializeAgentSession
} from "@/agent/contracts/agentSession";
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
    expect(AgentSessionSchema.parse(parsed).workflowState?.data.resumeId).toBe("resume-1");
    expect(() => AgentSessionSchema.parse({
      ...session,
      workflowState: { ...session.workflowState, data: { branch: { rawText: "forbidden copy" } } }
    })).toThrow();
  });

  it("derives a compact title from the first user message while keeping explicit names", () => {
    const session = AgentRuntime.create("agent_quick_action", "collecting_intent");
    const firstMessage = {
      id: "user-1",
      role: "user" as const,
      content: "帮我把数据产品经理岗位的简历改得更有针对性一些",
      createdAt: new Date().toISOString()
    };
    expect(deriveAgentSessionTitle(firstMessage.content)).toBe("帮我把数据产品经理岗位的简历改得更有针对性一些");
    expect(getAgentSessionDisplayTitle({ ...session, messages: [firstMessage] })).toBe(firstMessage.content);
    expect(getAgentSessionDisplayTitle({ ...session, title: "手动命名", messages: [firstMessage] })).toBe("手动命名");
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

  it("restores workflow pointers, scoped memory, and operational trajectory without copying profile facts", () => {
    const session = AgentRuntime.create("analyze_job_fit", "select_assets");
    const restored = AgentSessionSchema.parse({
      ...session,
      activeProfileId: "profile-1",
      activeResumeId: "resume-1",
      activeJobId: "job-1",
      memory: {
        userPreferences: ["回复保持简洁"],
        episodic: ["用户纠正了目标岗位名称"],
        procedural: ["jd-analysis"]
      },
      trajectory: {
        taskId: "task-restore-1",
        workflowId: "analyze_job_fit",
        turns: 1,
        skillsLoaded: ["jd-analysis"],
        toolCalls: [],
        confirmations: [],
        artifacts: [],
        outcome: "running",
        errors: []
      }
    });
    expect(restored).toMatchObject({
      activeProfileId: "profile-1",
      activeResumeId: "resume-1",
      activeJobId: "job-1",
      workflowState: { workflowId: "analyze_job_fit", step: "select_assets" }
    });
    expect(JSON.stringify(restored.memory)).not.toContain("experiences");
  });

  it("keeps the planner API independent from Dexie and WorkspaceRepository", () => {
    const source = fs.readFileSync(path.resolve("src/app/api/agent/turn/route.ts"), "utf8");
    expect(source).not.toContain("Dexie");
    expect(source).not.toContain("WorkspaceRepository");
    expect(source).not.toContain("services/storage/db");
  });
});
