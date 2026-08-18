import { afterEach, describe, expect, it } from "vitest";
import { CareerAdaptMcpProtocolServer } from "@/agent/mcp/CareerAdaptMcpServer";
import { mapOfficialHermesEvent } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";
import { editorDocumentToCanonicalExperience, canonicalExperienceToEditorDocument } from "@/domain/profile/experienceContentAdapter";
import { experienceDocumentToEditorHtml, editorHtmlToExperienceDocument } from "@/components/editor/helpers";
import { migrateCareerProfileToV2, projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import { retrieveCareerContext } from "@/domain/careerContext/retrieveCareerContext";
import { CareerProfileSchema, ProfileStructuredFactSchema, ResumeItemV2Schema, type CareerProfile } from "@/domain/schemas";
import { demoCareerProfile } from "@/data/demoProfile";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { ResumeImportOrchestrator } from "@/services/resumeImport/ResumeImportOrchestrator";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  if (!db) return;
  db.close();
  await db.delete();
  db = undefined;
});

describe("P4.5c.1.17 Career evidence integrity and canonical tailoring", () => {
  it("publishes declarative one-of schemas for the canonical routes", () => {
    const gateway = new CareerToolGateway(new AgentToolRegistry([]));
    const tailor = gateway.getContract("career.workflow.tailor_resume");
    const compose = gateway.getContract("career.workflow.compose_resume");
    const tailorBranches = Array.isArray(tailor.inputSchema.oneOf)
      ? tailor.inputSchema.oneOf as Array<Record<string, unknown>>
      : [];
    const composeBranches = Array.isArray(compose.inputSchema.oneOf)
      ? compose.inputSchema.oneOf as Array<Record<string, unknown>>
      : [];

    expect(tailorBranches).toHaveLength(3);
    expect(tailorBranches.map((branch) => branch.required)).toEqual([
      ["targetText"],
      ["jobId"],
      ["checkpointId"]
    ]);
    expect(composeBranches).toHaveLength(2);
    expect(composeBranches[0]?.required).toEqual(["profileId", "expectedProfileRevision", "mode"]);
    expect(composeBranches[1]?.required).toEqual(["profileId", "expectedProfileRevision", "mode", "jobId"]);
    expect(tailor.inputSchema.oneOf).toEqual(tailor.inputSchema.anyOf);
  });

  it("round-trips one rich experience editor without dropping paragraphs, bullets, tools, or provenance", () => {
    const project = ResumeItemV2Schema.parse({
      id: "project-editor-1",
      sectionType: "project",
      title: "证据编辑器项目",
      role: "产品协作",
      organization: "CareerAdapt",
      tools: ["TypeScript", "Dexie"],
      background: "将资料库事实整理为可核验简历内容。",
      description: "第一段说明项目背景和职责。",
      highlights: ["梳理用户流程", "建立证据映射", "完成回归验收"],
      outcomes: ["保存后读回内容一致。"],
      customFields: []
    });
    if (project.sectionType !== "project") throw new Error("project_fixture_invalid");
    const profileFact = ProfileStructuredFactSchema.parse({
      data: project,
      factIds: ["fact-editor-1"],
      sourceBlockIds: ["source-block-1"],
      sourceExcerpt: "项目来源摘录",
      mappingTrace: [],
      provenance: [{ kind: "source_turn", sourceTurnId: "turn-editor-1", fieldNames: ["description", "highlights", "tools"] }]
    });
    const document = canonicalExperienceToEditorDocument(profileFact);
    const html = experienceDocumentToEditorHtml(document);
    const fromHtml = editorHtmlToExperienceDocument(html, document);
    const roundTripped = editorDocumentToCanonicalExperience(profileFact, fromHtml);

    expect(fromHtml).toMatchObject({
      description: "第一段说明项目背景和职责。",
      highlights: ["梳理用户流程", "建立证据映射", "完成回归验收"],
      outcomes: ["保存后读回内容一致。"]
    });
    expect(roundTripped).toMatchObject({
      data: { description: project.description, highlights: project.highlights, tools: project.tools, outcomes: project.outcomes },
      factIds: ["fact-editor-1"],
      sourceBlockIds: ["source-block-1"],
      provenance: profileFact.provenance
    });
  });

  it("keeps project content and safe sync diagnostics through repository readback", async () => {
    db = new CareerAdaptDb(`CareerAdaptP45C1C17-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const profile = profileWithCanonicalProject();
    await repository.saveProfile(profile);
    const created = await repository.createGeneralResumeBranch({
      profileId: profile.id,
      operationId: "p45c1c17-create-general",
      name: "通用资料库简历",
      includeProfileFacts: false,
      includeProfileBasics: false
    });
    const added = await repository.addResumeContentItemFromProfileReference({
      branchId: created.branch.id,
      expectedRevision: created.branch.revision,
      operationId: "p45c1c17-profile-to-resume",
      section: "project",
      reference: { type: "canonical", itemId: "project-integrity-1", sectionType: "project" }
    });
    expect(added.syncDiagnostics).toMatchObject({
      direction: "profile_to_resume",
      sourceId: profile.id,
      targetId: created.branch.id,
      readbackVerified: true
    });

    const original = added.branch.structuredContentItems?.find((item) => item.id === added.newItemId)?.data;
    if (!original || original.sectionType !== "project") throw new Error("project_readback_missing");
    expect(original).toMatchObject({
      sectionType: "project",
      description: "原始项目段落。",
      highlights: ["原始成果一", "原始成果二"],
      tools: ["TypeScript", "Dexie"],
      outcomes: ["原始结果。"]
    });

    const editedProject = ResumeItemV2Schema.parse({
      ...original,
      description: "保存后的项目段落。",
      highlights: ["第一条成果", "第二条成果", "第三条成果"],
      tools: ["TypeScript", "Dexie", "Vitest"],
      outcomes: ["保存后仍可读回。"]
    });
    const edited = await repository.editResumeBranch({
      branchId: added.branch.id,
      expectedRevision: added.branch.revision,
      operationId: "p45c1c17-editor-save",
      confirmAsResumeOnly: true,
      edits: [{ itemId: added.newItemId, text: projectResumeItemV2(editedProject), structuredItem: editedProject }]
    });
    const reloaded = await repository.getResumeBranch(edited.branch.id);
    const reloadedProject = reloaded?.structuredContentItems?.find((item) => item.id === added.newItemId)?.data;
    expect(reloadedProject).toMatchObject({
      description: "保存后的项目段落。",
      highlights: ["第一条成果", "第二条成果", "第三条成果"],
      tools: ["TypeScript", "Dexie", "Vitest"],
      outcomes: ["保存后仍可读回。"]
    });

    const synced = await repository.syncResumeContentItemToProfile({
      branchId: edited.branch.id,
      expectedRevision: edited.branch.revision,
      operationId: "p45c1c17-resume-to-profile",
      itemId: added.newItemId,
      structuredItem: editedProject
    });
    expect(synced.syncDiagnostics).toMatchObject({ direction: "resume_to_profile", readbackVerified: true });
    const profileAfter = await repository.getProfile(profile.id);
    const profileProject = profileAfter?.structuredFacts?.find((entry) => entry.data.id === "project-integrity-1")?.data;
    expect(profileProject).toMatchObject({
      description: "保存后的项目段落。",
      highlights: ["第一条成果", "第二条成果", "第三条成果"],
      tools: ["TypeScript", "Dexie", "Vitest"],
      outcomes: ["保存后仍可读回。"]
    });
  });

  it("keeps four project items and four bullets per item in a real markdown import", async () => {
    db = new CareerAdaptDb(`CareerAdaptP45C1C17Import-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const file = new File([[
      "# Candidate",
      "## 工作经历",
      "### Company",
      "**Engineer** | 2026.02 - 2026.03",
      "- Work result one",
      "- Work result two",
      "## 项目经历",
      "### Project One",
      "**Developer** | 至今",
      "- Project one result one",
      "- Project one result two",
      "- Project one result three",
      "- Project one result four",
      "### Project Two",
      "**Developer** | 至今",
      "- Project two result one",
      "- Project two result two",
      "- Project two result three",
      "- Project two result four",
      "### Project Three",
      "**Developer** | 至今",
      "- Project three result one",
      "- Project three result two",
      "- Project three result three",
      "- Project three result four",
      "### Project Four",
      "**Developer** | 至今",
      "- Project four result one",
      "- Project four result two",
      "- Project four result three",
      "- Project four result four"
    ].join("\n")], "content-integrity.md", { type: "text/markdown" });

    const prepared = await new ResumeImportOrchestrator(repository).prepare({
      file,
      fileName: file.name,
      mimeType: file.type,
      size: file.size
    }, { semanticMode: "local" });
    const projectItems = prepared.draft.sections.find((section) => section.sectionType === "project")?.items ?? [];

    expect(prepared.status).toBe("ready_for_review");
    expect(projectItems).toHaveLength(4);
    expect(projectItems.map(({ structuredItem }) => structuredItem?.sectionType === "project" ? structuredItem.highlights : [])).toEqual([
      ["Project one result one", "Project one result two", "Project one result three", "Project one result four"],
      ["Project two result one", "Project two result two", "Project two result three", "Project two result four"],
      ["Project three result one", "Project three result two", "Project three result three", "Project three result four"],
      ["Project four result one", "Project four result two", "Project four result three", "Project four result four"]
    ]);
    expect(prepared.draft.sections.find((section) => section.sectionType === "work")?.items).toHaveLength(1);
  });

  it("returns safe career-context coverage without putting raw text in the result summary", () => {
    const result = retrieveCareerContext({
      request: { profileId: demoCareerProfile.id, query: "项目成果", maxFacts: 4 },
      profile: demoCareerProfile
    });
    expect(result.careerContextResultSummary).toMatchObject({ profileId: demoCareerProfile.id, factsReturned: result.facts.length });
    expect(result.careerContextResultSummary.entityCounts.project).toBeGreaterThan(0);
    expect(result.careerContextResultSummary.contentCoverage).toHaveProperty("projectDescriptionNonEmpty");
    expect(JSON.stringify(result.careerContextResultSummary)).not.toContain("使用 Stata");
  });

  it("keeps a successful MCP envelope successful through the official Hermes projection", async () => {
    const contract = new CareerToolGateway(new AgentToolRegistry([])).getContract("career.workflow.tailor_resume");
    const server = new CareerAdaptMcpProtocolServer({
      listContracts: () => [contract],
      execute: async (_name, _input, context) => ({
        ok: true,
        data: { profiles: [] },
        artifacts: [],
        receipt: {
          operationId: context?.operationId ?? "mcp-operation-1",
          toolName: "career.workflow.tailor_resume",
          status: "completed" as const,
          completedAt: "2026-08-18T00:00:00.000Z"
        }
      })
    });
    const response = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "career.workflow.tailor_resume",
        arguments: { targetText: "A sufficiently detailed external job description for this test." },
        _meta: {
          "careeradapt/operationId": "mcp-operation-1",
          "careeradapt/logicalToolOperationId": "logical-mcp-1"
        }
      }
    });
    const projected = mapOfficialHermesEvent("tool.completed", {
      tool_name: "career.workflow.tailor_resume",
      operation_id: "mcp-operation-1",
      result: response?.result
    });

    expect(response?.result?.structuredContent).toMatchObject({ ok: true, receipt: { status: "completed" } });
    expect(response?.result?._meta).toMatchObject({ "careeradapt/logicalToolOperationId": "logical-mcp-1" });
    expect(projected).toMatchObject({ type: "tool_call_completed", logicalToolOperationId: "logical-mcp-1" });

    const hermesRejected = mapOfficialHermesEvent("tool.failed", {
      tool_name: "career.workflow.tailor_resume",
      operation_id: "mcp-operation-1",
      result: response?.result
    });
    expect(hermesRejected).toMatchObject({
      type: "tool_call_failed",
      code: "hermes_protocol_rejected_valid_mcp_success",
      data: {
        toolResultIsError: false,
        protocolCause: "valid_mcp_success_envelope_rejected_by_hermes",
        officialHermesToolTerminalEvent: "failed"
      }
    });
    expect(hermesRejected).not.toMatchObject({ code: "hermes_tool_failed" });
  });
});

function profileWithCanonicalProject(): CareerProfile {
  const base = migrateCareerProfileToV2(demoCareerProfile);
  const project = ResumeItemV2Schema.parse({
    id: "project-integrity-1",
    sectionType: "project",
    title: "完整项目",
    role: "产品协作",
    organization: "CareerAdapt",
    tools: ["TypeScript", "Dexie"],
    background: "项目背景保留。",
    description: "原始项目段落。",
    highlights: ["原始成果一", "原始成果二"],
    outcomes: ["原始结果。"],
    customFields: []
  });
  return CareerProfileSchema.parse({
    ...base,
    structuredFacts: [
      ...(base.structuredFacts ?? []),
      ProfileStructuredFactSchema.parse({
        data: project,
        factIds: ["fact-ai-product"],
        sourceBlockIds: ["source-integrity-1"],
        sourceExcerpt: "项目来源",
        mappingTrace: []
      })
    ]
  });
}
