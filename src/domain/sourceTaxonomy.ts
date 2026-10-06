/**
 * V4-P1 前置：canonical sourceType 分类法。
 *
 * 迁移前仓库内存在多套互不一致的 sourceType 分类（V4-P0 静态审计记录）：
 *  1. FactProvenance.sourceType        —— src/domain/schemas/common.ts
 *  2. CandidateEvidenceUnit.sourceType —— src/domain/schemas/jobOptimizationV2.ts
 *  3. JobTargetSnapshot.sourceType     —— src/domain/schemas/jobTarget.ts
 *  4. MaterialEvidenceRef.sourceType   —— src/domain/schemas/applicationPreparation.ts
 *  5. ProfileRecoveryCandidate.sourceType —— src/domain/profile/profileContentRecovery.ts
 *
 * 本模块是这些分类法的唯一权威定义点：
 * - 各旧枚举的字面量数组在此集中声明，旧 Schema 改为从这里派生（运行时值不变）；
 * - `toCanonicalSourceKind`/`legacySourceTypesForCanonicalKind` 提供旧值 ↔ canonical
 *   语义层（CanonicalSourceKind）的双向适配，旧值全部保留兼容映射；
 * - V4-P1 起新增的岗位资产（JD 快照、去重、Fact Proposal 等）只允许使用
 *   canonical kind 或某个已注册的旧分类，不得再造新的私有分类。
 *
 * 相邻但未并入的轴：BranchContentSourceSchema（简历分支内容来源）描述的是分支
 * 内容的产生方式，与"来源 origin"是两个正交概念，保持独立。
 */

export const CanonicalSourceKindValues = [
  /** 用户手动声明、输入或确认的原始内容 */
  "user_declared",
  /** 文本 / PDF 等文档导入 */
  "document_import",
  /** AI 生成或建议 */
  "ai_generated",
  /** 已核验的证据材料（证据文件、已确认 provenance） */
  "verified_evidence",
  /** 系统、演示数据、恢复或迁移产生的结构内容 */
  "system",
  /** 岗位需求侧内容 */
  "job_requirement",
  /** 简历内容（区块、来源简历、通用简历素材） */
  "resume_content",
  /** 外部岗位来源（保存的岗位、粘贴 JD、外部投递） */
  "external_job_source"
] as const;

export type CanonicalSourceKind = (typeof CanonicalSourceKindValues)[number];

/** 分类法 1：FactProvenance.sourceType（事实来源） */
export const FACT_SOURCE_TYPES = [
  "demo",
  "imported_text",
  "pdf_import",
  "user_input",
  "ai_suggestion",
  "evidence",
  "system"
] as const;

export type FactSourceType = (typeof FACT_SOURCE_TYPES)[number];

/**
 * factMaturityOf 的历史 demonstrated-asset 过滤表。值与迁移前完全一致
 * （包含 demo，不含 system/ai_suggestion）；只移动定义位置，不改变行为。
 */
export const LEGACY_DEMONSTRATED_ASSET_SOURCE_TYPES: readonly FactSourceType[] = [
  "demo",
  "user_input",
  "imported_text",
  "pdf_import",
  "evidence"
];

/** 分类法 2：CandidateEvidenceUnit.sourceType（岗位优化候选证据） */
export const CANDIDATE_EVIDENCE_SOURCE_TYPES = [
  "experience_highlight",
  "experience_description",
  "skill",
  "certificate",
  "education",
  "project_outcome",
  "custom_fact"
] as const;

export type CandidateEvidenceSourceType = (typeof CANDIDATE_EVIDENCE_SOURCE_TYPES)[number];

/** 分类法 3：JobTargetSnapshot.sourceType（岗位目标来源） */
export const JOB_TARGET_SOURCE_TYPES = [
  "saved_job",
  "pasted_jd",
  "manual_target",
  "external_application"
] as const;

export type JobTargetSourceType = (typeof JOB_TARGET_SOURCE_TYPES)[number];

/** 分类法 4：MaterialEvidenceRef.sourceType（投递材料证据） */
export const MATERIAL_EVIDENCE_SOURCE_TYPES = [
  "career_fact",
  "resume_block",
  "job_requirement",
  "user_confirmed"
] as const;

export type MaterialEvidenceSourceType = (typeof MATERIAL_EVIDENCE_SOURCE_TYPES)[number];

/** 分类法 5：ProfileRecoveryCandidate.sourceType（资料恢复候选来源） */
export const PROFILE_RECOVERY_SOURCE_TYPES = [
  "imported_resume_draft",
  "resume_source_document",
  "confirmed_provenance",
  "general_resume"
] as const;

export type ProfileRecoverySourceType = (typeof PROFILE_RECOVERY_SOURCE_TYPES)[number];

/** 旧值 → canonical kind 的兼容映射。每个映射必须是全函数（Record 穷尽旧联合）。 */
export const FACT_SOURCE_TYPE_TO_CANONICAL: Record<FactSourceType, CanonicalSourceKind> = {
  demo: "system",
  imported_text: "document_import",
  pdf_import: "document_import",
  user_input: "user_declared",
  ai_suggestion: "ai_generated",
  evidence: "verified_evidence",
  system: "system"
};

export const CANDIDATE_EVIDENCE_SOURCE_TYPE_TO_CANONICAL: Record<CandidateEvidenceSourceType, CanonicalSourceKind> = {
  experience_highlight: "resume_content",
  experience_description: "resume_content",
  skill: "resume_content",
  certificate: "resume_content",
  education: "resume_content",
  project_outcome: "resume_content",
  custom_fact: "user_declared"
};

export const JOB_TARGET_SOURCE_TYPE_TO_CANONICAL: Record<JobTargetSourceType, CanonicalSourceKind> = {
  saved_job: "external_job_source",
  pasted_jd: "external_job_source",
  manual_target: "user_declared",
  external_application: "external_job_source"
};

export const MATERIAL_EVIDENCE_SOURCE_TYPE_TO_CANONICAL: Record<MaterialEvidenceSourceType, CanonicalSourceKind> = {
  career_fact: "user_declared",
  resume_block: "resume_content",
  job_requirement: "job_requirement",
  user_confirmed: "user_declared"
};

export const PROFILE_RECOVERY_SOURCE_TYPE_TO_CANONICAL: Record<ProfileRecoverySourceType, CanonicalSourceKind> = {
  imported_resume_draft: "document_import",
  resume_source_document: "resume_content",
  confirmed_provenance: "verified_evidence",
  general_resume: "resume_content"
};

/** 已注册的旧分类法标识。 */
export const SOURCE_TAXONOMIES = [
  "fact_source",
  "candidate_evidence",
  "job_target",
  "material_evidence",
  "profile_recovery"
] as const;

export type SourceTaxonomy = (typeof SOURCE_TAXONOMIES)[number];

/**
 * 旧值 → canonical kind。旧值在对应分类法内必须合法；未知值在该分类法下
 * 没有兼容映射，显式返回 undefined 而不是猜测，由调用方决定拒绝或上报。
 */
export function toCanonicalSourceKind(taxonomy: SourceTaxonomy, value: string): CanonicalSourceKind | undefined {
  switch (taxonomy) {
    case "fact_source":
      return FACT_SOURCE_TYPE_TO_CANONICAL[value as FactSourceType];
    case "candidate_evidence":
      return CANDIDATE_EVIDENCE_SOURCE_TYPE_TO_CANONICAL[value as CandidateEvidenceSourceType];
    case "job_target":
      return JOB_TARGET_SOURCE_TYPE_TO_CANONICAL[value as JobTargetSourceType];
    case "material_evidence":
      return MATERIAL_EVIDENCE_SOURCE_TYPE_TO_CANONICAL[value as MaterialEvidenceSourceType];
    case "profile_recovery":
      return PROFILE_RECOVERY_SOURCE_TYPE_TO_CANONICAL[value as ProfileRecoverySourceType];
  }
}

/** canonical kind → 某分类法下所有兼容的旧值（用于读旧数据时的反向过滤）。 */
export function legacySourceTypesForCanonicalKind(taxonomy: SourceTaxonomy, kind: CanonicalSourceKind): string[] {
  const map = taxonomy === "fact_source"
    ? FACT_SOURCE_TYPE_TO_CANONICAL
    : taxonomy === "candidate_evidence"
      ? CANDIDATE_EVIDENCE_SOURCE_TYPE_TO_CANONICAL
      : taxonomy === "job_target"
        ? JOB_TARGET_SOURCE_TYPE_TO_CANONICAL
        : taxonomy === "material_evidence"
          ? MATERIAL_EVIDENCE_SOURCE_TYPE_TO_CANONICAL
          : PROFILE_RECOVERY_SOURCE_TYPE_TO_CANONICAL;
  return Object.entries(map).filter(([, canonical]) => canonical === kind).map(([legacy]) => legacy);
}
