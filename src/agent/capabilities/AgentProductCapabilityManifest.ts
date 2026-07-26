export const RESUME_IMPORT_FORMATS = [
  { id: "pdf", label: "PDF", mimeTypes: ["application/pdf"], extensions: [".pdf"] },
  {
    id: "docx",
    label: "DOCX",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    extensions: [".docx"]
  },
  { id: "json", label: "JSON", mimeTypes: ["application/json"], extensions: [".json"] },
  { id: "png", label: "PNG", mimeTypes: ["image/png"], extensions: [".png"] },
  { id: "jpeg", label: "JPG/JPEG", mimeTypes: ["image/jpeg"], extensions: [".jpg", ".jpeg"] }
] as const;

export const RESUME_IMPORT_ACCEPT = RESUME_IMPORT_FORMATS
  .flatMap((format) => [...format.mimeTypes, ...format.extensions])
  .join(",");

export const AgentProductCapabilityManifest = {
  supportedInputFormats: RESUME_IMPORT_FORMATS.map(({ id, label }) => ({ id, label })),
  supportedExportFormats: [
    { id: "pdf", label: "PDF" },
    { id: "json", label: "结构化 JSON" }
  ],
  ocr: {
    supportedInputs: ["pdf", "png", "jpeg"],
    status: "optional_local_service",
    fallback: "manual_review_required"
  },
  operation: {
    localWorkspace: "offline",
    aiTasks: "configured_provider_required",
    externalTools: "availability_is_runtime_discovered"
  },
  capabilities: [
    "profile_management",
    "resume_analysis",
    "job_fit_analysis",
    "resume_tailoring",
    "resume_archive_restore",
    "resume_export"
  ]
} as const;

export function capabilityManifestForPrompt() {
  return {
    inputFormats: AgentProductCapabilityManifest.supportedInputFormats,
    exportFormats: AgentProductCapabilityManifest.supportedExportFormats,
    ocr: AgentProductCapabilityManifest.ocr,
    operation: AgentProductCapabilityManifest.operation,
    capabilities: AgentProductCapabilityManifest.capabilities
  };
}
