import {
  DocumentRecognitionPreferencesSchema,
  type DocumentRecognitionPreferences
} from "@/domain/schemas";

export const documentRecognitionStorageKey = "careeradapt.documentRecognition";

export const DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES: DocumentRecognitionPreferences = {
  schemaVersion: "document-recognition-preferences-v1",
  parsingMode: "auto",
  localOcrEnabled: true,
  modelDirectory: "",
  openDataLoaderExperimental: false,
  allowManualRouteSelection: true
};

export function readDocumentRecognitionPreferences(): DocumentRecognitionPreferences {
  if (typeof window === "undefined") {
    return { ...DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES };
  }
  try {
    const raw = window.localStorage.getItem(documentRecognitionStorageKey);
    if (!raw) return { ...DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES };
    return migrateDocumentRecognitionPreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES };
  }
}

export function writeDocumentRecognitionPreferences(preferences: DocumentRecognitionPreferences) {
  if (typeof window === "undefined") return;
  const parsed = DocumentRecognitionPreferencesSchema.parse(preferences);
  window.localStorage.setItem(documentRecognitionStorageKey, JSON.stringify(parsed));
  window.dispatchEvent(new CustomEvent("careeradapt-document-recognition-change", { detail: parsed }));
}

export function migrateDocumentRecognitionPreferences(value: unknown): DocumentRecognitionPreferences {
  const current = DocumentRecognitionPreferencesSchema.safeParse(value);
  if (current.success) return current.data;
  if (!value || typeof value !== "object") return { ...DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES };
  const legacy = value as Record<string, unknown>;
  const parsingMode = legacy.parsingMode === "text_first"
    ? "text_layer"
    : legacy.parsingMode;
  return DocumentRecognitionPreferencesSchema.parse({
    ...DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES,
    parsingMode: ["auto", "text_layer", "local_ocr", "manual_review"].includes(String(parsingMode))
      ? parsingMode
      : DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES.parsingMode,
    localOcrEnabled: typeof legacy.localOcrEnabled === "boolean"
      ? legacy.localOcrEnabled
      : DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES.localOcrEnabled,
    modelDirectory: typeof legacy.modelDirectory === "string" ? legacy.modelDirectory : "",
    openDataLoaderExperimental: legacy.openDataLoaderExperimental === true,
    allowManualRouteSelection: typeof legacy.allowManualRouteSelection === "boolean"
      ? legacy.allowManualRouteSelection
      : DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES.allowManualRouteSelection
  });
}
