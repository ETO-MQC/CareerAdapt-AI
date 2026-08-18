import { CAREER_TOOL_CONTRACT_VERSION } from "@/agent/tools/careerToolContract";

/**
 * Build markers are injected by the deployment environment when available.
 * They intentionally contain no filesystem paths or user data.
 */
export const appBuildTechnicalDiagnostics = {
  appBuildCommit: process.env.NEXT_PUBLIC_APP_BUILD_COMMIT?.trim()
    || process.env.APP_BUILD_COMMIT?.trim()
    || "unknown",
  appBuildTimestamp: process.env.NEXT_PUBLIC_APP_BUILD_TIMESTAMP?.trim()
    || process.env.APP_BUILD_TIMESTAMP?.trim()
    || "unknown",
  careerToolContractVersion: CAREER_TOOL_CONTRACT_VERSION
} as const;
