import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { useState } from "react";
import { NumberControl } from "@/components/resume/PrecisionInspector";
import { StringListEditor } from "@/components/editor/StringListEditor";
import { ResumePresentationConfigSchema } from "@/domain/schemas";
import { layoutStyleFrom, referenceLayoutStyle, ResumeLayoutStyleSchema } from "@/domain/resumePresentation/layoutPresets";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { createImportedResumeDraftFromStructuredJson, createImportedResumeDraftFromText } from "@/domain/resumeImport/parser";
import { buildResumeImportConfirmation } from "@/domain/resumeImport/confirm";
import { orderContactDetails, resumeContactDetails } from "@/domain/resumePresentation/contacts";

let db: CareerAdaptDb | undefined;
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); if (db) { db.close(); await db.delete(); db = undefined; } });
const base = () => ResumePresentationConfigSchema.parse({ schemaVersion: "resume-presentation-v1", branchId: "branch", templateId: "campus-reference", contentRevision: { branchRevision: 2, currentRevisionId: "revision" }, presentationRevision: 3, updatedAt: "2026-10-26T00:00:00.000Z" });

it("allows partial numeric drafts and applies/clamps only on confirmation", () => {
  const commit = vi.fn();
  function Form() { const [value, setValue] = useState(24); return <NumberControl label="字号" min={9} max={24} value={value} onChange={next => { commit(next); setValue(next); }} />; }
  render(<Form/>); const input = screen.getByLabelText("字号");
  fireEvent.change(input, { target: { value: "" } }); fireEvent.change(input, { target: { value: "1" } });
  expect(input).toHaveValue(1); expect(commit).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "15" } }); fireEvent.blur(input); expect(commit).toHaveBeenLastCalledWith(15);
  fireEvent.change(input, { target: { value: "100" } }); expect(input).toHaveValue(100); fireEvent.blur(input); expect(commit).toHaveBeenLastCalledWith(24);
  input.focus(); fireEvent.change(input, { target: { value: "16" } }); fireEvent.keyDown(input, { key: "Enter" }); expect(commit).toHaveBeenLastCalledWith(16);
  fireEvent.click(screen.getByRole("button", { name: "增加字号" })); expect(commit).toHaveBeenLastCalledWith(17);
});

it("combines and splits honors explicitly without dropping any text", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  function Form() { const [values, setValues] = useState(["匿名奖项一", "匿名奖项二"]); return <StringListEditor values={values} onChange={setValues} field="honors" label="荣誉" idPrefix="honors"/>; }
  render(<Form/>); fireEvent.click(screen.getByRole("button", { name: "合并为一段" }));
  expect(screen.getAllByRole("textbox")).toHaveLength(1); expect(screen.getByRole("textbox")).toHaveValue("匿名奖项一；匿名奖项二");
  fireEvent.click(screen.getByRole("button", { name: "拆分为多条" }));
  expect(screen.getAllByRole("textbox").map(node => (node as HTMLTextAreaElement).value)).toEqual(["匿名奖项一", "匿名奖项二"]);
});

it("stores reusable layout presets atomically without content, section order or branch identity", async () => {
  db = new CareerAdaptDb(`presets-${crypto.randomUUID()}`); const repo = new WorkspaceRepository(db);
  const config = base(); const style = referenceLayoutStyle(config);
  const presets = await Promise.all([repo.saveResumeLayoutPreset("排版一", style), repo.saveResumeLayoutPreset("排版二", layoutStyleFrom(config))]);
  const reopened = new WorkspaceRepository(db); expect(await reopened.getResumeLayoutPresets()).toEqual(presets);
  expect(style.precision).toMatchObject({ fontSizePx: 15, lineHeight: 1.56, sectionGapPx: 10, nameScale: 1.55 });
  expect(Object.keys(style).sort()).toEqual(["precision", "spacing", "theme", "typography"]);
  expect(ResumeLayoutStyleSchema.safeParse({ ...style, branchId: "private" }).success).toBe(false);
  expect(await db.profiles.count()).toBe(0); expect(await db.resumeBranches.count()).toBe(0);
  await repo.deleteResumeLayoutPreset(presets[0].id); expect(await reopened.getResumeLayoutPresets()).toEqual([presets[1]]);
});

it("requires confirmation for sourced political affiliation and renders it directly after email by default", () => {
  const field = { id: "political", label: "政治面貌", valueType: "string" as const, value: "中共预备党员", sensitive: true, order: 0 };
  const draft = createImportedResumeDraftFromStructuredJson({ canonicalResume: { schemaVersion: "careeradapt-resume-v2", locale: "zh-CN", basics: { name: "匿名候选人", portfolioLinks: [], otherLinks: [], customFields: [field] }, sections: [{ id: "summary", sectionType: "summary", title: "自我评价", order: 0, visible: true, items: [{ id: "summary-1", sectionType: "summary", text: "匿名介绍。", customFields: [] }] }], unclassifiedBlocks: [] }, source: { fileName: "anonymous.json", mimeType: "application/json", fileHash: "political-test-source-hash", pageCount: 1 } });
  expect(draft.basics.additionalFields?.[0].sourceBlockIds.length).toBeGreaterThan(0);
  expect(() => buildResumeImportConfirmation({ draft, operationId: "unconfirmed" })).toThrow("resume_import_personal_fields_unconfirmed");
  draft.basics.additionalFields![0].userConfirmed = true;
  const confirmed = buildResumeImportConfirmation({ draft, operationId: "confirmed" });
  expect(confirmed.branch.resumeBasics?.customFields).toEqual([field]);
  const details = orderContactDetails(resumeContactDetails({ name: "匿名", phone: "", email: "", location: "某市", summary: "", links: [], customFields: [field] }));
  expect(details.map(detail => detail.id).slice(0, 4)).toEqual(["phone", "email", "custom:political", "location"]);
  expect(orderContactDetails(details, ["location", "custom:political", "email"]).map(detail => detail.id).slice(0, 3)).toEqual(["location", "custom:political", "email"]);
});

it("detects only explicit political identity in the contact header and retains source evidence", () => {
  const text = "匿名候选人\n13800000000 demo@example.com 中共预备党员\n教育背景\n示例大学";
  const draft = createImportedResumeDraftFromText({ source: { fileName: "anonymous.pdf", mimeType: "application/pdf", fileHash: "political-text-source-hash", pageCount: 1 }, pages: [{ pageNumber: 1, extractedPageText: text, cleanedPageText: text, charStart: 0, charEnd: text.length }] });
  expect(draft.basics.additionalFields?.[0].customField.value).toBe("中共预备党员");
  expect(draft.basics.additionalFields?.[0].sourceRanges?.length ?? 0).toBeGreaterThan(0);
  expect(draft.basics.targetRole?.value ?? "").not.toContain("党员");
  const other = text.replace("中共预备党员", "群众服务中心");
  const unrelated = createImportedResumeDraftFromText({ source: { fileName: "anonymous.pdf", mimeType: "application/pdf", fileHash: "other-text-source-hash", pageCount: 1 }, pages: [{ pageNumber: 1, extractedPageText: other, cleanedPageText: other, charStart: 0, charEnd: other.length }] });
  expect(unrelated.basics.additionalFields).toHaveLength(0);
});
