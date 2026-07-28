import { expect, test, type Page, type Route } from "@playwright/test";
import { resolve } from "node:path";

function nativeFinal(message: string) {
  return `event: model_text_delta\ndata: ${JSON.stringify({ type: "model_text_delta", delta: message })}\n\nevent: model_finish\ndata: ${JSON.stringify({ type: "model_finish", stopReason: "final" })}\n\n`;
}

function nativeAskUser(message: string) {
  return `event: model_text_delta\ndata: ${JSON.stringify({ type: "model_text_delta", delta: message })}\n\nevent: model_finish\ndata: ${JSON.stringify({ type: "model_finish", stopReason: "ask_user" })}\n\n`;
}

function nativeTool(id: string, name: string, args: Record<string, unknown>) {
  const call = { id, name, arguments: args };
  return [
    `event: model_tool_call_start\ndata: ${JSON.stringify({ type: "model_tool_call_start", index: 0, id, name })}\n\n`,
    `event: model_tool_call_complete\ndata: ${JSON.stringify({ type: "model_tool_call_complete", index: 0, call })}\n\n`,
    `event: model_finish\ndata: ${JSON.stringify({ type: "model_finish", stopReason: "tool_calls" })}\n\n`
  ].join("");
}

test.describe("P4.2a.3c autonomous resume import", () => {
  test("A — PDF attachment executes the shared parser and opens a provenance review artifact", async ({ page }) => {
    let prepared: Record<string, unknown> | undefined;
    await routeImportAgent(page, async ({ route, body, tools, observations }) => {
      const observation = observations.findLast((item) => item.name === "prepare_resume_import");
      if (!observation) {
        expect(tools).toContain("prepare_resume_import");
        expect(tools).not.toEqual(expect.arrayContaining(["parse_resume_file", "create_resume_import_draft"]));
        const attachmentId = readAttachmentId(body.systemPrompt);
        await fulfillTool(route, "prepare-pdf-e2e", "prepare_resume_import", { attachmentId });
        return;
      }
      prepared = readObservation(observation.content);
      await fulfillAsk(route, summaryMessage(prepared));
    });

    await upload(page, "tests/fixtures/pdf/two-column-reportlab.pdf");
    await expect(page.getByText(/已识别 \d+ 项信息/)).toBeVisible({ timeout: 30_000 });
    expect(["digital_pdf", "complex_digital_pdf", "text_pdf"]).toContain(prepared?.sourceKind);
    expect(prepared?.status).toBe("ready_for_review");
    expect((prepared?.quality as Record<string, unknown>)?.readingOrderConfidence).toEqual(expect.any(String));
    const persisted = await latestImportDraft(page);
    expect(persisted.sourceBlocks.length).toBeGreaterThan(0);
    expect(persisted.sourceBlocks.every((block) => block.sourceEngine === "pdfjs")).toBe(true);
    await page.getByRole("button", { name: "产物 1" }).click();
    await expect(page.getByRole("complementary", { name: "任务产物" })).toBeVisible();
    await expect(page.getByRole("region", { name: "简历导入核对" })).toContainText("two-column-reportlab.pdf");
    await expect(page.getByRole("region", { name: "简历导入核对" })).toContainText("需要确认");
    expect(JSON.stringify(prepared)).not.toContain("JVBER");
  });

  test("B — DOCX attachment uses real DOCX extraction and produces a canonical draft", async ({ page }) => {
    const prepared = await prepareToReview(page, "tests/fixtures/resume-import/ordinary.docx");
    expect(prepared).toMatchObject({ sourceKind: "docx", status: "ready_for_review" });
    expect((prepared.reviewSummary as Record<string, unknown>).itemCount).toBeGreaterThan(0);
    await page.getByRole("button", { name: "产物 1" }).click();
    await expect(page.getByRole("region", { name: "简历导入核对" })).toContainText("DOCX");
  });

  test("C/F/H — JSON v2 reviews, confirms a new profile commit, and survives reload", async ({ page }) => {
    test.setTimeout(60_000);
    let prepareObservation: Record<string, unknown> | undefined;
    let reviewObservation: Record<string, unknown> | undefined;
    let commitObservation: Record<string, unknown> | undefined;
    await routeImportAgent(page, async ({ route, body, tools, observations }) => {
      const commit = observations.findLast((item) => item.name === "commit_resume_import");
      if (commit) {
        commitObservation = readObservation(commit.content);
        await fulfillFinal(route, "已保存到测试导入用户的资料库，并创建通用简历。");
        return;
      }
      const review = observations.findLast((item) => item.name === "review_resume_import");
      const prepare = observations.findLast((item) => item.name === "prepare_resume_import");
      if (prepare) prepareObservation = readObservation(prepare.content);
      if (!prepareObservation) {
        await fulfillTool(route, "prepare-json-v2-e2e", "prepare_resume_import", {
          attachmentId: readAttachmentId(body.systemPrompt)
        });
        return;
      }
      const latestUser = body.messages?.findLast((message) => message.role === "user")?.content ?? "";
      if (tools.includes("review_resume_import") && !review && !/确认这些信息/.test(latestUser)) {
        await fulfillAsk(route, summaryMessage(prepareObservation));
        return;
      }
      if (tools.includes("review_resume_import") && !reviewObservation) {
        await fulfillTool(route, "review-json-v2-e2e", "review_resume_import", {
          importId: prepareObservation.importId,
          expectedDraftRevision: prepareObservation.expectedDraftRevision,
          decision: "accept_all"
        });
        return;
      }
      if (review) reviewObservation = readObservation(review.content);
      if (tools.includes("commit_resume_import")) {
        await fulfillTool(route, "commit-json-v2-e2e", "commit_resume_import", {
          importId: prepareObservation.importId,
          expectedDraftRevision: reviewObservation?.expectedDraftRevision ?? prepareObservation.expectedDraftRevision,
          target: { mode: "new", profileName: "测试导入用户", createGeneralResume: true }
        });
        return;
      }
      await fulfillAsk(route, summaryMessage(prepareObservation));
    });

    await upload(page, "tests/fixtures/resume-import/structured-standard.json");
    await expect(page.getByText(/已识别 \d+ 项信息/).last()).toBeVisible();
    await expect.poll(() => prepareObservation?.sourceKind).toBe("standard_json");
    await page.getByLabel("描述你的求职任务").fill("确认这些信息，新建资料库，名称为 测试导入用户");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("region", { name: "确认写入简历与资料库" })).toBeVisible();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.getByText("已保存到测试导入用户的资料库，并创建通用简历。")).toBeVisible();
    expect(commitObservation?.profileId).toEqual(expect.any(String));
    expect(commitObservation?.branchId).toEqual(expect.any(String));
    expect(commitObservation?.revisionId).toEqual(expect.any(String));

    await page.reload();
    await expect(page.getByText("已保存到测试导入用户的资料库，并创建通用简历。")).toBeVisible();
    await page.getByRole("button", { name: /产物 1/ }).click();
    await expect(page.getByRole("region", { name: "简历导入核对" })).toBeVisible();
  });

  test("D — external JSON stays on the deterministic adapter path", async ({ page }) => {
    const prepared = await prepareToReview(page, "tests/fixtures/resume-import/external-aliases.json");
    expect(prepared).toMatchObject({ sourceKind: "external_json", status: "ready_for_review" });
    expect((prepared.artifactPayload as Record<string, unknown>).sourceType).toBe("external_json");
  });

  test("E — confirmed import into an existing profile advances authoritative profile state", async ({ page }) => {
    test.setTimeout(60_000);
    let prepared: Record<string, unknown> | undefined;
    let existingProfileId = "";
    let commitCount = 0;
    const commitResults: Record<string, unknown>[] = [];
    let reconciliation: Record<string, unknown> | undefined;
    let useExisting = false;
    await routeImportAgent(page, async ({ route, body, tools, observations }) => {
      const commit = observations.findLast((item) => item.name === "commit_resume_import");
      if (commit) {
        const value = readObservation(commit.content);
        commitResults.push(value);
        existingProfileId = String(value.profileId ?? existingProfileId);
        commitCount += 1;
        await fulfillFinal(route, useExisting ? "已合并到现有资料库，并保留现有通用简历。" : "已创建测试资料库和通用简历。");
        return;
      }
      const prepare = observations.findLast((item) => item.name === "prepare_resume_import");
      if (prepare) prepared = readObservation(prepare.content);
      const review = observations.findLast((item) => item.name === "review_resume_import");
      if (review && prepared) {
        const reviewed = readObservation(review.content);
        prepared = { ...prepared, expectedDraftRevision: reviewed.expectedDraftRevision };
      }
      const reconciliationObservation = observations.findLast((item) => item.name === "reconcile_resume_import");
      if (reconciliationObservation) reconciliation = readObservation(reconciliationObservation.content);
      const resolutionObservation = observations.findLast((item) => item.name === "resolve_resume_reconciliation");
      if (resolutionObservation) reconciliation = readObservation(resolutionObservation.content);
      const profilesObservation = observations.findLast((item) => item.name === "list_profiles");
      let observedProfiles: Array<{ id: string }> = [];
      if (profilesObservation) {
        const value = readObservation(profilesObservation.content);
        observedProfiles = Array.isArray(value.profiles) ? value.profiles as Array<{ id: string }> : [];
        if (observedProfiles[0]?.id) existingProfileId = observedProfiles[0].id;
      }
      if (tools.includes("prepare_resume_import")) {
        await fulfillTool(route, `prepare-existing-${commitCount}`, "prepare_resume_import", {
          attachmentId: readAttachmentId(body.systemPrompt)
        });
        return;
      }
      if (tools.includes("list_profiles") && (!profilesObservation || (useExisting && observedProfiles.length === 0))) {
        await fulfillTool(route, `list-existing-profiles-${useExisting ? "after-create" : "before-create"}`, "list_profiles", {});
        return;
      }
      if (tools.includes("review_resume_import") && !review && prepared) {
        await fulfillTool(route, "review-existing-import", "review_resume_import", {
          importId: prepared.importId,
          expectedDraftRevision: prepared.expectedDraftRevision,
          decision: "accept_all"
        });
        return;
      }
      if (tools.includes("reconcile_resume_import") && prepared && useExisting && !reconciliation) {
        await fulfillTool(route, "reconcile-existing-import", "reconcile_resume_import", {
          importId: prepared.importId,
          expectedDraftRevision: prepared.expectedDraftRevision,
          profileId: existingProfileId
        });
        return;
      }
      const unresolved = Array.isArray(reconciliation?.unresolved)
        ? reconciliation.unresolved as Array<Record<string, unknown>>
        : [];
      if (
        tools.includes("resolve_resume_reconciliation")
        && unresolved[0]
        && body.systemPrompt?.includes('"reconciliationDecision":"keep_existing"')
      ) {
        await fulfillTool(route, "resolve-existing-import-conflict", "resolve_resume_reconciliation", {
          importId: prepared?.importId,
          expectedPlanRevision: reconciliation?.expectedPlanRevision,
          incomingItemId: unresolved[0].incomingItemId,
          resolution: "keep_existing"
        });
        return;
      }
      if (tools.includes("commit_resume_import") && prepared) {
        await fulfillTool(route, `commit-existing-${commitCount}`, "commit_resume_import", {
          importId: prepared.importId,
          expectedDraftRevision: prepared.expectedDraftRevision,
          expectedReconciliationRevision: useExisting ? reconciliation?.expectedPlanRevision : undefined,
          target: useExisting
            ? { mode: "existing", profileId: existingProfileId }
            : { mode: "new", profileName: "测试用户", createGeneralResume: true }
        });
        return;
      }
      await fulfillAsk(route, prepared ? summaryMessage(prepared) : "请选择简历文件。");
    });

    await upload(page, "tests/fixtures/resume-import/structured-standard.json");
    await expect(page.getByText(/已识别 \d+ 项信息/)).toBeVisible();
    await page.getByLabel("描述你的求职任务").fill("新建资料库，名称为 测试用户");
    await page.getByRole("button", { name: "发送消息" }).click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.getByText("已创建测试资料库和通用简历。")).toBeVisible();
    const existingProfile = await profileSnapshot(page, existingProfileId);
    const beforeVersion = existingProfile.version;

    useExisting = true;
    prepared = undefined;
    reconciliation = undefined;
    await page.locator('.agent-composer input[type="file"]').setInputFiles(resolve(process.cwd(), "tests/fixtures/resume-import/external-aliases.json"));
    await expect.poll(() => prepared?.sourceKind).toBe("external_json");
    await expect(page.getByText(/已识别 \d+ 项信息/).last()).toBeVisible();
    await page.getByLabel("描述你的求职任务").fill(`确认这些信息，保存到${existingProfile.name}的资料库`);
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect.poll(() => latestImportTaskState(page)).toMatchObject({
      stage: "resolve_conflicts",
      completionStatus: "waiting_for_user",
      knownSlots: {
        reviewStatus: "reviewed",
        importTargetIntent: "existing",
        importTargetProfileName: existingProfile.name,
        importTarget: { mode: "existing", profileId: existingProfileId }
      },
      lastObservation: {
        toolName: "reconcile_resume_import",
        value: { profileId: existingProfileId, expectedPlanRevision: 0 }
      }
    });
    await page.getByRole("button", { name: /产物 \d+/ }).click();
    const reconciliationArtifact = page.getByRole("region", { name: "简历导入核对" });
    await expect(reconciliationArtifact).toContainText("融合来源");
    await expect(reconciliationArtifact).toContainText("需确认");
    await reconciliationArtifact.getByRole("button", { name: "保留原数据", exact: true }).click();
    await expect.poll(() => latestImportTaskState(page)).toMatchObject({
      stage: "confirm_import",
      completionStatus: "waiting_for_confirmation",
      knownSlots: { expectedReconciliationRevision: 1 }
    });
    await page.getByRole("button", { name: "关闭任务产物" }).click();
    await expect(page.getByRole("region", { name: "确认写入简历与资料库" })).toBeVisible();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.getByText("已合并到现有资料库，并保留现有通用简历。")).toBeVisible();
    expect(commitCount).toBe(2);
    expect(commitResults[1]).toMatchObject({
      profileId: existingProfileId,
      idempotent: false
    });
    expect(await profileVersion(page, existingProfileId)).toBeGreaterThan(beforeVersion);
    const counts = await storeCounts(page);
    expect(counts.resumeBranches).toBe(1);
    expect(counts.resumeRevisions).toBe(1);
  });

  test("G — cancellation before confirmation leaves Profile and Resume stores unchanged", async ({ page }) => {
    let prepared: Record<string, unknown> | undefined;
    await routeImportAgent(page, async ({ route, body, observations }) => {
      const observation = observations.findLast((item) => item.name === "prepare_resume_import");
      if (!observation) {
        await fulfillTool(route, "prepare-cancel-e2e", "prepare_resume_import", {
          attachmentId: readAttachmentId(body.systemPrompt)
        });
        return;
      }
      prepared = readObservation(observation.content);
      await fulfillAsk(route, summaryMessage(prepared));
    });
    await upload(page, "tests/fixtures/resume-import/structured-standard.json");
    await expect(page.getByText(/已识别 \d+ 项信息/)).toBeVisible();
    const counts = await storeCounts(page);
    expect(counts.resumeBranches).toBe(0);
    expect(counts.resumeRevisions).toBe(0);
    expect(counts.importDrafts).toBeGreaterThan(0);
  });

  test("H — reload after draft creation restores review without reparsing the transient file", async ({ page }) => {
    let prepareCalls = 0;
    let prepared: Record<string, unknown> | undefined;
    await routeImportAgent(page, async ({ route, body, observations }) => {
      const observation = observations.findLast((item) => item.name === "prepare_resume_import");
      if (!observation) {
        prepareCalls += 1;
        await fulfillTool(route, "prepare-reload-e2e", "prepare_resume_import", {
          attachmentId: readAttachmentId(body.systemPrompt)
        });
        return;
      }
      prepared = readObservation(observation.content);
      await fulfillAsk(route, summaryMessage(prepared));
    });
    await upload(page, "tests/fixtures/resume-import/structured-standard.json");
    await expect(page.getByText(/已识别 \d+ 项信息/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "产物 1" })).toBeVisible();
    await page.getByRole("button", { name: "产物 1" }).click();
    await expect(page.getByRole("region", { name: "简历导入核对" })).toBeVisible();
    expect(prepareCalls).toBe(1);
  });

  test("I — stale ImportedResumeDraft revision is refused after confirmation", async ({ page }) => {
    test.setTimeout(60_000);
    let prepared: Record<string, unknown> | undefined;
    let commitError: Record<string, unknown> | undefined;
    await routeImportAgent(page, async ({ route, body, tools, observations }) => {
      const commit = observations.findLast((item) => item.name === "commit_resume_import");
      if (commit) {
        const value = readObservation(commit.content);
        commitError = value.error as Record<string, unknown>;
        await fulfillFinal(route, "导入草稿版本已变化，本次写入已拒绝。请刷新核对结果后重试。");
        return;
      }
      const prepare = observations.findLast((item) => item.name === "prepare_resume_import");
      if (prepare) prepared = readObservation(prepare.content);
      if (!prepared) {
        await fulfillTool(route, "prepare-stale-e2e", "prepare_resume_import", {
          attachmentId: readAttachmentId(body.systemPrompt)
        });
        return;
      }
      if (tools.includes("commit_resume_import")) {
        await fulfillTool(route, "commit-stale-e2e", "commit_resume_import", {
          importId: prepared.importId,
          expectedDraftRevision: prepared.expectedDraftRevision,
          target: { mode: "new", profileName: "不会写入", createGeneralResume: true }
        });
        return;
      }
      await fulfillAsk(route, summaryMessage(prepared));
    });

    await upload(page, "tests/fixtures/resume-import/structured-standard.json");
    await expect(page.getByText(/已识别 \d+ 项信息/)).toBeVisible();
    await bumpLatestDraftRevision(page);
    await page.getByLabel("描述你的求职任务").fill("新建资料库，名称为 不会写入");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("region", { name: "确认写入简历与资料库" })).toBeVisible();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.getByText("导入草稿版本已变化，本次写入已拒绝。请刷新核对结果后重试。")).toBeVisible();
    expect(commitError).toBeTruthy();
    const counts = await storeCounts(page);
    expect(counts.resumeBranches).toBe(0);
    expect(counts.resumeRevisions).toBe(0);
  });

  for (const manualCase of [
    { label: "PDF", fixture: "tests/fixtures/pdf/two-column-reportlab.pdf", sourceKind: "complex_digital_pdf" },
    { label: "DOCX", fixture: "tests/fixtures/resume-import/ordinary.docx", sourceKind: "docx" },
    { label: "JSON", fixture: "tests/fixtures/resume-import/structured-standard.json", sourceKind: "standard_json" }
  ]) {
    test(`manual Wizard remains a client of the shared orchestrator for ${manualCase.label}`, async ({ page }) => {
      await page.goto("/resume");
      await page.getByRole("button", { name: "导入", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "导入简历" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("选择要导入的简历文件").setInputFiles(resolve(process.cwd(), manualCase.fixture));
      await expect(dialog.locator(".import-review-footer")).toContainText(/已识别 \d+ 项信息，其中 \d+ 项需要核对/, { timeout: 30_000 });
      const draft = await latestImportDraft(page) as unknown as {
        source: { fileName: string };
        sourceKind: string;
      };
      expect(draft.source.fileName).toBe(manualCase.fixture.split("/").at(-1));
      expect(draft.sourceKind).toBe(manualCase.sourceKind);
    });
  }
});

type AgentRequest = {
  systemPrompt?: string;
  tools?: Array<{ name: string }>;
  messages?: Array<{ role: string; name?: string; content: string }>;
};

async function routeImportAgent(
  page: Page,
  handler: (input: {
    route: Route;
    body: AgentRequest;
    tools: string[];
    observations: Array<{ role: string; name?: string; content: string }>;
  }) => Promise<void>
) {
  await page.route("**/api/agent/stream", async (route) => {
    const body = route.request().postDataJSON() as AgentRequest;
    await handler({
      route,
      body,
      tools: body.tools?.map((tool) => tool.name) ?? [],
      observations: body.messages?.filter((message) => message.role === "tool") ?? []
    });
  });
}

async function prepareToReview(page: Page, fixture: string) {
  let prepared: Record<string, unknown> | undefined;
  await routeImportAgent(page, async ({ route, body, observations }) => {
    const observation = observations.findLast((item) => item.name === "prepare_resume_import");
    if (!observation) {
      await fulfillTool(route, `prepare-${fixture.replace(/\W/g, "-")}`, "prepare_resume_import", {
        attachmentId: readAttachmentId(body.systemPrompt)
      });
      return;
    }
    prepared = readObservation(observation.content);
    await fulfillAsk(route, summaryMessage(prepared));
  });
  await upload(page, fixture);
  await expect(page.getByText(/已识别 \d+ 项信息/)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => prepared, { timeout: 30_000 }).toBeTruthy();
  return prepared!;
}

async function upload(page: Page, fixture: string) {
  await page.goto("/ai-workspace");
  await page.locator('.agent-composer input[type="file"]').setInputFiles(resolve(process.cwd(), fixture));
}

function readAttachmentId(systemPrompt = "") {
  const id = systemPrompt.match(/agent-attachment-[0-9a-f-]+/i)?.[0];
  if (!id) throw new Error("attachment id missing from task context");
  return id;
}

function summaryMessage(prepared: Record<string, unknown>) {
  const summary = prepared.reviewSummary as Record<string, unknown>;
  return `已识别 ${summary.itemCount ?? 0} 项信息，其中 ${summary.needsReviewCount ?? 0} 项需要你确认。`;
}

function readObservation(content: string): Record<string, unknown> {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  return parsed.observation && typeof parsed.observation === "object"
    ? parsed.observation as Record<string, unknown>
    : parsed;
}

async function fulfillTool(route: Route, id: string, name: string, args: Record<string, unknown>) {
  await route.fulfill({ contentType: "text/event-stream", body: nativeTool(id, name, args) });
}

async function fulfillAsk(route: Route, message: string) {
  await route.fulfill({ contentType: "text/event-stream", body: nativeAskUser(message) });
}

async function fulfillFinal(route: Route, message: string) {
  await route.fulfill({ contentType: "text/event-stream", body: nativeFinal(message) });
}

async function storeCounts(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveDb, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolveDb(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = (store: string) => new Promise<number>((resolveCount, reject) => {
      const transaction = database.transaction(store, "readonly");
      const request = transaction.objectStore(store).count();
      request.onsuccess = () => resolveCount(request.result);
      request.onerror = () => reject(request.error);
    });
    const importDrafts = await new Promise<number>((resolveCount, reject) => {
      const transaction = database.transaction("appMeta", "readonly");
      const request = transaction.objectStore("appMeta").getAllKeys();
      request.onsuccess = () => resolveCount(
        request.result.filter((key) => String(key).startsWith("importedResumeDraft:")).length
      );
      request.onerror = () => reject(request.error);
    });
    const result = {
      resumeBranches: await count("resumeBranches"),
      resumeRevisions: await count("resumeRevisions"),
      importDrafts
    };
    database.close();
    return result;
  });
}

async function latestImportDraft(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveDb, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolveDb(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<Array<{ key: string; value: unknown; updatedAt: string }>>((resolveRows, reject) => {
      const transaction = database.transaction("appMeta", "readonly");
      const request = transaction.objectStore("appMeta").getAll();
      request.onsuccess = () => resolveRows(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return rows
      .filter((row) => row.key.startsWith("importedResumeDraft:"))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]!.value as {
        sourceBlocks: Array<{ sourceEngine: string }>;
      };
  });
}

async function bumpLatestDraftRevision(page: Page) {
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveDb, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolveDb(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("appMeta", "readwrite");
    const store = transaction.objectStore("appMeta");
    const rows = await new Promise<Array<{ key: string; value: Record<string, unknown>; updatedAt: string }>>((resolveRows, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolveRows(request.result);
      request.onerror = () => reject(request.error);
    });
    const row = rows
      .filter((candidate) => candidate.key.startsWith("importedResumeDraft:"))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]!;
    row.value = { ...row.value, revision: Number(row.value.revision) + 1, updatedAt: new Date().toISOString() };
    row.updatedAt = String(row.value.updatedAt);
    store.put(row);
    await new Promise<void>((resolveTransaction, reject) => {
      transaction.oncomplete = () => resolveTransaction();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
}

async function profileVersion(page: Page, profileId: string) {
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolveDb, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolveDb(request.result);
      request.onerror = () => reject(request.error);
    });
    const profile = await new Promise<{ version: number }>((resolveProfile, reject) => {
      const transaction = database.transaction("profiles", "readonly");
      const request = transaction.objectStore("profiles").get(id);
      request.onsuccess = () => resolveProfile(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return profile.version;
  }, profileId);
}

async function profileSnapshot(page: Page, profileId: string) {
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolveDb, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolveDb(request.result);
      request.onerror = () => reject(request.error);
    });
    const profile = await new Promise<{ name: string; version: number }>((resolveProfile, reject) => {
      const transaction = database.transaction("profiles", "readonly");
      const request = transaction.objectStore("profiles").get(id);
      request.onsuccess = () => resolveProfile(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return profile;
  }, profileId);
}

async function latestImportTaskState(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveDb, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolveDb(request.result);
      request.onerror = () => reject(request.error);
    });
    const sessions = await new Promise<Array<{ updatedAt: string; taskState?: unknown }>>((resolveSessions, reject) => {
      const transaction = database.transaction("agentSessions", "readonly");
      const request = transaction.objectStore("agentSessions").getAll();
      request.onsuccess = () => resolveSessions(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.taskState;
  });
}
