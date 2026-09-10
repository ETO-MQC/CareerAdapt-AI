import type { FactMaturity, FactStatement, SkillProficiency } from "@/domain/schemas";

/**
 * Legacy facts predate maturity. The historical write paths that produced
 * non-skill facts all required a user-confirmed source (manual narration,
 * confirmed imported text, or a located PDF quote), so those facts retain the
 * old demonstrated-asset meaning. Skills and languages are declarations of
 * capability, not project proof, and therefore project to the narrower
 * confirmed_capability value. This is a read-time compatibility projection;
 * it does not authorize an unconfirmed or high-risk fact for a resume.
 */
export function factMaturityOf(fact: FactStatement | undefined, fallback: FactMaturity = "demonstrated"): FactMaturity {
  if (fact?.maturity) return fact.maturity;
  if (!fact) return fallback;
  const hasUserConfirmedProvenance = fact.provenance.some((source) => source.confirmedByUser);
  const hasHighRiskProvenance = fact.provenance.some((source) => source.riskLevel === "high");
  if (!fact.confirmedByUser || !hasUserConfirmedProvenance || fact.riskLevel === "high" || hasHighRiskProvenance) return fallback;
  if (fact.category === "skill" || fact.category === "language") return "confirmed_capability";
  const hasHistoricalEvidenceSource = fact.provenance.some((source) =>
    ["demo", "user_input", "imported_text", "pdf_import", "evidence"].includes(source.sourceType)
  );
  if (hasHistoricalEvidenceSource) return "demonstrated";
  // A confirmed fact from an unrecognised/system source is not allowed to
  // inherit demonstrated status; retain only the user-confirmed capability
  // claim until a stronger source is present.
  return "confirmed_capability";
}

export function strongestFactMaturity(facts: FactStatement[], fallback: FactMaturity = "demonstrated"): FactMaturity {
  const rank: Record<FactMaturity, number> = {
    learning: 0,
    familiar: 1,
    confirmed_capability: 2,
    demonstrated: 3
  };
  return facts
    .map((fact) => factMaturityOf(fact, fallback))
    .sort((left, right) => rank[right] - rank[left])[0] ?? fallback;
}

export function maturityForSkillProficiency(proficiency: SkillProficiency | undefined): FactMaturity {
  if (proficiency === "proficient") return "confirmed_capability";
  if (proficiency === "familiar" || proficiency === "aware") return "familiar";
  if (proficiency === "learning") return "learning";
  return "confirmed_capability";
}

export function maturityForTailoringAnswer(answer: string, proficiency?: SkillProficiency): FactMaturity | undefined {
  const normalized = answer.trim().toLocaleLowerCase();
  if (!normalized || /没有|不具备|未使用|没用过|跳过|不确定/u.test(normalized)) return undefined;
  if (/实际做过|有相关经历|真实经历|做过/u.test(normalized)) return "confirmed_capability";
  if (/独立完成基础|基础任务|熟练/u.test(normalized)) return "confirmed_capability";
  if (/接触|熟悉|了解|不完整/u.test(normalized)) return "familiar";
  if (/学习|正在学|aspirational|想学/u.test(normalized)) return "learning";
  return proficiency ? maturityForSkillProficiency(proficiency) : undefined;
}

export function maturityLabel(maturity: FactMaturity): string {
  return ({
    demonstrated: "已证明经历",
    confirmed_capability: "用户确认能力",
    familiar: "熟悉 / 基础接触",
    learning: "学习中 / 目标能力"
  } as const)[maturity];
}

export function canUseAsResumeEvidence(maturity: FactMaturity, mode: "steady" | "competitive" | "max_fit" = "competitive") {
  if (maturity === "demonstrated") return true;
  if (maturity === "confirmed_capability") return mode !== "steady";
  return false;
}
