import type { ResumeItemV2 } from "@/domain/schemas";
import { highestValueFollowUpDetail } from "@/domain/profileIntake/ProfileIntakeCompleteness";
import type { ProfileIntakeNextTurnPlan } from "@/domain/profileIntake/ProfileIntakeNextTurnPlan";

export type ProfileIntakeInterviewSupervisorAction =
  | {
      type: "ask_follow_up";
      question: string;
      candidateId?: string;
      candidateLabel?: string;
      sectionType?: ResumeItemV2["sectionType"];
      dimension?: string;
      action?: "ask_follow_up";
      acknowledgement?: string;
      capturedAssetLabels?: string[];
    }
  | { type: "ask_next_section"; section: string; question: string; action?: "ask_next_section" }
  | { type: "wait_for_candidate_review"; question: string }
  | { type: "offer_finish"; question: string; action?: "offer_finish" }
  | { type: "start_final_synthesis" }
  | { type: "commit" };

export type ProfileIntakeInterviewSupervisorInput = {
  acceptedItems?: ResumeItemV2[];
  provisionalItems?: ResumeItemV2[];
  activeQuestion?: {
    id?: string;
    candidateId: string;
    candidateLabel?: string;
    sectionType?: ResumeItemV2["sectionType"];
    dimension?: string;
    question: string;
  };
  unresolvedCandidateIds?: string[];
  suggestedNextSections?: string[];
  requestedSection?: string;
  explicitFinish?: boolean;
  followUpCounts?: Record<string, number>;
  acknowledgement?: string;
  capturedAssetLabels?: string[];
};

/**
 * The interview supervisor owns only the next conversational action. It does
 * not persist facts and never decides that an unreviewed candidate is safe.
 */
export class ProfileIntakeInterviewSupervisor {
  resolve(input: ProfileIntakeInterviewSupervisorInput): ProfileIntakeInterviewSupervisorAction {
    if (input.explicitFinish) {
      // Compatibility for persisted P4.3g callers.  The current host always
      // passes provisionalItems and therefore enters synthesis instead.
      return input.provisionalItems ? { type: "start_final_synthesis" } : { type: "commit" };
    }
    if (input.unresolvedCandidateIds?.length && !input.provisionalItems) {
      return {
        type: "wait_for_candidate_review",
        question: "先核对上面的经历卡片；确认或忽略后，我再继续整理下一段。"
      };
    }
    if (input.activeQuestion?.question && input.activeQuestion.candidateId) {
      const candidate = input.provisionalItems?.find((item) => item.id === input.activeQuestion?.candidateId);
      const candidateLabel = input.activeQuestion.candidateLabel
        ?? (candidate ? profileIntakeItemLabel(candidate) : undefined);
      const question = targetQuestion(input.activeQuestion.question, candidateLabel);
      return {
        type: "ask_follow_up",
        question,
        candidateId: input.activeQuestion.candidateId,
        candidateLabel,
        sectionType: input.activeQuestion.sectionType,
        dimension: input.activeQuestion.dimension,
        action: "ask_follow_up",
        acknowledgement: input.acknowledgement,
        capturedAssetLabels: input.capturedAssetLabels
      };
    }
    const items = input.provisionalItems?.length ? input.provisionalItems : input.acceptedItems ?? [];
    const followUp = items.length
      ? highestValueFollowUpDetail(items, { followUpCounts: input.followUpCounts })
      : undefined;
    if (followUp) {
      const candidate = followUp.item;
      const candidateLabel = profileIntakeItemLabel(candidate);
      return {
        type: "ask_follow_up",
        question: targetQuestion(followUp.question, candidateLabel),
        candidateId: candidate.id,
        candidateLabel,
        sectionType: candidate.sectionType,
        dimension: followUp.dimension,
        action: "ask_follow_up" as const
      };
    }
    const section = input.requestedSection
      ?? input.suggestedNextSections?.[0]
      ?? nextMissingSection(items);
    if (section) {
      if (section === "finish") {
        return {
          type: "offer_finish",
          question: "目前没有必须补充的栏目了。你可以继续补充其他经历，或选择完成整理。",
          action: "offer_finish"
        };
      }
      return {
        type: "ask_next_section",
        section,
        question: sectionQuestion(section)
      };
    }
    return {
      type: "offer_finish",
      question: "目前没有必须补充的栏目了。你可以继续补充其他经历，或选择完成整理。"
    };
  }
}

function nextMissingSection(items: ResumeItemV2[]) {
  const covered = new Set(items.map((item) => item.sectionType));
  return (["internship", "project", "campus", "skills", "awards", "certificates"] as const)
    .find((section) => !covered.has(section));
}

export function resolveProfileIntakeInterviewSupervisor(
  input: ProfileIntakeInterviewSupervisorInput
) {
  return new ProfileIntakeInterviewSupervisor().resolve(input);
}

export function sectionQuestion(section: string) {
  const questions: Record<string, string> = {
    project: "接下来介绍一段项目经历吧。先说名称、你的角色和主要工作即可。",
    internship: "接下来介绍一段实习经历吧。先说公司、你的角色和主要工作即可。",
    work: "接下来介绍一段工作经历吧。先说公司、你的角色和主要工作即可。",
    research: "接下来介绍一段研究经历吧。先说课题、你的角色和主要工作即可。",
    campus: "接下来介绍一段校园经历吧。先说活动或组织、你的角色和主要工作即可。",
    volunteer: "接下来介绍一段志愿经历吧。先说项目、你的角色和主要工作即可。",
    skills: "接下来补充你的技能吧。先说最熟悉的工具、技术或方法即可。",
    awards: "接下来补充一项奖项或成果吧。先说名称和获得时间即可。",
    certificates: "接下来补充一项证书吧。先说证书名称和获得时间即可。",
    languages: "接下来补充语言能力吧。先说语种和熟练程度即可。"
  };
  return questions[section] ?? `接下来补充一段${section}经历吧。先说名称、你的角色和主要工作即可。`;
}

/**
 * A follow-up is not allowed to rely on an unbound pronoun when more than one
 * asset is in the provisional draft.  Keep the original wording intact and
 * add the target identity at the boundary so the model never has to resolve
 * it from the full conversation again.
 */
export function targetQuestion(question: string, candidateLabel?: string) {
  const text = question.trim();
  const label = candidateLabel?.trim();
  if (!text || !label || text.includes(label)) return text;
  return `在“${label}”中，${text}`;
}

export function profileIntakeItemLabel(item: ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  const value = item.sectionType === "education"
    ? item.school
    : item.sectionType === "awards" || item.sectionType === "certificates" || item.sectionType === "skills"
      ? record.name
      : item.sectionType === "languages"
        ? record.language
        : ["work", "internship", "campus", "volunteer"].includes(item.sectionType)
          ? record.organization
          : record.title;
  return typeof value === "string" && value.trim() ? value.trim() : `待补充${item.sectionType}经历`;
}

export function nextTurnPlanFromSupervisorAction(
  action: ProfileIntakeInterviewSupervisorAction
): ProfileIntakeNextTurnPlan {
  if (action.type === "ask_follow_up") {
    const sectionType = action.sectionType === "summary"
      ? undefined
      : action.sectionType as NonNullable<ProfileIntakeNextTurnPlan["sectionType"]> | undefined;
    return {
      action: "ask_follow_up",
      candidateId: action.candidateId,
      candidateLabel: action.candidateLabel,
      sectionType,
      dimension: action.dimension,
      question: action.question,
      acknowledgement: action.acknowledgement,
      capturedAssetLabels: action.capturedAssetLabels ?? []
    };
  }
  if (action.type === "ask_next_section") {
    const sectionType = action.section === "basics" || action.section === "summary" || action.section === "finish"
      ? undefined
      : action.section as NonNullable<ProfileIntakeNextTurnPlan["sectionType"]>;
    return {
      action: "ask_next_section",
      ...(sectionType ? { sectionType } : {}),
      question: action.question,
      capturedAssetLabels: []
    };
  }
  if (action.type === "offer_finish") return { action: "offer_finish", question: action.question, capturedAssetLabels: [] };
  if (action.type === "start_final_synthesis") return { action: "start_final_synthesis", capturedAssetLabels: [] };
  if (action.type === "wait_for_candidate_review") return { action: "report_recoverable_failure", question: action.question, capturedAssetLabels: [] };
  return { action: "report_recoverable_failure", capturedAssetLabels: [] };
}
