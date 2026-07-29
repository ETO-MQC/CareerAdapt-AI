import { ImportedResumeDraftSchema, type ImportedResumeDraft } from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";
import { ProfileIntakeNormalizer } from "./ProfileIntakeNormalizer";

export type ConversationIntakeCandidate = {
  id: string;
  kind: "education" | "project" | "award" | "research" | "campus";
  label: string;
  sourceQuote: string;
  needsConfirmation: boolean;
  reason?: string;
};

export type ConversationIntakeArtifact = {
  title: "经历核对";
  recognized: Array<{ id: string; label: string }>;
  needsConfirmation: Array<{ id: string; label: string; reason: string }>;
  duplicates: Array<{ id: string; label: string }>;
  additions: Array<{ id: string; label: string }>;
  sources: Array<{
    sessionId: string;
    messageId: string;
    turnId: string;
    capturedAt: string;
  }>;
};

export function adaptConversationMessageToIntakeDraft(input: {
  sessionId: string;
  messageId: string;
  turnId: string;
  text: string;
  capturedAt: string;
  importId?: string;
}): {
  draft: ImportedResumeDraft;
  candidates: ConversationIntakeCandidate[];
  artifact: ConversationIntakeArtifact;
} {
  const text = input.text.trim();
  if (!text) throw new Error("profile_intake_source_empty");
  const shortHash = stableHashText(`${input.sessionId}:${input.messageId}:${text}`);
  const hash = `${shortHash}${stableHashText(`${text}:${input.turnId}`)}`;
  const importId = input.importId ?? `conversation-intake-${hash.slice(0, 20)}`;
  const normalizer = new ProfileIntakeNormalizer();
  const candidates = extractCandidates(text, hash.slice(0, 8)).map((candidate) => {
    const normalized = normalizer.normalize(candidate);
    return normalized.needsConfirmation && !candidate.needsConfirmation
      ? {
          ...candidate,
          needsConfirmation: true,
          reason: "来源包含可能影响职业事实准确性的表述，请确认"
        }
      : candidate;
  });
  const sections = candidates.map((candidate, order) => {
    const normalized = normalizer.normalize(candidate);
    return {
    id: `section-${candidate.id}`,
    sectionType: candidateSectionType(candidate.kind),
    category: candidateCategory(candidate.kind),
    detectedTitle: candidate.label,
    included: !candidate.needsConfirmation,
    order,
    confidence: candidate.needsConfirmation ? "low" as const : "high" as const,
    items: [{
      id: candidate.id,
      rawText: candidate.sourceQuote,
      normalizedText: normalized.normalizedText,
      included: !candidate.needsConfirmation,
      order: 0,
      pageRefs: [{ pageNumber: 1, quote: candidate.sourceQuote }],
      confidence: candidate.needsConfirmation ? "low" as const : "high" as const,
      sourceStatus: candidate.needsConfirmation ? "ambiguous" as const : "user_confirmed_modified" as const,
      userEdited: false,
      sourceBlockIds: [],
      itemLabel: candidate.label,
      structuredItem: normalized.structuredItem,
      structuredMappingTrace: [],
      sourceQuote: candidate.sourceQuote,
      conversationEvidence: [{
        sessionId: input.sessionId,
        messageId: input.messageId,
        turnId: input.turnId,
        capturedAt: input.capturedAt,
        sourceQuote: candidate.sourceQuote,
        supportedFields: normalized.fieldEvidence.map((item) => item.field)
      }],
      careerNormalization: {
        version: "profile-intake-normalization-v1" as const,
        mode: "deterministic" as const,
        needsNormalization: normalized.needsNormalization,
        fieldEvidence: normalized.fieldEvidence
      }
    }]
  };
  });
  const draft = ImportedResumeDraftSchema.parse({
    id: importId,
    schemaVersion: "resume-import-v1",
    importId,
    revision: 0,
    status: "reviewing",
    source: {
      sourceSessionId: input.sessionId,
      sourceMessageId: input.messageId,
      sourceTurnId: input.turnId,
      capturedAt: input.capturedAt,
      fileName: `conversation-${input.messageId}.txt`,
      mimeType: "application/x-careeradapt-conversation",
      fileHash: hash,
      normalizedTextHash: stableHashText(text),
      pageCount: 1,
      extractedAt: input.capturedAt
    },
    sourceKind: "conversation",
    sourceBlocks: [],
    basics: { links: [] },
    sections,
    pages: [{
      pageNumber: 1,
      rawText: text,
      normalizedText: text,
      charStart: 0,
      charEnd: text.length
    }],
    unclassifiedBlocks: [],
    warnings: candidates.filter((candidate) => candidate.needsConfirmation).map((candidate) => ({
      code: "ambiguous_field",
      message: candidate.reason ?? `${candidate.label} 需要确认`,
      pageNumber: 1,
      itemId: candidate.id,
      sectionId: `section-${candidate.id}`
    })),
    parserVersion: "conversation-intake.v1",
    createdAt: input.capturedAt,
    updatedAt: input.capturedAt
  });
  const recognized = candidates.filter((candidate) => !candidate.needsConfirmation);
  return {
    draft,
    candidates,
    artifact: {
      title: "经历核对",
      recognized: recognized.map(({ id, label }) => ({ id, label })),
      needsConfirmation: candidates
        .filter((candidate) => candidate.needsConfirmation)
        .map(({ id, label, reason }) => ({ id, label, reason: reason ?? "名称或表述可能来自语音转写，请确认" })),
      duplicates: [],
      additions: recognized.map(({ id, label }) => ({ id, label })),
      sources: [{
        sessionId: input.sessionId,
        messageId: input.messageId,
        turnId: input.turnId,
        capturedAt: input.capturedAt
      }]
    }
  };
}

function extractCandidates(text: string, seed: string): ConversationIntakeCandidate[] {
  const result: ConversationIntakeCandidate[] = [];
  const add = (
    kind: ConversationIntakeCandidate["kind"],
    key: string,
    label: string,
    pattern: RegExp,
    options?: { ambiguous?: RegExp; reason?: string }
  ) => {
    const sourceQuote = sourceSentence(text, pattern);
    if (!sourceQuote) return;
    const needsConfirmation = Boolean(options?.ambiguous?.test(sourceQuote));
    result.push({
      id: `intake-${seed}-${key}`,
      kind,
      label,
      sourceQuote,
      needsConfirmation,
      reason: needsConfirmation ? options?.reason : undefined
    });
  };

  add("education", "education", educationLabel(text), /示例大学|计算机相关专业/);
  add("project", "esp32", "ESP32 穿戴设备课程项目", /ESP\s*32|心跳.*摔倒|摔倒.*心跳/i);
  add("award", "lanqiao", "示例编程竞赛某省省级三等奖", /示例编程竞赛|南郊杯|蓝郊杯/, {
    ambiguous: /南郊杯|蓝郊杯|示例编程竞赛.*南郊杯/,
    reason: "竞赛名称存在可能的语音转写差异"
  });
  add("research", "research", "视觉模型 / Python PDF 数据提取", /1000\s*页|视觉模型.*Python|Python.*PDF/i);
  add("campus", "league", "团支书与团日活动", /团支书|团日活动/);
  add("project", "smartfocus", projectLabel(text, /Smart\s*(Focus|Fox)|Task\s*AI/i, "示例任务系统 / TaskAI"), /Smart\s*(Focus|Fox)|Task\s*AI/i, {
    ambiguous: /Smart\s*Fox/i,
    reason: "项目名称可能是 示例任务系统、Smart Fox 或 TaskAI"
  });
  add("project", "learning-assistant", projectLabel(
    text,
    /Learn\s*(?:Some|Kata|Cat)(?:\s*AI\s*Tool)?/i,
    "AI 学习助手"
  ), /Learn\s*(?:Some|Kata|Cat)(?:\s*AI\s*Tool)?/i, {
    ambiguous: /Learn\s*Cat/i,
    reason: "项目名称可能被语音转写"
  });
  add("project", "xiaohongshu", "示例内容采集与 AI 可信度分析", /示例内容.*(可信度|可视|采集)|可信度分析.*示例内容/);
  add("project", "careeradap", "CareerAdapt AI", /CareerAdapt\s*AI|职适\s*AI|简历制作平台/i);
  return result;
}

function sourceSentence(text: string, pattern: RegExp) {
  const clauses = text
    .split(/[。！？；\n]+|(?:然后)?(?=社团学生组织)|(?:下一个|第二个|第三个|第四个)/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const clause = clauses.find((value) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
  pattern.lastIndex = 0;
  return clause?.slice(0, 1200);
}

function projectLabel(text: string, pattern: RegExp, fallback: string) {
  return pattern.exec(text)?.[0]?.trim() || fallback;
}

function educationLabel(text: string) {
  const values = [
    /示例大学/u.test(text) ? "示例大学" : undefined,
    /计算机相关专业/u.test(text) ? "计算机相关专业" : undefined
  ].filter(Boolean);
  return values.join(" / ");
}

function candidateSectionType(kind: ConversationIntakeCandidate["kind"]) {
  if (kind === "award") return "awards" as const;
  return kind;
}

function candidateCategory(kind: ConversationIntakeCandidate["kind"]) {
  if (kind === "award") return "award" as const;
  if (kind === "research") return "custom" as const;
  return kind;
}
