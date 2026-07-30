import { readAiSettings } from "@/services/storage/aiSettings";

export type ResumeImportSemanticPreference = "unset" | "ai" | "local";

type StoredResumeImportAiPreference = {
  schemaVersion: "resume-import-ai-preference-v1";
  mode: Exclude<ResumeImportSemanticPreference, "unset">;
  providerFingerprint: string;
};

export const resumeImportAiPreferenceStorageKey = "careeradapt.resumeImportAiPreference";

export function currentResumeImportProviderFingerprint() {
  const settings = readAiSettings();
  return [settings.provider, settings.baseUrl, settings.model].join("|");
}

export function readResumeImportSemanticPreference(): ResumeImportSemanticPreference {
  if (typeof window === "undefined") return "unset";
  try {
    const raw = window.localStorage.getItem(resumeImportAiPreferenceStorageKey);
    if (!raw) return "unset";
    const parsed = JSON.parse(raw) as Partial<StoredResumeImportAiPreference>;
    if (
      parsed.schemaVersion !== "resume-import-ai-preference-v1"
      || (parsed.mode !== "ai" && parsed.mode !== "local")
      || parsed.providerFingerprint !== currentResumeImportProviderFingerprint()
    ) {
      return "unset";
    }
    return parsed.mode;
  } catch {
    return "unset";
  }
}

export function writeResumeImportSemanticPreference(
  mode: Exclude<ResumeImportSemanticPreference, "unset">
) {
  if (typeof window === "undefined") return;
  const value: StoredResumeImportAiPreference = {
    schemaVersion: "resume-import-ai-preference-v1",
    mode,
    providerFingerprint: currentResumeImportProviderFingerprint()
  };
  window.localStorage.setItem(resumeImportAiPreferenceStorageKey, JSON.stringify(value));
}
