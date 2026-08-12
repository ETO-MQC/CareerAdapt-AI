import { describe, expect, it } from "vitest";
import {
  HERMES_REQUIRED_CAREER_FACADES,
  HermesCareerToolCatalog,
  hermesRegisteredCareerToolName,
  projectCareerContractsForHermes
} from "@/agent/runtime/hermes/HermesCareerToolCatalog";
import { parseHermesToolsetsPayload } from "@/app/api/agent/runtime/hermes/health/route";
import { RuntimeHealthSchema, isRoadshowReady } from "@/agent/runtime/runtimeHealth";

describe("P4.5b.4.2 embedded Hermes MCP closure", () => {
  it("maps stable CareerAdapt names to Hermes v0.19 double-underscore names", () => {
    expect(hermesRegisteredCareerToolName("career.workflow.compose_resume"))
      .toBe("mcp__careeradapt__career_workflow_compose_resume");
    const catalog = new HermesCareerToolCatalog([
      "career.workflow.compose_resume",
      "career.profile.get"
    ]);
    expect(catalog.stableNameForRequestedName("mcp__careeradapt__career_workflow_compose_resume"))
      .toBe("career.workflow.compose_resume");
    expect(catalog.stableNameForRequestedName("mcp_careeradapt_career_workflow_compose_resume"))
      .toBe("career.workflow.compose_resume");
  });

  it("requires every workflow facade to be visible in the Hermes registry", () => {
    const catalog = new HermesCareerToolCatalog(HERMES_REQUIRED_CAREER_FACADES);
    const visible = HERMES_REQUIRED_CAREER_FACADES.map((name) => catalog.registeredNameForStableName(name));
    expect(catalog.coverage(visible, ["mcp-careeradapt"])).toMatchObject({
      hermesMcpRegistered: true,
      hermesMcpToolCount: 8,
      hermesCareerFacadeCount: 8,
      requiredCareerFacadesMissing: []
    });
    const health = RuntimeHealthSchema.parse({
      runtimeId: "hermes",
      runtimeAvailable: true,
      providerConfigured: true,
      providerReachable: true,
      model: "test-model",
      toolCallingAvailable: true,
      mcpConnected: true,
      mcpToolCount: 55,
      careerSkillsLoaded: true,
      browserCareerDomainHostConnected: true,
      careerMcpServerReachable: true,
      careerMcpContractCount: 55,
      hermesMcpRegistered: true,
      hermesMcpToolCount: 55,
      hermesCareerFacadeCount: 8,
      requiredCareerFacadesMissing: [],
      lastCheckedAt: new Date().toISOString()
    });
    expect(isRoadshowReady(health)).toBe(true);
    expect(isRoadshowReady({ ...health, requiredCareerFacadesMissing: [HERMES_REQUIRED_CAREER_FACADES[0]] })).toBe(false);
  });

  it("projects model-facing contracts without changing the stable gateway name", () => {
    const contract = {
      name: "career.workflow.compose_resume",
      description: "Compose",
      sourceToolName: "compose_resume"
    } as never;
    const projected = projectCareerContractsForHermes([contract])[0];
    expect(projected).toMatchObject({
      name: "mcp__careeradapt__career_workflow_compose_resume",
      careerAdaptStableName: "career.workflow.compose_resume"
    });
  });

  it("parses only enabled Hermes toolsets and preserves exact visible tool names", () => {
    const snapshot = parseHermesToolsetsPayload({
      object: "list",
      data: [
        { name: "skills", enabled: true, tools: ["skills_list"] },
        { name: "mcp-careeradapt", enabled: true, tools: ["mcp__careeradapt__career_workflow_compose_resume"] },
        { name: "terminal", enabled: false, tools: ["terminal"] }
      ]
    });
    expect(snapshot).toEqual({
      ok: true,
      registeredToolsets: ["mcp-careeradapt", "skills"],
      visibleTools: ["mcp__careeradapt__career_workflow_compose_resume", "skills_list"]
    });
  });
});
