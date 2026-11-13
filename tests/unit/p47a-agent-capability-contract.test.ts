import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HERMES_PRODUCTION_TOOL_PROFILE,
  HERMES_REQUIRED_CAREER_FACADES,
  hermesRegisteredCareerToolName
} from "@/agent/runtime/hermes/HermesCareerToolCatalog";
import { CAREER_WORKFLOW_FACADE_DEFINITIONS, prepareCareerWorkflowInvocation } from "@/agent/workflows/CareerWorkflowFacade";

const require = createRequire(import.meta.url);
const {
  addManagedCareerAdaptMcpServer,
  preserveUserHermesConfig
} = require("../../electron/hermesCompanion.js") as {
  addManagedCareerAdaptMcpServer: (preserved: string[], managedServer: string[]) => string[];
  preserveUserHermesConfig: (existing: string) => string[];
};

const skillRoot = resolve(process.cwd(), "skills/career");
const productionSkillNames = [
  "candidate-profile-interview",
  "career-story-mining",
  "job-fit-analysis",
  "resume-tailoring",
  "resume-review",
  "resume-composition"
] as const;

const productionAuditRows = [
  { stableName: "career.workflow.precise_edit", kind: "facade", readWrite: "read", skillOwner: "explicit field rewording", visible: true },
  { stableName: "career.workflow.material_intake", kind: "facade", readWrite: "write", skillOwner: "material intake", visible: true },
  { stableName: "career.workflow.job_intake", kind: "facade", readWrite: "write", skillOwner: "job intake", visible: true },
  { stableName: "career.context.retrieve", kind: "read", readWrite: "read", skillOwner: "career-story-mining / resume-review", visible: true },
  { stableName: "career.profile.get", kind: "read", readWrite: "read", skillOwner: "personal career Q&A", visible: true },
  { stableName: "career.resume.get", kind: "read", readWrite: "read", skillOwner: "selected resume detail", visible: true },
  { stableName: "career.job.get", kind: "read", readWrite: "read", skillOwner: "selected job detail", visible: true },
  { stableName: "career.resume.list", kind: "read", readWrite: "read", skillOwner: "resume-review", visible: true },
  { stableName: "career.job.list", kind: "read", readWrite: "read", skillOwner: "target selection", visible: true },
  { stableName: "career.workflow.profile_intake_turn", kind: "facade", readWrite: "write", skillOwner: "candidate-profile-interview", visible: true },
  { stableName: "career.workflow.profile_intake_finalize", kind: "facade", readWrite: "write", skillOwner: "candidate-profile-interview", visible: true },
  { stableName: "career.workflow.resume_import", kind: "facade", readWrite: "write", skillOwner: "resume import", visible: true },
  { stableName: "career.workflow.job_fit", kind: "facade", readWrite: "write", skillOwner: "job-fit-analysis", visible: true },
  { stableName: "career.workflow.tailor_resume", kind: "facade", readWrite: "write", skillOwner: "resume-tailoring", visible: true },
  { stableName: "career.workflow.compose_resume", kind: "facade", readWrite: "write", skillOwner: "resume-composition / resume-review", visible: true },
  { stableName: "career.workflow.resume_export", kind: "facade", readWrite: "write", skillOwner: "resume-review / export", visible: true }
] as const;

const skillRoutingFixtures = [
  { label: "greeting", text: "你好", skill: undefined, tools: [] },
  { label: "general advice", text: "大学生找工作应该怎么准备？", skill: undefined, tools: [] },
  { label: "personal career question", text: "根据我的经历，你觉得我适合哪些岗位？", skill: undefined, tools: ["career.profile.get"] },
  { label: "profile intake", text: "我没有简历，从零开始帮我做一份。", skill: "candidate-profile-interview", tools: ["career.workflow.profile_intake_turn"] },
  { label: "story mining", text: "我想把这个项目经历提炼成行动、方法和结果。", skill: "career-story-mining", tools: [] },
  { label: "job fit", text: "分析一下我和这个岗位匹不匹配。", skill: "job-fit-analysis", tools: ["career.workflow.job_fit"] },
  { label: "target tailoring", text: "根据这个 JD 帮我生成岗位简历。", skill: "resume-tailoring", tools: ["career.workflow.tailor_resume"] },
  { label: "general resume review", text: "帮我看看这份简历有什么问题。", skill: "resume-review", tools: ["career.workflow.compose_resume"] },
  { label: "general resume composition", text: "根据我的确认资料创建一份通用简历。", skill: "resume-composition", tools: ["career.workflow.compose_resume"] }
] as const;

function skillText(name: string) {
  return readFileSync(resolve(skillRoot, name, "SKILL.md"), "utf8");
}

function skillDescription(text: string) {
  return text.match(/^description:\s*(.+)$/mu)?.[1]?.trim() ?? "";
}

describe("P4.7a Agent capability contract", () => {
  it("keeps the exact production profile to facades plus the small read surface", () => {
    const expected = productionAuditRows.map((row) => row.stableName).sort();
    expect([...HERMES_PRODUCTION_TOOL_PROFILE].sort()).toEqual(expected);
    expect(HERMES_PRODUCTION_TOOL_PROFILE).toHaveLength(16);
    expect(HERMES_PRODUCTION_TOOL_PROFILE).not.toEqual(expect.arrayContaining([
      "career.system.runtime_status",
      "career.system.current_task",
      "career.system.last_failure"
    ]));
  });

  it("maps every production row to the exact Hermes registered name", () => {
    for (const row of productionAuditRows) {
      expect(hermesRegisteredCareerToolName(row.stableName)).toBe(
        `mcp__careeradapt__${row.stableName.replace(/[^A-Za-z0-9_]/gu, "_")}`
      );
      expect(row.visible).toBe(true);
    }
  });

  it("has six specific, distinguishable Skill routing descriptions", () => {
    const descriptions = Object.fromEntries(productionSkillNames.map((name) => [name, skillDescription(skillText(name))]));
    expect(Object.values(descriptions).every(Boolean)).toBe(true);
    expect(descriptions["candidate-profile-interview"]).toMatch(/CareerProfile/u);
    expect(descriptions["career-story-mining"]).toMatch(/one user-described career experience/u);
    expect(descriptions["job-fit-analysis"]).toMatch(/without creating or modifying a Resume/u);
    expect(descriptions["resume-tailoring"]).toMatch(/job-specific Resume/u);
    expect(descriptions["resume-review"]).toMatch(/existing general Resume/u);
    expect(descriptions["resume-composition"]).toMatch(/general\/base Resume/u);
    expect(new Set(Object.values(descriptions)).size).toBe(productionSkillNames.length);
  });

  it("contains no explicit Skill reference to an invisible or atomic Career tool", () => {
    const visibleRegistered = new Set(HERMES_PRODUCTION_TOOL_PROFILE.map((name) => hermesRegisteredCareerToolName(name)));
    const references = productionSkillNames.flatMap((name) => [...skillText(name).matchAll(/mcp__careeradapt__[A-Za-z0-9_]+/gu)].map((match) => ({ name, reference: match[0] })));
    expect(references.length).toBeGreaterThan(0);
    expect(references.filter(({ reference }) => !visibleRegistered.has(reference))).toEqual([]);
    expect(references.filter(({ reference }) => !reference.includes("__career_workflow_")
      && !reference.endsWith("__career_context_retrieve")
      && !reference.endsWith("__career_resume_list"))).toEqual([]);
  });

  it("describes each workflow facade as an intent boundary", () => {
    for (const definition of CAREER_WORKFLOW_FACADE_DEFINITIONS) {
      expect(definition.description).toMatch(/Use when/u);
      expect(definition.description).toMatch(/Do not use/u);
      expect(definition.description).toMatch(/Reads|writes/u);
      expect(definition.description).toMatch(/stop|stops|may stop/u);
    }
  });

  it("uses compose update_existing as the single existing-resume review capability", () => {
    expect(CAREER_WORKFLOW_FACADE_DEFINITIONS.some((definition) => definition.name === "career.workflow.review_resume")).toBe(false);
    const compose = CAREER_WORKFLOW_FACADE_DEFINITIONS.find((definition) => definition.name === "career.workflow.compose_resume");
    expect(compose?.description).toContain("update_existing");
    expect(skillText("resume-review")).toContain("mcp__careeradapt__career_workflow_compose_resume");
    expect(skillText("resume-review")).toContain("generalResumeMode: \"update_existing\"");
  });

  it("distinguishes natural multi-asset candidates from a bound targeted follow-up and Profile commit", () => {
    const intake = skillText("candidate-profile-interview").replace(/\s+/gu, " ");
    expect(intake).toContain("multiple career assets in a natural turn");
    expect(intake).toContain("single-asset follow-up, apply an answer or correction only to its bound asset/question revision");
    expect(intake).toContain("answered, skipped, and correction dispositions");
    expect(intake).toContain("multiple clearly identified assets is not a reason to stop");
    expect(intake).toContain("candidate patch, not a confirmed Profile commit");
    expect(intake).toContain("factual review and explicit user confirmation");
    expect(intake).not.toContain("the answer supports multiple assets, or");
  });

  it("accepts only available host evidence during review and never treats resume prose as confirmation", () => {
    const review = skillText("resume-review").replace(/\s+/gu, " ");
    expect(review).toContain("confirmed Profile facts, or explicit current-session confirmed skills with sourceTurn and maturity");
    expect(review).toContain("Resume text alone is a claim to assess, not independent confirmation");
    expect(review).toContain("unsupported objective facts as unsupported");
    expect(review).toContain("Do not claim to have read session evidence that the facade has not supplied");
    expect(review).toContain("Review-only never applies a proposal or writes formal Resume/Profile content");
    expect(review).toContain("without claiming formal Resume Review, tool execution, PDF extraction, or ATS parsing");
    expect(review).not.toContain("Profile evidence and provenance for every material included claim");
  });

  it("bounds composition overlay to skills and preserves maturity, sourceTurn and separate Profile approval", () => {
    const compose = skillText("resume-composition").replace(/\s+/gu, " ");
    expect(compose).toContain("existing host-supported session-confirmed skill overlay");
    expect(compose).toContain("model cannot submit or authorize its own sessionSource");
    expect(compose).toContain("with sourceTurn, quote, session/target binding and accurate maturity");
    expect(compose).toContain("Do not upgrade familiar, learning, or confirmed_capability into one another");
    expect(compose).toContain("Eligible skills default to resume_only");
    expect(compose).toContain("Profile synchronization remains a separate explicit reviewed action");
    expect(compose).toContain("This is not a general fact-writing channel");
    expect(compose).toContain("education, employers, dates, results, numbers and ownership still follow the existing fact confirmation policy");
    expect(compose).toContain("commits that checkpoint exactly; it must not invoke the Writer a second time");
  });

  it("makes the remaining Host-frozen budget authoritative without rebuilding its queue", () => {
    const tailor = skillText("resume-tailoring").replace(/\s+/gu, " ");
    expect(tailor).toContain("Host-frozen question plan is the execution boundary");
    expect(tailor).toContain("`steady`: zero, `competitive`: at most one, `max_fit`: at most three");
    expect(tailor).toContain("a Skill may tighten it, never expand or reopen it");
    expect(tailor).toContain("answered / skipped / uncertain ledger");
    expect(tailor).toContain("do not redesign the queue or repeat resolved questions");
    expect(tailor).toContain("stop optional questions and draft safely");
    expect(tailor).toContain("Wait for explicit approval before applying or exporting");
    expect(tailor).not.toContain("`competitive` asks at most two");
  });

  it("does not grant Job Fit the composition-only session skill overlay", () => {
    const input = { profileId: "profile-sq11", resumeId: "resume-sq11", jobId: "job-sq11" };
    const context = { sourceUserMessage: "我会 Python。", sourceUserMessageId: "message-sq11", logicalTurnId: "turn-sq11",
      careerSessionBinding: { agentSessionId: "session-sq11", personId: "person-sq11", profileId: input.profileId, profileRevision: 1, profileVersionNumber: 1 } };
    const prepared = prepareCareerWorkflowInvocation("career.workflow.job_fit", input, context, "fit-sq11");
    expect(prepared.input).toEqual(input);
    expect(prepared.context.sourceUserMessage).toBeUndefined();
    expect(prepared.context.compositionSourceTurn).toBeUndefined();
    expect(() => prepareCareerWorkflowInvocation("career.workflow.job_fit", {
      ...input, sessionSource: { sessionId: "session-sq11", turnId: "turn-sq11", exactSourceText: "我会 Python。" }
    }, context, "injected-fit-sq11")).toThrow();
  });

  it("keeps routing fixtures metadata-only and collision-free", () => {
    const ownedSkills = skillRoutingFixtures.flatMap((fixture) => fixture.skill ? [fixture.skill] : []);
    expect(new Set(ownedSkills).size).toBe(ownedSkills.length);
    expect(skillRoutingFixtures.find((fixture) => fixture.label === "greeting")?.tools).toEqual([]);
    expect(skillRoutingFixtures.find((fixture) => fixture.label === "general advice")?.tools).toEqual([]);
    expect(skillRoutingFixtures.find((fixture) => fixture.label === "target tailoring")?.tools).toEqual(["career.workflow.tailor_resume"]);
    expect(skillRoutingFixtures.find((fixture) => fixture.label === "general resume review")?.tools).toEqual(["career.workflow.compose_resume"]);
  });

  it("preserves a second user-owned MCP server beside managed CareerAdapt MCP", () => {
    const existing = [
      "mcp_servers:",
      "  calendar-test:",
      "    url: \"http://calendar.test/mcp\"",
      "    enabled: true",
      "  careeradapt:",
      "    url: \"http://old-careeradapt.test/mcp\"",
      "gateway:",
      "  user_setting: true",
      ""
    ].join("\n");
    const preserved = preserveUserHermesConfig(existing);
    expect(preserved).toContain("  calendar-test:");
    expect(preserved).not.toContain("  careeradapt:");
    const merged = addManagedCareerAdaptMcpServer(preserved, [
      "  careeradapt:",
      "    url: \"http://new-careeradapt.test/mcp\""
    ]);
    expect(merged.filter((line) => line === "mcp_servers:")).toHaveLength(1);
    expect(merged).toEqual(expect.arrayContaining([
      "  calendar-test:",
      "  careeradapt:",
      "    url: \"http://new-careeradapt.test/mcp\""
    ]));
  });

  it("keeps the canonical facade list free of a second semantic Agent or router", () => {
    expect(CAREER_WORKFLOW_FACADE_DEFINITIONS.some((definition) => definition.name === "career.workflow.profile_to_resume")).toBe(true);
    expect(HERMES_REQUIRED_CAREER_FACADES).toHaveLength(10);
    expect(HERMES_REQUIRED_CAREER_FACADES).not.toContain("career.workflow.profile_to_resume");
    expect(HERMES_REQUIRED_CAREER_FACADES.some((name) => /router|planner|agent|manager/u.test(name))).toBe(false);
  });
});
