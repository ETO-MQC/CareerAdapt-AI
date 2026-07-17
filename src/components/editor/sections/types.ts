import type { ResumeSectionTypeV2 } from "@/domain/resumeFields";

export type ResumeStudioSectionKey =
  | ResumeSectionTypeV2
  | `custom:${string}`
  | "add";

export const SECTION_ORDER: ResumeStudioSectionKey[] = [
  "basics",
  "summary",
  "education",
  "work",
  "internship",
  "project",
  "campus",
  "research",
  "volunteer",
  "skills",
  "awards",
  "certificates",
  "languages",
  "publications",
  "patents",
  "portfolio",
  "other",
  "custom"
];

export function prevSection(current: ResumeStudioSectionKey): ResumeStudioSectionKey | undefined {
  const index = SECTION_ORDER.indexOf(current);
  return index > 0 ? SECTION_ORDER[index - 1] : undefined;
}

export function nextSection(current: ResumeStudioSectionKey): ResumeStudioSectionKey | undefined {
  const index = SECTION_ORDER.indexOf(current);
  return index >= 0 && index < SECTION_ORDER.length - 1 ? SECTION_ORDER[index + 1] : undefined;
}

export type SectionNavContext = {
  activeSection: ResumeStudioSectionKey;
  onNavigate: (section: ResumeStudioSectionKey) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
};
