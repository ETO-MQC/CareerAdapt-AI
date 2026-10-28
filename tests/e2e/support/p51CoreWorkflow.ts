import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { openManualPageTab } from "./g7b2Ui";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import { CareerProfileSchema, JobDescriptionSchema, ResumeBranchSchema } from "@/domain/schemas";

export async function prepareCoreSourceResume(page: Page) {
    await page.goto("/resume");
    await page.getByRole("button", { name: /导入已有简历/ }).click();
    const dialog = page.getByRole("dialog", { name: "导入简历" });
    await dialog.getByText("粘贴 JSON", { exact: true }).click();
    await dialog.getByLabel("JSON 内容").fill(JSON.stringify({
      schemaVersion: "careeradapt-resume-v2", locale: "zh-CN",
      basics: { name: "Core 候选人", phone: "", email: "core@example.org", portfolioLinks: [], otherLinks: [], customFields: [] },
      sections: [{ id: "project", sectionType: "project", title: "项目经历", order: 0, visible: true, items: [{
        id: "core-project", sectionType: "project", title: "AI 应用项目", role: "项目成员",
        startDate: "2025-01", endDate: "2025-06", current: false,
        description: "参与 AI 应用项目的需求梳理、原型设计和功能验收。",
        highlights: ["参与 AI 应用项目的需求梳理、原型设计和功能验收。"], tools: [], outcomes: [], customFields: []
      }] }], unclassifiedBlocks: []
    }));
    await dialog.getByRole("button", { name: "导入 JSON", exact: true }).click();
    await dialog.locator("label.import-target-option").filter({ hasText: "创建新人物" }).click();
    for (let index = 0; index < 40 && await page.getByRole("button", { name: "确认此字段", exact: true }).count(); index++) {
      await page.getByRole("button", { name: "确认此字段", exact: true }).first().click();
    }
    for (let index = 0; index < 40 && await page.getByRole("button", { name: "核对并保留来源", exact: true }).count(); index++) {
      await page.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
    }
    await dialog.locator(".import-review-footer button.primary-button").click();
    const open = page.getByRole("button", { name: "打开", exact: true });
    if (await open.isVisible()) await open.click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
}

export async function completeCoreResumeWorkflow(page: Page, jobId: string) {
    await installCoreWritingProvider(page);
    const branchesBefore = await readStore(page, "resumeBranches");
    const profileBefore = await readStore(page, "profiles");
    await page.goto(`/jobs?jobId=${encodeURIComponent(jobId)}`);
    await page.getByRole("radio", { name: /优化已有简历/ }).click();
    await page.getByLabel("来源通用简历").selectOption({ index: 1 });
    const sourceId = await page.getByLabel("来源通用简历").inputValue();
    expect(sourceId).toBeTruthy();
    await page.getByTestId("analyze-and-generate-job-resume").click();
    await expect(page).toHaveURL(/\/resume\?.*branchId=/, { timeout: 20_000 });
    const branchId = new URL(page.url()).searchParams.get("branchId")!;
    const before = (await readStore(page, "resumeBranches")).find(branch => branch.id === branchId)!;
    const presentationBefore = await readStore(page, "appMeta");
    const panel = page.getByTestId("job-optimization-panel");
    await panel.getByRole("button", { name: "生成改写建议", exact: true }).click();
    await expect.poll(async () => await panel.getByRole("button", { name: "采用全部可直接应用建议", exact: true }).isVisible()
      || await panel.getByRole("button", { name: "没有", exact: true }).isVisible(), { timeout: 30_000 }).toBe(true);
    if (await panel.getByRole("button", { name: "没有", exact: true }).isVisible()) {
      // The isolated candidate has no additional evidence to offer; decline
      // the unsupported claim rather than authorizing a new personal fact.
      await panel.getByRole("button", { name: "没有", exact: true }).click();
      await panel.getByRole("button", { name: "提交回答", exact: true }).click();
    }
    await expect(panel.getByTestId("tailoring-suggestions")).toBeVisible({ timeout: 60_000 });
    await expect(panel.getByRole("button", { name: "采用全部可直接应用建议", exact: true })).toBeVisible({ timeout: 60_000 });
    await panel.getByRole("button", { name: "采用全部可直接应用建议", exact: true }).click();
    await panel.getByRole("button", { name: "确认并应用", exact: true }).click();
    const confirmations = panel.locator(".tailoring-confirmation-card");
    for (let index = 0; index < await confirmations.count(); index++) {
      const accept = confirmations.nth(index).getByRole("button", { name: "确认采用", exact: true });
      if (await accept.count()) await accept.click();
    }
    await panel.getByRole("button", { name: "应用选择并保存新版本" }).click();
    await expect.poll(async () => (await readStore(page, "resumeBranches")).find(branch => branch.id === branchId)?.revision).toBe(Number(before.revision) + 1);
    const after = (await readStore(page, "resumeBranches")).find(branch => branch.id === branchId)!;
    expect(after).toMatchObject({ jobId: jobId, sourceBranchId: sourceId });
    expect((await readStore(page, "resumeBranches")).find(branch => branch.id === sourceId)).toEqual(branchesBefore.find(branch => branch.id === sourceId));
    expect(await readStore(page, "profiles")).toEqual(profileBefore);
    const presentationKey = `resumePresentationConfig:${branchId}`;
    const presentationAfter = await readStore(page, "appMeta");
    const settings = (records: Array<Record<string, unknown>>) => {
      const value = records.find(record => record.key === presentationKey)?.value as Record<string, unknown>;
      const { contentRevision, updatedAt, ...configuration } = value;
      void contentRevision; void updatedAt;
      return configuration;
    };
    expect(settings(presentationAfter)).toEqual(settings(presentationBefore));
    const jobBeforePdf = (await readStore(page, "jobDescriptions")).find(job => job.id === jobId);
    expect(() => mapBranchToResumeRenderModel({ branch: ResumeBranchSchema.parse(after),
      profile: CareerProfileSchema.parse(profileBefore.find(profile => profile.id === after.profileId)),
      job: JobDescriptionSchema.parse(jobBeforePdf)
    })).not.toThrow();
    await openManualPageTab(page);
    const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
    const responsePromise = page.waitForResponse(response => response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST");
    await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
    const [download, response] = await Promise.all([downloadPromise, responsePromise]);
    expect(response.status()).toBe(200);
    const outputDir = path.resolve("artifacts/p51-core");
    mkdirSync(outputDir, { recursive: true });
    const pdfPath = path.join(outputDir, "targeted-resume.pdf");
    await download.saveAs(pdfPath);
    const binary = ["E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe", "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"].find(existsSync) ?? "pdftotext";
    const text = execFileSync(binary, [pdfPath, "-"], { encoding: "utf8" });
    const exports = await readStore(page, "exportRecords");
    expect(exports.some(record => record.branchId === branchId && record.revisionId === after.currentRevisionId
      && record.branchRevision === after.revision && record.exportStatus === "direct_pdf_success")).toBe(true);
    const previewText = (await page.getByTestId("resume-a4-page").allInnerTexts()).join("\n");
    const normalize = (value: string) => value.replace(/\s+/gu, "");
    for (const item of after.structuredContentItems as Array<{ visible: boolean; data: { highlights?: string[] } }>) {
      if (!item.visible) continue;
      for (const highlight of item.data.highlights ?? []) {
        expect(normalize(previewText)).toContain(normalize(highlight));
        expect(normalize(text)).toContain(normalize(highlight));
      }
    }
}

export async function readStore(page: Page, name: string): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(name => new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    const request = indexedDB.open("CareerAdaptDb");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const result = database.transaction(name, "readonly").objectStore(name).getAll();
      result.onerror = () => reject(result.error);
      result.onsuccess = () => { database.close(); resolve(result.result); };
    };
  }), name);
}

async function installCoreWritingProvider(page: Page) {
  // Only external writing responses are controlled; domain validation,
  // Fact Guard, review, Repository, preview and PDF remain the real product.
  await page.route("**/api/ai/structured", async route => {
    const body = route.request().postDataJSON() as { task: string; input: Record<string, unknown> };
    const meta = { provider: "isolated-test", model: "core-writer", inputLength: 1, outputLength: 1, latencyMs: 1 };
    let output: unknown;
    if (body.task === "resume-optimization-planner") {
      const sections = body.input.sections as Array<{ itemId: string }>;
      output = { assessments: sections.map(section => ({ itemId: section.itemId, action: "rewrite_from_evidence", reason: "保留已确认事实并统一句末标点", suggestedKeywords: [], relatedRequirementIds: [], clarificationQuestions: [] })) };
    } else if (body.task === "resume-tailor-batch") {
      const input = body.input as unknown as { intensity: string; targets: Array<{ itemId: string; sectionType: string; sectionId: string; fieldPath: string; before: string | string[]; relevantRequirements: Array<{ requirementId: string }>; allowedEvidenceRefs: unknown[] }> };
      const targets = input.targets.filter(target => target.sectionType === "project"
        && (Array.isArray(target.before) ? target.before.join(" ") : target.before).includes("需求梳理"));
      const rephrase = (line: string) => line.includes("需求梳理")
        ? "参与需求梳理、原型设计和功能验收等 AI 应用项目工作。" : line;
      output = { suggestions: targets.map(target => ({ id: `core-${target.itemId}`, intensity: input.intensity, operation: "rewrite",
        targetSectionType: target.sectionType, targetSectionId: target.sectionId, targetItemId: target.itemId, targetFieldPath: target.fieldPath,
        before: target.before, after: Array.isArray(target.before) ? target.before.map(rephrase) : rephrase(target.before),
        changedFields: [target.fieldPath.split(".").at(-1)], requirementIds: target.relevantRequirements.map(requirement => requirement.requirementId),
        targetKeywords: [], coveredKeywordsBefore: [], coveredKeywordsAfter: [], claimSupportLevel: "verified", evidenceRefs: target.allowedEvidenceRefs,
        rationale: "重排已确认的项目职责，保留原有事实和证据", riskLevel: "low", metrics: { textChangeRatio: 0.1, keywordGain: 0 }, status: "ready" })) };
    } else {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false,
        error: { code: "provider_unavailable", message: "Optional semantic Provider is isolated in this test.", retryable: true },
        meta }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, task: body.task, promptVersion: "core-test", output, meta }) });
  });
}
