import { ProfileIntakeSourceTurnSchema } from "@/domain/profileIntake/ProfileIntakeSourceTurn";
import { findTechnicalTerms, technicalTermCategory } from "./ResumeSkillTaxonomy";
import { ResumeEvidenceGraphSchema, type ResumeEvidenceGraph } from "./contracts";
import type { FactMaturity } from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";

// Reuse the source-turn contract. This is evidence for one composition
// checkpoint, never a Profile fact or a second session profile.
export const CompositionSourceTurnSchema = ProfileIntakeSourceTurnSchema.pick({
  sessionId: true, messageId: true, turnId: true, exactSourceText: true
});
export type CompositionSourceTurn = ReturnType<typeof CompositionSourceTurnSchema.parse>;

export function sessionClaimPrefix(sessionId: string) {
  return `session-claim:${encodeURIComponent(sessionId)}:`;
}

export function addSessionConfirmedSkills(graph: ResumeEvidenceGraph, source: CompositionSourceTurn): ResumeEvidenceGraph {
  const result = ResumeEvidenceGraphSchema.parse(graph);
  const turn = CompositionSourceTurnSchema.parse(source);
  // Accept direct capability declarations only. A recalled example, a JD,
  // a hypothetical, or a request to invent something is not a declaration.
  for (const clause of turn.exactSourceText.split(/[，,。！？!?；;\n]/u)) {
    const terms = findTechnicalTerms(clause);
    const removePrevious = (name: string) => {
      const previousIds = result.nodes.filter(node => node.value === name && node.id.startsWith(sessionClaimPrefix(turn.sessionId))).map(node => node.id);
      result.nodes = result.nodes.filter(node => !previousIds.includes(node.id));
      result.skillMatrix = result.skillMatrix.filter(skill => !skill.evidenceNodeIds.some(id => previousIds.includes(id)));
    };
    if (/我(?:还|确实)?(?:不会|没用过|未使用|没有用过)/u.test(clause)) {
      for (const name of terms) removePrevious(name);
      continue;
    }
    if (/示例|例子|比如|例如|假设|如果|也许|可能|帮我编|替我编|没确认|未确认|岗位要求|任职要求|要求掌握|不会|没用过|未使用|不确定|是否|能否|吗|同事|同学|朋友|别人|他会|她会/u.test(clause)) continue;
    if (terms.length > 1 && /或|其中|任选/u.test(clause)) continue;
    if (!/(?:我(?:会|能|只学过|学过|用过|接触过|正在学)|(?:基础查询|基础任务).*我能|(?:课程|比赛|练习).*用过|只学过|正在学习)/u.test(clause)) continue;
    const maturity: FactMaturity = /只学过|学过|接触|了解|基础接触/u.test(clause) ? "familiar"
      : /正在学|学习中/u.test(clause) ? "learning" : "confirmed_capability";
    for (const name of terms) {
      // Only the ordinary skill label is emitted. Metrics, credentials,
      // dates, project delivery and ownership in a narration are never copied.
      removePrevious(name);
      if (result.skillMatrix.some(skill => skill.name === name)) continue;
      const id = `${sessionClaimPrefix(turn.sessionId)}${stableHashText(`${turn.turnId}:${name}`)}`;
      result.nodes.push({ id, type: "skill", value: name, sourceAssetIds: [id], factIds: [],
        sourceTurnIds: [turn.turnId], confirmationStatus: "confirmed", maturity,
        ownershipStrength: 0, sourceExcerpts: [clause.trim()] });
      result.skillMatrix.push({ name, category: technicalTermCategory(name) ?? "其他", sourceAssetIds: [id],
        factIds: [], evidenceNodeIds: [id], evidenceCount: 1, maturity });
    }
  }
  return ResumeEvidenceGraphSchema.parse(result);
}
