import type { AgentSession } from "@/agent/contracts/agentSession";
import type { AgentPageContext } from "@/agent/contracts/agentContext";
import type { AgentMemoryContext } from "./AgentMemoryManager";
import type { AgentSkill } from "./AgentSkillRegistry";
import { capabilityManifestForPrompt } from "@/agent/capabilities/AgentProductCapabilityManifest";

export class AgentContextAssembler {
  assemble(input: {
    session: AgentSession;
    pageContext: AgentPageContext;
    userMessage: string;
    memory: AgentMemoryContext;
    activeSkills: AgentSkill[];
  }) {
    const workflow = input.session.workflowState;
    const task = input.session.taskState;
    return [
      "Tier 1 — stable policy",
      "You are CareerAdapt AI, a career orchestration agent over existing domain tools.",
      "CareerProfile and FactProvenance are authoritative career memory. Never invent or silently upgrade facts, dates, metrics, titles, proficiency, salary, or years of experience.",
      "Never claim that a profile, resume, or job is absent without using the corresponding read tool in this turn.",
      "Use MINIMUM SUFFICIENT ACTION: choose the lowest-cost path that can correctly answer the latest request. Greetings, thanks, and casual acknowledgements use no domain tools.",
      "For identity questions, use the active profile pointer when present; otherwise resolve the active profile, then read only that profile.",
      "Canonical entity fields returned by tools are exact strings. Never shorten, nickname, translate, normalize, paraphrase, or autocorrect a person name, school, company, job title, project title, email, phone, URL, date, or numeric result unless the user explicitly asks.",
      "Do not address the user by name in casual greetings unless it is needed for the task.",
      "Natural-language task intent is Agent-led. Do not open a manual panel unless the user explicitly asks for a form/window or structured review materially improves safety.",
      "For application intent without a pasted JD, inspect only saved-job availability, then ask whether to continue an existing job or add a new one. Do not preload profile or resumes.",
      "When the latest turn contains a complete JD, call parse_job_description with rawText immediately, present its semantic review artifact, ask only for missing title/company, and require confirmation before commit_job.",
      "After a confirmed or rejected action, treat the authoritative observation as the next loop input and continue automatically.",
      "Write tools must stop at their confirmation boundary. Never expose hidden reasoning, raw planner JSON, schemas, operation IDs, or engineering tool names.",
      "",
      "Tier 2 — task",
      JSON.stringify({
        workflowId: task?.workflowId ?? workflow.workflowId,
        step: task?.stage ?? workflow.step,
        status: task?.completionStatus ?? workflow.status,
        requiredSlots: task?.requiredSlots ?? [],
        taskState: task
            ? {
              rootGoal: task.rootGoal,
              activeGoal: task.activeGoal,
              stage: task.stage,
              requiredSlots: task.requiredSlots,
              knownSlots: promptKnownSlots(task.knownSlots),
              missingSlots: task.missingSlots,
              selectedEntities: task.selectedEntities,
              pendingDecision: task.pendingDecision,
              dependencySnapshots: task.dependencySnapshots,
              completionStatus: task.completionStatus,
              computeTier: task.computeTier
            }
          : undefined,
        activeSkills: input.activeSkills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          procedure: skill.procedure,
          factRules: skill.factRules,
          confirmationBoundaries: skill.confirmationBoundaries
        }))
      }),
      "",
      "Tier 3 — memory pointers (not a copy of CareerProfile)",
      JSON.stringify(input.memory),
      "Conversation summary:",
      input.session.conversationSummary,
      "",
      "Tier 4 — volatile context",
      JSON.stringify({ pageContext: input.pageContext, latestUserTurn: input.userMessage }),
      "Product capability manifest (authoritative; do not claim unlisted formats or features):",
      JSON.stringify(capabilityManifestForPrompt()),
      "",
      "Return a concise user-visible final answer in the user's language, or use the allowed tools. Use tools autonomously when facts are needed."
    ].join("\n");
  }
}

function promptKnownSlots(slots: Record<string, unknown>) {
  const retained = [
    "title",
    "company",
    "sourceRoute",
    "recommendedResumeId",
    "confirmedRequirementIds",
    "previewComplete",
    "confirmationAccepted"
  ];
  const compact = Object.fromEntries(
    retained.flatMap((key) => slots[key] === undefined ? [] : [[key, slots[key]]])
  );
  const sourceRecommendation = objectValue(slots.sourceRecommendation);
  if (Object.keys(sourceRecommendation).length) {
    compact.sourceRecommendation = {
      route: sourceRecommendation.route,
      reason: sourceRecommendation.reason,
      resumeId: sourceRecommendation.resumeId
    };
  }
  const currentClarification = compactClarification(slots.currentClarification);
  if (currentClarification) compact.currentClarification = currentClarification;
  const qualityResult = objectValue(slots.qualityResult);
  if (Object.keys(qualityResult).length) {
    compact.qualityResult = {
      status: qualityResult.status,
      score: qualityResult.score,
      summary: qualityResult.summary
    };
  }
  const session = objectValue(slots.tailoringSession);
  const plan = objectValue(session.plan);
  if (Object.keys(session).length) {
    const questions = Array.isArray(plan.clarificationQuestions)
      ? plan.clarificationQuestions.map(compactClarification).filter(Boolean)
      : [];
    const answers = Array.isArray(plan.clarificationAnswers)
      ? plan.clarificationAnswers.map((answer) => {
        const value = objectValue(answer);
        return {
          questionId: value.questionId,
          status: value.status,
          requirementIds: stringArray(value.requirementIds)
        };
      })
      : [];
    compact.tailoringSession = {
      id: session.id,
      profileId: objectValue(session.profile).id,
      resumeId: objectValue(session.branch).id,
      resumeRevisionId: objectValue(session.branch).currentRevisionId,
      jobId: objectValue(session.job).id,
      clarificationQuestions: questions,
      clarificationAnswers: answers,
      diffCount: Array.isArray(slots.selectedDiffs) ? slots.selectedDiffs.length : 0,
      note: "The runtime binds the authoritative persisted session and selected diffs to the next tailoring tool call."
    };
  }
  return compact;
}

function compactClarification(value: unknown) {
  const item = objectValue(value);
  if (!Object.keys(item).length) return undefined;
  return {
    id: item.id,
    question: item.question,
    answerType: item.answerType,
    requirementIds: stringArray(item.requirementIds)
  };
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
