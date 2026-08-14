import { CAREER_WORKFLOW_FACADE_DEFINITIONS } from "@/agent/workflows/CareerWorkflowFacade";
import type { CareerToolContract } from "@/agent/tools/CareerToolGateway";

/** The logical MCP server name written to the managed Hermes config. */
export const HERMES_CAREER_MCP_SERVER = "careeradapt";

/**
 * Hermes v0.19 registers MCP tools as
 * `mcp__<sanitized-server>__<sanitized-tool>`.
 *
 * Keep the sanitizer here deliberately small and source-compatible with
 * Hermes' `sanitize_mcp_name_component`.  CareerAdapt's MCP wire contract
 * remains the stable dotted name; only this model-facing registry name is
 * translated.
 */
export function sanitizeHermesMcpNameComponent(value: string) {
  return value.replace(/[^A-Za-z0-9_]/gu, "_");
}

export function hermesRegisteredCareerToolName(
  stableName: string,
  serverName = HERMES_CAREER_MCP_SERVER
) {
  return `mcp__${sanitizeHermesMcpNameComponent(serverName)}__${sanitizeHermesMcpNameComponent(stableName)}`;
}

export const HERMES_REQUIRED_CAREER_FACADES = CAREER_WORKFLOW_FACADE_DEFINITIONS
  .map((definition) => definition.name)
  .sort();

/**
 * The production Hermes model sees workflow boundaries and a very small
 * diagnostic/read surface. Atomic contracts remain registered for the
 * browser gateway and internal recovery, but are not part of normal model
 * planning.
 */
export const HERMES_PRODUCTION_TOOL_PROFILE = [
  ...HERMES_REQUIRED_CAREER_FACADES,
  "career.system.runtime_status",
  "career.system.current_task",
  "career.system.last_failure",
  "career.profile.get",
  "career.resume.list",
  "career.job.list"
] as const;

export function hermesProductionToolNames() {
  return new Set<string>(HERMES_PRODUCTION_TOOL_PROFILE);
}

export type HermesCareerToolCatalogEntry = {
  stableName: string;
  registeredName: string;
  kind: "facade" | "atomic";
  sourceToolName?: string;
};

export type HermesCareerToolCoverage = {
  hermesMcpRegistered: boolean;
  hermesMcpToolCount: number;
  hermesCareerFacadeCount: number;
  requiredCareerFacadesMissing: string[];
  visibleCareerTools: string[];
};

/**
 * One authoritative stable → Hermes registry mapping for all CareerAdapt MCP
 * contracts visible to the browser bridge.  It is also used by instructions,
 * diagnostics, tests, and the legacy callback adapter.
 */
export class HermesCareerToolCatalog {
  private readonly byStableName: Map<string, HermesCareerToolCatalogEntry>;
  private readonly byRegisteredName: Map<string, HermesCareerToolCatalogEntry>;

  constructor(contracts: Array<Pick<CareerToolContract, "name" | "sourceToolName">> | string[] = []) {
    const names = contracts.map((contract) => typeof contract === "string" ? contract : contract.name);
    const sourceNames = new Map(
      contracts.flatMap((contract) => typeof contract === "string" ? [] : [[contract.name, contract.sourceToolName] as const])
    );
    const uniqueNames = [...new Set(names)].sort();
    const entries = uniqueNames.map((stableName) => ({
      stableName,
      registeredName: hermesRegisteredCareerToolName(stableName),
      kind: HERMES_REQUIRED_CAREER_FACADES.includes(stableName) ? "facade" as const : "atomic" as const,
      ...(sourceNames.get(stableName) ? { sourceToolName: sourceNames.get(stableName) } : {})
    }));
    this.byStableName = new Map(entries.map((entry) => [entry.stableName, entry]));
    this.byRegisteredName = new Map(entries.map((entry) => [entry.registeredName, entry]));
  }

  entries() {
    return [...this.byStableName.values()];
  }

  facadeEntries() {
    return this.entries().filter((entry) => entry.kind === "facade");
  }

  entryForStableName(stableName: string) {
    return this.byStableName.get(stableName);
  }

  entryForRegisteredName(registeredName: string) {
    return this.byRegisteredName.get(registeredName);
  }

  /** Resolve Hermes' exact requested name back to the stable gateway name. */
  stableNameForRequestedName(requestedName: string) {
    if (this.byStableName.has(requestedName)) return requestedName;
    const exact = this.byRegisteredName.get(requestedName);
    if (exact) return exact.stableName;

    // Keep diagnostics useful for the approximate single-underscore spelling
    // used by older Hermes builds and in incident reports.  We only accept a
    // match against this catalog, never an arbitrary transformed name.
    const legacyName = requestedName.startsWith("mcp_careeradapt_")
      ? requestedName.slice("mcp_careeradapt_".length)
      : undefined;
    if (!legacyName) return undefined;
    return this.entries().find((entry) => sanitizeHermesMcpNameComponent(entry.stableName) === legacyName)?.stableName;
  }

  registeredNameForStableName(stableName: string) {
    return this.byStableName.get(stableName)?.registeredName
      ?? hermesRegisteredCareerToolName(stableName);
  }

  isCareerMcpRegisteredName(name: string) {
    return name.startsWith(`mcp__${sanitizeHermesMcpNameComponent(HERMES_CAREER_MCP_SERVER)}__`)
      || name.startsWith(`mcp_${sanitizeHermesMcpNameComponent(HERMES_CAREER_MCP_SERVER)}_`);
  }

  coverage(visibleTools: string[], registeredToolsets?: string[]): HermesCareerToolCoverage {
    const visibleCareerTools = [...new Set(visibleTools.filter((name) => this.isCareerMcpRegisteredName(name)))].sort();
    const visibleStableNames = new Set(
      visibleCareerTools.flatMap((name) => {
        const stableName = this.stableNameForRequestedName(name);
        return stableName ? [stableName] : [];
      })
    );
    const requiredCareerFacadesMissing = HERMES_REQUIRED_CAREER_FACADES
      .filter((name) => !visibleStableNames.has(name));
    return {
      hermesMcpRegistered: visibleCareerTools.length > 0
        && (!registeredToolsets || registeredToolsets.includes(`mcp-${HERMES_CAREER_MCP_SERVER}`)),
      hermesMcpToolCount: visibleCareerTools.length,
      hermesCareerFacadeCount: HERMES_REQUIRED_CAREER_FACADES.filter((name) => visibleStableNames.has(name)).length,
      requiredCareerFacadesMissing,
      visibleCareerTools
    };
  }

  /** Stable names exposed by CareerAdapt's MCP wire server. */
  stableNames() {
    return this.entries().map((entry) => entry.stableName);
  }

  /** Exact Hermes names used in model-facing instructions and diagnostics. */
  registeredNames() {
    return this.entries().map((entry) => entry.registeredName);
  }
}

export function projectCareerContractsForHermes(
  contracts: CareerToolContract[],
  allowedStableNames?: Set<string>
) {
  const catalog = new HermesCareerToolCatalog(contracts);
  return contracts
    .filter((contract) => !allowedStableNames || allowedStableNames.has(contract.name))
    .map((contract) => ({
      ...contract,
      name: catalog.registeredNameForStableName(contract.name),
      careerAdaptStableName: contract.name,
      description: `${contract.description} Stable CareerAdapt contract: ${contract.name}.`
    }));
}

export function normalizeHermesCareerToolName(
  requestedName: string,
  contracts: Array<Pick<CareerToolContract, "name" | "sourceToolName">> | string[] = []
) {
  return new HermesCareerToolCatalog(contracts).stableNameForRequestedName(requestedName);
}
