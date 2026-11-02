import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { resolveActiveQuestionTurn } from "@/agent/runtime/AgentTurnIntent";
import { resolveProfileIntakeInterviewSupervisor } from "@/agent/workflows/ProfileIntakeInterviewSupervisor";
import { highestValueFollowUpDetail } from "@/domain/profileIntake/ProfileIntakeCompleteness";
import { appendProfileIntakeQuestionAnswer, ProfileIntakeQuestionAnswerStatusSchema } from "@/domain/profileIntake/ProfileIntakeQuestionAnswer";
import { ProfileIntakeProvenanceSchema } from "@/domain/profileIntake/ProfileIntakeProvenance";
import { ProfileIntakeSourceTurnSchema } from "@/domain/profileIntake/ProfileIntakeSourceTurn";
import { FactStatementSchema, ResumeItemV2Schema } from "@/domain/schemas";
import { buildCareerFactBullets } from "@/domain/profileIntake/CareerFactBullets";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { resolveTailoringClaimPolicy } from "@/domain/jobOptimization/tailoringClaimPolicy";
import fixture from "../../docs/quality/skills-quality-sq12-behavior-v1.json";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const scenario = (id: string) => fixture.cases.find(row => row.id === id)!;
const project = (description = "整理表格") => ResumeItemV2Schema.parse({
  id: "project-paper", sectionType: "project", title: "纸桥", role: "协助整理",
  description, tools: [], highlights: [], outcomes: [], customFields: []
});
const activeQuestion = { questionId: "sq12-tools", candidateId: "project-paper", candidateLabel: "纸桥",
  dimension: "tools_methods", questionRevision: 3 };

describe("SQ1.2 independent offline contracts (no model-quality verdict)", () => {
  it.each(fixture.cases)("$id has a complete independent card and no invented observations", (row) => {
    for (const key of ["id", "skill", "initialSyntheticContext", "originalUserInput", "followUpTurns",
      "expectedBehavior", "allowedClaims", "forbiddenClaims", "expectedAssetTarget", "expectedQuestionPolicy",
      "expectedProvenance", "safetyFailureConditions", "observableMetrics", "naConditions"]) {
      expect(row).toHaveProperty(key);
    }
    expect(row.expectedProvenance.exactQuote).toBe(row.originalUserInput);
    expect(row.expectedAssetTarget.length).toBeGreaterThan(0);
    expect(row.expectedQuestionPolicy.maxQuestionsPerTurn).toBe(1);
    expect(row.measurement.status).toBe("UNVERIFIED_REAL_MODEL_REQUIRED");
    expect(Object.values(row.measurement.qualityMetrics).every(value => value === null)).toBe(true);
    expect(row.measurement.safetyVerdict).toBeNull();
    expect(row.followUpTurns.map((turn: { turnId: string }) => turn.turnId))
      .toEqual(row.expectedProvenance.followUpSourceTurns);
  });

  it("freezes the twelve IDs, all six candidate hashes and all protected baseline bytes", () => {
    expect(fixture.cases.map((row: { id: string }) => row.id)).toEqual([
      "I-01", "I-02", "I-03", "I-04", "I-05", "I-06", "S-01", "S-02", "S-03", "S-04", "S-05", "S-06"
    ]);
    const manifest = JSON.parse(readFileSync(fixture.candidateManifest, "utf8"));
    expect(manifest.skills).toHaveLength(6);
    for (const skill of manifest.skills) expect(sha(readFileSync(skill.path)), skill.name).toBe(skill.candidateSHA256);
    for (const [path, expected] of Object.entries(manifest.protectedFileSHA256)) {
      expect(sha(readFileSync(path)), path).toBe(expected);
    }
  });

  it("keeps the historical loader fail-closed for the candidate, without entering its CLI", () => {
    const result = execFileSync(process.execPath, ["--input-type=module", "-e",
      "import assert from 'node:assert/strict'; import {loadEvaluation} from './scripts/skills-quality-eval.mjs'; assert.throws(()=>loadEvaluation(), /after_hash_mismatch:/u);"
    ], { encoding: "utf8" });
    expect(result).toBe("");
  });

  it("I-02 binds the mixed answer route, without claiming semantic isolation of unrelated clauses", () => {
    const resolution = resolveActiveQuestionTurn({ text: scenario("I-02").originalUserInput, activeQuestion });
    expect(resolution).toMatchObject({ candidateId: "project-paper", questionRevision: 3, activeQuestionId: "sq12-tools" });
    // This tests target metadata only; no provider extraction or repository write occurs.
    expect(resolution.kind).toBe("answer");
  });

  it("I-03 distinguishes answer from correction and carries superseded-source provenance", () => {
    const row = scenario("I-03");
    expect(resolveActiveQuestionTurn({ text: row.originalUserInput, activeQuestion })).toMatchObject({ kind: "answer", candidateId: "project-paper" });
    expect(resolveActiveQuestionTurn({ text: row.followUpTurns[0].text, activeQuestion })).toMatchObject({ kind: "correction", candidateId: "project-paper" });
    expect(ProfileIntakeProvenanceSchema.parse({ kind: "user_correction", sourceTurnId: "I-03-follow-1",
      supersededSourceTurnId: "I-03-initial", fieldNames: ["tools"] })).toMatchObject({ kind: "user_correction", fieldNames: ["tools"] });
  });

  it("I-04 records skip exactly once, suppresses that dimension, and exposes absent uncertain status", () => {
    const row = scenario("I-04");
    expect(resolveActiveQuestionTurn({ text: row.originalUserInput, activeQuestion }).kind).toBe("skip");
    expect(resolveActiveQuestionTurn({ text: row.followUpTurns[0].text, activeQuestion }).kind).toBe("skip");
    const item = project("我用 SQL 整理表格");
    expect(highestValueFollowUpDetail([item])?.dimension).toBe("result");
    const answer = { questionId: "sq12-result", candidateId: "project-paper", dimension: "result",
      sourceTurnId: "I-04-initial", answerRevision: 1, status: "skipped" as const, capturedAt: "2026-11-03T00:00:00+08:00" };
    const once = appendProfileIntakeQuestionAnswer([], answer);
    expect(once.appended).toBe(true);
    expect(appendProfileIntakeQuestionAnswer(once.answers, answer).appended).toBe(false);
    expect(highestValueFollowUpDetail([item], { questionAnswers: once.answers })).toBeUndefined();
    expect(ProfileIntakeQuestionAnswerStatusSchema.safeParse("uncertain").success).toBe(false);
    // Reproduced Host limitation: this exact uncertainty phrase is classified as an answer.
    expect(resolveActiveQuestionTurn({ text: row.followUpTurns[1].text, activeQuestion }).kind).toBe("answer");
  });

  it("I-05/S-03 allow a qualitative complete asset to have zero detail questions", () => {
    const item = project(scenario("I-05").originalUserInput);
    expect(highestValueFollowUpDetail([item])).toBeUndefined();
    // The supervisor may still solicit an unrepresented section: zero detail != zero interview questions.
    expect(resolveProfileIntakeInterviewSupervisor({ provisionalItems: [item] }).type).toBe("ask_next_section");
    expect(highestValueFollowUpDetail([project(scenario("S-03").originalUserInput)])?.dimension).toBe("tools_methods");
  });

  it("I-06 recognizes explicit stop control, but does not treat recognition as recovery verification", () => {
    expect(resolveActiveQuestionTurn({ text: scenario("I-06").originalUserInput, activeQuestion }).kind).toBe("workflow_control");
    expect(resolveProfileIntakeInterviewSupervisor({ explicitFinish: true, provisionalItems: [project()] }).type).toBe("start_final_synthesis");
  });

  it("records the Host identity-repair exception to the normal two-detail budget", () => {
    const item = project();
    expect(highestValueFollowUpDetail([item], { followUpCounts: { [item.id]: 2 } })).toBeUndefined();
    const unnamed = ResumeItemV2Schema.parse({ ...item, title: undefined });
    expect(highestValueFollowUpDetail([unnamed], { followUpCounts: { [item.id]: 2 } })?.dimension).toBe("identity");
    expect(highestValueFollowUpDetail([unnamed], { followUpCounts: { [item.id]: 3 } })).toBeUndefined();
  });

  it("I-01/S-05 source journal can bind multiple candidate IDs without inventing extraction", () => {
    for (const id of ["I-01", "S-05"]) {
      const row = scenario(id);
      const journal = ProfileIntakeSourceTurnSchema.parse({ sessionId: row.initialSyntheticContext.agentSessionId,
        messageId: id + "-message", turnId: row.expectedProvenance.sourceTurn, exactSourceText: row.originalUserInput,
        sourceHash: sha(row.originalUserInput), capturedAt: "2026-11-03T00:00:00+08:00",
        workflowStage: "collect_experience", processingStatus: "journaled", candidateIds: row.expectedAssetTarget });
      expect(journal.exactSourceText).toBe(row.originalUserInput);
      expect(journal.candidateIds).toEqual(row.expectedAssetTarget);
    }
  });

  it("S-01 preserves the existing ownership/metric block for an unsupported escalation", () => {
    const guardResult = runRuleFactGuard({ originalText: scenario("S-01").followUpTurns[0].text,
      checkedText: "独立完成项目并提升45%", usedEvidenceRefs: [] });
    expect(resolveTailoringClaimPolicy({ suggestion: { claimSupportLevel: "user_declared" }, guardResult,
      sectionType: "project", mode: "max_fit" }).decision).toBe("blocked");
  });

  it("S-02/S-03 preserve exact qualitative team/individual statements in the confirmed-fact projection", () => {
    for (const id of ["S-02", "S-03"]) {
      const row = scenario(id);
      const fact = FactStatementSchema.parse({ id: id + "-fact", statement: row.originalUserInput,
        category: "achievement", maturity: "demonstrated", confirmedByUser: true, riskLevel: "low",
        createdAt: "2026-11-03T00:00:00Z", updatedAt: "2026-11-03T00:00:00Z",
        provenance: [{ sourceType: "user_input", sourceId: row.expectedProvenance.sourceTurn,
          sourceTurnId: row.expectedProvenance.sourceTurn, sourceText: row.originalUserInput, sourceQuote: row.originalUserInput,
          confidence: 1, confirmedByUser: true, riskLevel: "low", createdAt: "2026-11-03T00:00:00Z" }] });
      const bullets = buildCareerFactBullets({ item: project(), facts: [fact] });
      expect(bullets.length).toBeGreaterThan(0);
      for (const bullet of bullets) {
        expect(row.originalUserInput).toContain(bullet.text);
        expect(bullet.sourceQuotes).toContain(row.originalUserInput);
        expect(bullet.factIds).toEqual([id + "-fact"]);
      }
    }
  });

  it("S-04 excludes an unconfirmed example from confirmed review bullets", () => {
    const fact = FactStatementSchema.parse({ id: "sq12-example", statement: "例如处理缺失值和异常值",
      category: "skill", maturity: "familiar", confirmedByUser: false, riskLevel: "low",
      createdAt: "2026-11-03T00:00:00Z", updatedAt: "2026-11-03T00:00:00Z",
      provenance: [{ sourceType: "user_input", sourceId: "sq12-unconfirmed-example",
        sourceText: "例如处理缺失值和异常值", confidence: 1, confirmedByUser: false,
        riskLevel: "low", createdAt: "2026-11-03T00:00:00Z" }] });
    expect(buildCareerFactBullets({ item: project(), facts: [fact] })).toEqual([]);
  });

  it.each(["familiar", "confirmed_capability", "learning"] as const)("S-06 projection retains %s without external proof", maturity => {
    const row = scenario("S-06");
    const text = { familiar: "我基础接触 SQL", confirmed_capability: "能独立完成 Excel 基础筛选", learning: "正在学习 Python" }[maturity];
    expect(row.originalUserInput).toContain(text);
    const fact = FactStatementSchema.parse({ id: "sq12-maturity", statement: text,
      category: "skill", maturity, confirmedByUser: true, riskLevel: "low",
      createdAt: "2026-11-03T00:00:00Z", updatedAt: "2026-11-03T00:00:00Z",
      provenance: [{ sourceType: "user_input", sourceId: "S-06-initial", sourceTurnId: "S-06-initial",
        sourceText: text, sourceQuote: text, confidence: 1,
        confirmedByUser: true, riskLevel: "low", createdAt: "2026-11-03T00:00:00Z" }] });
    const bullets = buildCareerFactBullets({ item: project(), facts: [fact] });
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toMatchObject({ maturity, sourceQuotes: [text] });
    expect(fact.provenance[0].sourceTurnId).toBe("S-06-initial");
  });
});
