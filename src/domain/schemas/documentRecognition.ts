import { z } from "zod";

export const DocumentParsingModeSchema = z.enum([
  "auto",
  "text_layer",
  "local_ocr",
  "manual_review"
]);

export const DocumentRecognitionModelIdSchema = z.enum([
  "official_paddle_bf16",
  "hf_int8_safetensors",
  "hf_int4_openvino",
  "official_gguf_bf16",
  "gguf_q4_k_m",
  "gguf_q5_k_m",
  "gguf_q6_k",
  "gguf_q8_0"
]);

export const DocumentRecognitionPreferencesSchema = z.object({
  schemaVersion: z.literal("document-recognition-preferences-v1"),
  parsingMode: DocumentParsingModeSchema,
  localOcrEnabled: z.boolean(),
  modelDirectory: z.string().max(1024),
  modelId: DocumentRecognitionModelIdSchema,
  openDataLoaderExperimental: z.boolean(),
  allowManualRouteSelection: z.boolean()
}).strict();

export const DocumentEngineHealthSchema = z.object({
  engine: z.string().min(1),
  status: z.enum(["ready", "missing", "loading", "error"]),
  version: z.string().min(1).optional(),
  message: z.string().min(1).optional()
}).strict();

export const DocumentEngineHealthReportSchema = z.object({
  paddleOcr: DocumentEngineHealthSchema,
  modelDirectory: DocumentEngineHealthSchema,
  python: DocumentEngineHealthSchema,
  openDataLoader: DocumentEngineHealthSchema.optional(),
  java: DocumentEngineHealthSchema.optional(),
  suggestedModelDirectories: z.array(z.string()).default([])
}).strict();

export type DocumentParsingMode = z.infer<typeof DocumentParsingModeSchema>;
export type DocumentRecognitionModelId = z.infer<typeof DocumentRecognitionModelIdSchema>;
export type DocumentRecognitionPreferences = z.infer<typeof DocumentRecognitionPreferencesSchema>;
export type DocumentEngineHealth = z.infer<typeof DocumentEngineHealthSchema>;
export type DocumentEngineHealthReport = z.infer<typeof DocumentEngineHealthReportSchema>;
