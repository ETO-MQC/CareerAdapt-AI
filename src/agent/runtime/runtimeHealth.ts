import { z } from "zod";
import { HERMES_REQUIRED_CAREER_FACADES } from "./hermes/HermesCareerToolCatalog";
import { HermesRunFailureDiagnosticsSchema } from "./hermes/hermesRunReliability";

/** The single readiness contract used by the UI, diagnostics and roadshow. */
export const RuntimeHealthSchema = z.object({
  runtimeId: z.string().min(1),
  activeRunId: z.string().min(1).optional(),
  hermesRunId: z.string().min(1).optional(),
  runtimeAvailable: z.boolean(),
  /** Lightweight readiness dimensions. Optional for persisted pre-P4.5c.1.7 snapshots. */
  companionReady: z.boolean().optional(),
  providerConfigured: z.boolean(),
  providerReachable: z.boolean(),
  providerReady: z.boolean().optional(),
  model: z.string().min(1).optional(),
  contextWindow: z.number().int().min(0).optional(),
  /** Capability of the configured model/runtime; it is not an in-flight tool call. */
  toolCallingCapability: z.enum(["verified", "unverified", "unsupported", "unknown"]).optional(),
  toolCallingAvailable: z.boolean(),
  /** Observational state only. Watchdogs must not infer a stall from this flag. */
  toolCallInFlight: z.boolean().optional(),
  mcpConnected: z.boolean(),
  mcpReady: z.boolean().optional(),
  mcpToolCount: z.number().int().min(0),
  careerSkillsLoaded: z.boolean(),
  browserCareerDomainHostConnected: z.boolean().default(false),
  careerMcpServerReachable: z.boolean().default(false),
  careerMcpContractCount: z.number().int().min(0).default(0),
  hermesMcpRegistered: z.boolean().default(false),
  hermesMcpToolCount: z.number().int().min(0).default(0),
  hermesCareerFacadeCount: z.number().int().min(0).default(0),
  careerToolContractReady: z.boolean().default(true),
  careerToolContractVersion: z.string().min(1).optional(),
  careerToolContractReason: z.string().min(1).optional(),
  careerToolContractMismatches: z.array(z.object({
    toolName: z.string().min(1),
    reason: z.string().min(1),
    publishedContractVersion: z.string().min(1).optional(),
    publishedSchemaHash: z.string().min(1).optional(),
    expectedSchemaHash: z.string().min(1).optional()
  }).strict()).default([]),
  requiredCareerFacadesMissing: z.array(z.string().min(1)).default([...HERMES_REQUIRED_CAREER_FACADES]),
  careerGatewayContracts: z.array(z.string().min(1)).default([]),
  careerMcpExposedTools: z.array(z.string().min(1)).default([]),
  hermesRegisteredToolsets: z.array(z.string().min(1)).default([]),
  hermesVisibleTools: z.array(z.string().min(1)).default([]),
  missingRequiredCareerTools: z.array(z.string().min(1)).default([...HERMES_REQUIRED_CAREER_FACADES]),
  lastRequestedHermesToolName: z.string().min(1).optional(),
  lastRequestedCareerToolName: z.string().min(1).optional(),
  lastCheckedAt: z.string().datetime({ offset: true }),
  safeErrorCode: z.string().min(1).optional(),
  /** This is run-start capability, not an LLM completion probe. */
  runReady: z.boolean().optional(),
  runReadyCheckedAt: z.string().datetime({ offset: true }).optional(),
  runReadySafeErrorCode: z.string().min(1).optional(),
  runtimeFailureDiagnostics: HermesRunFailureDiagnosticsSchema.optional()
}).strict();

export type RuntimeHealth = z.infer<typeof RuntimeHealthSchema>;

export function isRoadshowReady(health: RuntimeHealth) {
  const dimensions = readinessDimensions(health);
  return dimensions.companionReady
    && dimensions.providerReady
    && dimensions.mcpReady
    && dimensions.runReady
    && health.runtimeAvailable
    && health.providerConfigured
    && health.providerReachable
    && Boolean(health.model)
    && health.browserCareerDomainHostConnected
    && health.careerMcpServerReachable
    && health.careerMcpContractCount > 0
    && health.careerToolContractReady
    && health.hermesMcpRegistered
    && health.hermesMcpToolCount > 0
    && health.hermesCareerFacadeCount >= HERMES_REQUIRED_CAREER_FACADES.length
    && health.requiredCareerFacadesMissing.length === 0
    && health.careerSkillsLoaded;
}

export function readinessDimensions(health: RuntimeHealth) {
  return {
    companionReady: health.companionReady ?? health.runtimeAvailable,
    providerReady: health.providerReady ?? (health.providerConfigured && health.providerReachable && Boolean(health.model)),
    mcpReady: health.mcpReady ?? (
      health.mcpConnected
      && health.browserCareerDomainHostConnected
      && health.careerMcpServerReachable
      && health.careerMcpContractCount > 0
      && health.careerToolContractReady
      && health.hermesMcpRegistered
      && health.hermesMcpToolCount > 0
      && health.hermesCareerFacadeCount >= HERMES_REQUIRED_CAREER_FACADES.length
      && health.requiredCareerFacadesMissing.length === 0
    ),
    // Older persisted health records predate run readiness. Their existing
    // registry checks remain the compatibility fallback; current health
    // responses always provide this field explicitly.
    runReady: health.runReady ?? true
  };
}

export function runtimeHealthStatus(health: RuntimeHealth) {
  return isRoadshowReady(health)
    ? "ready" as const
    : /auth|provider|invalid|config|contract/u.test(`${health.runReadySafeErrorCode ?? ""} ${health.safeErrorCode ?? ""} ${health.careerToolContractReason ?? ""}`)
      ? "unavailable" as const
      : health.runtimeAvailable || health.mcpConnected || health.careerSkillsLoaded
      ? "starting" as const
      : "unavailable" as const;
}
