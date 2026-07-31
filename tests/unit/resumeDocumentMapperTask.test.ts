import { describe, expect, it } from "vitest";
import { aiTaskRegistry } from "@/ai/tasks/registry";
import type { ResumeJsonMapperOutput } from "@/domain/schemas";
import {
  coerceResumeDocumentMapperOutput,
  normalizeResumeMapperBoundaryOutput
} from "@/ai/tasks/resumeDocumentMapperOutput";

const definition = aiTaskRegistry["resume-document-mapper"];
const rawText = JSON.stringify([
  { id: "b1", text: "GPA：3.95/5.0，排名：1/42" },
  { id: "b2", text: "未分类来源" }
]);
const input = { rawText, inputHash: "document-mapper-input" };

describe("resume-document-mapper shared boundary", () => {
  it("includes catalog metadata and allows deterministic local preservation of uncited blocks", () => {
    const prompt = JSON.parse(definition.buildUserPrompt(input)) as Record<string, unknown>;
    expect(prompt).toMatchObject({ schemaVersion: "resume-import-v2" });
    expect(prompt.catalogVersion).toBeTypeOf("string");
    expect(prompt.canonicalFields).toEqual(expect.arrayContaining([expect.objectContaining({ id: "education.gpa", valueType: "number" })]));
    expect(() => definition.validateOutput(validOutput(), input)).not.toThrow();

    const dropped = validOutput();
    dropped.unclassifiedBlocks = [];
    expect(() => definition.validateOutput(dropped, input)).not.toThrow();
    expect(definition.systemPrompt).toContain("untrusted DATA");
    expect(definition.systemPrompt).toContain("define structure only, never facts");
    expect(definition.systemPrompt).toContain("local code preserves all uncited source blocks");
    expect(definition.systemPrompt).toContain("Do not output mappingDecisions");
    expect(definition.systemPrompt).toContain("An item may contain only");
    expect(definition.systemPrompt).toContain("Do not output category or included");
    expect(definition.systemPrompt).toContain("cover every factual item property");
    expect(prompt.outputContract).toBeDefined();
  });

  it("coerces a direct StructuredResumeDraft and unambiguous wrappers", () => {
    const direct = { schemaVersion: "structured-resume-draft-v1", basics: {}, sections: [] };
    expect(coerceResumeDocumentMapperOutput(direct)).toEqual({ structuredDraft: direct });
    expect(coerceResumeDocumentMapperOutput({ draft: direct })).toEqual({ structuredDraft: direct });
    expect(coerceResumeDocumentMapperOutput({ result: { structuredDraft: direct } })).toEqual({
      structuredDraft: direct
    });
  });

  it("coerces supported item aliases without changing factual values", () => {
    const output = coerceResumeDocumentMapperOutput({
      structuredDraft: {
        basics: {},
        sections: [{
          sectionName: "项目经历",
          type: "project",
          items: [{
            company: "示例公司",
            position: "开发",
            bullets: ["保留原句"]
          }]
        }]
      }
    }) as ResumeJsonMapperOutput;
    const section = output.structuredDraft.sections[0];
    const item = section.items[0];
    expect(section).toMatchObject({ title: "项目经历", sectionType: "project" });
    expect(item).toEqual({
      organization: "示例公司",
      role: "开发",
      highlights: ["保留原句"]
    });
  });

  it("keeps a distinct item name as grounded content when text already exists", () => {
    const output = normalizeResumeMapperBoundaryOutput({
      structuredDraft: {
        basics: {},
        sections: [{
          title: "技能",
          sectionType: "skills",
          items: [{
            name: "工具与平台",
            text: "Git/GitHub",
            mapping: mapping(["b1"], ["工具与平台 Git/GitHub"])
          }]
        }]
      }
    }, [{ id: "b1", text: "工具与平台 Git/GitHub" }]) as ResumeJsonMapperOutput;
    expect(output.structuredDraft.sections[0].items[0]).toMatchObject({
      text: "Git/GitHub",
      highlights: ["工具与平台"]
    });
  });

  it("omits null optional values and normalizes numeric confidence", () => {
    const output = coerceResumeDocumentMapperOutput({
      structuredDraft: {
        basics: {},
        sections: [{
          title: "项目经历",
          sectionType: "project",
          items: [{
            text: "保留原句",
            location: null,
            mapping: {
              sourcePaths: ["b1"],
              sourceValues: ["保留原句"],
              confidence: 0.7,
              confidenceReason: "显式来源",
              needsConfirmation: false
            }
          }]
        }]
      }
    }) as ResumeJsonMapperOutput;
    const item = output.structuredDraft.sections[0].items[0];
    expect(item).toMatchObject({
      text: "保留原句",
      mapping: { confidenceLevel: "medium", needsConfirmation: true }
    });
    expect(item).not.toHaveProperty("location");
  });

  it("normalizes links strings, mapped objects, blanks, and arrays without splitting facts", () => {
    expect(coerceResumeDocumentMapperOutput({
      structuredDraft: { basics: { links: "https://example.test/me" }, sections: [] }
    })).toMatchObject({
      structuredDraft: { basics: { links: ["https://example.test/me"] } }
    });
    const mappedLink = {
      value: "https://example.test/work",
      mapping: mapping(["b1"], ["https://example.test/work"])
    };
    expect(coerceResumeDocumentMapperOutput({
      structuredDraft: { basics: { links: mappedLink }, sections: [] }
    })).toMatchObject({
      structuredDraft: { basics: { links: [mappedLink] } }
    });
    expect(coerceResumeDocumentMapperOutput({
      structuredDraft: {
        basics: { links: [null, "", "   ", "https://example.test/kept"] },
        sections: []
      }
    })).toMatchObject({
      structuredDraft: { basics: { links: ["https://example.test/kept"] } }
    });
  });

  it("derives category locally and omits blank optional item values before Zod", () => {
    const output = normalizeResumeMapperBoundaryOutput({
      structuredDraft: {
        basics: {},
        sections: [{
          title: "技能",
          sectionType: "skills",
          category: "skills",
          items: [{
            text: "TypeScript",
            endDate: "",
            location: "   "
          }]
        }]
      }
    }) as ResumeJsonMapperOutput;
    expect(output.structuredDraft.sections[0]).toMatchObject({
      sectionType: "skills",
      category: "skill"
    });
    expect(output.structuredDraft.sections[0].items[0]).not.toHaveProperty("endDate");
    expect(output.structuredDraft.sections[0].items[0]).not.toHaveProperty("location");
    expect(output.mapperDiagnostics?.shapeRepairs).toEqual(expect.arrayContaining([
      "category_derived",
      "blank_end_date_omitted",
      "blank_location_omitted"
    ]));
    expect(() => definition.outputSchema.parse(output)).not.toThrow();
  });

  it("completes exact item evidence only from already-authorized source paths", () => {
    const output = normalizeResumeMapperBoundaryOutput({
      structuredDraft: {
        basics: {},
        sections: [{
          title: "工作经历",
          sectionType: "work",
          items: [{
            organization: "腾讯科技",
            role: "产品实习生",
            mapping: mapping(["b21", "b22"], ["腾讯科技"])
          }]
        }]
      }
    }, [
      { id: "b21", text: "腾讯科技" },
      { id: "b22", text: "产品实习生" }
    ]) as ResumeJsonMapperOutput;
    const item = output.structuredDraft.sections[0].items[0];
    expect(item).toMatchObject({
      organization: "腾讯科技",
      role: "产品实习生",
      mapping: {
        sourceValues: ["腾讯科技", "产品实习生"],
        needsConfirmation: true
      }
    });
    expect(output.mapperDiagnostics).toMatchObject({
      evidenceRepairs: ["evidence_quote_completed"],
      rejectedFieldCount: 0,
      groundedFieldCount: 2
    });
    expect(() => definition.validateOutput(output, {
      rawText: JSON.stringify([
        { id: "b21", text: "腾讯科技" },
        { id: "b22", text: "产品实习生" }
      ]),
      inputHash: "evidence-completion"
    })).not.toThrow();
  });

  it("quarantines one unsupported field while preserving the grounded resume", () => {
    const output = normalizeResumeMapperBoundaryOutput({
      structuredDraft: {
        basics: {},
        sections: [{
          title: "工作经历",
          sectionType: "work",
          items: [{
            organization: "示例公司",
            role: "虚构职位",
            mapping: mapping(["b1"], ["示例公司"])
          }]
        }]
      }
    }, [{ id: "b1", text: "示例公司" }]) as ResumeJsonMapperOutput;
    expect(output.structuredDraft.sections[0].items[0]).toMatchObject({
      organization: "示例公司"
    });
    expect(output.structuredDraft.sections[0].items[0]).not.toHaveProperty("role");
    expect(output.mapperDiagnostics?.rejectedFields).toEqual([{
      path: "structuredDraft.sections[0].items[0].role",
      reason: "ai_field_not_grounded"
    }]);
    expect(output.unclassifiedBlocks).toEqual([
      expect.objectContaining({
        sourcePath: "b1",
        reason: "ai_field_not_grounded:structuredDraft.sections[0].items[0].role"
      })
    ]);
  });

  it("rejects systematically unsupported facts and fabricated source ids", () => {
    expect(() => normalizeResumeMapperBoundaryOutput({
      structuredDraft: {
        basics: {},
        sections: [{
          title: "工作经历",
          sectionType: "work",
          items: [{
            organization: "虚构公司",
            role: "虚构职位",
            text: "虚构职责",
            mapping: mapping(["fake-1", "fake-2", "fake-3"], ["虚构公司"])
          }]
        }]
      }
    }, [{ id: "b1", text: "真实来源" }])).toThrow(
      "resume_document_mapper_systematic_grounding_failure"
    );
  });

  it("rejects an actual paraphrase instead of accepting it as grounded", () => {
    const output = normalizeResumeMapperBoundaryOutput({
      structuredDraft: {
        basics: {},
        sections: [{
          title: "项目经历",
          sectionType: "project",
          items: [{
            organization: "课程项目",
            role: "主导产品需求战略",
            text: "负责需求分析",
            mapping: mapping(["b1"], ["课程项目", "负责需求分析"])
          }]
        }]
      }
    }, [{ id: "b1", text: "课程项目 负责需求分析" }]) as ResumeJsonMapperOutput;
    const item = output.structuredDraft.sections[0].items[0];
    expect(item).not.toHaveProperty("role");
    expect(item).toMatchObject({ organization: "课程项目", text: "负责需求分析" });
  });

  it("quarantines an unknown factual item field with a safe path", () => {
    const normalized = normalizeResumeMapperBoundaryOutput({
      structuredDraft: {
        basics: {},
        sections: [{
          title: "教育经历",
          sectionType: "education",
          items: [{
            school: "示例大学",
            salaryExpectation: "保留但不接受",
            mapping: mapping(["b1"], ["示例大学", "保留但不接受"])
          }]
        }]
      }
    }, [{ id: "b1", text: "示例大学 保留但不接受" }]) as ResumeJsonMapperOutput;
    expect(normalized.structuredDraft.sections[0].items[0]).not.toHaveProperty(
      "salaryExpectation"
    );
    expect(normalized.mapperDiagnostics?.rejectedFields).toContainEqual({
      path: "structuredDraft.sections[0].items[0].salaryExpectation",
      reason: "ai_field_not_grounded"
    });
  });

  it("repairs safety metadata for a one-source-to-many-field decision", () => {
    const output = validOutput();
    output.mappingDecisions = [
      canonicalDecision("education.gpa", "3.95", false),
      canonicalDecision("education.gpaScale", "5.0", false)
    ];
    const repaired = definition.normalizeOutput(output);
    expect(repaired.mappingDecisions).toEqual([
      expect.objectContaining({ needsConfirmation: true, confidence: 0.84 }),
      expect.objectContaining({ needsConfirmation: true, confidence: 0.84 })
    ]);
    expect(() => definition.validateOutput(repaired, input)).not.toThrow();
  });

  it("rejects decision quotes that cannot be located in the cited block", () => {
    const output = validOutput();
    output.mappingDecisions = [canonicalDecision("education.gpa", "3.96", true)];
    expect(() => definition.validateOutput(output, input)).toThrow("resume_document_mapper_decision_quote_mismatch");
  });

  it("quarantines a current flag when the cited source never says current", () => {
    const output = validOutput();
    const item = output.structuredDraft.sections[0].items[0];
    if (typeof item !== "string") item.current = true;
    const normalized = normalizeResumeMapperBoundaryOutput(
      output,
      [{ id: "b1", text: "GPA：3.95/5.0，排名：1/42" }]
    ) as ResumeJsonMapperOutput;
    expect(normalized.structuredDraft.sections[0].items[0]).not.toHaveProperty("current");
    expect(normalized.mapperDiagnostics?.rejectedFields).toContainEqual({
      path: "structuredDraft.sections[0].items[0].current",
      reason: "ai_field_not_grounded"
    });
  });

  it("grounds sensitive placeholders against the redacted authoritative source", () => {
    const sensitiveRawText = JSON.stringify([
      { id: "contact", text: "电话：13800000000" }
    ]);
    const output: ResumeJsonMapperOutput = {
      structuredDraft: {
        basics: { phone: "[PHONE_1]" },
        sections: []
      },
      mappingDecisions: [{
        kind: "canonical_field",
        targetFieldId: "basics.phone",
        sourceBlockIds: ["contact"],
        sourceQuote: "[PHONE_1]",
        confidence: 0.99,
        needsConfirmation: false,
        mappingReason: "exact redacted source"
      }],
      unclassifiedBlocks: []
    };

    expect(() => definition.validateOutput(output, {
      rawText: sensitiveRawText,
      inputHash: "sensitive-document-mapper-input"
    })).not.toThrow();
  });
});

function validOutput(): ResumeJsonMapperOutput {
  return {
    structuredDraft: {
      basics: {},
      sections: [{
        title: "教育背景",
        sectionType: "experience",
        category: "education",
        included: false,
        items: [{
          text: "GPA：3.95/5.0，排名：1/42",
          included: false,
          mapping: {
            sourcePaths: ["b1"],
            sourceValues: ["GPA：3.95/5.0，排名：1/42"],
            confidenceLevel: "medium",
            confidenceReason: "来源块逐字引用",
            needsConfirmation: true
          }
        }]
      }]
    },
    mappingDecisions: [canonicalDecision("education.gpa", "3.95", true)],
    unclassifiedBlocks: [{ sourcePath: "b2", sourceValue: "未分类来源", reason: "尚未映射" }]
  };
}

function canonicalDecision(targetFieldId: "education.gpa" | "education.gpaScale", sourceQuote: string, needsConfirmation: boolean) {
  return {
    kind: "canonical_field" as const,
    targetFieldId,
    sourceBlockIds: ["b1"],
    sourceQuote,
    confidence: 0.9,
    needsConfirmation,
    mappingReason: "exact source"
  };
}

function mapping(sourcePaths: string[], sourceValues: string[]) {
  return {
    sourcePaths,
    sourceValues,
    confidenceLevel: "high" as const,
    confidenceReason: "exact source",
    needsConfirmation: false
  };
}
