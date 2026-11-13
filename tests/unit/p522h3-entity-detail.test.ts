import { expect, it } from "vitest";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { analyzeJobDescriptionV4 } from "@/domain/jobOptimization";

it("reads a listed saved job with its full source and requirement graph through the Gateway", async () => {
  const db = new CareerAdaptDb(`h3-detail-${crypto.randomUUID()}`);
  try {
    const repository = new WorkspaceRepository(db);
    const service = new BrowserAgentToolService(repository);
    const registry = createAgentToolRegistry(service);
    const gateway = new CareerToolGateway({ registry, executor: new AgentExecutor(registry),
      assertAvailableTargets: (name, input, binding) => service.assertAvailableToolTargets(name, input, binding),
      filterAvailableResult: (name, data) => service.filterAvailableToolResult(name, data) });
    const now = new Date().toISOString();
    const rawText = "岗位：AI大模型应用开发工程师\n公司：华为\n任职要求：必须掌握 Python，能够参与模型应用开发与测试。";
    const graph = analyzeJobDescriptionV4({ rawText }).graph;
    await repository.saveJobDescription({ id: "saved-h3-job", title: "AI大模型应用开发工程师", company: "华为", rawText, source: "manual", requirements: [], requirementGraph: graph, createdAt: now, updatedAt: now });
    const listed = await gateway.execute("career.job.list", {}, { operationId: "h3-list" });
    expect(listed.ok).toBe(true);
    expect(listed.data).toMatchObject({ jobs: [expect.objectContaining({ id: "saved-h3-job" })] });
    const detail = await gateway.execute("career.job.get", { jobId: "saved-h3-job" }, { operationId: "h3-get" });
    expect(detail.ok).toBe(true);
    expect(detail.data).toMatchObject({ job: { id: "saved-h3-job", title: "AI大模型应用开发工程师", company: "华为", rawText, requirementGraph: graph, updatedAt: now } });
  } finally {
    db.close();
    await db.delete();
  }
});
