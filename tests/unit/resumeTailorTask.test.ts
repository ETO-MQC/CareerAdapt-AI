import { describe, expect, it } from "vitest";
import { aiTaskRegistry, type ResumeTailorTaskInput } from "@/ai/tasks/registry";
import type { TailoringIntensity } from "@/domain/schemas";

const definition = aiTaskRegistry["resume-tailor"];

describe("resume-tailor v2 task contract", () => {
  it("includes intensity, full JD context, canonical target and item-specific requirements", () => {
    const prompt = JSON.parse(definition.buildUserPrompt(input("balanced")));
    expect(prompt).toMatchObject({
      intensity: "balanced",
      jobContext: { title: "AI 软件工程师", rawText: expect.stringContaining("RAG") },
      target: { sectionType: "project", fieldPath: "sections.project.items.smartfocus.highlights" }
    });
    expect(prompt.relevantRequirements[0]).toMatchObject({ requirementId: "req-rag", description: expect.stringContaining("RAG") });
  });

  it("uses materially different instructions for all three intensities", () => {
    const prompts = (["conservative", "balanced", "proactive"] as TailoringIntensity[]).map((intensity) => definition.buildUserPrompt(input(intensity)));
    expect(new Set(prompts).size).toBe(3);
    expect(prompts[0]).toContain("Conservative");
    expect(prompts[1]).toContain("Balanced");
    expect(prompts[2]).toContain("Proactive");
  });

  it("does not replace an empty AI after with the original text", () => {
    const taskInput = input("balanced");
    const coerced = definition.coerceRawOutput({ suggestions: [{ requirementIds: ["req-rag"], rationale: "针对 RAG 应用开发调整 示例任务系统 项目要点。", after: "" }] }, taskInput);
    const normalized = definition.normalizeOutput(coerced as never, taskInput);
    expect(normalized.suggestions).toEqual([]);
    expect(() => definition.validateOutput?.(normalized, taskInput)).toThrow("invalid_ai_output");
  });
});

function input(intensity: TailoringIntensity): ResumeTailorTaskInput {
  return {
    draftId: "draft-ai",
    profileId: "profile-ai",
    jobId: "job-ai",
    intensity,
    jobContext: {
      title: "AI 软件工程师",
      company: "目标公司",
      rawText: "大模型应用开发；RAG；AI Agent；Python；FastAPI；Playwright；模型输出评估；Prompt Engineering；结构化输出验证",
      roleMission: "交付可靠的大模型应用",
      responsibilities: ["RAG 应用开发", "接口开发", "自动化测试"],
      mustHave: ["Python", "FastAPI"],
      niceToHave: ["AI Agent"],
      tools: ["Python", "FastAPI", "Playwright"],
      keywords: ["RAG", "AI Agent", "FastAPI", "Playwright"]
    },
    target: { sectionType: "project", sectionId: "project", itemId: "smartfocus", fieldPath: "sections.project.items.smartfocus.highlights" },
    currentContent: {
      structuredItem: { id: "smartfocus", sectionType: "project", title: "示例任务系统", current: false, tools: ["RAG", "FastAPI"], highlights: ["搭建并调优 RAG 系统。"], outcomes: [], customFields: [] },
      fieldValue: ["搭建并调优 RAG 系统。"],
      renderedText: "示例任务系统：搭建并调优 RAG 系统。"
    },
    relevantRequirements: [{ requirementId: "req-rag", description: "负责 RAG 应用开发与 FastAPI 接口", priority: "high", keywords: ["RAG", "FastAPI", "接口开发"], relevanceScore: 30 }],
    allowedEvidenceRefs: [],
    allowedFacts: [{ value: "搭建并调优 RAG 系统。", evidenceRefs: [] }]
  };
}
