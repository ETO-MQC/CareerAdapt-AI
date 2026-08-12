import { z } from "zod";
import { HERMES_REQUIRED_CAREER_FACADES } from "./hermes/HermesCareerToolCatalog";

/** The single readiness contract used by the UI, diagnostics and roadshow. */
export const RuntimeHealthSchema = z.object({
  runtimeId: z.string().min(1),
  runtimeAvailable: z.boolean(),
  providerConfigured: z.boolean(),
  providerReachable: z.boolean(),
  model: z.string().min(1).optional(),
  contextWindow: z.number().int().min(0).optional(),
  toolCallingAvailable: z.boolean(),
  mcpConnected: z.boolean(),
  mcpToolCount: z.number().int().min(0),
  careerSkillsLoaded: z.boolean(),
  browserCareerDomainHostConnected: z.boolean().default(false),
  careerMcpServerReachable: z.boolean().default(false),
  careerMcpContractCount: z.number().int().min(0).default(0),
  hermesMcpRegistered: z.boolean().default(false),
  hermesMcpToolCount: z.number().int().min(0).default(0),
  hermesCareerFacadeCount: z.number().int().min(0).default(0),
  requiredCareerFacadesMissing: z.array(z.string().min(1)).default([...HERMES_REQUIRED_CAREER_FACADES]),
  careerGatewayContracts: z.array(z.string().min(1)).default([]),
  careerMcpExposedTools: z.array(z.string().min(1)).default([]),
  hermesRegisteredToolsets: z.array(z.string().min(1)).default([]),
  hermesVisibleTools: z.array(z.string().min(1)).default([]),
  missingRequiredCareerTools: z.array(z.string().min(1)).default([...HERMES_REQUIRED_CAREER_FACADES]),
  lastRequestedHermesToolName: z.string().min(1).optional(),
  lastRequestedCareerToolName: z.string().min(1).optional(),
  lastCheckedAt: z.string().datetime({ offset: true }),
  safeErrorCode: z.string().min(1).optional()
}).strict();

export type RuntimeHealth = z.infer<typeof RuntimeHealthSchema>;

export function isRoadshowReady(health: RuntimeHealth) {
  return health.runtimeAvailable
    && health.providerConfigured
    && health.providerReachable
    && Boolean(health.model)
    && health.browserCareerDomainHostConnected
    && health.careerMcpServerReachable
    && health.careerMcpContractCount > 0
    && health.hermesMcpRegistered
    && health.hermesMcpToolCount > 0
    && health.hermesCareerFacadeCount >= HERMES_REQUIRED_CAREER_FACADES.length
    && health.requiredCareerFacadesMissing.length === 0
    && health.careerSkillsLoaded;
}

export function runtimeHealthStatus(health: RuntimeHealth) {
  return isRoadshowReady(health)
    ? "ready" as const
    : health.runtimeAvailable || health.mcpConnected || health.careerSkillsLoaded
      ? "starting" as const
      : "unavailable" as const;
}
