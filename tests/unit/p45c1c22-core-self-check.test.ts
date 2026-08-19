import { expect, it, afterEach } from "vitest";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";
import { CareerProfileSchema, ProfileStructuredFactSchema, ResumeItemV2Schema } from "@/domain/schemas";
import { buildLiveProfileContentIntegrity } from "@/domain/profile/profileContentIntegrity";
import { applyProfileRecoveryItems } from "@/domain/profile/profileContentRecovery";
import { runP45CoreClosureSelfCheck } from "@/services/diagnostics/p45CoreClosureSelfCheck";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  db?.close();
  if (db) await db.delete();
  db = undefined;
});

function profileWithProject() {
  const now = "2026-08-19T00:00:00.000Z";
  return CareerProfileSchema.parse({
    id: "profile-5PV7uCZWGh",
    personId: "person-core-check",
    profileVersionNumber: 1,
    isCurrent: true,
    versionCreatedReason: "initial",
    schemaVersion: "career-profile-v2",
    name: "诊断人物",
    basics: { name: "诊断人物", links: [] },
    structuredBasics: { name: "诊断人物", otherLinks: [], customFields: [] },
    preference: { targetRoles: [], targetCities: [], industries: [] },
    version: 3,
    structuredFacts: [{
      data: ResumeItemV2Schema.parse({
        id: "project-core",
        sectionType: "project",
        title: "核心项目",
        role: "工程师",
        tools: ["TypeScript"],
        description: "项目说明",
        highlights: ["成果一", "成果二"],
        outcomes: ["结果"],
        customFields: []
      }),
      factIds: [],
      sourceBlockIds: [],
      sourceRanges: [],
      mappingTrace: []
    }],
    experiences: [],
    skills: [],
    certificates: [],
    evidences: [],
    unclassifiedBlocks: [],
    createdAt: now,
    updatedAt: now
  });
}

it("classifies a visible repository item whose editor projection is empty", () => {
  const profile = profileWithProject();
  const result = buildLiveProfileContentIntegrity({
    profile,
    liveProjection: {
      profileId: profile.id,
      profileRevision: profile.version,
      selectedItemId: "project-core",
      selectedSectionType: "project",
      adapter: { paragraphCount: 1, bulletCount: 3 },
      form: { paragraphCount: 1, bulletCount: 3 },
      editor: { visibleParagraphCount: 0, visibleBulletCount: 0 },
      dirty: false,
      capturedAt: "2026-08-19T00:00:00.000Z"
    }
  });

  expect(result.classification).toBe("editor_hydration_loss");
  expect(result.profileContentIntegrity).toMatchObject({
    profileId: profile.id,
    revision: profile.version,
    repository: { projectCount: 1, projectDescriptionCount: 1, projectHighlightCount: 2 },
    adapter: { paragraphCount: 1, bulletCount: 3 },
    form: { paragraphCount: 1, bulletCount: 3 },
    editor: { visibleParagraphCount: 0, visibleBulletCount: 0 }
  });
});

it("merges confirmed recovery content without changing the source Profile object", () => {
  const profile = profileWithProject();
  const incoming = ProfileStructuredFactSchema.parse({
    data: ResumeItemV2Schema.parse({
      id: "project-recovered",
      sectionType: "project",
      title: "恢复项目",
      role: "工程师",
      description: "恢复说明",
      highlights: ["恢复成果"],
      outcomes: [],
      tools: [],
      customFields: []
    }),
    factIds: [],
    sourceBlockIds: ["source-confirmed"],
    sourceRanges: [],
    mappingTrace: []
  });
  const repaired = applyProfileRecoveryItems({
    profile,
    items: [{ structuredFact: incoming, facts: [] }],
    now: "2026-08-19T00:01:00.000Z"
  });

  expect(profile.structuredFacts).toHaveLength(1);
  expect(repaired.structuredFacts).toHaveLength(2);
  expect(repaired.structuredFacts?.find((entry) => entry.data.id === "project-recovered")?.data).toMatchObject({ highlights: ["恢复成果"] });
});

it("runs the production MCP route shape and correlates one logical tool id", async () => {
  db = new CareerAdaptDb(`CareerAdaptP45C1C22-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const profile = profileWithProject();
  await repository.saveProfile(profile);
  await repository.setActiveCareerContext({ personId: profile.personId!, profileId: profile.id });
  const gateway = new CareerToolGateway(new AgentToolRegistry([]));
  const contracts = gateway.listContracts();
  const runtimeSnapshot = {
    preferredRuntime: "hermes" as const,
    activeRuntime: "hermes" as const,
    status: "ready" as const,
    processReady: true,
    apiReady: true,
    providerReady: true,
    careerMcpReady: true,
    toolSurfaceReady: true,
    runReady: true,
    mcpConnected: true,
    discoveredToolCount: contracts.length
  };
  const fetcher: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { params?: { _meta?: { "careeradapt/logicalToolOperationId"?: string } } };
    const logicalToolOperationId = request.params?._meta?.["careeradapt/logicalToolOperationId"];
    return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: "request",
    result: {
      structuredContent: {
        ok: true,
        data: { profile: { id: profile.id, version: profile.version } },
        diagnostics: {
          mcpCallTrace: {
            logicalToolOperationId,
            browserMcpHandlerReached: true,
            gatewayReached: true
          },
          mcpResponseTrace: {
            responseSerialized: true,
            responseEnvelopeValid: true,
            responseSent: true
          }
        }
      },
      _meta: { "careeradapt/logicalToolOperationId": logicalToolOperationId }
    }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await runP45CoreClosureSelfCheck({ repository, runtimeSnapshot, contracts, fetcher });
  expect(result.checks.browserMcpRoundTrip.status).toBe("PASS");
  expect(result.checks.logicalToolOperationIdCorrelation.status).toBe("PASS");
  expect(result.checks.turnTargetContext.status).toBe("PASS");
  expect(result.checks.repositoryReadback.status).toBe("PASS");
});
