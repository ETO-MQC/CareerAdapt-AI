import { nanoid } from "nanoid";
import {
  CareerProfileSchema,
  type CareerProfile,
  type FactCategory,
  type FactStatement,
  type ProfileBuilderFact,
  type ProfileBuilderOutput,
  type ProfileImportDraft,
  type RawInputDocument
} from "@/domain/schemas";

const riskByConfidence = {
  high: "low",
  medium: "medium",
  low: "high"
} as const;

const numericConfidence = {
  high: 0.9,
  medium: 0.7,
  low: 0.45
} as const;

export function mapProfileDraftToCareerProfile(input: {
  draft: ProfileImportDraft;
  rawInput: RawInputDocument;
  profileId?: string;
  now?: string;
}): CareerProfile {
  const now = input.now ?? new Date().toISOString();
  const output = getProfileOutput(input.draft);

  const experiences = output.experiences
    .map((experience) => {
      const facts = experience.facts
        .filter((fact) => canCommitEvidence(fact, input.rawInput))
        .map((fact) => mapDraftFact(fact, input.rawInput, now));

      if (facts.length === 0) {
        return undefined;
      }

      return {
        id: experience.id || `exp-${nanoid(10)}`,
        type: experience.type,
        organization: experience.organization.value,
        role: experience.role.value,
        startDate: experience.startDate?.value,
        endDate: experience.endDate?.value,
        facts,
        resumeDrafts: facts.map((fact, index) => ({
          id: `draft-${nanoid(10)}`,
          text: fact.statement,
          factIds: [fact.id],
          createdAt: now,
          updatedAt: now,
          targetRole: index === 0 ? undefined : undefined
        })),
        tags: experience.tags,
        evidenceIds: [],
        createdAt: now,
        updatedAt: now
      };
    })
    .filter((experience): experience is NonNullable<typeof experience> => Boolean(experience));

  const skills = output.skills
    .filter((skill) => canCommitEvidence(skill, input.rawInput))
    .map((skill) => ({
      id: skill.id || `skill-${nanoid(10)}`,
      name: skill.name.value,
      level: skill.level,
      evidenceIds: [],
      fact: mapDraftFact(
        {
          id: `fact-${skill.id}`,
          statement: skill.name.value,
          category: "skill",
          sourceQuote: skill.sourceQuote,
          sourceSpan: skill.sourceSpan,
          confidenceLevel: skill.confidenceLevel,
          confidenceReason: skill.confidenceReason,
          needsConfirmation: skill.needsConfirmation,
          confirmedByUser: skill.confirmedByUser,
          createdAt: now,
          updatedAt: now
        },
        input.rawInput,
        now
      ),
      createdAt: now,
      updatedAt: now
    }));

  const certificates = output.certificates
    .filter((certificate) => canCommitEvidence(certificate, input.rawInput))
    .map((certificate) => ({
      id: certificate.id || `cert-${nanoid(10)}`,
      name: certificate.name.value,
      issuer: certificate.issuer?.value,
      issuedAt: certificate.issuedAt?.value,
      evidenceIds: [],
      fact: mapDraftFact(
        {
          id: `fact-${certificate.id}`,
          statement: certificate.name.value,
          category: "certificate",
          sourceQuote: certificate.sourceQuote,
          sourceSpan: certificate.sourceSpan,
          confidenceLevel: certificate.confidenceLevel,
          confidenceReason: certificate.confidenceReason,
          needsConfirmation: certificate.needsConfirmation,
          confirmedByUser: certificate.confirmedByUser,
          createdAt: now,
          updatedAt: now
        },
        input.rawInput,
        now
      ),
      createdAt: now,
      updatedAt: now
    }));

  return CareerProfileSchema.parse({
    id: input.profileId ?? `profile-${nanoid(10)}`,
    name: output.basics.name?.value || "未命名职业母档案",
    basics: {
      name: output.basics.name?.value || "未命名",
      phone: output.basics.phone?.value,
      email: output.basics.email?.value,
      location: output.basics.location?.value,
      summary: output.basics.summary?.value,
      links: output.basics.links.map((link) => link.value)
    },
    preference: {
      targetRoles: [],
      targetCities: [],
      industries: []
    },
    version: 1,
    experiences,
    skills,
    certificates,
    evidences: [],
    unclassifiedBlocks: output.unclassifiedBlocks,
    createdAt: now,
    updatedAt: now
  });
}

function getProfileOutput(draft: ProfileImportDraft): ProfileBuilderOutput {
  const output = draft.manualSections ?? draft.builderOutput;

  if (!output) {
    throw new Error("profile_draft_has_no_output");
  }

  return output;
}

function mapDraftFact(fact: ProfileBuilderFact, rawInput: RawInputDocument, now: string): FactStatement {
  const pdfLocated = rawInput.kind === "resume_pdf_text" && fact.sourceLocatorStatus === "located" && fact.sourceLocator;
  const riskLevel = pdfLocated || fact.sourceSpan ? riskByConfidence[fact.confidenceLevel] : "high";
  const sourceLocation = pdfLocated
    ? fact.sourceLocator
    : rawInput.kind !== "resume_pdf_text" && fact.sourceSpan
      ? locateRawInputSource(rawInput, fact.sourceSpan.start, fact.sourceSpan.end)
      : undefined;
  const sourceType = rawInput.kind === "resume_pdf_text"
    ? pdfLocated
      ? "pdf_import"
      : "user_input"
    : "imported_text";

  return {
    id: fact.id || `fact-${nanoid(10)}`,
    statement: fact.statement,
    category: fact.category as FactCategory,
    provenance: [
      {
        sourceType,
        sourceId: rawInput.id,
        sourceText: pdfLocated ? fact.sourceQuote : fact.sourceSpan?.text ?? fact.sourceQuote,
        confidence: numericConfidence[fact.confidenceLevel],
        confirmedByUser: fact.confirmedByUser,
        riskLevel,
        createdAt: now,
        sourceInputId: rawInput.id,
        sourceSessionId: rawInput.sourceSessionId,
        fileName: rawInput.fileName,
        pageNumber: sourceLocation?.pageNumber,
        pageRange: sourceLocation
          ? {
              startPage: sourceLocation.pageNumber,
              endPage: sourceLocation.pageNumber
            }
          : undefined,
        sourceQuote: fact.sourceQuote,
        sourceLocatorStatus: pdfLocated ? "located" : rawInput.kind === "resume_pdf_text" ? fact.sourceLocatorStatus ?? "unlocated" : undefined,
        sourceLocator: sourceLocation
          ? {
              pageNumber: sourceLocation.pageNumber,
              pageStart: sourceLocation.pageStart,
              pageEnd: sourceLocation.pageEnd,
              globalStart: sourceLocation.globalStart,
              globalEnd: sourceLocation.globalEnd
            }
          : undefined
      }
    ],
    confirmedByUser: fact.confirmedByUser,
    riskLevel,
    createdAt: now,
    updatedAt: now
  };
}

function canCommitEvidence(
  item: {
    confirmedByUser: boolean;
    sourceSpan?: unknown;
    sourceLocatorStatus?: "located" | "ambiguous" | "unlocated";
    sourceLocator?: unknown;
  },
  rawInput: RawInputDocument
) {
  if (!item.confirmedByUser) {
    return false;
  }

  if (rawInput.kind === "resume_pdf_text") {
    return item.sourceLocatorStatus === "located" && Boolean(item.sourceLocator);
  }

  return Boolean(item.sourceSpan);
}

function locateRawInputSource(rawInput: RawInputDocument, globalStart: number, globalEnd: number) {
  const page = (rawInput.sourcePages ?? []).find((item) => globalStart >= item.start && globalStart <= item.end);

  if (!page) {
    return undefined;
  }

  return {
    pageNumber: page.pageNumber,
    pageStart: Math.max(0, globalStart - page.start),
    pageEnd: Math.max(0, Math.min(globalEnd, page.end) - page.start),
    globalStart,
    globalEnd
  };
}
