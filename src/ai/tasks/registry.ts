import { z } from "zod";
import {
  JdAnalyzerOutputSchema,
  ProfileBuilderOutputSchema,
  type JdAnalyzerOutput,
  type ProfileBuilderOutput
} from "@/domain/schemas";
import { locateSourceQuote, redactSensitiveTextForModel } from "@/services/security/text";
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

export type StageBAiTask = z.infer<typeof stageBAiTaskSchema>;
export type ProfileBuilderTaskInput = z.infer<typeof ProfileBuilderTaskInputSchema>;
export type JdAnalyzerTaskInput = z.infer<typeof JdAnalyzerTaskInputSchema>;

export type StageBTaskDefinition<TInput, TOutput> = {
  task: StageBAiTask;
  promptVersion: string;
  systemPrompt: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  maxOutputChars: number;
  buildUserPrompt(input: TInput): string;
  normalizeOutput(output: TOutput, input: TInput): TOutput;
};

export const stageBTaskRegistry = {
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
    normalizeOutput(output: ProfileBuilderOutput, input: ProfileBuilderTaskInput) {
      return {
        ...output,
        basics: {
          ...output.basics,
          name: normalizeField(output.basics.name, input.rawText),
          phone: normalizeField(output.basics.phone, input.rawText),
          email: normalizeField(output.basics.email, input.rawText),
          location: normalizeField(output.basics.location, input.rawText),
          summary: normalizeField(output.basics.summary, input.rawText),
          links: output.basics.links.map((link) => normalizeEvidenceItem(link, input.rawText))
        },
        experiences: output.experiences.map((experience) => ({
          ...experience,
          organization: normalizeEvidenceItem(experience.organization, input.rawText),
          role: normalizeEvidenceItem(experience.role, input.rawText),
          startDate: normalizeField(experience.startDate, input.rawText),
          endDate: normalizeField(experience.endDate, input.rawText),
          facts: experience.facts.map((fact) => normalizeEvidenceItem(fact, input.rawText))
        })),
        skills: output.skills.map((skill) => normalizeEvidenceItem(skill, input.rawText)),
        certificates: output.certificates.map((certificate) => normalizeEvidenceItem(certificate, input.rawText))
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
    normalizeOutput(output: JdAnalyzerOutput, input: JdAnalyzerTaskInput) {
      return {
        ...output,
        title: normalizeField(output.title, input.rawText),
        company: normalizeField(output.company, input.rawText),
        industry: normalizeField(output.industry, input.rawText),
        location: normalizeField(output.location, input.rawText),
        workType: normalizeField(output.workType, input.rawText),
        requirements: output.requirements.map((requirement) => normalizeEvidenceItem(requirement, input.rawText))
      };
    }
  } satisfies StageBTaskDefinition<JdAnalyzerTaskInput, JdAnalyzerOutput>
} as const;

export function getStageBTaskDefinition(task: string) {
  const parsed = stageBAiTaskSchema.safeParse(task);

  if (!parsed.success) {
    return undefined;
  }

  return stageBTaskRegistry[parsed.data];
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
