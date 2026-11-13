import { describe, expect, it } from "vitest";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { HERMES_PRODUCTION_TOOL_PROFILE, projectCareerContractsForHermes } from "@/agent/runtime/hermes/HermesCareerToolCatalog";
import { createCareerAdaptMcpBridgeGateway, disconnectCareerAdaptMcpBridge, registerCareerAdaptMcpBridge } from "@/server/careerAdaptMcpBridgeRegistry";

describe("Career tool catalog surface", () => {
  it("publishes the same selected Gateway contracts and schemas through MCP and Hermes", () => {
    const service = new BrowserAgentToolService(new WorkspaceRepository());
    const gateway = new CareerToolGateway(createAgentToolRegistry(service));
    const contracts = gateway.listContracts();
    const selected = new Set(HERMES_PRODUCTION_TOOL_PROFILE);
    const expected = contracts.filter((contract) => selected.has(contract.name));
    expect(expected.map((contract) => contract.name).sort()).toEqual([...selected].sort());
    expect(selected.has("career.job.get")).toBe(true);
    expect(selected.has("career.resume.get")).toBe(true);
    const registration = registerCareerAdaptMcpBridge(contracts);
    try {
      const mcp = createCareerAdaptMcpBridgeGateway("hermes-production").listContracts();
      expect(mcp).toEqual(expected);
      const hermes = projectCareerContractsForHermes(mcp, selected);
      for (const published of hermes) {
        const canonical = expected.find((contract) => contract.name === published.careerAdaptStableName);
        expect(canonical).toBeDefined();
        expect(published.inputSchema).toEqual(canonical!.inputSchema);
        expect(published.outputSchema).toEqual(canonical!.outputSchema);
      }
      expect(hermes).toHaveLength(expected.length);
    } finally {
      disconnectCareerAdaptMcpBridge(registration.bridgeId, registration.token);
    }
  });
});
