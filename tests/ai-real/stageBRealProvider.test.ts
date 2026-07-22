import { describe, expect, it } from "vitest";
import { OpenAiCompatibleProvider } from "@/ai/providers/openAiCompatibleProvider";
import { stageBTaskRegistry, type ProfileBuilderTaskInput, type JdAnalyzerTaskInput, type StageBTaskDefinition } from "@/ai/tasks/registry";
import { stableHashText } from "@/services/security/text";
import { ProfileBuilderOutputSchema, JdAnalyzerModelOutputSchema, type ProfileBuilderOutput, type JdAnalyzerModelOutput } from "@/domain/schemas";
import { analyzeJobDescriptionV3 } from "@/domain/jobOptimization";
import { AI_CODING_TASK_DESIGNER_JD } from "../fixtures/aiCodingTaskDesignerJd";

const hasRealAiConfig = Boolean(process.env.AI_API_KEY && process.env.AI_MODEL);

/**
 * Desensitized Chinese test samples — no real personal data.
 * Phone, email, ID, and address are either absent or fictional.
 */
const PROFILE_SAMPLE = `教育经历
北京大学 计算机相关专业专业 本科 2022年9月 - 2026年6月
- GPA 3.7/4.0，获校级奖学金两次

实习经历
某科技有限公司 数据分析实习生 2025年6月 - 2025年9月
- 使用 Python 和 SQL 清洗用户行为数据，搭建周报自动化流程
- 协助完成用户留存率分析报告，覆盖3个月数据

项目经历
校园二手交易平台 后端开发 2024年3月 - 2024年6月
- 基于 Node.js 和 Express 搭建 REST API，支持商品发布、搜索和订单功能
- 使用 MongoDB 存储商品和用户数据

技能
- 编程语言：Python, JavaScript, SQL
- 工具：Excel, Tableau, Git
`;

describe("stage B real AI smoke test", () => {
  (hasRealAiConfig ? it : it.skip)(
    "health check: basic provider connectivity",
    async () => {
      const provider = new OpenAiCompatibleProvider();
      const result = await provider.invoke({
        systemPrompt: "Return only JSON: {\"status\":\"ok\"}.",
        userPrompt: "This is a redacted test sample with no real contact details.",
        maxOutputChars: 2_000,
        signal: AbortSignal.timeout(20_000)
      });

      expect(result.provider).toBeTruthy();
      expect(result.model).toBeTruthy();
      expect(result.output).toMatchObject({ status: "ok" });
    }
  );
});

describe("profile-builder real model integration", () => {
  (hasRealAiConfig ? it : it.skip)(
    "produces valid ProfileBuilderOutput from redacted Chinese resume text",
    async () => {
      const definition = stageBTaskRegistry["profile-builder"] as StageBTaskDefinition<ProfileBuilderTaskInput, ProfileBuilderOutput>;
      const input: ProfileBuilderTaskInput = {
        rawText: PROFILE_SAMPLE,
        inputHash: stableHashText(PROFILE_SAMPLE)
      };

      const provider = new OpenAiCompatibleProvider();
      const response = await provider.invoke({
        systemPrompt: definition.systemPrompt,
        userPrompt: definition.buildUserPrompt(input),
        maxOutputChars: definition.maxOutputChars,
        signal: AbortSignal.timeout(30_000)
      });

      expect(response.provider).toBeTruthy();
      expect(response.model).toBeTruthy();

      const coerced = definition.coerceRawOutput(response.output);
      const normalized = definition.normalizeOutput(coerced as ProfileBuilderOutput, input);
      const parsed = ProfileBuilderOutputSchema.safeParse(normalized);

      if (!parsed.success) {
        console.error("[profile-builder] Schema validation failed:", JSON.stringify(parsed.error.issues, null, 2));
        console.error("[profile-builder] Normalized output sample:", JSON.stringify(normalized, null, 2).slice(0, 2000));
      }

      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }

      const output = parsed.data;

      // Verify sourceQuote can be located in original text
      const allQuotes: string[] = [];

      if (output.basics.name) {
        allQuotes.push(output.basics.name.sourceQuote);
      }

      if (output.basics.summary) {
        allQuotes.push(output.basics.summary.sourceQuote);
      }

      for (const experience of output.experiences) {
        allQuotes.push(experience.organization.sourceQuote);
        allQuotes.push(experience.role.sourceQuote);
        for (const fact of experience.facts) {
          allQuotes.push(fact.sourceQuote);
        }
      }

      for (const skill of output.skills) {
        allQuotes.push(skill.sourceQuote);
      }

      // Each sourceQuote should be findable in original text (direct or compact match)
      for (const quote of allQuotes) {
        const directMatch = PROFILE_SAMPLE.includes(quote.trim());
        const compactRaw = PROFILE_SAMPLE.replace(/\s+/g, "");
        const compactQuote = quote.trim().replace(/\s+/g, "");
        const compactMatch = compactRaw.includes(compactQuote);
        expect(
          directMatch || compactMatch,
          `sourceQuote "${quote.slice(0, 40)}..." should be locatable in original text`
        ).toBe(true);
      }

      // Verify no fabricated schools or organizations beyond what's in the sample
      const knownOrganizations = ["北京大学", "某科技有限公司", "校园二手交易平台"];
      for (const experience of output.experiences) {
        const orgValue = experience.organization.value;
        const hasKnownOrg = knownOrganizations.some(
          (known) => orgValue.includes(known) || known.includes(orgValue)
        );
        // If confidence is low, it might not match perfectly, but we verify sourceQuote is locatable
        if (experience.organization.confidenceLevel === "high") {
          expect(
            hasKnownOrg || PROFILE_SAMPLE.includes(orgValue),
            `Organization "${orgValue}" should be in original text`
          ).toBe(true);
        }
      }

      // Verify confidence levels and needsConfirmation are properly set
      for (const experience of output.experiences) {
        expect(["high", "medium", "low"]).toContain(experience.organization.confidenceLevel);
        expect(typeof experience.organization.needsConfirmation).toBe("boolean");
        expect(experience.organization.confidenceReason.length).toBeGreaterThan(0);
      }

      // Items without sourceSpan should have low confidence and needsConfirmation
      for (const skill of output.skills) {
        if (!skill.sourceSpan) {
          expect(skill.confidenceLevel).toBe("low");
          expect(skill.needsConfirmation).toBe(true);
        }
      }

      console.log(
        `[profile-builder] provider=${response.provider} model=${response.model} ` +
        `experiences=${output.experiences.length} skills=${output.skills.length} ` +
        `certificates=${output.certificates.length} unclassified=${output.unclassifiedBlocks.length}`
      );
    }
  );
});

describe("jd-analyzer real model integration", () => {
  (hasRealAiConfig ? it : it.skip)(
    "produces valid JdAnalyzerOutput from redacted Chinese JD text",
    async () => {
      const definition = stageBTaskRegistry["jd-analyzer"] as StageBTaskDefinition<JdAnalyzerTaskInput, JdAnalyzerModelOutput>;
      const deterministic = analyzeJobDescriptionV3({ rawText: AI_CODING_TASK_DESIGNER_JD });
      const input: JdAnalyzerTaskInput = { title: "AI Coding 任务设计专家", company: "测试公司", rawText: AI_CODING_TASK_DESIGNER_JD, inputHash: stableHashText(AI_CODING_TASK_DESIGNER_JD), sourceUnits: deterministic.sourceUnits, deterministicGroups: deterministic.groups, deterministicHierarchy: deterministic.requirements.map((requirement) => ({ sourceUnitId: requirement.sourceUnitId, detailUnitIds: requirement.details.map((detail) => detail.sourceUnitId), parentGroupId: requirement.parentGroupId })) };

      const provider = new OpenAiCompatibleProvider();
      const response = await provider.invoke({
        systemPrompt: definition.systemPrompt,
        userPrompt: definition.buildUserPrompt(input),
        maxOutputChars: definition.maxOutputChars,
        signal: AbortSignal.timeout(30_000)
      });

      expect(response.provider).toBeTruthy();
      expect(response.model).toBeTruthy();

      const coerced = definition.coerceRawOutput(response.output);
      const normalized = definition.normalizeOutput(coerced as JdAnalyzerModelOutput, input);
      const parsed = JdAnalyzerModelOutputSchema.safeParse(normalized);

      if (!parsed.success) {
        console.error("[jd-analyzer] Schema validation failed:", JSON.stringify(parsed.error.issues, null, 2));
        console.error("[jd-analyzer] Normalized output sample:", JSON.stringify(normalized, null, 2).slice(0, 2000));
      }

      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }

      const output = parsed.data;

      expect(output.unitAssignments).toBeDefined();
      for (const assignment of output.unitAssignments) expect(assignment.sourceUnitId.length).toBeGreaterThan(0);

      console.log(
        `[jd-analyzer] provider=${response.provider} model=${response.model} ` +
        `assignments=${output.unitAssignments.length} riskNotes=${output.riskNotes.length}`
      );
    }
  );
});
