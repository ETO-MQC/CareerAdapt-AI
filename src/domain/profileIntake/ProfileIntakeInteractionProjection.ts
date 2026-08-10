import type { ResumeItemV2 } from "@/domain/schemas";
import {
  buildCareerInteractionPlan,
  type CareerInteractionKnownContext,
  type CareerInteractionPlan,
  type CareerInformationNeedDraft
} from "@/domain/careerInteraction/CareerInteractionPlan";
import {
  assessCareerAssetCompleteness,
  createProfileIntakeInterviewPlan,
  type ProfileIntakeCompletenessOptions,
  type ProfileIntakeInterviewPlan
} from "./ProfileIntakeCompleteness";

export function buildProfileIntakeInteractionPlan(input: {
  items: ResumeItemV2[];
  interviewPlan?: ProfileIntakeInterviewPlan;
  options?: ProfileIntakeCompletenessOptions;
  knownContext?: Partial<CareerInteractionKnownContext>;
}) : CareerInteractionPlan {
  const options = input.options ?? {};
  const interviewPlan = input.interviewPlan ?? createProfileIntakeInterviewPlan(input.items, 0, options);
  const answered = new Set((options.questionAnswers ?? []).map((answer) => `${answer.candidateId}::${answer.dimension}`));
  const needs: CareerInformationNeedDraft[] = input.items.flatMap((item) => {
    const assessment = assessCareerAssetCompleteness(item, options.sourceEvidenceByCandidate?.[item.id] ?? []);
    const dimension = assessment.missing.find((candidate) => candidate === interviewPlan.activeQuestion?.dimension)
      ?? assessment.missing.find((candidate) => !["challenge", "scope", "collaboration"].includes(candidate));
    if (!dimension) return [];
    const identity = displayIdentity(item);
    const alreadyAsked = answered.has(`${item.id}::${dimension}`);
    return [{
      id: `profile-intake:${item.id}:${dimension}`,
      type: isOptionalDimension(dimension) ? "optional_enrichment" as const : "factual_gap" as const,
      targetAssetId: item.id,
      dimension,
      importance: assessment.informationGain,
      reason: assessment.nextQuestion ?? `“${identity}”仍有一项事实需要核对。`,
      answerChangesOutcome: assessment.informationGain > 0,
      required: false,
      alreadyAsked,
      priorityFactors: {
        ...assessment.priorityFactors,
        alreadyAskedPenalty: alreadyAsked ? 1 : 0
      }
    }];
  });
  const question = interviewPlan.activeQuestion;
  return buildCareerInteractionPlan({
    workflow: "guided_profile_intake",
    objective: "把真实经历整理成可复用、可核验的职业资产",
    knownContext: input.knownContext,
    informationNeeds: needs,
    ...(question?.question ? {
      recommendedNextQuestion: {
        needId: `profile-intake:${question.candidateId}:${question.dimension}`,
        question: question.question,
        targetAssetId: question.candidateId,
        dimension: question.dimension
      }
    } : {}),
    canProceedWithoutQuestion: true,
    ...(question ? {} : { stopReason: "当前没有会明显改变整理结果的未解决问题。" }),
    interactionSummary: input.items.length
      ? `已识别 ${input.items.length} 项经历；问题只会围绕能明显改善职业表达的事实提出。`
      : "还没有足够的职业经历可供整理。",
    careerAssetState: interviewPlan.careerAssetState
  });
}

function isOptionalDimension(dimension: string) {
  return ["challenge", "scope", "collaboration", "coursework_honors", "publication", "credential_status", "test_score"].includes(dimension);
}

function displayIdentity(item: ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  const value = item.sectionType === "education"
    ? item.school ?? item.major
    : item.sectionType === "skills"
      ? item.name
      : item.sectionType === "languages"
        ? item.language
        : ["work", "internship", "campus", "volunteer"].includes(item.sectionType)
          ? record.organization
          : record.title ?? record.name;
  return typeof value === "string" && value.trim() ? value.trim() : `待补充${item.sectionType}经历`;
}

