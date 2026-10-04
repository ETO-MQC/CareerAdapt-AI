import { z } from "zod";
import type { ResumeItemV2 } from "@/domain/schemas";

export const TAILORING_DIAGNOSTIC_LIMIT = 50;

export const TailoringDiagnosticStatusSchema = z.enum([
  "rejected",
  "blocked",
  "unsupported_section",
  "original_mismatch",
  "conflict",
  "pending_confirmation"
]);

export const TailoringDiagnosticSchema = z.object({
  diagnosticId: z.string().min(1),
  diffId: z.string().min(1).optional(),
  status: TailoringDiagnosticStatusSchema,
  reasonCode: z.string().min(1),
  sectionType: z.string().min(1).optional(),
  itemId: z.string().min(1).optional(),
  itemLabel: z.string().min(1).optional(),
  fieldPath: z.string().min(1).optional(),
  tailoringSessionId: z.string().min(1).optional(),
  generatedDiffRevision: z.number().int().min(0).optional(),
  capturedAt: z.string().datetime({ offset: true })
}).strict();

export const TailoringDiagnosticsSchema = z.object({
  diagnostics: z.array(TailoringDiagnosticSchema).max(TAILORING_DIAGNOSTIC_LIMIT),
  truncatedCount: z.number().int().min(0).default(0),
  generatedDiffRevision: z.number().int().min(0).default(0)
}).strict();

export type TailoringDiagnostic = z.infer<typeof TailoringDiagnosticSchema>;
export type TailoringDiagnostics = z.infer<typeof TailoringDiagnosticsSchema>;

const EMPTY_DIAGNOSTICS: TailoringDiagnostics = { diagnostics: [], truncatedCount: 0, generatedDiffRevision: 0 };

/**
 * Diagnostics are display-only. They never feed apply: the review ledger stays the
 * single source of truth for what may be written.
 */
export function readTailoringDiagnostics(value: unknown): TailoringDiagnostics {
  const parsed = TailoringDiagnosticsSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_DIAGNOSTICS;
}

const REASON_EXPLANATIONS: Readonly<Record<string, string>> = {
  target_not_found: "目标条目在当前简历中不存在，可能已被删除或不在本分支内。",
  path_not_allowed: "该字段不允许被智能改写，通常属于学校、公司、日期等身份事实。",
  original_mismatch: "简历内容在生成后发生了变化，改写已放弃以避免覆盖你的新修改。",
  blocked_identity_path: "该字段是身份事实，不允许智能改写。",
  invalid_value_type: "返回的内容类型与字段要求不一致。",
  empty_value: "返回内容为空，未写入。",
  no_op: "改写前后内容一致，无需应用。",
  truncated_output: "输出明显短于原文，判定为被截断。",
  mechanical_prefix: "输出包含机械式套话前缀。",
  duplicate_original: "输出只是把原文包在更长句子里，没有新增信息。",
  invented_metric: "输出引入了原文与证据中都不存在的数字。",
  responsibility_upgrade: "输出把参与类表述升级成了主导类表述，超过你的事实范围。",
  insufficient_evidence: "缺少可引用的证据，未采用。",
  confirmation_required: "需要你确认后才会写入。",
  reorder_membership_changed: "排序结果改变了条目集合，不只是顺序。",
  append_not_allowed: "该字段不支持追加内容。",
  hide_not_allowed: "该操作不支持隐藏条目。",
  duplicate_sentence: "输出中存在重复句子。",
  platform_as_skill: "把技术平台名当成了技能，不符合当前语义。",
  company_as_skill: "把公司名当成了技能，不符合当前语义。",
  generic_proficiency_sentence: "输出是无信息量的通用熟练度套话。",
  malformed_chinese_phrase: "输出存在不通顺的短语。",
  internal_field_label: "输出里出现了字段名标签，不应出现在简历正文。",
  denied_capability: "输出涉及你已声明不使用的方向。",
  uncertain_capability: "该能力真实性不确定，未采用。",
  proficiency_upgrade: "输出提升了熟练度等级，且没有对应的用户声明。",
  keyword_stuffing: "输出为堆砌关键词而牺牲了可读性。",
  jd_parroting: "输出只是照抄岗位要求原文。",
  cross_diff_duplicate: "与其他改写条目重复。",
  repeated_claim_target: "多个条目指向同一个目标字段。",
  original_snapshot_mismatch: "简历版本与生成时的快照不一致。",
  empty_revision: "该轮没有产生任何实际改动。",
  unsupported_metric: "输出使用了不被支持的指标表述。",
  identity_field_changed: "输出试图修改身份事实字段，已阻止。",
  invalid_ai_output: "模型输出不符合约定格式，重试后仍未通过。",
  invalid_ai_output_after_retry: "模型输出重试后仍不符合约定格式。",
  insufficient_evidence_after_question_plan: "补充信息后仍缺少可引用证据。",
  conflict: "与当前简历内容冲突，已放弃应用。"
};

const GENERATION_DIAGNOSTIC_STATUS: Readonly<Record<string, TailoringDiagnostic["status"]>> = {
  invalid_ai_output: "blocked",
  invalid_ai_output_after_retry: "blocked",
  insufficient_evidence_after_question_plan: "blocked"
};

export function explainTailoringReason(code: string): string {
  const normalized = code.replace(/^rejected_(after_retry)?_/, "");
  return REASON_EXPLANATIONS[normalized] ?? "该修改未通过校验，详情可查看生成日志。";
}

function statusForReasonCode(reasonCode: string): TailoringDiagnostic["status"] {
  if (reasonCode === "original_mismatch" || reasonCode === "original_snapshot_mismatch") return "original_mismatch";
  if (reasonCode === "confirmation_required") return "pending_confirmation";
  const generation = GENERATION_DIAGNOSTIC_STATUS[reasonCode];
  if (generation) return generation;
  return "rejected";
}

const TITLE_FIELD_BY_SECTION: Readonly<Record<string, readonly string[]>> = {
  work: ["organization", "role"],
  internship: ["organization", "role"],
  campus: ["organization", "role"],
  volunteer: ["organization", "role"],
  project: ["title", "organization", "role"],
  research: ["title", "institution"],
  education: ["school", "major"],
  skills: ["name"],
  awards: ["name"],
  certificates: ["name"],
  languages: ["language", "testName"],
  publications: ["title"],
  patents: ["title"],
  portfolio: ["title"],
  other: ["title"],
  custom: ["title"],
  summary: []
};

export function resumeItemLabel(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const data = item as Partial<ResumeItemV2> & Record<string, unknown>;
  const sectionType = typeof data.sectionType === "string" ? data.sectionType : undefined;
  if (!sectionType) return undefined;
  for (const field of TITLE_FIELD_BY_SECTION[sectionType] ?? []) {
    const value = data[field];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 40);
  }
  return undefined;
}

function stableDiagnosticId(parts: readonly (string | number | undefined)[]) {
  return parts.filter((part) => part !== undefined).join(":") || "diagnostic";
}

/**
 * Projects generation output into a display-only diagnostic list. Rejections keep their
 * section/item/field so the reader can tell which entry was skipped; raw model text and
 * before/after payloads are deliberately dropped to keep the slot small and safe to persist.
 */
export function buildTailoringDiagnostics(input: {
  observation: Record<string, unknown>;
  tailoringSessionId?: string;
  capturedAt: string;
  limit?: number;
}): TailoringDiagnostics {
  const limit = input.limit ?? TAILORING_DIAGNOSTIC_LIMIT;
  const session = sessionOf(input.observation);
  const sessionId = input.tailoringSessionId ?? (session ? stringField(session, "id") : undefined);
  const labelById = new Map<string, string | undefined>();
  for (const item of structuredItemsOf(session)) {
    const id = stringField(item, "id");
    const data = item.data;
    if (id) labelById.set(id, resumeItemLabel(data));
  }

  const collected: TailoringDiagnostic[] = [];
  const rejected = input.observation.rejectedDiffs;
  if (Array.isArray(rejected)) {
    for (const entry of rejected) {
      if (!entry || typeof entry !== "object") continue;
      const reasonCode = stringField(entry, "reasonCode");
      if (!reasonCode) continue;
      const diff = (entry as Record<string, unknown>).diff;
      const target = diff && typeof diff === "object" ? (diff as Record<string, unknown>).target : undefined;
      const targetRecord = target && typeof target === "object" ? target as Record<string, unknown> : {};
      const sectionType = stringField(targetRecord, "sectionId");
      const itemId = stringField(targetRecord, "itemId");
      const fieldPath = stringField(targetRecord, "fieldPath");
      collected.push({
        diagnosticId: stableDiagnosticId(["rejected", sectionType, itemId, fieldPath, reasonCode]),
        status: statusForReasonCode(reasonCode),
        reasonCode,
        sectionType,
        itemId,
        itemLabel: itemId ? labelById.get(itemId) : undefined,
        fieldPath,
        tailoringSessionId: sessionId,
        capturedAt: input.capturedAt
      });
    }
  }

  const generation = sessionGenerationDiagnostics(session);
  if (Array.isArray(generation)) {
    for (const entry of generation) {
      if (!entry || typeof entry !== "object") continue;
      const code = stringField(entry as Record<string, unknown>, "code");
      if (!code) continue;
      if (code.startsWith("rejected_")) continue;
      const itemId = stringField(entry as Record<string, unknown>, "targetItemId");
      collected.push({
        diagnosticId: stableDiagnosticId(["generation", code, itemId]),
        status: GENERATION_DIAGNOSTIC_STATUS[code] ?? "blocked",
        reasonCode: code,
        itemId,
        itemLabel: itemId ? labelById.get(itemId) : undefined,
        tailoringSessionId: sessionId,
        capturedAt: input.capturedAt
      });
    }
  }

  const deduped = [...new Map(collected.map((entry) => [entry.diagnosticId, entry])).values()];
  const kept = deduped.slice(0, limit);
  return {
    diagnostics: kept,
    truncatedCount: deduped.length - kept.length,
    generatedDiffRevision: numberField(sessionGenerationRevision(session))
  };
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function sessionOf(observation: Record<string, unknown>): Record<string, unknown> | undefined {
  const session = observation.session;
  return session && typeof session === "object" ? session as Record<string, unknown> : undefined;
}

function structuredItemsOf(session: unknown) {
  const record = session && typeof session === "object" ? session as Record<string, unknown> : undefined;
  const branch = record?.branch;
  const branchRecord = branch && typeof branch === "object" ? branch as Record<string, unknown> : undefined;
  const items = branchRecord?.structuredContentItems;
  return Array.isArray(items) ? items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function sessionGenerationDiagnostics(session: unknown) {
  const record = session && typeof session === "object" ? session as Record<string, unknown> : undefined;
  const plan = record?.plan;
  const planRecord = plan && typeof plan === "object" ? plan as Record<string, unknown> : undefined;
  const diagnostics = planRecord?.generationDiagnostics;
  return Array.isArray(diagnostics) ? diagnostics : undefined;
}

function sessionGenerationRevision(session: unknown) {
  const record = session && typeof session === "object" ? session as Record<string, unknown> : undefined;
  return record?.generatedDiffRevision;
}
