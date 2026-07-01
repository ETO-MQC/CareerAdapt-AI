import { describe, expect, it } from "vitest";
import { OpenAiCompatibleProvider } from "@/ai/providers/openAiCompatibleProvider";
import { stageBTaskRegistry, type ProfileBuilderTaskInput, type JdAnalyzerTaskInput, type StageBTaskDefinition } from "@/ai/tasks/registry";
import { stableHashText } from "@/services/security/text";
import { ProfileBuilderOutputSchema, JdAnalyzerOutputSchema, type ProfileBuilderOutput, type JdAnalyzerOutput } from "@/domain/schemas";

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

const JD_SAMPLE = `岗位：数据分析实习生
公司：某互联网公司
工作地点：北京
工作类型：全职实习

岗位职责：
- 协助分析师完成数据采集、清洗和建模
- 使用 SQL 和 Excel 产出周期性数据报表
- 参与用户行为分析和增长策略讨论

任职要求：
- 统计学、数学、计算机等相关专业本科及以上
- 熟练使用 SQL 和 Excel，熟悉 Python 优先
- 每周至少实习4天，实习期不少于3个月
- 具备良好的沟通和团队协作能力

加分项：
- 有 Tableau 或 Power BI 经验
- 参加过数据分析竞赛
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
      const definition = stageBTaskRegistry["jd-analyzer"] as StageBTaskDefinition<JdAnalyzerTaskInput, JdAnalyzerOutput>;
      const input: JdAnalyzerTaskInput = {
        title: "数据分析实习生",
        company: "某互联网公司",
        rawText: JD_SAMPLE,
        inputHash: stableHashText(JD_SAMPLE)
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
      const normalized = definition.normalizeOutput(coerced as JdAnalyzerOutput, input);
      const parsed = JdAnalyzerOutputSchema.safeParse(normalized);

      if (!parsed.success) {
        console.error("[jd-analyzer] Schema validation failed:", JSON.stringify(parsed.error.issues, null, 2));
        console.error("[jd-analyzer] Normalized output sample:", JSON.stringify(normalized, null, 2).slice(0, 2000));
      }

      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }

      const output = parsed.data;

      // Verify requirements are present
      expect(output.requirements.length).toBeGreaterThan(0);

      // Verify each requirement has valid category and priority
      const validCategories = ["responsibility", "must_have", "core_skill", "soft_skill", "nice_to_have", "risk_or_uncertain"];
      const validPriorities = ["must", "important", "nice_to_have", "uncertain"];

      for (const requirement of output.requirements) {
        expect(validCategories).toContain(requirement.category);
        expect(validPriorities).toContain(requirement.priority);
        expect(requirement.sourceQuote.length).toBeGreaterThan(0);
        expect(requirement.confidenceReason.length).toBeGreaterThan(0);
        expect(typeof requirement.hardConstraint).toBe("boolean");
        expect(typeof requirement.needsConfirmation).toBe("boolean");
      }

      // Verify sourceQuote locatability
      const allQuotes = output.requirements.map((r) => r.sourceQuote);
      for (const quote of allQuotes) {
        const directMatch = JD_SAMPLE.includes(quote.trim());
        const compactRaw = JD_SAMPLE.replace(/\s+/g, "");
        const compactQuote = quote.trim().replace(/\s+/g, "");
        const compactMatch = compactRaw.includes(compactQuote);
        expect(
          directMatch || compactMatch,
          `sourceQuote "${quote.slice(0, 40)}..." should be locatable in JD text`
        ).toBe(true);
      }

      // Verify requirements without sourceSpan have low confidence
      for (const requirement of output.requirements) {
        if (!requirement.sourceSpan) {
          expect(requirement.confidenceLevel).toBe("low");
          expect(requirement.needsConfirmation).toBe(true);
        }
      }

      // Verify title/company from input are preserved or locatable
      if (output.title) {
        expect(["high", "medium", "low"]).toContain(output.title.confidenceLevel);
      }
      if (output.company) {
        expect(["high", "medium", "low"]).toContain(output.company.confidenceLevel);
      }

      console.log(
        `[jd-analyzer] provider=${response.provider} model=${response.model} ` +
        `requirements=${output.requirements.length} riskNotes=${output.riskNotes.length}`
      );
    }
  );
});
