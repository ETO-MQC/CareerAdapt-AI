import { z } from "zod";

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
  lastCheckedAt: z.string().datetime({ offset: true }),
  safeErrorCode: z.string().min(1).optional()
}).strict();

export type RuntimeHealth = z.infer<typeof RuntimeHealthSchema>;

export function isRoadshowReady(health: RuntimeHealth) {
  return health.runtimeAvailable
    && health.providerReachable
    && health.mcpConnected
    && health.careerSkillsLoaded;
}

export function runtimeHealthStatus(health: RuntimeHealth) {
  return isRoadshowReady(health)
    ? "ready" as const
    : health.runtimeAvailable || health.mcpConnected || health.careerSkillsLoaded
      ? "starting" as const
      : "unavailable" as const;
}
