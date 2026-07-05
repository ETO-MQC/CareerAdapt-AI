import { nanoid } from "nanoid";
import type { JdAnalyzerOutput } from "@/domain/schemas";

export function createManualJdOutput(rawText: string, title: string, company: string): JdAnalyzerOutput {
  const now = new Date().toISOString();
  const sourceQuote = rawText.split(/[。；;\n]/).find(Boolean)?.slice(0, 120) || rawText.slice(0, 120);
  const start = rawText.indexOf(sourceQuote);
  const sourceSpan = start >= 0 ? { start, end: start + sourceQuote.length, text: sourceQuote } : undefined;

  return {
    title: {
      value: title,
      sourceQuote,
      sourceSpan,
      confidenceLevel: "medium",
      confidenceReason: "岗位名称来自用户填写。",
      needsConfirmation: false
    },
    company: {
      value: company,
      sourceQuote,
      sourceSpan,
      confidenceLevel: "medium",
      confidenceReason: "公司名称来自用户填写。",
      needsConfirmation: false
    },
    requirements: splitRequirementQuotes(rawText).map((quote, index) => {
      const quoteStart = rawText.indexOf(quote);
      const span = quoteStart >= 0 ? { start: quoteStart, end: quoteStart + quote.length, text: quote } : sourceSpan;
      return {
        id: `manual-req-${nanoid(8)}`,
        category: guessRequirementCategory(quote),
        description: quote || "待补充岗位要求",
        priority: index === 0 ? "important" : "uncertain",
        hardConstraint: /必须|需要|要求|熟练|required|must/i.test(quote),
        sourceQuote: quote,
        sourceSpan: span,
        keywords: extractKeywords(quote),
        confidenceLevel: "low",
        confidenceReason: "手动模式默认条目，需要用户分类确认。",
        needsConfirmation: false,
        confirmedByUser: true,
        createdAt: now,
        updatedAt: now
      };
    }),
    riskNotes: []
  };
}

function splitRequirementQuotes(rawText: string) {
  const parts = rawText
    .split(/[。；;\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, 8);
  return parts.length > 0 ? parts : [rawText.slice(0, 120) || "待补充岗位要求"];
}

function guessRequirementCategory(text: string) {
  if (/SQL|Python|Excel|Tableau|Power BI|Java|React|Next\.js|TypeScript|工具|技能/i.test(text)) {
    return "required_skill" as const;
  }
  if (/本科|硕士|学历|专业|大学|education/i.test(text)) {
    return "education" as const;
  }
  if (/证书|认证|certificate/i.test(text)) {
    return "certificate" as const;
  }
  if (/经验|实习|年/.test(text)) {
    return "experience" as const;
  }
  if (/沟通|协作|表达|推动/.test(text)) {
    return "soft_skill" as const;
  }
  return "responsibility" as const;
}

function extractKeywords(text: string) {
  const alnum = text.match(/[A-Za-z0-9+#.]+/g) ?? [];
  const chinese = text.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  return Array.from(new Set([...alnum, ...chinese].map((item) => item.trim()).filter((item) => item.length >= 2))).slice(0, 8);
}
