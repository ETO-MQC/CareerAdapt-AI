import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

test.describe.serial("P4.5c.1 real resume artifacts", () => {
  test("CASE A — natural CareerProfile to General Resume reaches a real PDF", async ({ page }, testInfo) => {
    test.setTimeout(480_000);
    const timings: Record<string, number> = {};
    const startedAt = Date.now();
    await openHermesWorkspace(page);
    timings.careerAdaptLaunchMs = Date.now() - startedAt;
    const before = await readReleaseState(page);

    await send(page, "用我的资料库生成一份适合互联网技术 / AI 应用方向秋招的通用简历。先自己读取资料，只有会明显改变简历质量的信息再问我。");
    const composeStartedAt = Date.now();
    await waitForTurnToSettle(page, 300_000);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = await readReleaseState(page);
      if (state.stage === "resume_ready" || state.completionStatus === "completed") break;
      const directGenerate = page.getByRole("button", { name: "直接生成", exact: true }).last();
      if (!await directGenerate.isVisible({ timeout: 2_000 }).catch(() => false)) break;
      await directGenerate.click();
      await waitForTurnToSettle(page, 300_000);
      await approveVisibleCareerOperation(page);
      await waitForTurnToSettle(page, 120_000);
    }
    timings.compositionMs = Date.now() - composeStartedAt;

    const after = await readReleaseState(page);
    console.info("[p45c1-case-a-after-compose]", JSON.stringify({
      runtime: after.runtime,
      hermesRunId: after.hermesRunId,
      workflowId: after.workflowId,
      stage: after.stage,
      completionStatus: after.completionStatus,
      writerMode: after.writerMode,
      writerFallbackReason: after.writerFallbackReason,
      bulletCount: after.bulletCount,
      branchCount: after.resumeBranches.length
    }));
    expect(after.runtime).toBe("hermes");
    expect(after.hermesRunId).toMatch(/^run_/u);
    expect(after.workflowId).toBe("compose_resume");
    expect(after.stage).toBe("resume_ready");
    expect(after.completionStatus).toBe("completed");
    expect(after.resumeBranches.length).toBeGreaterThan(before.resumeBranches.length);
    const branch = after.resumeBranches.find((candidate) => !before.resumeBranches.some((existing) => existing.id === candidate.id));
    expect(branch?.branchPurpose ?? branch?.purpose).toBe("general");
    expect(branch?.currentRevisionId).toBeTruthy();
    expect(after.writerMode).toBe("ai");
    expect(after.writerFallbackReason).toBeFalsy();
    expect(JSON.stringify(after.taskState)).toContain("互联网技术 / AI 应用");

    await page.getByRole("button", { name: /产物 \d+/u }).click();
    const openResume = page.getByRole("link", { name: /打开.*简历|打开原功能页/u }).last();
    await expect(openResume).toBeVisible({ timeout: 30_000 });
    await openResume.click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("resume-a4-page").first()).toBeVisible({ timeout: 30_000 });
    const previewText = normalizeText(await page.getByTestId("resume-a4-page").allTextContents());
    expect(previewText.length).toBeGreaterThan(100);

    const pdfStartedAt = Date.now();
    const responsePromise = page.waitForResponse((response) => response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST", { timeout: 120_000 });
    const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
    const exportButton = page.getByRole("button", { name: /导出PDF|下载 PDF/u }).first();
    await exportButton.click();
    const [response, download] = await Promise.all([responsePromise, downloadPromise]);
    timings.pdfMs = Date.now() - pdfStartedAt;
    expect(response.status()).toBe(200);
    const pdfPath = testInfo.outputPath("case-a-general-resume.redacted.pdf");
    await download.saveAs(pdfPath);
    const poppler = resolvePopplerBinary();
    const pdfTextPath = testInfo.outputPath("case-a-general-resume.redacted.txt");
    execFileSync(poppler.pdftotext, [pdfPath, pdfTextPath], { encoding: "utf8" });
    const pdfText = readFileSync(pdfTextPath, "utf8");
    const pageCount = Number(execFileSync(poppler.pdfinfo, [pdfPath], { encoding: "utf8" }).match(/^Pages:\s+(\d+)/mu)?.[1] || 0);
    expect(pageCount).toBeGreaterThan(0);
    expect(normalizeText([pdfText])).toContain(normalizeText([previewText]).slice(0, 40));

    const finalState = await readReleaseState(page);
    const report = {
      runtime: finalState.runtime,
      hermesRunId: finalState.hermesRunId,
      writerMode: finalState.writerMode,
      writerProvider: finalState.writerProvider,
      writerModel: finalState.writerModel,
      writerFallbackReason: finalState.writerFallbackReason,
      targetContext: finalState.targetContext,
      selectedAssets: finalState.selectedAssets,
      excludedHighValueAssets: finalState.excludedHighValueAssets,
      bulletCount: finalState.bulletCount,
      bulletRepairCount: finalState.bulletRepairCount,
      unsupportedClaimsBlocked: finalState.unsupportedClaimsBlocked,
      evidenceKeywordCoverage: finalState.evidenceKeywordCoverage,
      finalKeywordCoverage: finalState.finalKeywordCoverage,
      estimatedPageCount: finalState.estimatedPageCount,
      actualPageCount: pageCount,
      compressionPassCount: finalState.compressionPassCount,
      branchId: branch?.id,
      revisionId: branch?.currentRevisionId,
      timings,
      previewText,
      pdfText: normalizeText([pdfText])
    };
    await testInfo.attach("case-a-release-report.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    console.info("[p45c1-case-a]", JSON.stringify(report));

    await page.reload();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 30_000 });
    expect(normalizeText(await page.getByTestId("resume-a4-page").allTextContents())).toBe(previewText);
  });
});

async function openHermesWorkspace(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl: "", apiKey: "", model: "mimo-v2.5-pro", provider: "openai-compatible" }));
  });
  await page.goto("/ai-workspace");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能", exact: true });
  if (await skip.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await skip.click();
    await page.goto("/ai-workspace");
  }
  const badge = page.locator(".agent-runtime-status");
  await expect(badge).toHaveAttribute("aria-label", /AI Runtime Hermes，状态 Ready/u, { timeout: 60_000 });
  await expect.poll(() => badge.getAttribute("title"), { timeout: 60_000 }).toContain("MCP 55 tools");
}

async function send(page: Page, text: string) {
  await page.getByLabel("描述你的求职任务").fill(text);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
}

async function waitForTurnToSettle(page: Page, timeoutMs: number) {
  const startedAt = Date.now();
  await expect.poll(async () => {
    const state = await readReleaseState(page);
    return state.activeTurnStatus && state.activeTurnStatus !== "running"
      ? state.activeTurnStatus
      : Date.now() - startedAt >= timeoutMs ? "observation_budget_exhausted" : "running";
  }, { timeout: timeoutMs + 5_000, intervals: [1_000, 2_000, 5_000] }).not.toBe("running");
}

async function approveVisibleCareerOperation(page: Page) {
  const confirmation = page.getByRole("region", { name: "确认执行 Career 操作" });
  if (await confirmation.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await confirmation.getByRole("button", { name: "确认", exact: true }).click();
  }
}

async function readReleaseState(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <T,>(store: string) => new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(store, "readonly").objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
    const [sessions, branches, revisions] = await Promise.all([
      read<Record<string, unknown>>("agentSessions"),
      read<Record<string, unknown>>("resumeBranches"),
      read<Record<string, unknown>>("resumeRevisions")
    ]);
    database.close();
    const activeSessionId = localStorage.getItem("careerad.agent.activeSessionId")
      ?? localStorage.getItem("careeradapt.agent.activeSessionId");
    const session = sessions.find((candidate) => candidate.id === activeSessionId)
      ?? sessions.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))[0];
    const taskState = session?.taskState as Record<string, unknown> | undefined;
    const activeTurn = session?.activeTurn as Record<string, unknown> | undefined;
    const hermesRun = session?.hermesRun as Record<string, unknown> | undefined;
    const knownSlots = (taskState?.knownSlots ?? {}) as Record<string, unknown>;
    const composition = (knownSlots.resumeCompositionResult ?? {}) as Record<string, unknown>;
    const telemetry = (composition.telemetry ?? taskState?.releaseTelemetry ?? taskState?.telemetry ?? {}) as Record<string, unknown>;
    const execution = (composition.writingExecution ?? taskState?.writingExecution ?? taskState?.writerExecution ?? {}) as Record<string, unknown>;
    return {
      runtime: session?.runtimeId ?? (hermesRun ? "hermes" : undefined),
      hermesRunId: hermesRun?.runId ?? activeTurn?.hermesRunId ?? activeTurn?.nextHermesRunId ?? activeTurn?.runtimeRunId ?? activeTurn?.runId,
      activeTurnStatus: activeTurn?.status,
      workflowId: taskState?.workflowId,
      stage: taskState?.stage,
      completionStatus: taskState?.completionStatus,
      taskState,
      writerMode: execution.writerMode ?? telemetry.writerMode,
      writerProvider: execution.provider ?? telemetry.writerProvider,
      writerModel: execution.model ?? telemetry.writerModel,
      writerFallbackReason: execution.fallbackReason ?? telemetry.writerFallbackReason,
      targetContext: execution.targetContext ?? telemetry.targetContext,
      selectedAssets: telemetry.selectedAssets,
      excludedHighValueAssets: telemetry.excludedHighValueAssets,
      bulletCount: telemetry.bulletCount,
      bulletRepairCount: telemetry.bulletRepairCount,
      unsupportedClaimsBlocked: telemetry.unsupportedClaimsBlocked,
      evidenceKeywordCoverage: telemetry.evidenceKeywordCoverage,
      finalKeywordCoverage: telemetry.finalKeywordCoverage,
      estimatedPageCount: telemetry.estimatedPageCount,
      compressionPassCount: telemetry.compressionPassCount,
      diagnostics: {
        activeSessionId,
        sessionId: session?.id,
        sessionKeys: Object.keys(session ?? {}),
        sessions: sessions.map((candidate) => ({
          id: candidate.id,
          updatedAt: candidate.updatedAt,
          hasHermesRun: Boolean(candidate.hermesRun),
          activeTurnStatus: (candidate.activeTurn as Record<string, unknown> | undefined)?.status,
          workflowId: (candidate.taskState as Record<string, unknown> | undefined)?.workflowId
        }))
      },
      resumeBranches: branches.map((branch) => ({
        id: String(branch.id ?? ""),
        branchPurpose: branch.branchPurpose,
        purpose: branch.purpose,
        currentRevisionId: branch.currentRevisionId,
        contentHash: branch.contentHash,
        presentationHash: branch.presentationHash,
        revisions: revisions.filter((revision) => revision.branchId === branch.id)
      }))
    };
  });
}

function normalizeText(parts: string[]) {
  return parts.join("\n").replace(/\s+/gu, "").trim();
}

function resolvePopplerBinary() {
  const directories = ["E:/Pycharm/Lib/poppler/Library/bin", "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64"];
  const directory = directories.find((candidate) => existsSync(`${candidate}/pdftotext.exe`) && existsSync(`${candidate}/pdfinfo.exe`));
  return directory
    ? { pdftotext: `${directory}/pdftotext.exe`, pdfinfo: `${directory}/pdfinfo.exe` }
    : { pdftotext: "pdftotext", pdfinfo: "pdfinfo" };
}
