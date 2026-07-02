import type {
  PdfPageText,
  PdfSourceLocator,
  ProfileBuilderCertificate,
  ProfileBuilderFact,
  ProfileBuilderOutput,
  ProfileBuilderSkill,
  DraftSourceField
} from "@/domain/schemas";

export type PdfQuoteLocation =
  | {
      status: "located";
      matchCount: 1;
      quote: string;
      locator: PdfSourceLocator;
    }
  | {
      status: "ambiguous";
      matchCount: number;
      quote: string;
    }
  | {
      status: "unlocated";
      matchCount: 0;
      quote: string;
    };

type PageSource = Pick<PdfPageText, "pageNumber" | "cleanedPageText" | "charStart" | "charEnd">;

export function locatePdfSourceQuote(sourceQuote: string, pages: PageSource[]): PdfQuoteLocation {
  const quote = sourceQuote.trim();

  if (!quote) {
    return {
      status: "unlocated",
      matchCount: 0,
      quote
    };
  }

  const directMatches = findDirectMatches(quote, pages);
  const matches = directMatches.length > 0 ? directMatches : findCompactedMatches(quote, pages);

  if (matches.length === 1) {
    return {
      status: "located",
      matchCount: 1,
      quote,
      locator: matches[0]
    };
  }

  if (matches.length > 1) {
    return {
      status: "ambiguous",
      matchCount: matches.length,
      quote
    };
  }

  return {
    status: "unlocated",
    matchCount: 0,
    quote
  };
}

export function applyPdfSourceMappingToProfileOutput(
  output: ProfileBuilderOutput,
  pages: PageSource[]
): ProfileBuilderOutput {
  return {
    ...output,
    basics: {
      ...output.basics,
      name: mapDraftField(output.basics.name, pages),
      phone: mapDraftField(output.basics.phone, pages),
      email: mapDraftField(output.basics.email, pages),
      location: mapDraftField(output.basics.location, pages),
      summary: mapDraftField(output.basics.summary, pages),
      links: output.basics.links.map((link) => mapDraftField(link, pages)!)
    },
    experiences: output.experiences.map((experience) => ({
      ...experience,
      organization: mapDraftField(experience.organization, pages)!,
      role: mapDraftField(experience.role, pages)!,
      startDate: mapDraftField(experience.startDate, pages),
      endDate: mapDraftField(experience.endDate, pages),
      facts: experience.facts.map((fact) => mapFact(fact, pages))
    })),
    skills: output.skills.map((skill) => mapSkill(skill, pages)),
    certificates: output.certificates.map((certificate) => mapCertificate(certificate, pages))
  };
}

export function isPdfEvidenceLocated(item: {
  sourceLocatorStatus?: "located" | "ambiguous" | "unlocated";
  sourceLocator?: PdfSourceLocator;
}) {
  return item.sourceLocatorStatus === "located" && Boolean(item.sourceLocator);
}

function mapDraftField<T extends DraftSourceField | undefined>(field: T, pages: PageSource[]): T {
  if (!field) {
    return field;
  }

  const location = locatePdfSourceQuote(field.sourceQuote, pages);

  return {
    ...field,
    sourceSpan: location.status === "located"
      ? {
          start: location.locator.globalStart,
          end: location.locator.globalEnd,
          text: field.sourceQuote.trim()
        }
      : undefined,
    confidenceLevel: location.status === "located" ? field.confidenceLevel : "low",
    needsConfirmation: location.status === "located" ? field.needsConfirmation : true,
    sourceLocatorStatus: location.status,
    sourceLocator: location.status === "located" ? location.locator : undefined,
    sourceMatchCount: location.matchCount
  } as T;
}

function mapFact(fact: ProfileBuilderFact, pages: PageSource[]): ProfileBuilderFact {
  const mapped = mapDraftField({
    ...fact,
    value: fact.statement
  }, pages);

  return {
    ...fact,
    sourceSpan: mapped.sourceSpan,
    confidenceLevel: mapped.confidenceLevel,
    needsConfirmation: mapped.needsConfirmation,
    confirmedByUser: mapped.sourceLocatorStatus === "located" ? fact.confirmedByUser : false,
    sourceLocatorStatus: mapped.sourceLocatorStatus,
    sourceLocator: mapped.sourceLocator,
    sourceMatchCount: mapped.sourceMatchCount
  };
}

function mapSkill(skill: ProfileBuilderSkill, pages: PageSource[]): ProfileBuilderSkill {
  const location = locatePdfSourceQuote(skill.sourceQuote, pages);

  return {
    ...skill,
    sourceSpan: location.status === "located"
      ? {
          start: location.locator.globalStart,
          end: location.locator.globalEnd,
          text: skill.sourceQuote.trim()
        }
      : undefined,
    confidenceLevel: location.status === "located" ? skill.confidenceLevel : "low",
    needsConfirmation: location.status === "located" ? skill.needsConfirmation : true,
    confirmedByUser: location.status === "located" ? skill.confirmedByUser : false,
    sourceLocatorStatus: location.status,
    sourceLocator: location.status === "located" ? location.locator : undefined,
    sourceMatchCount: location.matchCount
  };
}

function mapCertificate(certificate: ProfileBuilderCertificate, pages: PageSource[]): ProfileBuilderCertificate {
  const location = locatePdfSourceQuote(certificate.sourceQuote, pages);

  return {
    ...certificate,
    sourceSpan: location.status === "located"
      ? {
          start: location.locator.globalStart,
          end: location.locator.globalEnd,
          text: certificate.sourceQuote.trim()
        }
      : undefined,
    confidenceLevel: location.status === "located" ? certificate.confidenceLevel : "low",
    needsConfirmation: location.status === "located" ? certificate.needsConfirmation : true,
    confirmedByUser: location.status === "located" ? certificate.confirmedByUser : false,
    sourceLocatorStatus: location.status,
    sourceLocator: location.status === "located" ? location.locator : undefined,
    sourceMatchCount: location.matchCount
  };
}

function findDirectMatches(quote: string, pages: PageSource[]) {
  return pages.flatMap((page) => {
    const matches: PdfSourceLocator[] = [];
    let start = page.cleanedPageText.indexOf(quote);

    while (start >= 0) {
      matches.push(createLocator(page, start, start + quote.length));
      start = page.cleanedPageText.indexOf(quote, start + Math.max(quote.length, 1));
    }

    return matches;
  });
}

function findCompactedMatches(quote: string, pages: PageSource[]) {
  const compactQuote = quote.replace(/\s+/g, "");
  if (compactQuote.length < 2) {
    return [];
  }

  return pages.flatMap((page) => {
    const compact = compactTextWithMap(page.cleanedPageText);
    const matches: PdfSourceLocator[] = [];
    let compactStart = compact.text.indexOf(compactQuote);

    while (compactStart >= 0) {
      const compactEnd = compactStart + compactQuote.length - 1;
      const pageStart = compact.indexMap[compactStart];
      const pageEnd = compact.indexMap[compactEnd] + 1;
      matches.push(createLocator(page, pageStart, pageEnd));
      compactStart = compact.text.indexOf(compactQuote, compactStart + Math.max(compactQuote.length, 1));
    }

    return matches;
  });
}

function compactTextWithMap(text: string) {
  let compact = "";
  const indexMap: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    if (/\s/.test(text[index])) {
      continue;
    }

    compact += text[index];
    indexMap.push(index);
  }

  return {
    text: compact,
    indexMap
  };
}

function createLocator(page: PageSource, pageStart: number, pageEnd: number): PdfSourceLocator {
  return {
    pageNumber: page.pageNumber,
    pageStart,
    pageEnd,
    globalStart: page.charStart + pageStart,
    globalEnd: page.charStart + pageEnd
  };
}
