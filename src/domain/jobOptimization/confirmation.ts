import type {
  ClaimConfirmation,
  ConfirmableClaim,
  ResumeFieldPatch,
  SkillProficiency,
  TailoringSuggestion
} from "@/domain/schemas";
import { ConfirmableClaimSchema, ResumeFieldPatchSchema } from "@/domain/schemas";

const TOOL_PATTERN = /cursor|claude code|codex|windsurf|playwright|vitest/i;
const MATERIAL_PATTERN = /github|仓库|作品|演示|dashboard|日志|订阅/i;
const GENERIC_KEYWORD = /^(?:ai|人工智能|coding|agent|vibe)$/i;

export function buildConfirmableClaim(suggestion: TailoringSuggestion): ConfirmableClaim {
  if (!suggestion.targetItemId) throw new Error("tailoring_patch_item_missing");
  const fieldPath = patchFieldPath(suggestion.targetFieldPath);
  const claimType = claimTypeFor(suggestion);
  const claimText = renderValue(suggestion.after);
  const tool = suggestion.targetKeywords.find((keyword) => TOOL_PATTERN.test(keyword));
  const finalTextByProficiency = claimType === "tool" || claimType === "skill" || claimType === "workflow"
    ? proficiencyText(tool ?? preferredCapability(suggestion.targetKeywords) ?? "AI Coding 工具")
    : undefined;
  return ConfirmableClaimSchema.parse({
    id: suggestion.id,
    label: labelFor(suggestion, claimType),
    claimText,
    finalTextByProficiency,
    sourceItemIds: [suggestion.targetItemId],
    requirementIds: suggestion.requirementIds,
    targetPatches: [ResumeFieldPatchSchema.parse({
      sectionId: suggestion.targetSectionId,
      itemId: suggestion.targetItemId,
      fieldPath,
      operation: suggestion.operation === "add" ? "append" : suggestion.operation === "remove" || suggestion.operation === "hide" ? "remove" : "replace",
      before: normalizePatchValue(fieldPath, suggestion.before),
      after: normalizePatchValue(fieldPath, suggestion.after)
    })],
    claimType
  });
}

export function resolveConfirmableClaim(claim: ConfirmableClaim, confirmation: ClaimConfirmation) {
  if (!confirmation.accepted) return { ...claim, resolvedText: undefined, targetPatches: claim.targetPatches };
  const resolvedText = confirmation.editedText
    ?? (confirmation.proficiency ? claim.finalTextByProficiency?.[confirmation.proficiency] : undefined)
    ?? claim.claimText;
  return {
    ...claim,
    resolvedText,
    targetPatches: claim.targetPatches.map((patch) => ({
      ...patch,
      after: patch.fieldPath === "highlights"
        ? confirmation.editedText ? replacePrimaryHighlight(patch.after, resolvedText) : patch.after
        : resolvedText
    }))
  };
}

export function groupTailoringKeywords(keywords: string[]) {
  const core: string[] = [];
  const confirmableTools: string[] = [];
  const materials: string[] = [];
  for (const keyword of keywords) {
    const value = keyword.trim();
    if (!value || GENERIC_KEYWORD.test(value)) continue;
    const target = MATERIAL_PATTERN.test(value) ? materials : TOOL_PATTERN.test(value) ? confirmableTools : core;
    if (!target.some((existing) => normalizeKeyword(existing) === normalizeKeyword(value))) target.push(value);
  }
  return { core, confirmableTools, materials };
}

export function tailoringTargetPriority(itemId: string, text: string) {
  const value = `${itemId} ${text}`.toLowerCase();
  let score = 0;
  const signals: Array<[RegExp, number]> = [
    [/ai\s*辅助开发|指令评估/, 20],
    [/coding agent/, 18], [/复杂任务拆解|多文件/, 16], [/错误复现|复现/, 15], [/模型输出验证|验证模型输出/, 14],
    [/自动化测试|playwright|vitest/, 13], [/风险操作|约束/, 12], [/rag.*幻觉|拒答边界/, 11], [/badcase|verifier|benchmark/, 10]
  ];
  for (const [pattern, weight] of signals) if (pattern.test(value)) score += weight;
  return score;
}

function claimTypeFor(suggestion: TailoringSuggestion): ConfirmableClaim["claimType"] {
  if (suggestion.targetSectionType === "skills") {
    return suggestion.targetKeywords.some((keyword) => TOOL_PATTERN.test(keyword)) ? "tool" : "skill";
  }
  return "experience_reframe";
}

function labelFor(suggestion: TailoringSuggestion, claimType: ConfirmableClaim["claimType"]) {
  const item = displayItemName(suggestion.targetItemId ?? suggestion.targetSectionId);
  const keyword = preferredCapability(suggestion.targetKeywords);
  if (claimType === "tool") return `确认 ${keyword ?? "AI Coding 工具"} 的使用程度`;
  if (claimType === "skill" || claimType === "workflow") return `确认 ${keyword ?? "岗位能力"}`;
  return item ? `强化 ${item} 的${keyword ? `${keyword}经验` : "岗位相关经验"}` : `强化${keyword ? `${keyword}相关经验` : "岗位相关经验"}`;
}

function displayItemName(value: string) {
  const known: Record<string, string> = { smartfocus: "示例任务系统", learnkata: "示例学习助手", redbook: "示例内容分析" };
  const normalized = value.toLowerCase();
  const matched = Object.entries(known).find(([key]) => normalized.includes(key))?.[1];
  if (matched) return matched;
  return value.length <= 24 && !/^branch-item-/.test(value) ? value : undefined;
}

function preferredCapability(keywords: string[]) {
  return keywords.find((keyword) => !GENERIC_KEYWORD.test(keyword));
}

function proficiencyText(tool: string): Record<SkillProficiency, string> {
  return {
    proficient: `熟练使用 ${tool} 完成多文件开发、代码修改与问题定位。`,
    familiar: `熟悉 ${tool} 的项目开发、代码修改与调试流程。`,
    aware: `了解 ${tool} 等 AI Coding 工具的基本工作方式。`,
    learning: `正在学习 ${tool} 等 AI Coding 工具在真实开发任务中的应用。`
  };
}

function patchFieldPath(path: string): ResumeFieldPatch["fieldPath"] {
  const field = path.split(".").at(-1)?.replace(/\[\d+\]$/, "");
  if (!field || !["text", "name", "description", "highlights", "visible", "order"].includes(field)) throw new Error("tailoring_field_path_not_allowed");
  return field as ResumeFieldPatch["fieldPath"];
}

function normalizePatchValue(field: ResumeFieldPatch["fieldPath"], value: string | string[]) {
  if (field === "highlights") return Array.isArray(value) ? value : value.split(/\r?\n/).filter(Boolean);
  return Array.isArray(value) ? value.join("\n") : value;
}

function replacePrimaryHighlight(value: ResumeFieldPatch["after"], resolvedText: string) {
  if (!Array.isArray(value)) return [resolvedText];
  return [resolvedText, ...value.slice(1)];
}

function renderValue(value: string | string[]) { return Array.isArray(value) ? value.join("\n") : value; }
function normalizeKeyword(value: string) { return value.toLowerCase().replace(/[\s_-]+/g, ""); }
