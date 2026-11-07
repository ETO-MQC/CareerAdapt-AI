import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { MaterialSourceReview } from "@/components/resume/import/MaterialSourceReview";
import { ResumeImportWizard } from "@/components/resume/import/ResumeImportWizard";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { AgentAttachmentStore } from "@/services/agent/AgentAttachmentStore";
import { MaterialIntakeService } from "@/services/materialIntake/MaterialIntakeService";
import { writeResumeImportSemanticPreference } from "@/services/preferences/resumeImportAi";

let db: CareerAdaptDb; let repository: WorkspaceRepository;
beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob); writeResumeImportSemanticPreference("local");
  URL.createObjectURL = vi.fn(() => "blob:material-source"); URL.revokeObjectURL = vi.fn();
  db = new CareerAdaptDb(`material-review-${crypto.randomUUID()}`); repository = new WorkspaceRepository(db);
});
afterEach(async () => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); await db.delete(); db.close(); });
async function fixture() {
  const store = new AgentAttachmentStore(repository);
  const text = JSON.stringify({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN", basics: { portfolioLinks: [], otherLinks: [], customFields: [] },
    sections: [{ id: "certificate", sectionType: "certificates", title: "证书", order: 0, visible: true, items: [{ id: "c", sectionType: "certificates", name: "匿名证书", customFields: [] }] }], unclassifiedBlocks: [] });
  const ref = await store.register(new File([text], "source.json", { type: "application/json" }), { agentSessionId: "review-session" });
  return new MaterialIntakeService(repository, store).prepare({ attachmentId: ref.id, destination: "profile" }, "review-session");
}
it("shows original blocks, hash, confidence and page-only location independently of edited values", async () => {
  const result = await fixture();
  render(<MaterialSourceReview artifact={result.artifact} repository={repository} blockIds={result.artifact.sourceDocument.blocks.map((block) => block.id)} />);
  expect(screen.getByText(result.artifact.hash)).toBeInTheDocument();
  expect(screen.getAllByText(/仅有页级定位/).length).toBeGreaterThan(0);
  expect(screen.getByText(/UNKNOWN \/ REVIEW_REQUIRED/)).toBeInTheDocument();
  await expect(screen.findByRole("link", { name: "查看 / 下载原附件" })).resolves.toHaveAttribute("href", "blob:material-source");
  expect(screen.getAllByText(/SourceDocument 原始来源块/).length).toBeGreaterThan(0);
});
it("shows bbox coordinates and preserves the raw recognition confidence", async () => {
  const result = await fixture(); const block = result.artifact.sourceDocument.blocks[0];
  const artifact = { ...result.artifact, sourceDocument: { ...result.artifact.sourceDocument, blocks: [{ ...block, position: { x: 10, y: 20, width: 200, height: 40 }, extractionConfidence: 0.23 }] } };
  render(<MaterialSourceReview artifact={artifact} repository={repository} blockIds={[block.id]} />);
  expect(screen.getByText(/区域 x=10, y=20, w=200, h=40/)).toBeInTheDocument();
  expect(screen.getByText(/23%/)).toBeInTheDocument();
});
it("restores the material review target and name with Profile-only locked", async () => {
  const result = await fixture();
  const view = render(<ResumeImportWizard initialImportId={result.importId} repository={repository} onImported={vi.fn()} />);
  const name = await screen.findByRole("textbox", { name: "人物名称" });
  await waitFor(() => expect(name).toBeEnabled());
  fireEvent.change(name, { target: { value: "匿名审核人物" } });
  await waitFor(async () => expect(await repository.getMaterialReviewState(result.importId!)).toMatchObject({ newProfileName: "匿名审核人物" }));
  view.unmount();
  render(<ResumeImportWizard initialImportId={result.importId} repository={repository} onImported={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("textbox", { name: "人物名称" })).toHaveValue("匿名审核人物"));
  expect(screen.getByRole("checkbox", { name: "同时创建通用简历" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "同时创建通用简历" })).toBeDisabled();
  expect(await repository.listProfiles()).toHaveLength(0);
});
