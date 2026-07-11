import type { ResumeRenderSectionType } from "@/domain/schemas";

export type ResumeStudioSectionKey =
  | "basics"
  | ResumeRenderSectionType
  | "education"
  | "projects"
  | "campus"
  | "awards"
  | "language"
  | "custom"
  | "add";

export const SECTION_ORDER: ResumeStudioSectionKey[] = [
  "basics",
  "summary",
  "experience",
  "education",
  "projects",
  "campus",
  "skills",
  "awards",
  "certificates",
  "language",
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
