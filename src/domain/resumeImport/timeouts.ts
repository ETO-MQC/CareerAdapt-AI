import { z } from "zod";

export const RESUME_IMPORT_TIMEOUT_HEADER = "x-resume-import-timeout-seconds";
export const DEFAULT_VISION_TIMEOUT_SECONDS = 8 * 60;
export const DEFAULT_MAPPING_TIMEOUT_SECONDS = 10 * 60;
export const ResumeImportTimeoutSecondsSchema = z.number().int().min(60).max(30 * 60);
