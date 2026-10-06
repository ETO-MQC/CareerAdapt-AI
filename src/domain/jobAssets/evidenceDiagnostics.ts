/**
 * V4-P1 阶段 6b：证据定位诊断。
 *
 * Adapted from MyCareer (https://github.com/low-hands/MyCareer),
 * MIT License, Copyright (c) 2026 Rui Guo —
 * agent/contracts/resume_job_match.py 的 ResumeMatchEvidence
 * （source_locator / source_quote / page）grounding 契约。
 *
 * 诊断是对既有 `locateSourceQuote`（src/services/security/text.ts，行为保持
 * 不变）的结构化包装：把"引用能否回到原文"的三种结局显式分类——
 * located（直接或忽略空白差异命中）/ empty_quote（空引用）/ not_found（原文
 * 中不存在）。AI 输出的证据引用必须先通过本诊断才能作为 grounding 使用；
 * not_found 的引用不得进入 ResumePatchSupportEvidence 的 sourceSpan。
 */

import { locateSourceQuote } from "@/services/security/text";
import type { SourceSpan } from "@/domain/schemas";

export const EVIDENCE_DIAGNOSTICS_ALGORITHM = "careeradapt-evidence-diagnostics-v1";

export type EvidenceLocationDiagnostic =
  | { status: "located"; span: SourceSpan }
  | { status: "empty_quote" }
  | { status: "not_found"; quote: string };

export function diagnoseEvidenceLocation(rawText: string, quote: string): EvidenceLocationDiagnostic {
  if (!quote.trim()) return { status: "empty_quote" };
  const span = locateSourceQuote(rawText, quote);
  if (span) return { status: "located", span };
  return { status: "not_found", quote: quote.slice(0, 200) };
}

export type EvidenceGroundingSummary = {
  located: EvidenceLocationDiagnostic[];
  notFound: EvidenceLocationDiagnostic[];
  empty: EvidenceLocationDiagnostic[];
  allLocated: boolean;
  algorithm: typeof EVIDENCE_DIAGNOSTICS_ALGORITHM;
};

/** 批量诊断：逐条分类并给出 overall 结论（全部命中才算 grounding 通过）。 */
export function diagnoseEvidenceGrounding(
  rawText: string,
  quotes: readonly string[]
): EvidenceGroundingSummary {
  const located: EvidenceLocationDiagnostic[] = [];
  const notFound: EvidenceLocationDiagnostic[] = [];
  const empty: EvidenceLocationDiagnostic[] = [];
  for (const quote of quotes) {
    const diagnostic = diagnoseEvidenceLocation(rawText, quote);
    if (diagnostic.status === "located") located.push(diagnostic);
    else if (diagnostic.status === "not_found") notFound.push(diagnostic);
    else empty.push(diagnostic);
  }
  return {
    located,
    notFound,
    empty,
    allLocated: located.length === quotes.length,
    algorithm: EVIDENCE_DIAGNOSTICS_ALGORITHM
  };
}

/** 把 located 的 span 回填进 patch 证据；not_found/empty 原样拒绝。 */
export function attachSpanToPatchEvidence<T extends { sourceQuote: string }>(
  rawText: string,
  evidence: T
): T & { sourceSpan?: SourceSpan } | { status: "not_found"; quote: string } | { status: "empty_quote" } {
  const diagnostic = diagnoseEvidenceLocation(rawText, evidence.sourceQuote);
  if (diagnostic.status === "located") return { ...evidence, sourceSpan: diagnostic.span };
  if (diagnostic.status === "not_found") return diagnostic;
  return diagnostic;
}
