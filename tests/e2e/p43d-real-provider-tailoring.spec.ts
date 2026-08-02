import { expect, test } from "@playwright/test";

test("P4.3d real provider generates one grounded consolidated tailoring draft", async ({ request }) => {
  test.setTimeout(180_000);
  const response = await request.post("/api/ai/structured", {
    data: {
      task: "resume-tailor-batch",
      input: {
        draftId: "p43d-anonymous-draft",
        profileId: "p43d-anonymous-profile",
        jobId: "p43d-anonymous-job",
        intensity: "balanced",
        compactJobContext: {
          title: "AI 质量工程师",
          roleMission: "设计可追溯的 AI 质量验证流程",
          topResponsibilities: ["设计 AI 任务", "验收输出质量", "复盘失败案例"],
          targetKeywords: ["AI 质量", "自动化测试", "任务设计", "验收"]
        },
        targets: [
          target({
            itemId: "summary-1",
            sectionType: "summary",
            fieldPath: "text",
            structuredItem: {
              id: "summary-1",
              sectionType: "summary",
              text: "负责 AI 应用需求拆解、质量验收与迭代复盘。",
              customFields: []
            },
            before: "负责 AI 应用需求拆解、质量验收与迭代复盘。"
          }),
          target({
            itemId: "skills-1",
            sectionType: "skills",
            fieldPath: "description",
            structuredItem: {
              id: "skills-1",
              sectionType: "skills",
              name: "自动化测试",
              description: "使用 TypeScript 与 Playwright 编写回归测试。",
              customFields: []
            },
            before: "使用 TypeScript 与 Playwright 编写回归测试。"
          }),
          target({
            itemId: "project-1",
            sectionType: "project",
            fieldPath: "highlights",
            structuredItem: {
              id: "project-1",
              sectionType: "project",
              title: "匿名 AI 工作流项目",
              role: "项目负责人",
              current: false,
              tools: ["TypeScript", "Playwright"],
              highlights: ["设计多步骤任务流程并建立自动化验收用例。"],
              outcomes: [],
              customFields: []
            },
            before: ["设计多步骤任务流程并建立自动化验收用例。"]
          })
        ]
      }
    }
  });
  expect(response.status()).toBe(200);
  const result = await response.json() as {
    ok: boolean;
    output?: { suggestions?: Array<{ itemId?: string; targetItemId?: string; after?: string | string[] }> };
    meta?: { provider?: string; model?: string; latencyMs?: number };
    errorCode?: string;
  };
  expect(result.ok, result.errorCode).toBe(true);
  expect(result.output?.suggestions?.length).toBeGreaterThan(0);
  expect(result.output?.suggestions?.length).toBeLessThanOrEqual(3);
  for (const suggestion of result.output?.suggestions ?? []) {
    expect(["summary-1", "skills-1", "project-1"]).toContain(suggestion.targetItemId ?? suggestion.itemId);
    expect(suggestion.after).toBeTruthy();
  }
  console.info("[p43d-real-provider]", {
    provider: result.meta?.provider,
    model: result.meta?.model,
    generationCalls: 1,
    targetCount: 3,
    generatedDiffCount: result.output?.suggestions?.length ?? 0,
    latencyMs: result.meta?.latencyMs
  });
});

function target(input: {
  itemId: string;
  sectionType: "summary" | "skills" | "project";
  fieldPath: "text" | "description" | "highlights";
  structuredItem: Record<string, unknown>;
  before: string | string[];
}) {
  return {
    ...input,
    sectionId: input.sectionType,
    renderedText: Array.isArray(input.before) ? input.before.join("\n") : input.before,
    relevantRequirements: [{
      requirementId: "req-ai-quality",
      description: "具备 AI 质量验收、任务设计与自动化测试经验",
      priority: "must",
      keywords: ["AI 质量", "任务设计", "自动化测试"],
      relevanceScore: 1
    }],
    allowedEvidenceRefs: [],
    allowedFacts: [{
      value: Array.isArray(input.before) ? input.before.join("\n") : input.before,
      evidenceRefs: []
    }]
  };
}
