export const RESUME_IMPORT_FORMATS = [
  { id: "pdf", label: "PDF", mimeTypes: ["application/pdf"], extensions: [".pdf"] },
  {
    id: "docx",
    label: "DOCX",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    extensions: [".docx"]
  },
  { id: "json", label: "JSON", mimeTypes: ["application/json"], extensions: [".json"] },
  { id: "markdown", label: "Markdown", mimeTypes: ["text/markdown"], extensions: [".md", ".markdown"] },
  { id: "text", label: "TXT", mimeTypes: ["text/plain"], extensions: [".txt"] },
  { id: "png", label: "PNG", mimeTypes: ["image/png"], extensions: [".png"] },
  { id: "jpeg", label: "JPG/JPEG", mimeTypes: ["image/jpeg"], extensions: [".jpg", ".jpeg"] }
] as const;

export const RESUME_IMPORT_ACCEPT = RESUME_IMPORT_FORMATS
  .flatMap((format) => [...format.mimeTypes, ...format.extensions])
  .join(",");

export const AgentProductCapabilityManifest = {
  inputFormats: RESUME_IMPORT_FORMATS.map(({ id, label }) => {
    return {
      id,
      label,
      productStatus: "available" as const,
      entrypoints: {
        manual: "available" as const,
        agent: "available" as const
      }
    };
  }),
  supportedExportFormats: [
    { id: "pdf", label: "PDF", productStatus: "available", entrypoints: { manual: "available", agent: "available" } },
    { id: "json", label: "结构化 JSON", productStatus: "available", entrypoints: { manual: "available", agent: "available" } }
  ],
  ocr: {
    supportedInputs: ["pdf", "png", "jpeg"],
    productStatus: "partial",
    entrypoints: {
      manual: "partial",
      agent: "partial"
    },
    runtime: "optional_local_service",
    fallback: "manual_review_required"
  },
  operation: {
    localWorkspace: "offline",
    aiTasks: "configured_provider_required",
    externalTools: "availability_is_runtime_discovered"
  },
  capabilities: [
    "career_material_intake",
    "profile_management",
    "resume_analysis",
    "job_fit_analysis",
    "resume_tailoring",
    "resume_archive_restore",
    "resume_export"
  ]
} as const;

export const AGENT_RESUME_IMPORT_ACCEPT = AgentProductCapabilityManifest.inputFormats
  .filter((format) => format.entrypoints.agent === "available")
  .flatMap((format) => {
    const definition = RESUME_IMPORT_FORMATS.find((candidate) => candidate.id === format.id);
    return definition ? [...definition.mimeTypes, ...definition.extensions] : [];
  })
  .join(",");

export function capabilityManifestForPrompt() {
  return {
    inputFormats: AgentProductCapabilityManifest.inputFormats,
    exportFormats: AgentProductCapabilityManifest.supportedExportFormats,
    ocr: AgentProductCapabilityManifest.ocr,
    operation: AgentProductCapabilityManifest.operation,
    capabilities: AgentProductCapabilityManifest.capabilities
  };
}
