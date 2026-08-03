import { describe, expect, it } from "vitest";
import { aiTaskRegistry } from "@/ai/tasks/registry";

describe("profile intake semantic task normalization", () => {
  it("omits null optional model fields without weakening required evidence validation", () => {
    const raw = {
      candidates: [{
        candidateKey: "project-1",
        sectionType: "project",
        title: "TideNote",
        startDate: null,
        endDate: null,
        current: false,
        highlights: [],
        tools: ["Rust"],
        methods: [],
        outcomes: [],
        sourceQuote: "我开发 TideNote。",
        confidence: 0.9,
        needsConfirmation: false,
        fieldEvidence: [{
          field: "title",
          sourceQuote: "我开发 TideNote。",
          support: "explicit",
          confidence: 0.9,
          needsConfirmation: false
        }]
      }],
      followUpQuestion: null
    };

    const coerced = aiTaskRegistry["profile-intake-semantic"].coerceRawOutput(raw) as {
      candidates: Array<Record<string, unknown>>;
      followUpQuestion?: string;
    };
    expect(coerced.candidates[0]).not.toHaveProperty("startDate");
    expect(coerced.candidates[0]).not.toHaveProperty("endDate");
    expect(coerced).not.toHaveProperty("followUpQuestion");
    expect(coerced.candidates[0]?.fieldEvidence).toEqual(raw.candidates[0]?.fieldEvidence);
  });

  it("drops unsupported optional claims while preserving grounded candidate evidence", () => {
    const raw = {
      candidates: [{
        candidateKey: "project-1",
        sectionType: "project",
        title: "TideNote",
        name: "桌面端知识管理平台",
        role: "架构负责人",
        current: true,
        highlights: [],
        tools: ["Rust语言", "Tauri"],
        methods: [],
        outcomes: [],
        sourceQuote: "我开发 TideNote，用 Rust 编写索引，并用 Tauri 完成界面。",
        confidence: 0.9,
        needsConfirmation: false,
        fieldEvidence: [{
          field: "title",
          sourceQuote: "我开发 TideNote，用 Rust 编写索引，并用 Tauri 完成界面。",
          support: "explicit",
          confidence: 0.9,
          needsConfirmation: false
        }, {
          field: "tools",
          sourceQuote: "我开发 TideNote，用 Rust 编写索引，并用 Tauri 完成界面。",
          support: "explicit",
          confidence: 0.9,
          needsConfirmation: false
        }]
      }]
    };
    const coerced = aiTaskRegistry["profile-intake-semantic"].coerceRawOutput(raw) as {
      candidates: Array<Record<string, unknown>>;
    };
    expect(coerced.candidates[0]).not.toHaveProperty("name");
    expect(coerced.candidates[0]).not.toHaveProperty("role");
    expect(coerced.candidates[0]?.current).toBe(false);
    expect(coerced.candidates[0]?.tools).toEqual(["Tauri"]);
    expect(coerced.candidates[0]?.fieldEvidence).toEqual(raw.candidates[0]?.fieldEvidence);
  });

  it("rejects populated candidate fields that have no candidate-local evidence binding", () => {
    const input = {
      rawNarrative: "我开发 TideNote。",
      existingDraftContext: [],
      canonicalSections: ["project" as const]
    };
    const output = {
      candidates: [{
        candidateKey: "project-1",
        sectionType: "project" as const,
        title: "TideNote",
        description: "开发离线笔记工具。",
        current: false,
        highlights: [],
        tools: [],
        methods: [],
        outcomes: [],
        sourceQuote: "我开发 TideNote。",
        confidence: 0.9,
        needsConfirmation: false,
        fieldEvidence: [{
          field: "title",
          sourceQuote: "我开发 TideNote。",
          support: "explicit" as const,
          confidence: 0.9,
          needsConfirmation: false
        }]
      }]
    };
    expect(() => aiTaskRegistry["profile-intake-semantic"].validateOutput(output, input))
      .toThrow("profile_intake_field_evidence_missing:description");
  });

  it("requires typed structured education from a new semantic AI response", () => {
    const input = {
      rawNarrative: "我在郑州大学读本科，计算机科学与技术专业。",
      existingDraftContext: [],
      canonicalSections: ["education" as const]
    };
    const output = {
      candidates: [{
        candidateKey: "education-1",
        sectionType: "education" as const,
        title: "郑州大学",
        current: false,
        highlights: [],
        tools: [],
        methods: [],
        outcomes: [],
        sourceQuote: input.rawNarrative,
        confidence: 0.9,
        needsConfirmation: false,
        fieldEvidence: [{
          field: "title",
          sourceQuote: input.rawNarrative,
          support: "explicit" as const,
          confidence: 0.9,
          needsConfirmation: false
        }]
      }]
    };

    expect(() => aiTaskRegistry["profile-intake-semantic"].validateOutput(output, input))
      .toThrow("profile_intake_structured_item_required:education");
  });
});
