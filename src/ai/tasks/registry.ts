import { nanoid } from "nanoid";
import { z } from "zod";
import {
  AiTaskSchema,
  EvidenceMatcherOutputSchema,
  JdAnalyzerOutputSchema,
  MatchEvidenceRefSchema,
  ProfileBuilderOutputSchema,
  type AiTask,
  type EvidenceMatcherOutput,
  type JdAnalyzerOutput,
  type MatchRisk,
  type ProfileBuilderOutput
} from "@/domain/schemas";
import { locateSourceQuote, redactSensitiveTextForModel } from "@/services/security/text";
import { evidenceMatcherPrompt } from "@/ai/prompts/evidenceMatcher";
import { jdAnalyzerPrompt } from "@/ai/prompts/jdAnalyzer";
import { profileBuilderPrompt } from "@/ai/prompts/profileBuilder";

export const stageBAiTaskSchema = z.enum(["profile-builder", "jd-analyzer"]);

const BaseAiInputSchema = z.object({
  rawText: z.string().min(1).max(24_000),
  inputHash: z.string().min(8)
});

export const ProfileBuilderTaskInputSchema = BaseAiInputSchema;

export const JdAnalyzerTaskInputSchema = BaseAiInputSchema.extend({
  title: z.string().min(1).max(120),
  company: z.string().min(1).max(120)
});

export const EvidenceMatcherCandidateSchema = z.object({
  evidenceRef: MatchEvidenceRefSchema,
  searchText: z.string().min(1).max(2_000)
});

export const EvidenceMatcherTaskInputSchema = z.object({
  profileId: z.string().min(1),
  jobId: z.string().min(1),
  profileVersion: z.number().int().min(1),
  jobVersion: z.string().min(1),
  matcherVersion: z.string().min(1),
  candidateSetHash: z.string().min(8),
  requirement: z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    sourceQuote: z.string().min(1),
    hardConstraint: z.boolean(),
    keywords: z.array(z.string()).default([])
  }),
  candidates: z.array(EvidenceMatcherCandidateSchema).max(8)
});

export type StageBAiTask = z.infer<typeof stageBAiTaskSchema>;
export type ProfileBuilderTaskInput = z.infer<typeof ProfileBuilderTaskInputSchema>;
export type JdAnalyzerTaskInput = z.infer<typeof JdAnalyzerTaskInputSchema>;
export type EvidenceMatcherTaskInput = z.infer<typeof EvidenceMatcherTaskInputSchema>;

export type AiTaskDefinition<TInput, TOutput> = {
  task: AiTask;
  promptVersion: string;
  systemPrompt: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  maxOutputChars: number;
  buildUserPrompt(input: TInput): string;
  coerceRawOutput(rawOutput: unknown): unknown;
  normalizeOutput(output: TOutput, input: TInput): TOutput;
  validateOutput?(output: TOutput, input: TInput): void;
};

export type StageBTaskDefinition<TInput, TOutput> = AiTaskDefinition<TInput, TOutput> & {
  task: StageBAiTask;
};

export const aiTaskRegistry = {
  "profile-builder": {
    task: "profile-builder",
    promptVersion: profileBuilderPrompt.version,
    systemPrompt: profileBuilderPrompt.system,
    inputSchema: ProfileBuilderTaskInputSchema,
    outputSchema: ProfileBuilderOutputSchema,
    maxOutputChars: 18_000,
    buildUserPrompt(input: ProfileBuilderTaskInput) {
      const redacted = redactSensitiveTextForModel(input.rawText);
      return JSON.stringify(
        {
          rawText: redacted.text,
          redactions: redacted.redactions,
          instructions: "Extract a career master profile draft from this redacted resume text."
        },
        null,
        2
      );
    },
    coerceRawOutput(rawOutput: unknown) {
      const raw = rawOutput as Record<string, unknown>;
      const now = new Date().toISOString();

      // Coerce basics — model may return flat strings instead of DraftSourceField objects
      const rawBasics = (raw.basics ?? {}) as Record<string, unknown>;
      const basics = {
        name: coerceDraftField(rawBasics.name),
        phone: coerceDraftField(rawBasics.phone),
        email: coerceDraftField(rawBasics.email),
        location: coerceDraftField(rawBasics.location),
        summary: coerceDraftField(rawBasics.summary),
        links: Array.isArray(rawBasics.links) ? rawBasics.links.map(coerceDraftField).filter(Boolean) : []
      };

      const experiences = ((raw.experiences ?? raw.experience ?? []) as unknown[]).map((exp) => {
        const e = exp as Record<string, unknown>;
        return {
          id: typeof e.id === "string" ? e.id : `profile-exp-${nanoid(8)}`,
          type: typeof e.type === "string" ? e.type : "other",
          organization: coerceDraftField(e.organization ?? e.company ?? e.org ?? e.orgName ?? e.institution) ?? { value: pickString(e.organization, e.company, e.org, e.orgName, e.institution) || "待确认组织", sourceQuote: pickString(e.organization, e.company, e.org, e.orgName, e.institution) || "待确认组织", confidenceLevel: "low" as const, confidenceReason: "Coerced from model output.", needsConfirmation: true },
          role: coerceDraftField(e.role ?? e.position ?? e.title ?? e.jobTitle) ?? { value: pickString(e.role, e.position, e.title, e.jobTitle) || "待确认角色", sourceQuote: pickString(e.role, e.position, e.title, e.jobTitle) || "待确认角色", confidenceLevel: "low" as const, confidenceReason: "Coerced from model output.", needsConfirmation: true },
          startDate: coerceDraftField(e.startDate ?? e.start),
          endDate: coerceDraftField(e.endDate ?? e.end),
          facts: ((e.facts ?? e.details ?? []) as unknown[]).map((fact) => {
            const f = fact as Record<string, unknown>;
            return {
              id: typeof f.id === "string" ? f.id : `profile-fact-${nanoid(8)}`,
              statement: typeof f.statement === "string" ? f.statement : typeof f.text === "string" ? f.text : typeof f.content === "string" ? f.content : "",
              category: typeof f.category === "string" ? f.category : "experience",
              sourceQuote: typeof f.sourceQuote === "string" ? f.sourceQuote : typeof f.statement === "string" ? f.statement : "",
              sourceSpan: f.sourceSpan,
              confidenceLevel: typeof f.confidenceLevel === "string" ? f.confidenceLevel : "low",
              confidenceReason: pickString(f.confidenceReason, f.reason, "Coerced from model output."),
              needsConfirmation: typeof f.needsConfirmation === "boolean" ? f.needsConfirmation : true,
              confirmedByUser: false,
              createdAt: typeof f.createdAt === "string" ? f.createdAt : now,
              updatedAt: typeof f.updatedAt === "string" ? f.updatedAt : now
            };
          }),
          tags: Array.isArray(e.tags) ? e.tags : [],
          confirmedByUser: false,
          createdAt: typeof e.createdAt === "string" ? e.createdAt : now,
          updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : now
        };
      });

      const skills = Array.isArray(raw.skills) ? raw.skills.map((skill) => {
        const s = skill as Record<string, unknown>;
        // Skill name can be under many different field names
        const nameField = coerceDraftField(s.name ?? s.skill ?? s.skillName ?? s.title ?? s.text ?? s.value ?? s.content ?? s.description)
          ?? { value: pickString(s.name, s.skill, s.skillName, s.title, s.text, s.value, s.content, s.description) || "待确认技能", sourceQuote: pickString(s.name, s.skill, s.skillName, s.title, s.text, s.value, s.content, s.description) || "待确认技能", confidenceLevel: "low" as const, confidenceReason: "Coerced from model output.", needsConfirmation: true };
        return {
          id: typeof s.id === "string" ? s.id : `profile-skill-${nanoid(8)}`,
          name: nameField,
          level: typeof s.level === "string" ? s.level : undefined,
          sourceQuote: nameField.sourceQuote,
          sourceSpan: s.sourceSpan,
          confidenceLevel: typeof s.confidenceLevel === "string" ? s.confidenceLevel : "low",
          confidenceReason: pickString(s.confidenceReason, s.reason, "Coerced from model output."),
          needsConfirmation: typeof s.needsConfirmation === "boolean" ? s.needsConfirmation : true,
          confirmedByUser: false,
          createdAt: typeof s.createdAt === "string" ? s.createdAt : now,
          updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : now
        };
      }) : [];

      const certificates = Array.isArray(raw.certificates) ? raw.certificates.map((cert) => {
        const c = cert as Record<string, unknown>;
        const nameField = coerceDraftField(c.name ?? c.certificate ?? c.title ?? c.text ?? c.value ?? c.content)
          ?? { value: pickString(c.name, c.certificate, c.title, c.text, c.value, c.content) || "待确认证书", sourceQuote: pickString(c.name, c.certificate, c.title, c.text, c.value, c.content) || "待确认证书", confidenceLevel: "low" as const, confidenceReason: "Coerced.", needsConfirmation: true };
        return {
          id: typeof c.id === "string" ? c.id : `profile-cert-${nanoid(8)}`,
          name: nameField,
          issuer: coerceDraftField(c.issuer ?? c.organization),
          issuedAt: coerceDraftField(c.issuedAt ?? c.date),
          sourceQuote: nameField.sourceQuote,
          sourceSpan: c.sourceSpan,
          confidenceLevel: typeof c.confidenceLevel === "string" ? c.confidenceLevel : "low",
          confidenceReason: pickString(c.confidenceReason, c.reason, "Coerced from model output."),
          needsConfirmation: typeof c.needsConfirmation === "boolean" ? c.needsConfirmation : true,
          confirmedByUser: false,
          createdAt: typeof c.createdAt === "string" ? c.createdAt : now,
          updatedAt: typeof c.updatedAt === "string" ? c.updatedAt : now
        };
      }) : [];

      const unclassifiedBlocks = Array.isArray(raw.unclassifiedBlocks) ? raw.unclassifiedBlocks : [];

      return { basics, experiences, skills, certificates, unclassifiedBlocks };
    },
    normalizeOutput(output: ProfileBuilderOutput, input: ProfileBuilderTaskInput) {
      const basics = output.basics ?? {};
      return {
        ...output,
        basics: {
          ...basics,
          name: normalizeField(basics.name, input.rawText),
          phone: normalizeField(basics.phone, input.rawText),
          email: normalizeField(basics.email, input.rawText),
          location: normalizeField(basics.location, input.rawText),
          summary: normalizeField(basics.summary, input.rawText),
          links: (basics.links ?? []).map((link) => normalizeEvidenceItem(link, input.rawText))
        },
        experiences: (output.experiences ?? []).map((experience) => ({
          ...experience,
          organization: normalizeEvidenceItem(experience.organization, input.rawText),
          role: normalizeEvidenceItem(experience.role, input.rawText),
          startDate: normalizeField(experience.startDate, input.rawText),
          endDate: normalizeField(experience.endDate, input.rawText),
          facts: (experience.facts ?? []).map((fact) => normalizeEvidenceItem(fact, input.rawText))
        })),
        skills: (output.skills ?? []).map((skill) => normalizeEvidenceItem(skill, input.rawText)),
        certificates: (output.certificates ?? []).map((certificate) => normalizeEvidenceItem(certificate, input.rawText))
      };
    }
  } satisfies StageBTaskDefinition<ProfileBuilderTaskInput, ProfileBuilderOutput>,
  "jd-analyzer": {
    task: "jd-analyzer",
    promptVersion: jdAnalyzerPrompt.version,
    systemPrompt: jdAnalyzerPrompt.system,
    inputSchema: JdAnalyzerTaskInputSchema,
    outputSchema: JdAnalyzerOutputSchema,
    maxOutputChars: 14_000,
    buildUserPrompt(input: JdAnalyzerTaskInput) {
      const redacted = redactSensitiveTextForModel(input.rawText);
      return JSON.stringify(
        {
          title: input.title,
          company: input.company,
          rawText: redacted.text,
          redactions: redacted.redactions,
          instructions: "Analyze this redacted job description into structured requirements."
        },
        null,
        2
      );
    },
    coerceRawOutput(rawOutput: unknown) {
      const raw = rawOutput as Record<string, unknown>;
      const now = new Date().toISOString();

      // Map top-level field variations — title/company may come as plain strings or be missing
      const titleStr = typeof raw.jobTitle === "string" ? raw.jobTitle
        : typeof raw.title === "string" ? raw.title : "";
      const titleValue = typeof raw.title === "object" && raw.title !== null
        ? raw.title
        : {
            value: titleStr || "待确认岗位",
            sourceQuote: titleStr || "待确认岗位",
            confidenceLevel: titleStr ? ("medium" as const) : ("low" as const),
            confidenceReason: titleStr ? "Coerced from model output; value from user-provided job metadata." : "Model did not return title; using placeholder.",
            needsConfirmation: !titleStr
          };

      const companyStr = typeof raw.company === "string" ? raw.company : "";
      const companyValue = typeof raw.company === "object" && raw.company !== null
        ? raw.company
        : {
            value: companyStr || "待确认公司",
            sourceQuote: companyStr || "待确认公司",
            confidenceLevel: companyStr ? ("medium" as const) : ("low" as const),
            confidenceReason: companyStr ? "Coerced from model output; value from user-provided job metadata." : "Model did not return company; using placeholder.",
            needsConfirmation: !companyStr
          };

      // Requirements can be under different keys
      const rawRequirements = (raw.requirements ?? raw.parsedRequirements ?? raw.items ?? []) as unknown[];

      return {
        title: titleValue,
        company: companyValue,
        industry: coerceDraftField(raw.industry),
        location: coerceDraftField(raw.location),
        workType: coerceDraftField(raw.workType),
        requirements: rawRequirements.map((req) => {
          const r = req as Record<string, unknown>;
          return {
            id: typeof r.id === "string" ? r.id : `jd-req-${nanoid(8)}`,
            category: pickCategory(r.category, r.type, r.classification),
            description: pickString(r.description, r.requirement, r.text, r.content, r.summary, r.sourceQuote),
            priority: typeof r.priority === "string" ? r.priority : "uncertain",
            hardConstraint: typeof r.hardConstraint === "boolean" ? r.hardConstraint : false,
            sourceQuote: typeof r.sourceQuote === "string" ? r.sourceQuote : "",
            sourceSpan: r.sourceSpan,
            keywords: Array.isArray(r.keywords) ? r.keywords : [],
            confidenceLevel: typeof r.confidenceLevel === "string" ? r.confidenceLevel : "low",
            confidenceReason: pickString(r.confidenceReason, r.reason, r.explanation, "Model output required coercion."),
            needsConfirmation: typeof r.needsConfirmation === "boolean" ? r.needsConfirmation : true,
            confirmedByUser: false,
            createdAt: typeof r.createdAt === "string" ? r.createdAt : now,
            updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : now
          };
        }),
        riskNotes: Array.isArray(raw.riskNotes) ? raw.riskNotes : []
      };
    },
    normalizeOutput(output: JdAnalyzerOutput, input: JdAnalyzerTaskInput) {
      return {
        ...output,
        title: normalizeField(output.title, input.rawText),
        company: normalizeField(output.company, input.rawText),
        industry: normalizeField(output.industry, input.rawText),
        location: normalizeField(output.location, input.rawText),
        workType: normalizeField(output.workType, input.rawText),
        requirements: (output.requirements ?? []).map((requirement, index) => {
          const fallback = fallbackRequirementQuote(input.rawText, index);
          return normalizeEvidenceItem({
            ...requirement,
            description: requirement.description || fallback,
            sourceQuote: requirement.sourceQuote || fallback
          }, input.rawText);
        })
      };
    }
  } satisfies StageBTaskDefinition<JdAnalyzerTaskInput, JdAnalyzerOutput>,
  "evidence-matcher": {
    task: "evidence-matcher",
    promptVersion: evidenceMatcherPrompt.version,
    systemPrompt: evidenceMatcherPrompt.system,
    inputSchema: EvidenceMatcherTaskInputSchema,
    outputSchema: EvidenceMatcherOutputSchema,
    maxOutputChars: 8_000,
    buildUserPrompt(input: EvidenceMatcherTaskInput) {
      const redactedRequirement = redactSensitiveTextForModel(input.requirement.sourceQuote);
      const redactedDescription = redactSensitiveTextForModel(input.requirement.description);
      return JSON.stringify(
        {
          requirement: {
            id: input.requirement.id,
            description: redactedDescription.text,
            sourceQuote: redactedRequirement.text,
            hardConstraint: input.requirement.hardConstraint,
            keywords: input.requirement.keywords
          },
          candidateSetHash: input.candidateSetHash,
          allowedEvidenceRefs: input.candidates.map((candidate) => candidate.evidenceRef),
          candidates: input.candidates.map((candidate) => ({
            evidenceRef: candidate.evidenceRef,
            text: redactSensitiveTextForModel(candidate.searchText).text
          })),
          instructions: [
            "Judge whether the provided candidate facts support the requirement.",
            "Return exactly one evaluation for this requirement.",
            "Only use evidenceRefs from allowedEvidenceRefs.",
            "If candidates is empty, return matchLevel none, riskLevel medium or high, and no evidenceRefs."
          ]
        },
        null,
        2
      );
    },
    coerceRawOutput(rawOutput: unknown) {
      const raw = rawOutput as Record<string, unknown>;
      const evaluations = Array.isArray(raw.evaluations)
        ? raw.evaluations
        : Array.isArray(raw.matches)
          ? raw.matches
          : raw.requirementId
            ? [raw]
            : [];

      return {
        evaluations: evaluations.map((item) => {
          const evaluation = item as Record<string, unknown>;
          return {
            requirementId: typeof evaluation.requirementId === "string" ? evaluation.requirementId : "",
            matchLevel: normalizeMatchLevel(evaluation.matchLevel ?? evaluation.status),
            riskLevel: normalizeRiskLevel(evaluation.riskLevel ?? evaluation.risk),
            risks: Array.isArray(evaluation.risks) ? evaluation.risks : [],
            evidenceRefs: Array.isArray(evaluation.evidenceRefs) ? evaluation.evidenceRefs : [],
            explanation: typeof evaluation.explanation === "string" ? evaluation.explanation : "AI未提供解释。"
          };
        })
      };
    },
    normalizeOutput(output: EvidenceMatcherOutput, input: EvidenceMatcherTaskInput) {
      if (input.candidates.length === 0) {
        return {
          evaluations: [
            {
              requirementId: input.requirement.id,
              matchLevel: "none",
              riskLevel: input.requirement.hardConstraint ? "high" : "medium",
              risks: input.requirement.hardConstraint ? ["hard_constraint_gap", "source_missing"] : ["source_missing"],
              evidenceRefs: [],
              explanation: "规则层未召回任何候选事实，AI按约束返回无证据。"
            }
          ]
        };
      }

      const evaluations = output.evaluations.length > 0
        ? output.evaluations
        : [
            {
              requirementId: input.requirement.id,
              matchLevel: "none" as const,
              riskLevel: input.requirement.hardConstraint ? ("high" as const) : ("medium" as const),
              risks: ["source_missing" as const],
              evidenceRefs: [],
              explanation: "AI未返回有效匹配项，已降级为无证据。"
            }
          ];

      return {
        evaluations: evaluations.map((evaluation) => ({
          ...evaluation,
          requirementId: evaluation.requirementId || input.requirement.id,
          risks: normalizeMatchRisks(evaluation.risks),
          evidenceRefs: normalizeEvidenceRefs(evaluation.evidenceRefs, input)
        }))
      };
    },
    validateOutput(output: EvidenceMatcherOutput, input: EvidenceMatcherTaskInput) {
      const allowedRefKeys = new Set(input.candidates.map((candidate) => JSON.stringify(candidate.evidenceRef)));

      for (const evaluation of output.evaluations) {
        if (evaluation.requirementId !== input.requirement.id) {
          throw new Error("evidence_matcher_requirement_id_out_of_scope");
        }

        if (input.candidates.length === 0 && (evaluation.matchLevel !== "none" || evaluation.evidenceRefs.length > 0)) {
          throw new Error("evidence_matcher_empty_candidates_must_return_none");
        }

        for (const ref of evaluation.evidenceRefs) {
          if (!allowedRefKeys.has(JSON.stringify(ref))) {
            throw new Error("evidence_matcher_evidence_ref_out_of_scope");
          }
        }
      }
    }
  } satisfies AiTaskDefinition<EvidenceMatcherTaskInput, EvidenceMatcherOutput>
} as const;

export const stageBTaskRegistry = {
  "profile-builder": aiTaskRegistry["profile-builder"],
  "jd-analyzer": aiTaskRegistry["jd-analyzer"]
} as const;

export function getStageBTaskDefinition(task: string) {
  const parsed = stageBAiTaskSchema.safeParse(task);

  if (!parsed.success) {
    return undefined;
  }

  return stageBTaskRegistry[parsed.data];
}

export function getAiTaskDefinition(task: string) {
  const parsed = AiTaskSchema.safeParse(task);

  if (!parsed.success || !(parsed.data in aiTaskRegistry)) {
    return undefined;
  }

  return aiTaskRegistry[parsed.data as keyof typeof aiTaskRegistry];
}

function normalizeField<T extends { sourceQuote: string; sourceSpan?: unknown; confidenceLevel: "high" | "medium" | "low"; needsConfirmation: boolean }>(
  field: T | undefined,
  rawText: string
): T | undefined {
  if (!field) {
    return undefined;
  }

  return normalizeEvidenceItem(field, rawText);
}

function normalizeEvidenceItem<T extends { sourceQuote: string; sourceSpan?: unknown; confidenceLevel: "high" | "medium" | "low"; needsConfirmation: boolean }>(
  item: T,
  rawText: string
): T {
  if (!item || typeof item.sourceQuote !== "string") {
    return item;
  }

  const sourceSpan = locateSourceQuote(rawText, item.sourceQuote);

  if (!sourceSpan) {
    return {
      ...item,
      sourceSpan: undefined,
      confidenceLevel: "low",
      needsConfirmation: true
    };
  }

  return {
    ...item,
    sourceSpan
  };
}

function pickString(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return "";
}

function coerceDraftField(value: unknown): { value: string; sourceQuote: string; sourceSpan?: unknown; confidenceLevel: "high" | "medium" | "low"; confidenceReason: string; needsConfirmation: boolean } | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "object" && value !== null && "value" in value && "sourceQuote" in value) {
    return value as { value: string; sourceQuote: string; sourceSpan?: unknown; confidenceLevel: "high" | "medium" | "low"; confidenceReason: string; needsConfirmation: boolean };
  }

  if (typeof value === "string" && value.length > 0) {
    return {
      value,
      sourceQuote: value,
      confidenceLevel: "low",
      confidenceReason: "Coerced from plain string model output.",
      needsConfirmation: true
    };
  }

  return undefined;
}

const validJdCategories = new Set([
  "responsibility",
  "must_have",
  "core_skill",
  "soft_skill",
  "nice_to_have",
  "risk_or_uncertain"
]);

function pickCategory(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && validJdCategories.has(candidate)) {
      return candidate;
    }
  }

  return "risk_or_uncertain";
}

function fallbackRequirementQuote(rawText: string, index: number) {
  const segments = rawText
    .split(/[\n；;。]/)
    .map((segment) => segment.replace(/^[-•\s]+/, "").trim())
    .filter((segment) => segment.length > 0 && !segment.startsWith("岗位：") && !segment.startsWith("公司："));

  return segments[index % Math.max(segments.length, 1)] || rawText.slice(0, 80) || "待确认岗位要求";
}

function normalizeMatchLevel(value: unknown) {
  if (value === "strong" || value === "weak" || value === "transferable" || value === "none") {
    return value;
  }
  if (value === "strong_match") {
    return "strong";
  }
  if (value === "weak_match") {
    return "weak";
  }
  if (value === "no_evidence") {
    return "none";
  }
  return "none";
}

function normalizeRiskLevel(value: unknown) {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return "medium";
}

const validMatchRisks = new Set<MatchRisk>([
  "source_missing",
  "hard_constraint_gap",
  "ownership_risk",
  "team_to_individual_risk",
  "skill_level_risk",
  "number_risk",
  "new_fact_risk",
  "stale_match",
  "low_confidence"
]);

function normalizeMatchRisks(values: unknown[]): MatchRisk[] {
  return values.filter((value): value is MatchRisk => typeof value === "string" && validMatchRisks.has(value as MatchRisk));
}

function normalizeEvidenceRefs(values: unknown[], input: EvidenceMatcherTaskInput) {
  return values.flatMap((value) => {
    const parsed = MatchEvidenceRefSchema.safeParse(value);
    if (parsed.success && input.candidates.some((candidate) => JSON.stringify(candidate.evidenceRef) === JSON.stringify(parsed.data))) {
      return [parsed.data];
    }

    if (typeof value === "string") {
      const found = input.candidates.find((candidate) =>
        JSON.stringify(candidate.evidenceRef).includes(value)
      );
      return found ? [found.evidenceRef] : [];
    }

    if (typeof value === "object" && value !== null) {
      const raw = value as Record<string, unknown>;
      const factId = typeof raw.factId === "string" ? raw.factId : undefined;
      const experienceId = typeof raw.experienceId === "string" ? raw.experienceId : undefined;
      const skillId = typeof raw.skillId === "string" ? raw.skillId : undefined;
      const certificateId = typeof raw.certificateId === "string" ? raw.certificateId : undefined;
      const found = input.candidates.find((candidate) => {
        const ref = candidate.evidenceRef;
        if (ref.type === "experience_fact") {
          return (!factId || ref.factId === factId) && (!experienceId || ref.experienceId === experienceId);
        }
        if (ref.type === "skill_fact") {
          return (!factId || ref.factId === factId) && (!skillId || ref.skillId === skillId);
        }
        if (ref.type === "certificate_fact") {
          return (!factId || ref.factId === factId) && (!certificateId || ref.certificateId === certificateId);
        }
        return false;
      });
      return found ? [found.evidenceRef] : [];
    }

    return [];
  });
}
