import type { ResumeItemV2 } from "@/domain/schemas";
import { highestValueFollowUp } from "@/domain/profileIntake/ProfileIntakeCompleteness";

export type ProfileIntakeInterviewSupervisorAction =
  | { type: "ask_follow_up"; question: string; candidateId?: string }
  | { type: "ask_next_section"; section: string; question: string }
  | { type: "wait_for_candidate_review"; question: string }
  | { type: "offer_finish"; question: string }
  | { type: "start_final_synthesis" }
  | { type: "commit" };

export type ProfileIntakeInterviewSupervisorInput = {
  acceptedItems?: ResumeItemV2[];
  provisionalItems?: ResumeItemV2[];
  activeQuestion?: { id?: string; question: string };
  unresolvedCandidateIds?: string[];
  suggestedNextSections?: string[];
  requestedSection?: string;
  explicitFinish?: boolean;
  followUpCounts?: Record<string, number>;
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
    if (input.activeQuestion?.question) {
      return {
        type: "ask_follow_up",
        question: input.activeQuestion.question
      };
    }
    const items = input.provisionalItems?.length ? input.provisionalItems : input.acceptedItems ?? [];
    const followUp = items.length
      ? highestValueFollowUp(items, { followUpCounts: input.followUpCounts })
      : undefined;
    if (followUp) return { type: "ask_follow_up", question: followUp };
    const section = input.requestedSection
      ?? input.suggestedNextSections?.[0]
      ?? nextMissingSection(items);
    if (section) {
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
