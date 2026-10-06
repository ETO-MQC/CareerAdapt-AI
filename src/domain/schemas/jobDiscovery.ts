import { z } from "zod";
import {
  CanonicalSourceKindValues,
  FACT_SOURCE_TYPES
} from "@/domain/sourceTaxonomy";
import { EntityBaseSchema, IsoDateStringSchema } from "./common";

/**
 * V4-P2-A：五张已批准 Dexie 表的数据契约（v4-plan.md §6）。
 *
 * - crawlSources / jobListings / jobSnapshots / crawlRuns / applicationDrafts
 *   是 V4 计划明确批准的全部新表；本文件之外不得再新增第六张表。
 * - jobListings 是外部候选层：jobDescriptionId 为空时它不是正式岗位；
 *   转换必须经 WorkspaceRepository 的事务（P2-B 起接入现有 DraftCommit 流程）。
 * - jobSnapshots.version 由 Repository 在事务内计算，不依赖业务层先读后写。
 * - 来源 origin 语义使用 canonical source taxonomy（V4-P1），本文件不再
 *   发明新的 sourceType 分类；FACT_SOURCE_TYPES 仅用于快照 provenance 的
 *   兼容读取，不作为新写入的枚举。
 * - applicationDrafts 禁止写入密码、验证码、OTP、身份证、学籍号、银行卡和
 *   签名值；schema 层以字段名黑名单拒绝。
 */

// --- crawlSources（§6.1） ---

/** v4-plan §1.3 automationLevel 五级，原样采纳。 */
export const AutomationLevelSchema = z.enum(["scheduled", "user_present", "user_capture", "manual_only", "blocked"]);

/** v4-plan §8.1 fetcher 六类，作为 channelType 的合法值。 */
export const CrawlChannelTypeSchema = z.enum([
  "official_api",
  "public_http",
  "public_ssr",
  "managed_browser",
  "user_capture",
  "manual_only"
]);

export const ComplianceStatusSchema = z.enum(["allowed", "review_required", "blocked"]);

export const CrawlSourceModeSchema = z.enum(["manual", "scheduled"]);

export const AuthModeSchema = z.enum(["none", "api_key", "user_session"]);

export const RetentionPolicySchema = z.enum(["until_converted", "30_days", "90_days", "forever"]);

export const RobotsPolicySchema = z.enum(["respected", "not_applicable", "unclear"]);

export const CrawlSourceRateLimitSchema = z.object({
  maxRequestsPerMinute: z.number().int().min(1).max(600),
  minIntervalMs: z.number().int().min(0).max(60_000)
}).strict();

/** 政策版本：追加式，历史 crawlRun 引用的政策记录不被覆盖（§6.1 约束）。 */
export const CrawlPolicyVersionSchema = z.object({
  version: z.number().int().min(1),
  automationLevel: AutomationLevelSchema,
  permissionBasis: z.string().min(1).max(500),
  termsUrl: z.string().max(2048).optional(),
  termsReviewedAt: IsoDateStringSchema.optional(),
  robotsPolicy: RobotsPolicySchema,
  dataPolicy: z.string().min(1).max(2000),
  complianceStatus: ComplianceStatusSchema,
  createdAt: IsoDateStringSchema
}).strict();

export type CrawlPolicyVersion = z.infer<typeof CrawlPolicyVersionSchema>;

export const CrawlSourceSchema = EntityBaseSchema.extend({
  schemaVersion: z.literal("crawl-source-v1"),
  key: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9._-]*$/u),
  displayName: z.string().min(1).max(200),
  channelType: CrawlChannelTypeSchema,
  atsVendor: z.string().max(120).optional(),
  mode: CrawlSourceModeSchema,
  automationLevel: AutomationLevelSchema,
  /** 顶层合规状态，与 currentPolicyVersion.complianceStatus 保持一致。 */
  complianceStatus: ComplianceStatusSchema,
  profileRef: z.string().min(1).max(200),
  adapterId: z.string().min(1).max(200),
  adapterVersion: z.string().min(1).max(80),
  rateLimit: CrawlSourceRateLimitSchema,
  supportsSchedule: z.boolean(),
  supportsDetail: z.boolean(),
  supportsApplicationAssist: z.boolean(),
  retentionPolicy: RetentionPolicySchema,
  enabled: z.boolean(),
  lastRunAt: IsoDateStringSchema.optional(),
  lastErrorCode: z.string().max(160).optional(),
  policyVersions: z.array(CrawlPolicyVersionSchema).min(1).max(50),
  currentPolicyVersion: z.number().int().min(1)
}).strict().superRefine((source, context) => {
  if (source.complianceStatus === "blocked" && source.enabled) {
    context.addIssue({
      code: "custom",
      path: ["enabled"],
      message: "blocked sources cannot stay enabled"
    });
  }
  const currentPolicy = source.policyVersions.find((version) => version.version === source.currentPolicyVersion);
  if (currentPolicy) {
    // P2-A.1：顶层 automationLevel / complianceStatus 必须与当前政策版本一致，
    // 且该检查与 mode 无关（manual 模式同样生效）。
    if (currentPolicy.automationLevel !== source.automationLevel) {
      context.addIssue({
        code: "custom",
        path: ["automationLevel"],
        message: "top-level automationLevel must match the current policy version"
      });
    }
    if (currentPolicy.complianceStatus !== source.complianceStatus) {
      context.addIssue({
        code: "custom",
        path: ["complianceStatus"],
        message: "top-level complianceStatus must match the current policy version"
      });
    }
  }
  if (source.mode === "scheduled") {
    if (!source.supportsSchedule) {
      context.addIssue({
        code: "custom",
        path: ["mode"],
        message: "scheduled mode requires supportsSchedule"
      });
    }
    if (source.automationLevel !== "scheduled") {
      context.addIssue({
        code: "custom",
        path: ["mode"],
        message: "scheduled mode requires scheduled automation level"
      });
    }
    if (currentPolicy && (currentPolicy.complianceStatus === "review_required" || currentPolicy.complianceStatus === "blocked")) {
      context.addIssue({
        code: "custom",
        path: ["mode"],
        message: "review_required sources cannot enter scheduled mode"
      });
    }
  }
  const versions = source.policyVersions.map((version) => version.version);
  if (new Set(versions).size !== versions.length || !versions.includes(source.currentPolicyVersion)) {
    context.addIssue({
      code: "custom",
      path: ["policyVersions"],
      message: "policy versions must be unique and include the current version"
    });
  }
});

export type CrawlSource = z.infer<typeof CrawlSourceSchema>;

// --- jobListings（§6.2） ---

export const ListingKindSchema = z.enum(["job_posting", "internship", "campus_recruitment", "other"]);
export type ListingKind = z.infer<typeof ListingKindSchema>;

export const CrawlStateSchema = z.enum(["new", "unchanged", "changed", "retired"]);

export const ListingPolicyStatusSchema = z.enum(["allowed", "review_required", "blocked"]);
export type ListingPolicyStatus = z.infer<typeof ListingPolicyStatusSchema>;

export const JobListingSchema = EntityBaseSchema.extend({
  schemaVersion: z.literal("job-listing-v1"),
  sourceKey: z.string().min(1).max(120),
  externalId: z.string().min(1).max(300),
  canonicalSourceUrl: z.string().max(2048).optional(),
  applyUrl: z.string().max(2048).optional(),
  contentFingerprint: z.string().min(8).max(128),
  companyTitleFingerprint: z.string().min(8).max(128),
  listingKind: ListingKindSchema,
  /**
   * P2-A.1 收紧：jobListings 按定义是外部候选层，origin 固定为
   * external_job_source；其他 canonical kind 不允许出现在本表。
   */
  canonicalSourceKind: z.literal("external_job_source"),
  title: z.string().min(1).max(500),
  company: z.string().min(1).max(300),
  location: z.string().max(300).optional(),
  salaryText: z.string().max(300).optional(),
  education: z.string().max(300).optional(),
  experience: z.string().max(300).optional(),
  publishedAt: IsoDateStringSchema.optional(),
  applicationDeadline: IsoDateStringSchema.optional(),
  recruitmentBatch: z.string().max(200).optional(),
  crawlState: CrawlStateSchema,
  policyStatus: ListingPolicyStatusSchema,
  blockedReason: z.string().max(500).optional(),
  firstSeenAt: IsoDateStringSchema,
  lastSeenAt: IsoDateStringSchema,
  latestSnapshotId: z.string().min(1).optional(),
  /** 正式岗位 id；为空时本记录只是候选岗位（§6.2）。 */
  jobDescriptionId: z.string().min(1).optional(),
  /** V4-P2-A 补充字段：解析与转换的追溯锚点。 */
  parsedSnapshotId: z.string().min(1).optional(),
  analysisDraftId: z.string().min(1).optional(),
  convertedAt: IsoDateStringSchema.optional()
}).strict().superRefine((listing, context) => {
  if (listing.jobDescriptionId && !listing.convertedAt) {
    context.addIssue({
      code: "custom",
      path: ["convertedAt"],
      message: "converted listings must record convertedAt"
    });
  }
  if (!listing.jobDescriptionId && listing.convertedAt) {
    context.addIssue({
      code: "custom",
      path: ["convertedAt"],
      message: "convertedAt requires a jobDescriptionId"
    });
  }
  if (listing.policyStatus === "blocked" && !listing.blockedReason) {
    context.addIssue({
      code: "custom",
      path: ["blockedReason"],
      message: "blocked listings must record a reason"
    });
  }
  if (new Date(listing.lastSeenAt).getTime() < new Date(listing.firstSeenAt).getTime()) {
    context.addIssue({
      code: "custom",
      path: ["lastSeenAt"],
      message: "lastSeenAt cannot precede firstSeenAt"
    });
  }
});

export type JobListing = z.infer<typeof JobListingSchema>;

// --- jobSnapshots（§6.3） ---

export const RedactionStatusSchema = z.enum(["redacted", "raw", "pending_review"]);

/** 快照来源链。sourceKind 使用 canonical taxonomy；兼容读取支持旧 FactSourceType 值。 */
export const JobSnapshotProvenanceSchema = z.object({
  sourceName: z.string().min(1).max(200),
  sourceKind: z.enum(CanonicalSourceKindValues).default("external_job_source"),
  /** 旧数据的 FactSourceType 值（如 imported_text）；新写入不得使用。 */
  legacySourceType: z.enum(FACT_SOURCE_TYPES).optional(),
  operation: z.string().min(1).max(200),
  adapterId: z.string().min(1).max(200),
  adapterVersion: z.string().min(1).max(80),
  capturedAt: IsoDateStringSchema,
  sourceUrl: z.string().max(2048).optional()
}).strict();

export type JobSnapshotProvenance = z.infer<typeof JobSnapshotProvenanceSchema>;

export const JobSnapshotSchema = EntityBaseSchema.extend({
  schemaVersion: z.literal("job-snapshot-v1"),
  jobListingId: z.string().min(1),
  version: z.number().int().min(1),
  contentHash: z.string().min(8).max(128),
  rawText: z.string().min(1).max(200_000),
  sourceLocator: z.string().max(300).optional(),
  normalizerVersion: z.string().min(1).max(120),
  capturedBy: z.string().min(1).max(200),
  provenance: JobSnapshotProvenanceSchema,
  redactionStatus: RedactionStatusSchema,
  contentSize: z.number().int().min(1),
  capturedAt: IsoDateStringSchema
}).strict().superRefine((snapshot, context) => {
  if (snapshot.contentSize !== snapshot.rawText.length) {
    context.addIssue({
      code: "custom",
      path: ["contentSize"],
      message: "contentSize must equal rawText length"
    });
  }
});

export type JobSnapshot = z.infer<typeof JobSnapshotSchema>;

// --- crawlRuns（§6.4） ---

export const CrawlRunTriggerSchema = z.enum(["manual", "scheduled"]);

export const CrawlRunStatusSchema = z.enum(["running", "finished", "failed", "blocked"]);

export const CrawlRunCountersSchema = z.object({
  listPagesFetched: z.number().int().min(0).max(10_000).default(0),
  detailsFetched: z.number().int().min(0).max(10_000).default(0),
  itemsDiscovered: z.number().int().min(0).max(100_000).default(0),
  itemsNew: z.number().int().min(0).max(100_000).default(0),
  itemsChanged: z.number().int().min(0).max(100_000).default(0),
  requestsSpent: z.number().int().min(0).max(100_000).default(0),
  blockedCount: z.number().int().min(0).max(100_000).default(0)
}).strict();

export type CrawlRunCounters = z.infer<typeof CrawlRunCountersSchema>;

/** 单条诊断：有界长度；禁止 Cookie/Authorization/整页内容/个人信息进入。 */
export const CrawlRunDiagnosticSchema = z.object({
  code: z.string().min(1).max(160),
  message: z.string().min(1).max(500),
  occurredAt: IsoDateStringSchema
}).strict();

export const CrawlRunSchema = EntityBaseSchema.extend({
  schemaVersion: z.literal("crawl-run-v1"),
  sourceKey: z.string().min(1).max(120),
  trigger: CrawlRunTriggerSchema,
  autonomyLevel: AutomationLevelSchema,
  status: CrawlRunStatusSchema,
  startedAt: IsoDateStringSchema,
  finishedAt: IsoDateStringSchema.optional(),
  counters: CrawlRunCountersSchema,
  errorCode: z.string().max(160).optional(),
  diagnostics: z.array(CrawlRunDiagnosticSchema).max(50).default([]),
  /** 创建 run 时从来源复制的政策版本快照（不可变）。 */
  policySnapshot: CrawlPolicyVersionSchema
}).strict().superRefine((run, context) => {
  if (run.status === "running" && run.finishedAt) {
    context.addIssue({
      code: "custom",
      path: ["finishedAt"],
      message: "running runs must not have finishedAt"
    });
  }
  if (run.status !== "running" && !run.finishedAt) {
    context.addIssue({
      code: "custom",
      path: ["finishedAt"],
      message: "settled runs require finishedAt"
    });
  }
});

export type CrawlRun = z.infer<typeof CrawlRunSchema>;
export type CrawlRunStatus = z.infer<typeof CrawlRunStatusSchema>;
export type CrawlRunDiagnostic = z.infer<typeof CrawlRunDiagnosticSchema>;

// --- applicationDrafts（§6.5） ---

export const ApplicationDraftStepSchema = z.enum([
  "created",
  "login_required",
  "running",
  "awaiting_user_review",
  "ready_for_user_submit",
  "handed_off",
  "user_marked_submitted",
  "abandoned"
]);

export type ApplicationDraftStep = z.infer<typeof ApplicationDraftStepSchema>;

/**
 * P2-A.1：敏感字段名规范化与别名集（§6.5）。
 * 判定前先把字段名小写并去掉所有非字母数字字符，因此 verificationCode、
 * verification-code、verification code、VERIFICATION_CODE 命中同一别名。
 */
export function normalizeSensitiveFieldKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

/** 规范化后的敏感字段名别名（含常见缩写）。 */
export const SENSITIVE_FIELD_KEY_ALIASES: readonly string[] = [
  "password",
  "passwd",
  "pwd",
  "pass",
  "passcode",
  "otp",
  "onetimepassword",
  "onetimecode",
  "verificationcode",
  "verifycode",
  "verifcode",
  "vcode",
  "smscode",
  "smsverificationcode",
  "idcard",
  "idnumber",
  "identitynumber",
  "identityno",
  "studentid",
  "studentnumber",
  "xujihao",
  "bankcard",
  "bankaccount",
  "cardnumber",
  "cardno",
  "cvv",
  "cvc",
  "securitycode",
  "signature",
  "signedvalue",
  "signvalue"
];

const SENSITIVE_FIELD_KEY_SET = new Set(SENSITIVE_FIELD_KEY_ALIASES);

/** 规范化后的敏感字段名判定；与存储格式无关（camelCase/连字符/空格等价）。 */
export function isSensitiveFieldKey(key: string): boolean {
  return SENSITIVE_FIELD_KEY_SET.has(normalizeSensitiveFieldKey(key));
}

/** 兼容导出：规范化前的展示名单（各值均被 isSensitiveFieldKey 命中）。 */
export const SENSITIVE_FIELD_KEYS: readonly string[] = [
  "password",
  "passcode",
  "otp",
  "verification_code",
  "sms_code",
  "id_card",
  "id_number",
  "student_id",
  "xuji_hao",
  "bank_card",
  "bank_account",
  "signature",
  "signed_value"
];

export const ApplicationDraftFieldPlanSchema = z.object({
  fieldKey: z.string().min(1).max(120),
  value: z.string().max(2000).optional(),
  source: z.enum(["resume_data", "user_input_pending", "manual"]).default("manual")
}).strict().superRefine((entry, context) => {
  if (isSensitiveFieldKey(entry.fieldKey)) {
    context.addIssue({
      code: "custom",
      path: ["fieldKey"],
      message: "sensitive credential fields must never be stored in applicationDrafts"
    });
  }
  if (entry.source === "resume_data" && entry.value !== undefined && isSensitiveFieldKey(entry.value)) {
    context.addIssue({
      code: "custom",
      path: ["value"],
      message: "sensitive credential values must never be stored in applicationDrafts"
    });
  }
});

export type ApplicationDraftFieldPlan = z.infer<typeof ApplicationDraftFieldPlanSchema>;

export const ApplicationDraftBlockerSchema = z.object({
  code: z.string().min(1).max(160),
  message: z.string().min(1).max(500)
}).strict();

export const ApplicationDraftSchema = EntityBaseSchema.extend({
  schemaVersion: z.literal("application-draft-v1"),
  jobListingId: z.string().min(1),
  /** 关联到正式投递（ApplicationRecord.id）；为空表示尚未产生正式投递。 */
  applicationId: z.string().min(1).optional(),
  platform: z.string().min(1).max(120),
  step: ApplicationDraftStepSchema,
  fieldPlans: z.array(ApplicationDraftFieldPlanSchema).max(200).default([]),
  sensitiveFieldsPending: z.array(z.string().min(1).max(120)).max(100).default([]),
  resumeAttachmentRecordId: z.string().min(1).optional(),
  materialPackId: z.string().min(1).optional(),
  blockers: z.array(ApplicationDraftBlockerSchema).max(50).default([])
}).strict();

export type ApplicationDraft = z.infer<typeof ApplicationDraftSchema>;

// --- step 转移（§6.5 推荐顺序） ---

const APPLICATION_DRAFT_STEP_ORDER: ApplicationDraftStep[] = [
  "created",
  "login_required",
  "running",
  "awaiting_user_review",
  "ready_for_user_submit",
  "handed_off",
  "user_marked_submitted",
  "abandoned"
];

// P2-A.1：handed_off 不是终态——它必须允许用户执行 user_marked_submitted；
// 真正的终态只有 user_marked_submitted 与 abandoned。
const TERMINAL_DRAFT_STEPS = new Set<ApplicationDraftStep>(["user_marked_submitted", "abandoned"]);

const APPLICATION_DRAFT_TRANSITIONS: Readonly<Record<ApplicationDraftStep, readonly ApplicationDraftStep[]>> = {
  created: ["login_required", "running", "abandoned"],
  login_required: ["running", "abandoned"],
  running: ["awaiting_user_review", "abandoned"],
  awaiting_user_review: ["running", "ready_for_user_submit", "abandoned"],
  ready_for_user_submit: ["handed_off", "abandoned"],
  handed_off: ["user_marked_submitted"],
  user_marked_submitted: [],
  abandoned: []
};

export function applicationDraftTransitionError(from: ApplicationDraftStep, to: ApplicationDraftStep): "invalid_application_draft_transition" | undefined {
  return APPLICATION_DRAFT_TRANSITIONS[from].includes(to)
    ? undefined
    : "invalid_application_draft_transition";
}

export function isTerminalApplicationDraftStep(step: ApplicationDraftStep): boolean {
  return TERMINAL_DRAFT_STEPS.has(step);
}

export const APPLICATION_DRAFT_STEP_ORDER_EXPORT: readonly ApplicationDraftStep[] = APPLICATION_DRAFT_STEP_ORDER;
