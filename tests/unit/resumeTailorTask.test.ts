import { describe, expect, it } from "vitest";
import { aiTaskRegistry, type ResumeTailorTaskInput } from "@/ai/tasks/registry";
import type { TailoringIntensity } from "@/domain/schemas";

const definition = aiTaskRegistry["resume-tailor"];

describe("resume-tailor v2 task contract", () => {
  it("includes intensity, compact JD context and item-specific requirements", () => {
    const prompt = JSON.parse(definition.buildUserPrompt(input("balanced")));
    expect(prompt).toMatchObject({
      intensity: "balanced",
      compactJobContext: { title: "AI 软件工程师", targetKeywords: expect.arrayContaining(["RAG"]) },
      before: ["搭建并调优 RAG 系统。"]
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

  it("completes a minimal after + rationale response locally", () => {
    const taskInput = input("balanced");
    const coerced = definition.coerceRawOutput({ after: "面向 RAG 与 FastAPI 场景验证模型输出并交付 Agent 项目。", rationale: "对齐岗位重点" });
    const normalized = definition.normalizeOutput(coerced as never, taskInput);
    expect(normalized.suggestions[0]).toMatchObject({ intensity: "balanced", operation: "rewrite", requirementIds: ["req-rag"], before: taskInput.currentContent.fieldValue, evidenceRefs: [] });
  });

  it("filters invalid requirement ids and binds the most relevant local requirement", () => {
    const taskInput = input("balanced");
    const coerced = definition.coerceRawOutput({ suggestions: [{ after: "使用 RAG 与 FastAPI 完成系统开发。", rationale: "岗位对齐", requirementIds: ["invented"] }] });
    expect(definition.normalizeOutput(coerced as never, taskInput).suggestions[0].requirementIds).toEqual(["req-rag"]);
  });

  it.each(["suggestions", "items"])("recognizes the %s envelope", (key) => {
    const taskInput = input("balanced");
    const coerced = definition.coerceRawOutput({ [key]: [{ after: "使用 RAG 与 FastAPI 完成系统开发。", rationale: "岗位对齐" }] });
    expect(definition.normalizeOutput(coerced as never, taskInput).suggestions).toHaveLength(1);
  });

  it("ignores invalid server-owned metrics and status returned by the model", () => {
    const taskInput = input("balanced");
    const coerced = definition.coerceRawOutput({ suggestedText: "使用 RAG 与 FastAPI 完成系统开发。", reason: "岗位对齐", metrics: "wrong", status: "unknown" });
    expect(definition.normalizeOutput(coerced as never, taskInput).suggestions[0]).toMatchObject({ metrics: { textChangeRatio: 0, keywordGain: 0 }, status: "requires_confirmation" });
  });

  it("reports a specific diagnostic when after is missing instead of silently dropping it", () => {
    const taskInput = input("balanced");
    const coerced = definition.coerceRawOutput({ suggestions: [{ rationale: "岗位对齐" }] });
    expect(() => definition.normalizeOutput(coerced as never, taskInput)).toThrow("resume_tailor_after_missing");
  });

  it("normalizes a batch into complete suggestions bound by itemId", () => {
    const single = input("balanced");
    const batchDefinition = aiTaskRegistry["resume-tailor-batch"];
    const batchInput = {
      draftId: single.draftId, profileId: single.profileId, jobId: single.jobId, intensity: single.intensity,
      compactJobContext: { title: single.jobContext.title, roleMission: single.jobContext.roleMission, topResponsibilities: single.jobContext.responsibilities, targetKeywords: single.jobContext.keywords },
      targets: [{ itemId: single.target.itemId!, sectionType: single.target.sectionType, sectionId: single.target.sectionId, fieldPath: single.target.fieldPath, structuredItem: single.currentContent.structuredItem, before: single.currentContent.fieldValue, renderedText: single.currentContent.renderedText, relevantRequirements: single.relevantRequirements, allowedEvidenceRefs: [], allowedFacts: single.allowedFacts }]
    };
    const coerced = batchDefinition.coerceRawOutput({ suggestions: [{ itemId: "smartfocus", after: "围绕 RAG 与 FastAPI 验证模型输出。", rationale: "岗位对齐" }] });
    const normalized = batchDefinition.normalizeOutput(coerced as never, batchInput);
    expect(normalized.suggestions).toHaveLength(1);
    expect(normalized.suggestions[0]).toMatchObject({ targetItemId: "smartfocus", requirementIds: ["req-rag"] });
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
