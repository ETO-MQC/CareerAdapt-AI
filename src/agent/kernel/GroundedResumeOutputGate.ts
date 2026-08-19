import type { AgentSession, AgentTaskState } from "@/agent/contracts/agentSession";
import type { AgentArtifactRef } from "@/agent/contracts/agentArtifact";
import {
  ResumeCompositionProposalSchema,
  ResumeCompositionResultSchema
} from "@/domain/resumeComposition/contracts";
import { ResumeArtifactReceiptSchema } from "@/agent/contracts/resumeArtifactWrite";

export type GroundedResumeOutputDecision =
  | { allowed: true }
  | { allowed: false; reasonCode: string; recoveryText: string };

export function evaluateGroundedResumeOutput(input: {
  text: string;
  taskState: AgentTaskState;
  artifactRefs?: AgentArtifactRef[];
  explicitUserAuthoredSample?: boolean;
  explicitUserRequestedDraft?: boolean;
}) : GroundedResumeOutputDecision {
  const text = input.text.trim();
  if (!looksLikeResumePresentation(text)) return { allowed: true };
  // Other resume workflows (especially tailoring) have their own
  // authoritative diff/quality gates. This guard is the composition boundary
  // and must not turn a legitimate tailoring recovery prompt into a fabricated
  // composition failure.
  const tailoringWorkflow = input.taskState.workflowId === "tailor_resume"
    || ["generate_job_specific_resume", "apply_to_external_job", "create_tailored_resume", "apply_to_job"].includes(input.taskState.rootGoal);
  const compositionWorkflow = input.taskState.workflowId === "compose_resume" || input.taskState.rootGoal === "compose_resume";
  if (!compositionWorkflow && !tailoringWorkflow) {
    return { allowed: true };
  }
  if (
    input.explicitUserAuthoredSample
    || input.explicitUserRequestedDraft
    || input.taskState.knownSlots.nonPersistedDraftModeRequested === true
  ) return { allowed: true };

  if (tailoringWorkflow) {
    const slots = input.taskState.knownSlots;
    const quality = objectValue(slots.qualityResult);
    const artifactReceipt = ResumeArtifactReceiptSchema.safeParse(
      slots.artifactReceipt
        ?? quality.artifactReceipt
        ?? slots.applyReceipt
        ?? quality.receipt
    );
    if (!artifactReceipt.success) return blocked("resume_output_without_artifact_receipt");
    const corpus = JSON.stringify({ quality, receipt: artifactReceipt.data });
    if (containsUnsupportedHardClaim(text, corpus)) return blocked("resume_output_contains_unsupported_fact");
    return { allowed: true };
  }

  const slots = input.taskState.knownSlots;
  const proposal = ResumeCompositionProposalSchema.safeParse(
    slots.resumeCompositionProposal ?? objectValue(slots.resumeCompositionCheckpoint).proposal
  );
  const rawResult = slots.resumeCompositionResult ?? objectValue(slots.resumeCompositionCheckpoint).compositionResult;
  const directResult = ResumeCompositionResultSchema.safeParse(rawResult);
  const nestedResult = ResumeCompositionResultSchema.safeParse(objectValue(rawResult).composition);
  const result = directResult.success ? directResult : nestedResult;
  const currentResumeId = stringValue(
    slots.resumeCompositionResult && objectValue(slots.resumeCompositionResult).resumeId
  ) ?? input.taskState.selectedEntities.resumeId;
  const persistedArtifact = (input.artifactRefs ?? []).some((artifact) =>
    artifact.kind === "quality_result"
      && Boolean(currentResumeId && artifact.entityId === currentResumeId)
  );
  if (!proposal.success && !result.success && !persistedArtifact) {
    return blocked("resume_output_without_grounding");
  }

  const corpus = JSON.stringify({
    proposal: proposal.success ? proposal.data : undefined,
    result: result.success ? result.data : rawResult,
    checkpoint: slots.resumeCompositionCheckpoint,
    graph: slots.resumeCompositionEvidenceGraph
  });
  if (containsUnsupportedHardClaim(text, corpus)) {
    return blocked("resume_output_contains_unsupported_fact");
  }
  return { allowed: true };
}

export function isGroundedResumeTask(session: Pick<AgentSession, "taskState" | "artifactRefs">) {
  const taskState = session.taskState;
  if (!taskState) return false;
  const rawResult = taskState.knownSlots.resumeCompositionResult;
  return ResumeCompositionProposalSchema.safeParse(
    taskState.knownSlots.resumeCompositionProposal
      ?? objectValue(taskState.knownSlots.resumeCompositionCheckpoint).proposal
  ).success
    || ResumeCompositionResultSchema.safeParse(rawResult).success
    || ResumeCompositionResultSchema.safeParse(objectValue(rawResult).composition).success
    || session.artifactRefs.some((artifact) => artifact.kind === "quality_result"
      && Boolean(taskState.selectedEntities.resumeId && artifact.entityId === taskState.selectedEntities.resumeId));
}

function blocked(reasonCode: string): GroundedResumeOutputDecision {
  return {
    allowed: false,
    reasonCode,
    recoveryText: "这次简历输出还没有形成可展示的正式凭证。我已保留当前方向和已完成步骤，请从当前步骤继续；不会把未确认内容显示为简历。"
  };
}

function looksLikeResumePresentation(text: string) {
  if (text.length < 48) return false;
  return /(?:教育经历|工作经历|实习经历|项目经历|校园经历|技能证书|个人简介|求职目标|教育背景|工作经验|项目经验|GPA|CET-?6|个人优势)/iu.test(text)
    || /(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+[^\n]{8,}/u.test(text) && /简历|经历|项目|技能/iu.test(text);
}

function containsUnsupportedHardClaim(text: string, corpus: string) {
  const normalizedCorpus = corpus.toLowerCase();
  const suspiciousClaims = [
    /(?:xx|某某|未知)(?:大学|学院)/iu,
    /(?:xx|某某|未知)(?:科技|公司|企业|集团|有限公司)/iu,
    /(?:电商用户行为分析系统|用户行为分析系统|智能招聘平台|在线教育平台)/iu,
    /(?:毕业于|就读于|教育背景[：:])[^\n]{2,48}(?:大学|学院)/iu,
    /(?:任职于|就职于|供职于|工作经历[：:])[^\n]{2,64}(?:公司|科技|企业|集团|有限公司)/iu,
    /(?:本科|硕士|博士)[^\n]{0,18}(?:大学|学院)/iu,
    /(?:学校|院校|毕业院校|教育背景|教育经历|学历|学位)\s*[：:]\s*[^\n]{1,80}(?:大学|学院|本科|硕士|博士)/iu,
    /(?:公司|企业|实习单位|雇主|工作单位|任职于|就职于|实习于)\s*[：:]\s*[^\n]{1,80}/iu,
    /(?:实习经历|工作经历)\s*[：:]\s*[^\n]{2,80}/iu,
    /(?:项目名称|项目经历|项目经验)\s*[：:]\s*[^\n]{2,80}/iu,
    /(?:奖项|荣誉|获奖|证书|认证|资格证|技能证书|语言证书)\s*[：:]\s*[^\n]{1,80}/iu,
    /(?:熟练|精通|掌握|技能熟练度)\s*[^。\n]{1,48}/iu,
    /(?:专业排名|年级排名|排名|名次|位次)\s*[：:]\s*[^\n]{1,32}/iu,
    /(?:第\s*\d+\s*名|前\s*\d+(?:\.\d+)?\s*%|一等奖|二等奖|三等奖|奖学金|优秀学生|优秀毕业生)/iu,
    /(?:19|20)\d{2}(?:年\d{1,2}月?(?:\d{1,2}日)?|[./-]\d{1,2}(?:[./-]\d{1,2})?)/u,
    /(?:开发|负责|搭建|设计|实现|参与)[^。\n]{0,36}(?:系统|平台|项目|应用)/iu,
    /GPA\s*[:：]?\s*\d+(?:\.\d+)?/iu,
    /CET[-\s]?6\s*[:：]?\s*\d{3,4}/iu,
    /(?:\d+(?:\.\d+)?万\+|\d{3,}[+]?(?:并发|用户|次|人))/u,
    /(?:提升|增长|降低|减少|提高)[^。\n]{0,12}\d+(?:\.\d+)?%/u
  ];
  return suspiciousClaims.some((pattern) => {
    const match = text.match(pattern)?.[0];
    return Boolean(match && !hasCorpusSupport(match, normalizedCorpus));
  });
}

function hasCorpusSupport(match: string, normalizedCorpus: string) {
  const normalizedMatch = match.toLowerCase();
  if (normalizedCorpus.includes(normalizedMatch)) return true;
  const separator = match.search(/[：:]/u);
  if (separator < 0) return false;
  const value = match
    .slice(separator + 1)
    .replace(/^(?:毕业于|就读于|任职于|就职于|供职于|实习于)\s*/iu, "")
    .trim();
  const parts = value
    .split(/[，,、；;|/]/u)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 2)
    .filter((part) => !/^(?:本科|硕士|博士|学历|学位|学校|院校|奖项|荣誉|证书|认证)$/u.test(part));
  return parts.length > 0 && parts.every((part) => normalizedCorpus.includes(part));
}


function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
