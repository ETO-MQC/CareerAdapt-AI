import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

test.describe.serial("P4.4e real Hermes workflow closure", () => {
  test("CASE A — Profile Intake reaches a bounded Hermes terminal state", async ({ page }) => {
    test.setTimeout(480_000);
    const bridge = observeHermesBridge(page);
    await openHermesWorkspace(page);
    const before = await readCareerState(page);

    await startQuickAction(page, "从零整理我的经历");
    const startedAt = Date.now();
    await send(page, "教育经历：我在浙江理工大学就读电子信息工程本科，2022 年 9 月入学，预计 2026 年 6 月毕业。", true);
    await waitForTurnToSettle(page, 210_000);
    await send(page, "我在课程项目中和三名同学用 ESP32 做过智能穿戴设备，负责心率传感器接入、蓝牙数据传输和走线问题排查，最终完成了心率实时显示和跌倒检测演示。除此之外，我还参加过蓝桥杯、处理过科研数据，也担任过团支书。");
    await waitForTurnToSettle(page, 210_000);
    const afterNarrative = await readCareerState(page);
    await send(page, "请直接把刚才的内容整理进当前个人资料访谈草稿，不要重新询问目标；需要补充时只问一个最高价值问题。");
    await waitForTurnToSettle(page, 210_000);
    const afterCaptureRequest = await readCareerState(page);

    await send(page, "使用 PlatformIO 和 Arduino 框架，ESP32 通过 BLE 传输；我用串口日志和万用表排查走线问题。科研数据处理用 Python 完成，但前面没有给出具体成果，请不要补写。", true);
    await waitForTurnToSettle(page, 210_000);
    await send(page, "补充并修正：校园经历名称是学生会学习部，我担任团支书期间组织团日活动；蓝桥杯只保留为竞赛经历，未确认的名次不要写。", true);
    await waitForTurnToSettle(page, 210_000);
    await send(page, "查看草稿", true);
    await waitForTurnToSettle(page, 210_000);
    await send(page, "完成整理", true);
    await waitForTurnToSettle(page, 240_000);
    await expect.poll(() => readCareerState(page), { timeout: 60_000 }).toMatchObject({
      workflowId: "guided_profile_intake",
      stage: "final_review",
      completionStatus: "waiting_for_user"
    });
    await page.reload();
    await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /AI Runtime Hermes，状态 Ready/u, { timeout: 30_000 });
    await expect.poll(() => readCareerState(page), { timeout: 60_000 }).toMatchObject({
      workflowId: "guided_profile_intake",
      stage: "final_review",
      completionStatus: "waiting_for_user"
    });
    const finalArtifact = page.getByRole("region", { name: "最终资料草稿审核" });
    if (!(await finalArtifact.isVisible({ timeout: 2_000 }).catch(() => false))) {
      await page.getByRole("button", { name: /产物 \d+/u }).last().click();
    }
    await expect(finalArtifact).toBeVisible({ timeout: 30_000 });
    await expect(finalArtifact).toContainText("最终资料草稿");
    const editableCard = finalArtifact.locator("[data-candidate-id]").first();
    await expect(editableCard).toBeVisible({ timeout: 30_000 });
    await editableCard.getByRole("button", { name: "编辑", exact: true }).click();
    const editableField = editableCard.locator("input,textarea").first();
    await expect(editableField).toBeVisible({ timeout: 10_000 });
    await editableField.fill("用户核对后的真实经历描述");
    await editableCard.getByRole("button", { name: "保存并采用", exact: true }).click();
    await expect(editableCard).toContainText("已采用", { timeout: 30_000 });
    await finalArtifact.getByRole("button", { name: "全部采用", exact: true }).click();
    await expect(finalArtifact.getByRole("button", { name: "确认并写入个人资料库", exact: true })).toBeVisible({ timeout: 30_000 });
    await finalArtifact.getByRole("button", { name: "确认并写入个人资料库", exact: true }).click();
    await approveVisibleCareerOperation(page);
    await expect.poll(() => readCareerState(page), { timeout: 120_000 }).toMatchObject({
      workflowId: "guided_profile_intake",
      stage: "profile_complete",
      completionStatus: expect.stringMatching(/completed|waiting_for_user/u)
    });
    const committed = await readCareerState(page);
    expect(Number(committed.profileRevision)).toBeGreaterThan(Number(before.profileRevision));
    await page.reload();
    await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /AI Runtime Hermes，状态 Ready/u, { timeout: 30_000 });
    await expect.poll(() => readCareerState(page), { timeout: 60_000 }).toMatchObject({
      workflowId: "guided_profile_intake",
      stage: "profile_complete"
    });

    const after = await readCareerState(page);
    expect(after.hermesSessionId).toMatch(/^hermes-/u);
    expect(after.hermesRunId).toMatch(/^run_/u);
    expect(after.hermesRunStatus).toBe("completed");
    expect(["completed", "waiting_for_user"]).toContain(after.activeTurnStatus);
    expect(after.artifactCount).toBeGreaterThanOrEqual(1);
    expect(Number(after.profileRevision)).toBeGreaterThan(Number(before.profileRevision));
    expect(afterCaptureRequest.lastMessages.map((message) => message.content).join(" ")).toMatch(/智能穿戴|蓝桥杯|科研数据|团支书/u);
    expect(afterCaptureRequest.lastMessages.map((message) => message.content).join(" ")).toMatch(/最高价值问题|班级|开发板|传感器|软件工具/u);
    expect(bridge.some((call) => call.action === "run_start" && call.status === 200)).toBe(true);
    expect(bridge.some((call) => call.action === "run_events" && call.status === 200)).toBe(true);
    expect(bridge.every((call) => (call.elapsedMs ?? 0) < 180_000)).toBe(true);
    console.info("[p44e-case-a]", JSON.stringify({
      elapsedMs: Date.now() - startedAt,
      bridge,
      before,
      afterNarrative,
      afterCaptureRequest,
      after
    }));
  });

  test("CASE B — Resume Import uses the local attachment manifest and reaches review", async ({ page }) => {
    test.setTimeout(240_000);
    const bridge = observeHermesBridge(page);
    await openHermesWorkspace(page);
    const before = await readCareerState(page);

    await startQuickAction(page, "导入现有简历");
    const file = page.locator('.agent-composer input[type="file"]');
    await expect(file).toHaveCount(1);
    await file.setInputFiles(resolve(process.cwd(), "tests/fixtures/resume-import/ordinary.docx"));
    await expect(page.getByText("ordinary.docx", { exact: false })).toBeVisible();
    const startedAt = Date.now();
    const consent = page.getByTestId("agent-import-ai-consent");
    if (await consent.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await consent.getByRole("button", { name: "仅本地解析", exact: true }).click();
      await expect(consent).toHaveCount(0, { timeout: 20_000 });
    }
    await send(page, "请导入这份简历，并在需要我确认时停下来。", false);
    if (await consent.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await consent.getByRole("button", { name: "仅本地解析", exact: true }).click();
      await expect(consent).toHaveCount(0, { timeout: 20_000 });
    }
    await waitForTurnToSettle(page, 210_000);
    // The import artifact is available at this boundary.  Keep the explicit
    // confirmation visible and let the review dialog below remain the single
    // write decision; do not send a second textual "确认" turn here.
    await approveVisibleCareerOperation(page);
    await page.waitForTimeout(1_000);

    const after = await readCareerState(page);
    expect(after.hermesSessionId).toMatch(/^hermes-/u);
    expect(after.hermesRunId).toMatch(/^run_/u);
    expect(after.hermesRunStatus).toBe("completed");
    expect(["completed", "waiting_for_user", "waiting_for_confirmation"]).toContain(after.activeTurnStatus);
    expect(after.artifactCount).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole("button", { name: /产物 \d+/u })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /产物 \d+/u }).last().click();
    const importArtifact = page.getByRole("region", { name: "简历导入核对" });
    await expect(importArtifact).toBeVisible({ timeout: 30_000 });
    await expect(importArtifact).toContainText("ordinary.docx");
    console.info("[p44e-case-b-before-review]", JSON.stringify({ after, text: await importArtifact.innerText() }));
    const reviewButton = importArtifact.getByRole("button", { name: "采用全部来源明确内容", exact: true });
    if (await reviewButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await reviewButton.click();
      await page.waitForTimeout(1_000);
    }
    const afterReview = await readCareerState(page);
    console.info("[p44e-case-b-after-review]", JSON.stringify(afterReview));
    const storesBefore = await readCareerStores(page);
    await importArtifact.getByRole("button", { name: "编辑导入内容", exact: true }).click();
    const importDialog = page.getByTestId("agent-import-review-dialog");
    await expect(importDialog).toBeVisible({ timeout: 30_000 });
    const newTarget = importDialog.locator('input[name="import-target"]').nth(1);
    await newTarget.check();
    const newProfileName = importDialog.locator('input[name="new-profile-name"]');
    if (!(await newProfileName.inputValue()).trim()) await newProfileName.fill("Hermes 导入验收");
    const createGeneralResume = importDialog.locator('input[name="import-create-general-resume"]');
    if (!(await createGeneralResume.isChecked())) await createGeneralResume.check();
    const reviewActions = importDialog.getByRole("button", { name: /确认可批量项|确认字段映射|确认此映射|采用此条|保留原数据|核对并保留来源/u });
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const confirmImport = importDialog.getByRole("button", { name: "确认导入", exact: true });
      if (await confirmImport.isEnabled().catch(() => false)) break;
      const action = reviewActions.first();
      if (!(await action.isVisible({ timeout: 1_000 }).catch(() => false))) break;
      await action.click();
      await page.waitForTimeout(250);
    }
    const confirmImport = importDialog.getByRole("button", { name: "确认导入", exact: true });
    await expect(confirmImport).toBeEnabled({ timeout: 30_000 });
    await confirmImport.click();
    await expect(importDialog).toHaveCount(0, { timeout: 60_000 });
    await expect.poll(() => readCareerState(page), { timeout: 60_000 }).toMatchObject({
      workflowId: "resume_import",
      stage: "import_complete",
      completionStatus: "completed"
    });
    const afterCommit = await readCareerState(page);
    const storesAfter = await readCareerStores(page);
    expect(storesAfter.resumeBranches).toBeGreaterThan(storesBefore.resumeBranches);
    await page.reload();
    await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /AI Runtime Hermes，状态 Ready/u, { timeout: 30_000 });
    await expect.poll(() => readCareerState(page), { timeout: 60_000 }).toMatchObject({
      workflowId: "resume_import",
      stage: "import_complete",
      completionStatus: "completed"
    });
    await expect(page.getByRole("button", { name: /产物 \d+/u }).last()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /产物 \d+/u }).last().click();
    await expect(page.getByRole("region", { name: "简历导入核对" })).toContainText("ordinary.docx");
    console.info("[p44e-case-b-after-commit]", JSON.stringify({ afterCommit, storesBefore, storesAfter, reloaded: await readCareerState(page) }));
    expect(bridge.some((call) => call.action === "run_start" && call.status === 200)).toBe(true);
    expect(bridge.some((call) => call.action === "run_events" && call.status === 200)).toBe(true);
    expect(bridge.every((call) => (call.elapsedMs ?? 0) < 180_000)).toBe(true);
    console.info("[p44e-case-b]", JSON.stringify({
      elapsedMs: Date.now() - startedAt,
      bridge,
      before,
      after
    }));
  });

  for (const workflow of [
    { key: "C", title: "分析岗位匹配度", prompt: "请使用当前已确认的唯一简历、当前个人资料和当前已保存岗位，直接完成岗位匹配分析；遇到确认边界就停下来。", artifact: /匹配|岗位/u },
    { key: "D", title: "生成岗位定制简历", prompt: "请使用当前已确认的唯一简历和当前已保存岗位，开始岗位定制；只问一个必要问题，或在可安全继续时完成并停在确认边界。", artifact: /定制|岗位/u },
    { key: "E", title: "从资料库组装简历", prompt: "请先调用 career.workflow.profile_to_resume，使用当前已确认的个人资料组装一份通用简历，保持资料与简历分离；完成后停在预览或确认边界。", artifact: /简历|资料/u },
    { key: "F", title: "检查并导出简历", prompt: "请先调用 career.workflow.resume_export，检查当前唯一简历并准备真实预览和 PDF 导出；完成质量门禁后停在导出确认边界。", artifact: /导出|预览|简历/u }
  ] as const) {
    test(`CASE ${workflow.key} — ${workflow.title} uses a real Hermes Run`, async ({ page }) => {
      test.setTimeout(360_000);
      const bridge = observeHermesBridge(page);
      await openHermesWorkspace(page);
      await ensureCurrentDemoResume(page);
      if (workflow.key === "D") {
        // Give the browser bridge time to register before the gateway restart
        // used by the real-run harness; the production flow does not need this.
        await page.waitForTimeout(30_000);
      }
      await startQuickAction(page, workflow.title);
      await send(page, workflow.prompt);
      await waitForTurnToSettle(page, 300_000);
      await approveVisibleCareerOperation(page);
      await page.waitForTimeout(750);
      await waitForTurnToSettle(page, 120_000);
      await resolveVisibleBoundaries(page);
      let state = await readCareerState(page);
      if (workflow.key === "C" && !hasJobFitArtifact(state.artifactRefs)) {
        await send(page, "继续完成刚才的岗位匹配分析，使用数据分析实习生，不要只停留在读取资料。", true);
        await waitForTurnToSettle(page, 180_000);
        await resolveVisibleBoundaries(page);
        state = await readCareerState(page);
      }
      console.info(`[p44e-case-${workflow.key.toLowerCase()}-observed]`, JSON.stringify(state));
      expect(state.hermesSessionId).toMatch(/^hermes-/u);
      expect(state.hermesRunId).toMatch(/^run_/u);
      expect(["completed", "stopping"]).toContain(state.hermesRunStatus);
      expect(["completed", "waiting_for_user", "waiting_for_confirmation"]).toContain(state.activeTurnStatus);
      expect(state.artifactCount).toBeGreaterThanOrEqual(1);
      if (workflow.key === "C") {
        expect(state.completionStatus).toBe("completed");
        expect(state.stage).toBe("completed");
        expect(hasJobFitArtifact(state.artifactRefs)).toBe(true);
        expect(state.artifactRefs.find((artifact) => artifact.kind === "job_fit_overview")?.entityId).not.toMatch(/^pending-/u);
      }
      if (workflow.key === "D") {
        expect(["waiting_for_user", "completed"]).toContain(state.completionStatus);
        if (state.completionStatus === "waiting_for_user") {
          expect(state.stage).toBe("answer_tailoring_question");
        } else {
          expect(state.stage).toBe("resume_ready");
        }
        const tailoringArtifact = state.artifactRefs.find((artifact) => artifact.kind === "tailoring_workspace");
        expect(tailoringArtifact?.entityId).toBeTruthy();
        expect(tailoringArtifact?.entityId).not.toMatch(/^pending:/u);
      }
      if (workflow.key === "E") {
        expect(state.completionStatus).toBe("completed");
        expect(state.stage).toBe("resume_ready");
        const resumeArtifact = state.artifactRefs.find((artifact) => artifact.entityType === "resume_branch");
        expect(resumeArtifact?.entityId).toBeTruthy();
        expect(resumeArtifact?.entityId).not.toMatch(/^pending-/u);
        const resumeId = String(resumeArtifact?.entityId);
        expect(await readResumeBranchIds(page)).toContain(resumeId);
        await page.reload();
        await expect.poll(() => readResumeBranchIds(page), { timeout: 30_000 }).toContain(resumeId);
      }
      if (workflow.key === "F") {
        await expect(page.getByRole("button", { name: /产物 \d+/u }).last()).toBeVisible({ timeout: 30_000 });
        await page.getByRole("button", { name: /产物 \d+/u }).last().click();
        const openResume = page.getByRole("link", { name: "打开原功能页", exact: true }).last();
        await expect(openResume).toBeVisible({ timeout: 20_000 });
        await openResume.click();
        await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId("resume-a4-page").first()).toBeVisible({ timeout: 30_000 });
        const pdfResponse = page.waitForResponse((response) => response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST", { timeout: 120_000 });
        const pdfDownload = page.waitForEvent("download", { timeout: 120_000 });
        await page.getByRole("button", { name: "导出PDF", exact: true }).first().click();
        const [response, download] = await Promise.all([pdfResponse, pdfDownload]);
        expect(response.status()).toBe(200);
        expect(download.suggestedFilename()).toMatch(/\.pdf$/iu);
      }
      const assistantNarration = state.lastMessages
        .filter((message) => message.role === "assistant" && message.kind !== "tool")
        .map((message) => message.content)
        .join(" ");
      if (assistantNarration) expect(assistantNarration).toMatch(workflow.artifact);
      expect(bridge.some((call) => call.action === "run_start" && call.status === 200)).toBe(true);
      expect(bridge.some((call) => call.action === "run_events" && call.status === 200)).toBe(true);
      expect(bridge.every((call) => (call.elapsedMs ?? 0) < 180_000)).toBe(true);
      console.info(`[p44e-case-${workflow.key.toLowerCase()}]`, JSON.stringify({ workflow, bridge, state }));
    });
  }
});

async function approveVisibleCareerOperation(page: Page) {
  const confirmation = page.getByRole("region", { name: "确认执行 Career 操作" });
  if (await confirmation.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const confirm = confirmation.getByRole("button", { name: "确认", exact: true });
    if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.click();
    return true;
  }
  const inlineConfirm = page.getByRole("button", { name: "确认", exact: true }).last();
  if (await inlineConfirm.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await inlineConfirm.click();
    return true;
  }
  return false;
}

async function resolveVisibleBoundaries(page: Page) {
  for (let boundary = 0; boundary < 3; boundary += 1) {
    const clicked = await approveVisibleCareerOperation(page);
    await page.waitForTimeout(500);
    const checkpoint = await readCareerState(page);
    if (clicked || checkpoint.pendingConfirmation) {
      if (!clicked) await approveVisibleCareerOperation(page);
      await waitForTurnToSettle(page, 180_000);
      continue;
    }
    if (checkpoint.activeTurnStatus === "completed" && checkpoint.completionStatus === "completed") break;
    const checkpointText = checkpoint.lastMessages
      .filter((message) => message.role === "assistant" && message.kind !== "tool")
      .at(-1)?.content ?? "";
    if (/请回复[“"]?确认|是否同意|请确认|确认以上|明确决定/u.test(checkpointText)) {
      await send(page, "确认", true);
      await waitForTurnToSettle(page, 180_000);
      continue;
    }
    if (/目标岗位编号.*(?:1 或 2|1、2)|岗位编号.*(?:1 或 2|1、2)|请输入编号或岗位名称|要针对哪个岗位定制|针对哪个岗位|请从以下.*岗位.*选择|以下两个.*岗位|有两个.*保存岗位|两个已保存岗位/u.test(checkpointText)) {
      await send(page, "1", true);
      await waitForTurnToSettle(page, 180_000);
      continue;
    }
    break;
  }
}

function hasJobFitArtifact(artifacts: Array<Record<string, unknown>>) {
  return artifacts.some((artifact) => [artifact.kind, artifact.title, artifact.sourceToolName, artifact.entityType]
    .map((value) => String(value ?? "").toLowerCase())
    .some((value) => value.includes("job_fit") || value.includes("analyze_fit") || value.includes("匹配")));
}

function observeHermesBridge(page: Page) {
  const calls: Array<{ action: string; startedAt: number; status?: number; elapsedMs?: number }> = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/api/agent/runtime/hermes") || request.method() !== "POST") return;
    const body = request.postDataJSON() as { action?: string };
    calls.push({ action: String(body.action ?? "unknown"), startedAt: Date.now() });
  });
  page.on("response", async (response) => {
    if (!response.url().endsWith("/api/agent/runtime/hermes")) return;
    const active = calls.findLast((call) => call.status === undefined);
    if (!active) return;
    active.status = response.status();
    active.elapsedMs = Date.now() - active.startedAt;
  });
  return calls;
}

async function openHermesWorkspace(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
      baseUrl: "",
      apiKey: "",
      model: "mimo-v2.5-pro",
      provider: "openai-compatible"
    }));
  });
  await page.goto("/ai-workspace");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能", exact: true });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await expect(skip).toBeHidden({ timeout: 20_000 });
    await page.goto("/ai-workspace");
  }
  const badge = page.locator(".agent-runtime-status");
  await expect(badge).toHaveAttribute("aria-label", /AI Runtime Hermes，状态 Ready/, { timeout: 30_000 });
  await expect.poll(() => badge.getAttribute("title"), { timeout: 30_000 }).toContain("MCP 52 tools");
}

async function ensureCurrentDemoResume(page: Page) {
  await page.goto("/resume");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能", exact: true });
  if (await skip.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await skip.click();
    await page.goto("/resume");
  }
  await expect.poll(() => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = await new Promise<number>((resolve, reject) => {
      const request = database.transaction("profiles", "readonly").objectStore("profiles").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return count;
  }), { timeout: 30_000 }).toBeGreaterThan(0);
  const create = page.getByRole("button", { name: /从个人资料库创建/u });
  await expect(create).toBeVisible({ timeout: 30_000 });
  await expect(create).toBeEnabled({ timeout: 30_000 });
  await create.click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("CareerAdaptDb");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const count = await new Promise<number>((resolve, reject) => {
        const request = database.transaction("resumeBranches", "readonly").objectStore("resumeBranches").count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return count;
    }), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.goto("/ai-workspace");
  await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /AI Runtime Hermes，状态 Ready/u, { timeout: 30_000 });
  const resumeSummary = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = (store: string) => new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const request = database.transaction(store, "readonly").objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>);
      request.onerror = () => reject(request.error);
    });
    const [profiles, branches] = await Promise.all([read("profiles"), read("resumeBranches")]);
    database.close();
    return {
      profileId: profiles[0]?.id,
      profileVersion: profiles[0]?.version,
      branches: branches.map((branch) => ({
        id: branch.id,
        profileId: branch.profileId,
        sourceProfileVersion: branch.sourceProfileVersion,
        migrationStatus: branch.migrationStatus,
        branchPurpose: branch.branchPurpose
      }))
    };
  });
  console.info("[p44e-current-resume]", JSON.stringify(resumeSummary));
}

async function startQuickAction(page: Page, title: string) {
  let action = page.getByRole("button", { name: new RegExp(title) });
  if (!(await action.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "新任务", exact: true }).click();
    action = page.getByRole("button", { name: new RegExp(title) });
  }
  await expect(action).toBeVisible({ timeout: 20_000 });
  await action.click();
  await expect(page.locator("[data-agent-workflow-id]")).toBeVisible({ timeout: 30_000 });
}

async function send(page: Page, text: string, fill = true) {
  const composer = page.getByLabel("描述你的求职任务");
  if (fill) await composer.fill(text);
  else if ((await composer.inputValue()).trim() !== text) await composer.fill(text);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
}

async function waitForTurnToSettle(page: Page, timeoutMs: number) {
  const before = await readCareerState(page);
  await expect.poll(async () => {
    const state = await readCareerState(page);
    return state.activeTurnId !== before.activeTurnId
      || state.activeTurnStatus === "running"
      || (before.activeTurnStatus === undefined && state.activeTurnStatus !== undefined);
  }, { timeout: Math.min(15_000, timeoutMs), intervals: [250, 500, 1_000] }).toBe(true).catch(() => undefined);
  const startedAt = Date.now();
  await expect.poll(async () => {
    const state = await readCareerState(page);
    const status = state.activeTurnStatus;
    return status && status !== "running" ? status : Date.now() - startedAt >= timeoutMs ? "observation_budget_exhausted" : "running";
  }, { timeout: timeoutMs + 5_000, intervals: [1_000, 2_000, 5_000] }).not.toBe("running");
}

async function readCareerState(page: Page) {
  return page.evaluate(async () => {
    const open = () => new Promise<IDBDatabase>((resolveOpen, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => reject(request.error);
    });
    const readAll = <T,>(database: IDBDatabase, store: string) => new Promise<T[]>((resolveRead, reject) => {
      const request = database.transaction(store, "readonly").objectStore(store).getAll();
      request.onsuccess = () => resolveRead(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
    const database = await open();
    const [sessions, messages, profiles] = await Promise.all([
      readAll<Record<string, unknown>>(database, "agentSessions"),
      readAll<Record<string, unknown>>(database, "agentMessages"),
      readAll<Record<string, unknown>>(database, "profiles")
    ]);
    database.close();
    const activeId = localStorage.getItem("careerad.agent.activeSessionId");
    const session = sessions.find((candidate) => candidate.id === activeId)
      ?? sessions.sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0];
    const sessionMessages = messages
      .filter((message) => message.sessionId === session?.id)
      .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0));
    const activeTurn = session?.activeTurn as Record<string, unknown> | undefined;
    const pendingConfirmation = session?.pendingConfirmation as Record<string, unknown> | undefined;
    const taskState = session?.taskState as Record<string, unknown> | undefined;
    const hermesRun = session?.hermesRun as Record<string, unknown> | undefined;
    const profile = profiles.find((candidate) => candidate.id === session?.activeProfileId) ?? profiles[0];
    return {
      careerAgentSessionId: session?.id,
      hermesSessionId: hermesRun?.hermesSessionId,
      hermesRunId: hermesRun?.runId,
      hermesRunStatus: hermesRun?.status,
      activeTurnId: activeTurn?.id,
      activeTurnStatus: activeTurn?.status,
      lastCareerEvent: activeTurn?.lastEventType,
      pendingConfirmation: pendingConfirmation ? {
        id: pendingConfirmation.id,
        operationId: pendingConfirmation.operationId,
        toolName: pendingConfirmation.toolName,
        status: pendingConfirmation.status
      } : undefined,
      workflowId: taskState?.workflowId,
      stage: taskState?.stage,
      completionStatus: taskState?.completionStatus,
      profileId: profile?.id,
      profileRevision: profile?.version,
      profileVersionNumber: profile?.profileVersionNumber,
      artifactCount: Array.isArray(session?.artifactRefs) ? session.artifactRefs.length : 0,
      lastMessages: sessionMessages.slice(-10).map((message) => ({
        role: message.role,
        kind: message.kind,
        content: String(message.content ?? "").slice(0, 800),
        status: message.status,
        errorCode: (message.metadata as Record<string, unknown> | undefined)?.errorCode
      }))
      , artifactRefs: Array.isArray(session?.artifactRefs) ? session.artifactRefs : []
    };
  });
}

async function readResumeBranchIds(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const ids = await new Promise<string[]>((resolve, reject) => {
      const request = database.transaction("resumeBranches", "readonly").objectStore("resumeBranches").getAllKeys();
      request.onsuccess = () => resolve(request.result.filter((key): key is string => typeof key === "string"));
      request.onerror = () => reject(request.error);
    });
    database.close();
    return ids;
  });
}

async function readCareerStores(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = (store: string) => new Promise<number>((resolve, reject) => {
      if (!database.objectStoreNames.contains(store)) {
        resolve(0);
        return;
      }
      const request = database.transaction(store, "readonly").objectStore(store).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const [profiles, resumeBranches, resumeRevisions, importDrafts] = await Promise.all([
      count("profiles"), count("resumeBranches"), count("resumeRevisions"), count("importedResumeDrafts")
    ]);
    database.close();
    return { profiles, resumeBranches, resumeRevisions, importDrafts };
  });
}
