import {
  ResumePresentationItemSchema,
  type CustomFieldValue,
  type ResumeItemV2,
  type ResumePresentationCustomRow,
  type ResumePresentationItem
} from "@/domain/schemas";

export const RESUME_PRESENTATION_ALLOWED_LABELS = {
  gpa: "GPA",
  rank: "专业排名",
  courses: "核心课程",
  tools: "技术栈",
  doi: "DOI",
  patentNumber: "专利号",
  credentialId: "证书编号"
} as const;

export function formatResumePresentationDate(value?: string): string | undefined {
  const normalized = clean(value);
  if (!normalized) return undefined;
  const match = /^(\d{4})(?:-(\d{2})(?:-\d{2})?)?$/.exec(normalized);
  if (!match) return normalized;
  return match[2] ? `${match[1]}.${match[2]}` : match[1];
}

export function formatResumePresentationDateRange(startDate?: string, endDate?: string, current = false): string | undefined {
  const start = formatResumePresentationDate(startDate);
  const end = current ? "至今" : formatResumePresentationDate(endDate);
  if (start && end) return `${start}–${end}`;
  return start ?? end;
}

export function projectResumePresentationItem(item: ResumeItemV2): ResumePresentationItem {
  const base = {
    id: item.id,
    sectionType: item.sectionType,
    inlineMeta: [] as string[],
    secondaryMeta: [] as string[],
    highlights: [] as string[],
    links: [] as string[],
    customRows: projectCustomFields(item.customFields),
    warnings: [] as string[]
  };
  let projected: Omit<ResumePresentationItem, keyof typeof base> & Partial<typeof base>;

  switch (item.sectionType) {
    case "summary":
      projected = { description: item.text };
      break;
    case "education":
      projected = {
        primaryTitle: item.school,
        secondaryTitle: joinValues([item.degree, item.major]),
        tertiaryTitle: item.department,
        dateRange: formatResumePresentationDateRange(item.startDate, item.endDate, item.current),
        location: item.location,
        description: item.description,
        highlights: [...item.honors, ...item.highlights],
        customRows: [
          ...educationRows(item),
          ...base.customRows
        ]
      };
      break;
    case "work":
    case "internship":
    case "campus":
    case "volunteer":
      projected = {
        primaryTitle: item.organization,
        secondaryTitle: item.role,
        dateRange: formatResumePresentationDateRange(item.startDate, item.endDate, item.current),
        location: item.location,
        secondaryMeta: compact([item.department]),
        description: item.description,
        highlights: item.highlights
      };
      break;
    case "project":
      projected = {
        primaryTitle: item.title,
        secondaryTitle: item.role,
        dateRange: formatResumePresentationDateRange(item.startDate, item.endDate, item.current),
        location: item.location,
        inlineMeta: compact([item.organization, ...item.tools, item.url]),
        description: item.description ?? item.background,
        secondaryMeta: item.description && item.background ? [item.background] : [],
        highlights: [...item.highlights, ...item.outcomes],
        links: compact([item.url])
      };
      break;
    case "research":
      projected = {
        primaryTitle: item.title,
        secondaryTitle: item.authorRole,
        dateRange: formatResumePresentationDateRange(item.startDate, item.endDate, item.current),
        inlineMeta: compact([item.institution, item.publicationStatus]),
        secondaryMeta: compact([item.publication, item.samples]),
        description: item.description,
        highlights: [...item.methods, ...item.highlights],
        links: compact([item.url])
      };
      break;
    case "awards":
      projected = {
        primaryTitle: item.name,
        secondaryTitle: joinValues([item.level, item.issuer]),
        tertiaryTitle: item.rank,
        dateRange: formatResumePresentationDate(item.awardedAt),
        description: item.description
      };
      break;
    case "skills":
      projected = {
        primaryTitle: item.name,
        secondaryTitle: item.level,
        groupLabel: item.category,
        description: item.description
      };
      break;
    case "languages":
      projected = {
        primaryTitle: item.language,
        secondaryTitle: joinValues([item.level, item.testName, item.score]),
        description: item.description
      };
      break;
    case "certificates":
      projected = {
        primaryTitle: item.name,
        secondaryTitle: joinValues([item.issuer, item.status]),
        dateRange: certificateDateRange(item.issuedAt, item.expiresAt),
        description: item.description,
        customRows: [
          ...labeledRow(RESUME_PRESENTATION_ALLOWED_LABELS.credentialId, item.credentialId),
          ...base.customRows
        ]
      };
      break;
    case "publications":
      projected = {
        primaryTitle: item.title,
        secondaryTitle: item.authorRole,
        dateRange: formatResumePresentationDate(item.publishedAt),
        inlineMeta: compact([...item.authors, item.publisher, item.status]),
        description: item.description,
        links: compact([item.url]),
        customRows: [...labeledRow(RESUME_PRESENTATION_ALLOWED_LABELS.doi, item.doi), ...base.customRows]
      };
      break;
    case "patents":
      projected = {
        primaryTitle: item.title,
        secondaryTitle: item.status,
        dateRange: patentDateRange(item.filedAt, item.grantedAt),
        inlineMeta: compact([...item.inventors, item.office]),
        description: item.description,
        links: compact([item.url]),
        customRows: [...labeledRow(RESUME_PRESENTATION_ALLOWED_LABELS.patentNumber, item.patentNumber), ...base.customRows]
      };
      break;
    case "portfolio":
      projected = {
        primaryTitle: item.title,
        secondaryTitle: joinValues([item.type, item.role]),
        dateRange: formatResumePresentationDate(item.createdAt),
        inlineMeta: compact([...item.tools, item.url]),
        description: item.description,
        highlights: item.highlights,
        links: compact([item.url])
      };
      break;
    case "other":
    case "custom":
      projected = {
        primaryTitle: item.title,
        description: item.description,
        highlights: item.highlights,
        warnings: item.customFields.length ? ["包含自定义字段，已使用紧凑结构保留。"] : []
      };
      break;
  }

  return ResumePresentationItemSchema.parse(dedupePresentation({ ...base, ...projected }));
}

function educationRows(item: Extract<ResumeItemV2, { sectionType: "education" }>): ResumePresentationCustomRow[] {
  const gpa = item.gpa === undefined ? undefined : item.gpaScale === undefined ? `${item.gpa}` : `${item.gpa}/${item.gpaScale}`;
  const rank = item.rankPosition === undefined ? undefined : item.rankTotal === undefined ? `${item.rankPosition}` : `${item.rankPosition}/${item.rankTotal}`;
  return [
    ...labeledRow(RESUME_PRESENTATION_ALLOWED_LABELS.gpa, gpa),
    ...labeledRow(RESUME_PRESENTATION_ALLOWED_LABELS.rank, rank),
    ...labeledRow(RESUME_PRESENTATION_ALLOWED_LABELS.courses, item.courses.join("、"))
  ];
}

function projectCustomFields(fields: CustomFieldValue[]): ResumePresentationCustomRow[] {
  return [...fields].sort((left, right) => left.order - right.order).flatMap((field) => {
    if (field.value === false || field.value === "" || (Array.isArray(field.value) && field.value.length === 0)) return [];
    const value = Array.isArray(field.value) ? field.value.join("、") : field.value === true ? "是" : String(field.value);
    return [{ label: field.label, value, displayMode: field.valueType === "text" ? "secondary" as const : "inline" as const }];
  });
}

function labeledRow(label: string, value?: string): ResumePresentationCustomRow[] {
  const normalized = clean(value);
  return normalized ? [{ label, value: normalized, displayMode: "inline" }] : [];
}

function certificateDateRange(issuedAt?: string, expiresAt?: string) {
  return formatResumePresentationDateRange(issuedAt, expiresAt);
}

function patentDateRange(filedAt?: string, grantedAt?: string) {
  return formatResumePresentationDateRange(filedAt, grantedAt);
}

function dedupePresentation(item: ResumePresentationItem): ResumePresentationItem {
  const occupied = new Set(compact([
    item.primaryTitle,
    item.secondaryTitle,
    item.tertiaryTitle,
    item.dateRange,
    item.location,
    item.description,
    ...item.inlineMeta
  ]));
  const secondaryMeta = unique(item.secondaryMeta).filter((value) => !occupied.has(value));
  secondaryMeta.forEach((value) => occupied.add(value));
  return {
    ...item,
    inlineMeta: unique(item.inlineMeta),
    secondaryMeta,
    highlights: unique(item.highlights).filter((value) => !occupied.has(value)),
    links: unique(item.links),
    customRows: item.customRows.filter((row, index, rows) => rows.findIndex((candidate) => candidate.label === row.label && candidate.value === row.value) === index)
  };
}

function joinValues(values: Array<string | undefined>) {
  const normalized = compact(values);
  return normalized.length ? normalized.join(" · ") : undefined;
}

function clean(value?: string) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function compact(values: Array<string | undefined>): string[] {
  return values.flatMap((value) => clean(value) ?? []);
}

function unique(values: string[]) {
  return [...new Set(compact(values))];
}
