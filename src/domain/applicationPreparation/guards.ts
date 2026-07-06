import {
  type ApplicationPreparationContext
} from "./context";
import {
  type ApplicationMaterialStatus,
  type BaseApplicationMaterial,
  type MaterialGuardStatus
} from "@/domain/schemas";
import { FACT_GUARD_VERSION, runRuleFactGuard } from "@/domain/adaptation/factGuard";

export type ApplicationMaterialGuardResult = {
  guardStatus: MaterialGuardStatus;
  guardReasons: string[];
  guardVersion: string;
  statusSuggestion?: ApplicationMaterialStatus;
};

export function runApplicationMaterialGuard(input: {
  context: ApplicationPreparationContext;
  content: unknown;
}): ApplicationMaterialGuardResult {
  const checkedText = materialContentToText(input.content);
  if (!checkedText.trim()) {
    return {
      guardStatus: "blocked",
      guardReasons: ["材料内容为空，无法完成事实检查。"],
      guardVersion: FACT_GUARD_VERSION,
      statusSuggestion: "blocked"
    };
  }
  const result = runRuleFactGuard({
    originalText: `${input.context.sourceTextBaseline}\n${materialNeutralBaseline(input.context)}`,
    checkedText,
    usedEvidenceRefs: input.context.evidenceRefs
  });
  if (result.status === "blocked_high_risk") {
    return {
      guardStatus: "blocked",
      guardReasons: result.ruleFindings.filter((finding) => !finding.allowed).map(formatFindingReason),
      guardVersion: result.guardVersion,
      statusSuggestion: "blocked"
    };
  }
  if (result.status === "needs_edit") {
    return {
      guardStatus: "needs_edit",
      guardReasons: result.ruleFindings.filter((finding) => !finding.allowed).map(formatFindingReason),
      guardVersion: result.guardVersion,
      statusSuggestion: "draft"
    };
  }
  return {
    guardStatus: "allowed",
    guardReasons: [],
    guardVersion: result.guardVersion
  };
}

function formatFindingReason(finding: { message: string; text: string }) {
  return `${finding.message}：${finding.text}`;
}

export function canCompleteMaterial(material: Pick<BaseApplicationMaterial, "status" | "guardStatus">) {
  return material.status !== "stale"
    && material.status !== "blocked"
    && material.guardStatus === "allowed";
}

export function materialContentToText(content: unknown): string {
  if (content === undefined || content === null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (typeof content === "number" || typeof content === "boolean") {
    return String(content);
  }
  if (Array.isArray(content)) {
    return content.map(materialContentToText).filter(Boolean).join("\n");
  }
  if (typeof content === "object") {
    return Object.entries(content as Record<string, unknown>)
      .filter(([key]) => !MATERIAL_TEXT_IGNORED_KEYS.has(key))
      .map(([, value]) => value)
      .map(materialContentToText)
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

const MATERIAL_TEXT_IGNORED_KEYS = new Set([
  "id",
  "requirementIds",
  "contentItemIds",
  "sourceContentItemIds",
  "evidenceRefs",
  "estimatedSeconds",
  "missingParts",
  "preparationStatus",
  "question",
  "whyAsked"
]);

function materialNeutralBaseline(context: ApplicationPreparationContext) {
  return [
    context.company,
    context.jobTitle,
    `${context.jobTitle}岗位`,
    context.company && `${context.company}的${context.jobTitle}岗位`,
    context.company && `我正在申请${context.company}的${context.jobTitle}岗位`,
    context.company && `我想申请${context.company}的${context.jobTitle}岗位`,
    `针对${context.jobTitle}岗位`,
    context.company && `${context.company} / ${context.jobTitle}`,
    context.candidateName,
    "尊敬的招聘团队",
    "一",
    "Dear hiring team",
    "目标岗位",
    "当前锁定简历版本",
    "已确认事实",
    "已确认经历",
    "岗位相关",
    "申请材料",
    "期待有机会进一步沟通这些已确认经历与岗位",
    "针对",
    "针对目标岗位",
    "我可以进一步说明这些经历的事实依据和与岗位",
    "投递邮件草稿",
    "自我介绍",
    "面试问题",
    "STAR 案例",
    "结果信息缺失",
    "需用户补充已确认事实",
    "不得自动编造行动",
    "不添加未经确认的技能、结果或职业目标"
  ].filter(Boolean).join("\n");
}
