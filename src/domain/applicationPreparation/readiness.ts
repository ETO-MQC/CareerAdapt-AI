import {
  ApplicationPreparationChecklistSchema,
  type ApplicationPreparationChecklist,
  type ApplicationPreparationChecklistItem,
  type ApplicationPreparationPack,
  type BaseApplicationMaterial
} from "@/domain/schemas";

export function computeApplicationPreparationChecklist(
  pack: ApplicationPreparationPack,
  now = new Date().toISOString()
): ApplicationPreparationChecklist {
  const coverLetters = Object.values(pack.materials.coverLetters).filter(Boolean);
  const emails = Object.values(pack.materials.applicationEmails).filter(Boolean);
  const introductions = Object.values(pack.materials.selfIntroductions).filter(Boolean);
  const questions = pack.materials.interviewQuestions;
  const stories = pack.materials.starStories;
  const openGaps = pack.factGaps.filter((gap) => gap.status === "open");
  const items: ApplicationPreparationChecklistItem[] = [
    summarizeGroup("cover_letter", "求职信", coverLetters),
    summarizeGroup("application_email", "投递邮件草稿", emails),
    summarizeGroup("self_introduction", "中英文自我介绍", introductions),
    summarizeGroup("interview_questions", "面试问题", questions),
    summarizeGroup("star_story", "STAR 案例", stories),
    {
      id: "fact_gaps",
      label: "事实缺口",
      status: openGaps.length > 0 ? "draft" : "completed",
      level: openGaps.some((gap) => gap.missingFactType === "skill" || gap.missingFactType === "result" || gap.missingFactType === "metric")
        ? "needs_attention"
        : "ready",
      materialType: "fact_gap",
      message: openGaps.length > 0
        ? `${openGaps.length} 个事实缺口仍未处理。`
        : "当前材料没有未处理事实缺口。"
    }
  ];
  const level = items.some((item) => item.level === "blocked")
    ? "blocked"
    : items.some((item) => item.level === "needs_attention")
      ? "needs_attention"
      : "ready";

  return ApplicationPreparationChecklistSchema.parse({
    level,
    items,
    updatedAt: now
  });
}

export function withUpdatedApplicationPreparationChecklist(
  pack: ApplicationPreparationPack,
  now = new Date().toISOString()
): ApplicationPreparationPack {
  return {
    ...pack,
    checklist: computeApplicationPreparationChecklist(pack, now),
    updatedAt: now
  };
}

function summarizeGroup(
  id: string,
  label: string,
  materials: BaseApplicationMaterial[]
): ApplicationPreparationChecklistItem {
  if (materials.length === 0) {
    return {
      id,
      label,
      status: "not_started",
      level: "needs_attention",
      materialType: id,
      message: "尚未生成；这不会自动阻止投递，但建议按岗位需要准备。"
    };
  }
  if (materials.some((material) => material.status === "blocked" || material.guardStatus === "blocked")) {
    return {
      id,
      label,
      status: "blocked",
      level: "blocked",
      materialType: id,
      message: "存在被材料 Fact Guard 阻止的内容。"
    };
  }
  if (materials.some((material) => material.status === "stale")) {
    return {
      id,
      label,
      status: "stale",
      level: "needs_attention",
      materialType: id,
      message: "Application 版本或岗位要求变化后，已有材料需要重新生成或复核。"
    };
  }
  if (materials.every((material) => material.status === "completed" || material.status === "not_needed")) {
    return {
      id,
      label,
      status: "completed",
      level: "ready",
      materialType: id,
      message: "已完成或已明确标记不需要。"
    };
  }
  if (materials.some((material) => material.guardStatus === "needs_edit")) {
    return {
      id,
      label,
      status: "draft",
      level: "needs_attention",
      materialType: id,
      message: "草稿需要编辑后重新通过材料 Fact Guard。"
    };
  }
  return {
    id,
    label,
    status: "draft",
    level: "needs_attention",
    materialType: id,
    message: "已有草稿，等待用户核对并确认。"
  };
}
