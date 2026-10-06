import { describe, expect, it } from "vitest";
import {
  CANDIDATE_EVIDENCE_SOURCE_TYPE_TO_CANONICAL,
  CANDIDATE_EVIDENCE_SOURCE_TYPES,
  CanonicalSourceKindValues,
  FACT_SOURCE_TYPE_TO_CANONICAL,
  FACT_SOURCE_TYPES,
  JOB_TARGET_SOURCE_TYPE_TO_CANONICAL,
  JOB_TARGET_SOURCE_TYPES,
  LEGACY_DEMONSTRATED_ASSET_SOURCE_TYPES,
  MATERIAL_EVIDENCE_SOURCE_TYPE_TO_CANONICAL,
  MATERIAL_EVIDENCE_SOURCE_TYPES,
  PROFILE_RECOVERY_SOURCE_TYPE_TO_CANONICAL,
  legacySourceTypesForCanonicalKind,
  toCanonicalSourceKind,
  type CanonicalSourceKind,
  type SourceTaxonomy
} from "@/domain/sourceTaxonomy";
import { FactMaturitySchema, FactSourceTypeSchema } from "@/domain/schemas/common";
import { CandidateEvidenceSourceTypeSchema } from "@/domain/schemas/jobOptimizationV2";
import { JobTargetSourceTypeSchema } from "@/domain/schemas/jobTarget";
import { MaterialEvidenceSourceTypeSchema } from "@/domain/schemas/applicationPreparation";

const TAXONOMY_MAPS = {
  fact_source: FACT_SOURCE_TYPE_TO_CANONICAL,
  candidate_evidence: CANDIDATE_EVIDENCE_SOURCE_TYPE_TO_CANONICAL,
  job_target: JOB_TARGET_SOURCE_TYPE_TO_CANONICAL,
  material_evidence: MATERIAL_EVIDENCE_SOURCE_TYPE_TO_CANONICAL,
  profile_recovery: PROFILE_RECOVERY_SOURCE_TYPE_TO_CANONICAL
} as const;

describe("V4-P1 prerequisite: canonical sourceType taxonomy", () => {
  it("keeps every legacy enum validating exactly its historical values", () => {
    expect(FactSourceTypeSchema.options).toEqual([...FACT_SOURCE_TYPES]);
    expect(CandidateEvidenceSourceTypeSchema.options).toEqual([...CANDIDATE_EVIDENCE_SOURCE_TYPES]);
    expect(JobTargetSourceTypeSchema.options).toEqual([...JOB_TARGET_SOURCE_TYPES]);
    expect(MaterialEvidenceSourceTypeSchema.options).toEqual([...MATERIAL_EVIDENCE_SOURCE_TYPES]);

    for (const value of FACT_SOURCE_TYPES) expect(FactSourceTypeSchema.safeParse(value).success).toBe(true);
    for (const value of CANDIDATE_EVIDENCE_SOURCE_TYPES) expect(CandidateEvidenceSourceTypeSchema.safeParse(value).success).toBe(true);
    for (const value of JOB_TARGET_SOURCE_TYPES) expect(JobTargetSourceTypeSchema.safeParse(value).success).toBe(true);
    for (const value of MATERIAL_EVIDENCE_SOURCE_TYPES) expect(MaterialEvidenceSourceTypeSchema.safeParse(value).success).toBe(true);
  });

  it("rejects values that were never part of a legacy taxonomy", () => {
    expect(FactSourceTypeSchema.safeParse("external_job").success).toBe(false);
    expect(JobTargetSourceTypeSchema.safeParse("pdf_import").success).toBe(false);
    expect(MaterialEvidenceSourceTypeSchema.safeParse("ai_suggestion").success).toBe(false);
  });

  it("maps every legacy value of every taxonomy onto exactly one canonical kind", () => {
    const taxonomyEntries = Object.entries(TAXONOMY_MAPS) as Array<[SourceTaxonomy, Record<string, CanonicalSourceKind>]>;
    for (const [taxonomy, map] of taxonomyEntries) {
      for (const [legacy, canonical] of Object.entries(map)) {
        expect(toCanonicalSourceKind(taxonomy, legacy)).toBe(canonical);
        expect(CanonicalSourceKindValues).toContain(canonical);
      }
    }
  });

  it("returns undefined for unknown values instead of guessing", () => {
    expect(toCanonicalSourceKind("fact_source", "saved_job")).toBeUndefined();
    expect(toCanonicalSourceKind("job_target", "not_a_source")).toBeUndefined();
    expect(toCanonicalSourceKind("profile_recovery", "")).toBeUndefined();
  });

  it("round-trips: every canonical kind of a taxonomy resolves back to at least one legacy value", () => {
    for (const taxonomy of Object.keys(TAXONOMY_MAPS) as SourceTaxonomy[]) {
      const kinds = new Set(Object.values(TAXONOMY_MAPS[taxonomy]));
      for (const kind of kinds) {
        const legacyValues = legacySourceTypesForCanonicalKind(taxonomy, kind);
        expect(legacyValues.length).toBeGreaterThan(0);
        for (const legacy of legacyValues) {
          expect(toCanonicalSourceKind(taxonomy, legacy)).toBe(kind);
        }
      }
    }
  });

  it("keeps the factMaturity demonstrated-asset filter byte-identical to the legacy list", () => {
    expect([...LEGACY_DEMONSTRATED_ASSET_SOURCE_TYPES]).toEqual(["demo", "user_input", "imported_text", "pdf_import", "evidence"]);
  });

  it("preserves the specific compatibility decisions the audit recorded", () => {
    // demo 数据是系统种子内容，不是用户声明
    expect(FACT_SOURCE_TYPE_TO_CANONICAL.demo).toBe("system");
    // 导入文本与 PDF 导入同属文档导入
    expect(FACT_SOURCE_TYPE_TO_CANONICAL.imported_text).toBe("document_import");
    expect(FACT_SOURCE_TYPE_TO_CANONICAL.pdf_import).toBe("document_import");
    // 粘贴 JD 与保存的岗位都来自外部岗位来源；手动目标来自用户
    expect(JOB_TARGET_SOURCE_TYPE_TO_CANONICAL.pasted_jd).toBe("external_job_source");
    expect(JOB_TARGET_SOURCE_TYPE_TO_CANONICAL.manual_target).toBe("user_declared");
    // 恢复候选中的已确认 provenance 属于已核验证据
    expect(PROFILE_RECOVERY_SOURCE_TYPE_TO_CANONICAL.confirmed_provenance).toBe("verified_evidence");
    // 投递材料中的已确认事实起源于用户声明
    expect(MATERIAL_EVIDENCE_SOURCE_TYPE_TO_CANONICAL.career_fact).toBe("user_declared");
  });

  it("keeps FactMaturitySchema untouched (Fact Guard adjacent values unchanged)", () => {
    expect(FactMaturitySchema.options).toEqual(["demonstrated", "confirmed_capability", "familiar", "learning"]);
  });
});
