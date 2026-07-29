import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { AgentTaskState } from "@/agent/contracts/agentSession";
import { openManualPageTab } from "./support/g7b2Ui";

type ModelBody = {
  messages?: Array<{ role: string; name?: string; content: string }>;
  tools?: Array<{ name: string }>;
};

type BrowserProfileRecord = {
  id: string;
  name: string;
  basics: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

const REAL_LONG_ANSWER = [
  "我在示例大学学习计算机相关专业。",
  "课程项目用 ESP32 做过可穿戴设备，涉及心跳和摔倒检测。",
  "参加示例编程竞赛并获得某省省级三等奖。",
  "在实验室用视觉模型和 Python 从约 1000 页 PDF 中提取信息。",
  "担任团支书，组织团日活动、回答同学信息问题并传达社会实践安排。",
  "还做过 示例任务系统 / TaskAI、示例学习助手、",
  "示例内容分析项目，支持多格式报告导出。",
  "最近开发 CareerAdapt AI 简历制作平台。"
].join("");

function resolvePopplerBinary(name: "pdftotext") {
  const candidates = [
    "E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe",
    "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? name;
}

test.describe("P4.2a.3f guided profile intake closure", () => {
  test.beforeEach(async ({ page }) => {
    await mockSemanticIntake(page);
  });

  test("A — exact long narrative stays in profile intake and produces a review artifact", async ({ page }) => {
    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as ModelBody;
      const observations = toolObservations(body);
      const latestUser = latestUserMessage(body);
      if (
        (body.tools ?? []).some((tool) => tool.name === "get_active_profile")
        && !observations.some((item) => item.name === "get_active_profile")
      ) {
        await fulfillTool(route, "profile-target-a", "get_active_profile", {});
        return;
      }
      if (
        (body.tools ?? []).some((tool) => tool.name === "capture_profile_intake")
        && latestUser.includes("示例大学")
        && !observations.some((item) => item.name === "capture_profile_intake")
      ) {
        await fulfillTool(route, "capture-real-a", "capture_profile_intake", {});
        return;
      }
      if (
        observations.some((item) => item.name === "capture_profile_intake")
        || (latestUser.includes("示例大学") && (body.tools ?? []).some((tool) => tool.name === "reconcile_profile_intake"))
      ) {
        await fulfillAsk(route, "我从刚才的内容中整理出多项经历。我会把完整结构放在经历核对中，只询问高风险信息。");
        return;
      }
      await fulfillAsk(route, "先从最近的一段经历开始：你做了什么，结果如何？");
    });

    await startProfileIntake(page);
    await expect(page.getByText("先从最近的一段经历开始：你做了什么，结果如何？")).toBeVisible();
    expect(await readLatestAgentTask(page)).toMatchObject({ stage: "collect_experience" });
    await send(page, "我的资料库有邮箱吗？");
    await expect.poll(() => readLatestAgentTask(page)).toMatchObject({
      rootGoal: "profile_intake",
      workflowId: "guided_profile_intake"
    });
    await expect(page.getByLabel("描述你的求职任务")).toBeEnabled();
    await send(page, REAL_LONG_ANSWER);
    await expect.poll(() => readLatestAgentTask(page)).toMatchObject({
      rootGoal: "profile_intake",
      workflowId: "guided_profile_intake",
      stage: "confirm_commit",
      completionStatus: "waiting_for_confirmation"
    });
    await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();

    const task = await readLatestAgentTask(page);
    expect(task).toMatchObject({
      rootGoal: "profile_intake",
      workflowId: "guided_profile_intake",
      stage: "confirm_commit"
    });
    expect(task).not.toMatchObject({ rootGoal: "export_resume" });
    expect(task).not.toMatchObject({ stage: "export_complete" });
    await page.getByRole("button", { name: /产物 \d+/ }).click();
    const artifact = page.getByRole("region", { name: "经历核对" });
    await expect(artifact).toContainText("已识别");
    await expect(artifact).toContainText("将新增");
    await expect(page.getByText(/agent_no_progress|agent_iteration_budget_exceeded|export_complete/)).toHaveCount(0);
  });

  test("A2 — a single concise interview answer reaches profile fact capture", async ({ page }) => {
    const answer = "我现在是示例大学本科学生，计算机相关专业专业，2024年9月入学，预计2028年6月毕业";
    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as ModelBody;
      const observations = toolObservations(body);
      const tools = new Set((body.tools ?? []).map((tool) => tool.name));
      const latestUser = latestUserMessage(body);
      if (tools.has("get_active_profile") && !observations.some((item) => item.name === "get_active_profile")) {
        await fulfillTool(route, "profile-target-short", "get_active_profile", {});
        return;
      }
      if (latestUser === answer && !tools.has("capture_profile_intake")) {
        await fulfillAsk(route, "已整理这段教育经历，请继续补充下一段真实经历。");
        return;
      }
      if (latestUser === answer) {
        await fulfillFinal(route, "经历解析步骤不应再交给模型选择。");
        return;
      }
      await fulfillAsk(route, "请先介绍你的教育背景。");
    });

    await startProfileIntake(page);
    await expect(page.getByText("请先介绍你的教育背景。")).toBeVisible();
    await send(page, answer);
    await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
    expect(await readLatestAgentTask(page)).toMatchObject({
      rootGoal: "profile_intake",
      stage: "confirm_commit",
      completionStatus: "waiting_for_confirmation"
    });
    await expect(page.getByText(/这项任务暂时没有新进展|agent_no_progress|agent_iteration_budget_exceeded/)).toHaveCount(0);
  });

  test("A3 — continuing the interview asks the next question instead of reporting no progress", async ({ page }) => {
    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as ModelBody;
      const observations = toolObservations(body);
      const latestUser = latestUserMessage(body);
      if (
        (body.tools ?? []).some((tool) => tool.name === "get_active_profile")
        && !observations.some((item) => item.name === "get_active_profile")
      ) {
        await fulfillTool(route, "profile-target-continue", "get_active_profile", {});
        return;
      }
      if (latestUser === "继续添加经历") {
        await fulfillAsk(route, "好，我们继续。你想先整理实习、项目、校园活动还是技能证书？");
        return;
      }
      await fulfillAsk(route, "你想先整理哪一类经历？");
    });

    await startProfileIntake(page);
    await expect(page.getByText("你想先整理哪一类经历？")).toBeVisible();
    await send(page, "继续添加经历");
    await expect(page.getByText("好，我们继续。你想先整理实习、项目、校园活动还是技能证书？")).toBeVisible();
    await expect.poll(() => readLatestAgentTask(page)).toMatchObject({
      rootGoal: "profile_intake",
      stage: "collect_experience",
      completionStatus: "waiting_for_user"
    });
    await expect(page.getByText(/这项任务暂时没有新进展|agent_no_progress|agent_iteration_budget_exceeded/)).toHaveCount(0);
  });

  for (const scenario of [
    { label: "B — zero Resume creates a usable General Resume after Profile commit", existingBlank: false },
    { label: "C — an existing blank General Resume is populated by a new Revision without duplication", existingBlank: true }
  ]) {
    test(scenario.label, async ({ page }) => {
      test.setTimeout(60_000);
      await page.goto("/resume");
      await expect(page.getByRole("button", { name: "新建简历", exact: true })).toBeVisible();
      const beforeProfile = await activeProfileSnapshot(page);
      let existingResumeId: string | undefined;
      if (scenario.existingBlank) {
        await page.getByRole("button", { name: "新建简历", exact: true }).click();
        existingResumeId = await expect.poll(() => firstResumeBranchId(page)).not.toBeNull().then(() => firstResumeBranchId(page)) as string;
      }
      await routeCompletedIntake(page);
      await startProfileIntake(page);
      await send(page, `${REAL_LONG_ANSWER}以上内容均为我确认的真实经历，请整理后让我确认写入。`);

      await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "确认", exact: true }).click();
      await expect(page.getByText("您已确认").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "生成一份通用简历" })).toBeVisible();
      await page.getByRole("button", { name: "生成一份通用简历" }).click();
      await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "确认", exact: true }).click();
      await expect(page.getByText("资料库已确认保存，通用简历已准备好。")).toBeVisible();

      const result = await profileAndResumeSnapshot(page);
      expect(result.profile.version).toBeGreaterThan(beforeProfile.version);
      expect(result.branches).toHaveLength(1);
      expect(result.revisions.length).toBe(scenario.existingBlank ? 2 : 1);
      expect(result.branches[0]?.contentItems.some((item) => item.visible && item.factRefs.length > 0)).toBe(true);
      if (existingResumeId) expect(result.branches[0]?.id).toBe(existingResumeId);
      expect(await readLatestAgentTask(page)).toMatchObject({
        rootGoal: "profile_intake",
        stage: "resume_ready",
        completionStatus: "completed"
      });
    });
  }

  test("D — changing the active Profile asks once, switches by id, and clears stale Resume pointers", async ({ page }) => {
    let activeReadCount = 0;
    let expectSwitchRead = false;
    let switchReadIssued = false;
    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as ModelBody;
      const observations = toolObservations(body);
      if (expectSwitchRead && !switchReadIssued) {
        switchReadIssued = true;
        activeReadCount += 1;
        await fulfillTool(route, `active-profile-switch-${activeReadCount}`, "get_active_profile", {});
        return;
      }
      if (!expectSwitchRead && !observations.some((item) => item.name === "get_active_profile")) {
        activeReadCount += 1;
        await fulfillTool(route, `active-profile-switch-${activeReadCount}`, "get_active_profile", {});
        return;
      }
      await fulfillAsk(route, "我读取了当前活动资料库，请确认这批经历的写入目标。");
    });
    await startProfileIntake(page);
    await expect(page.getByText("我读取了当前活动资料库，请确认这批经历的写入目标。")).toBeVisible();
    const original = await activeProfileSnapshot(page);
    const switched = await cloneProfile(page, "profile-p42a3f-b", "小明");
    await page.goto("/profile");
    await page.getByLabel("选择人物").selectOption(switched.id);
    await expect(page.getByText(/已切换到 小明/)).toBeVisible();
    await page.goto("/ai-workspace");
    expect(await activeProfileSnapshot(page)).toMatchObject({ id: switched.id });
    expectSwitchRead = true;
    await send(page, "当前活动资料库已经切换，请重新读取并确认写入目标。");
    await expect(page.getByRole("button", { name: "写入当前资料库" })).toBeVisible();
    expect(await readLatestAgentTask(page)).toMatchObject({
      pendingDecision: { type: "profile_intake_target" }
    });
    await page.getByRole("button", { name: "写入当前资料库" }).click();
    const task = await readLatestAgentTask(page);
    expect(task).toMatchObject({
      knownSlots: { targetProfileId: switched.id },
      selectedEntities: { profileId: switched.id }
    });
    expect(task.knownSlots.targetProfileId).not.toBe(original.id);
    expect(task.selectedEntities.resumeId).toBeUndefined();
    expect(task.selectedEntities.resumeRevisionId).toBeUndefined();
  });

  test("E — renaming the same Profile id keeps the intake target and Resume association", async ({ page }) => {
    let expectRenameRead = false;
    let renameReadIssued = false;
    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as ModelBody;
      if (expectRenameRead && !renameReadIssued) {
        renameReadIssued = true;
        await fulfillTool(route, "active-after-rename", "get_active_profile", {});
        return;
      }
      if (!toolObservations(body).some((item) => item.name === "get_active_profile")) {
        await fulfillTool(route, `active-${Date.now()}`, "get_active_profile", {});
        return;
      }
      await fulfillAsk(route, "已按当前资料库继续访谈。");
    });
    await startProfileIntake(page);
    await expect(page.getByText("已按当前资料库继续访谈。")).toHaveCount(1);
    const original = await activeProfileSnapshot(page);
    await renameActiveProfile(page, "小明");
    expectRenameRead = true;
    await send(page, "我已经改成小明了，请读取当前资料库确认后继续。");
    await expect(page.getByText("已按当前资料库继续访谈。")).toHaveCount(2);
    const task = await readLatestAgentTask(page);
    expect(task).toMatchObject({
      knownSlots: { targetProfileId: original.id, targetProfileName: "小明" },
      selectedEntities: { profileId: original.id }
    });
    expect(task.pendingDecision).toBeUndefined();
  });

  test("F — user mutation language cannot produce an ungrounded persisted-state claim", async ({ page }) => {
    await page.route("**/api/agent/stream", async (route) => {
      await fulfillFinal(route, "好的，已经记录姓名改为小明。");
    });
    await page.goto("/ai-workspace");
    await send(page, "已修改为小明");
    await expect(page.getByText("好的，我会先读取当前资料库确认后继续。")).toBeVisible();
    await expect(page.getByText("好的，已经记录姓名改为小明。")).toHaveCount(0);
  });

  test("G — explicit PDF export reaches export_ready rather than an unreachable export_complete", async ({ page }) => {
    await page.goto("/resume");
    await page.getByRole("button", { name: "新建简历", exact: true }).click();
    const resumeId = await expect.poll(() => firstResumeBranchId(page)).not.toBeNull().then(() => firstResumeBranchId(page)) as string;
    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as ModelBody;
      const observations = toolObservations(body);
      if (!observations.some((item) => item.name === "get_resume")) {
        await fulfillTool(route, "read-export-resume", "get_resume", { resumeId });
        return;
      }
      if (!observations.some((item) => item.name === "export_resume")) {
        await fulfillTool(route, "export-ready", "export_resume", {});
        return;
      }
      await fulfillFinal(route, "已经导出 PDF。");
    });
    await page.goto("/ai-workspace");
    await send(page, "把这份简历导出 PDF");
    await expect(page.getByText("PDF 导出入口已准备好，请在预览页确认并下载。")).toBeVisible();
    expect(await readLatestAgentTask(page)).toMatchObject({
      rootGoal: "export_resume",
      workflowId: "repair_and_export_resume",
      stage: "export_ready",
      completionStatus: "completed"
    });
    await expect(page.getByText(/export_complete|agent_no_progress|agent_iteration_budget_exceeded/)).toHaveCount(0);
  });

  test("H — correcting an unclicked confirmation rebuilds it, and cancellation stays silent", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByLabel("选择人物")).toBeVisible();
    const before = await profileAndResumeSnapshot(page);
    await routeCompletedIntake(page);
    await startProfileIntake(page);
    await send(page, "我现在是示例大学本科学生，计算机相关专业专业，2024年9月入学，预计2028年6月毕业");
    await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();

    await send(page, "更正一下，我是示例大学本科学生，计算机相关专业专业，2025年9月入学，预计2029年6月毕业。");
    await expect(page.getByText("已根据您的纠正重新核对")).toBeVisible();
    if ((await readLatestAgentTask(page)).stage === "review_facts") {
      await page.getByRole("button", { name: /产物 \d+/ }).click();
      const artifact = page.getByRole("region", { name: "经历核对" });
      while (await artifact.getByRole("button", { name: "采用", exact: true }).count()) {
        await artifact.getByRole("button", { name: "采用", exact: true }).first().click();
      }
      await page.getByRole("button", { name: "关闭任务产物" }).click();
    }
    await expect.poll(() => readLatestAgentTask(page)).toMatchObject({
      stage: "confirm_commit",
      completionStatus: "waiting_for_confirmation"
    });
    const readyTask = await readLatestAgentTask(page);
    const persistence = await profileIntakePersistenceSnapshot(page, String(readyTask.knownSlots.intakeImportId));
    expect({
      expectedDraftRevision: readyTask.knownSlots.expectedIntakeDraftRevision,
      expectedPlanRevision: readyTask.knownSlots.expectedIntakeReconciliationRevision,
      expectedProfileVersion: readyTask.knownSlots.expectedProfileVersion,
      planDraftRevision: readyTask.knownSlots.expectedIntakeDraftRevision
    }).toEqual({
      expectedDraftRevision: persistence.draft.revision,
      expectedPlanRevision: persistence.plan.revision,
      expectedProfileVersion: persistence.plan.profileVersion,
      planDraftRevision: persistence.plan.draftRevision
    });
    await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();

    await expect(page.getByText("您已取消")).toBeVisible();
    await expect(page.getByRole("button", { name: "确认", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("描述你的求职任务")).toBeEnabled();
    const after = await profileAndResumeSnapshot(page);
    expect(after.profile.version).toBe(before.profile.version);
    expect(after.branches).toEqual(before.branches);
    expect(after.revisions).toEqual(before.revisions);
    expect(await readLatestAgentTask(page)).toMatchObject({
      completionStatus: "waiting_for_user"
    });
  });

  test("H2 — superseded confirmation is replaced and the corrected intake commits exactly once", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByLabel("选择人物")).toBeVisible();
    const before = await profileAndResumeSnapshot(page);
    await routeCompletedIntake(page);
    await startProfileIntake(page);
    await send(page, "我现在是示例大学本科学生，计算机相关专业专业，2024年9月入学，预计2028年6月毕业");
    await expect(page.getByRole("button", { name: "确认", exact: true })).toHaveCount(1);

    await send(page, "更正一下，我是示例大学本科学生，计算机相关专业专业，2025年9月入学，预计2029年6月毕业。");
    await expect(page.getByText("已根据您的纠正重新核对")).toBeVisible();
    await expect.poll(() => readLatestAgentTask(page)).toMatchObject({
      stage: "confirm_commit",
      completionStatus: "waiting_for_confirmation"
    });
    const readyTask = await readLatestAgentTask(page);
    const persistence = await profileIntakePersistenceSnapshot(page, String(readyTask.knownSlots.intakeImportId));
    expect({
      expectedDraftRevision: readyTask.knownSlots.expectedIntakeDraftRevision,
      expectedPlanRevision: readyTask.knownSlots.expectedIntakeReconciliationRevision,
      expectedProfileVersion: readyTask.knownSlots.expectedProfileVersion,
      planDraftRevision: readyTask.knownSlots.expectedIntakeDraftRevision
    }).toEqual({
      expectedDraftRevision: persistence.draft.revision,
      expectedPlanRevision: persistence.plan.revision,
      expectedProfileVersion: persistence.plan.profileVersion,
      planDraftRevision: persistence.plan.draftRevision
    });
    await expect(page.getByRole("button", { name: "确认", exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect.poll(() => readLatestAgentTask(page)).toMatchObject({
      stage: "profile_complete",
      completionStatus: "waiting_for_user"
    });
    await expect(page.getByRole("button", { name: "仅保存资料库" })).toBeVisible();

    const after = await profileAndResumeSnapshot(page);
    expect(after.profile.version).toBe(before.profile.version + 1);
    expect(after.branches).toEqual(before.branches);
    expect(after.revisions).toEqual(before.revisions);
  });

  test("I — artifact ignore is a typed decision and does not become a user message", async ({ page }) => {
    await routeCompletedIntake(page);
    await startProfileIntake(page);
    await send(page, "我在示例大学学习，开发的学习助手项目可能叫 LearnCat。");

    await page.getByRole("button", { name: /产物 \d+/ }).click();
    const candidate = page.locator(".agent-career-asset").filter({ hasText: "LearnCat" });
    await expect(candidate).toBeVisible();
    await candidate.getByRole("button", { name: "忽略" }).click();

    await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
    await expect(page.locator(".agent-message-row.is-user").filter({ hasText: "忽略经历候选" })).toHaveCount(0);
    await expect(candidate).toHaveCount(0);
  });

  test("J — an explicit import command recovers the original narrative after a completed intake", async ({ page }) => {
    test.setTimeout(60_000);
    await routeCompletedIntake(page);
    await startProfileIntake(page);
    await send(page, REAL_LONG_ANSWER);

    await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.getByRole("button", { name: "仅保存资料库" })).toBeVisible();
    await page.getByRole("button", { name: "仅保存资料库" }).click();
    await expect.poll(() => readLatestAgentTask(page)).toMatchObject({
      stage: "profile_complete",
      completionStatus: "completed"
    });

    await send(page, "导入");

    await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
    await expect.poll(() => readLatestAgentTask(page)).toMatchObject({
      rootGoal: "profile_intake",
      stage: "confirm_commit",
      completionStatus: "waiting_for_confirmation"
    });
    const task = await readLatestAgentTask(page);
    expect(task.knownSlots.latestIntakeSource).toMatchObject({
      exactSourceQuote: REAL_LONG_ANSWER
    });
  });

  test("K — a completely new user reaches rich review and confirmed CareerProfile write-back", async ({ page }) => {
    test.setTimeout(60_000);
    const internshipQuote = "2025年6月至8月，我在海岚物流做运营实习生，用 Excel 整理每日配送异常并协助客服核对原因。";
    const projectQuote = "另外我开发了 TideNote 离线笔记工具，用 Rust 写本地索引，用 Tauri 做桌面界面。";
    const narrative = `${internshipQuote}${projectQuote}`;
    await page.route("**/api/ai/structured", async (route) => {
      const body = route.request().postDataJSON() as { task?: string };
      if (body.task !== "profile-intake-semantic") {
        await route.continue();
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          task: "profile-intake-semantic",
          promptVersion: "profile-intake-semantic.e2e",
          output: {
            candidates: [{
              candidateKey: "hailan-internship",
              sectionType: "internship",
              title: "海岚物流运营实习",
              organization: "海岚物流",
              role: "运营实习生",
              startDate: "2025-06",
              endDate: "2025-08",
              current: false,
              description: "使用 Excel 整理每日配送异常，并协助客服核对原因。",
              highlights: [],
              tools: ["Excel"],
              methods: [],
              outcomes: [],
              sourceQuote: internshipQuote,
              confidence: 0.94,
              needsConfirmation: false,
              fieldEvidence: ["title", "organization", "role", "startDate", "endDate", "description", "tools"].map((field) => ({
                field, sourceQuote: internshipQuote, support: field === "description" ? "derived" : "explicit", confidence: 0.94, needsConfirmation: false
              }))
            }, {
              candidateKey: "tidenote-project",
              sectionType: "project",
              title: "TideNote",
              current: false,
              description: "开发离线笔记工具，使用 Rust 实现本地索引，并使用 Tauri 构建桌面界面。",
              highlights: [],
              tools: ["Rust", "Tauri"],
              methods: [],
              outcomes: [],
              sourceQuote: projectQuote,
              confidence: 0.95,
              needsConfirmation: false,
              fieldEvidence: ["title", "description", "tools"].map((field) => ({
                field, sourceQuote: projectQuote, support: field === "description" ? "derived" : "explicit", confidence: 0.95, needsConfirmation: false
              }))
            }]
          },
          meta: { provider: "mock", model: "semantic-e2e", inputLength: narrative.length, outputLength: 1200, latencyMs: 1 }
        })
      });
    });
    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as ModelBody;
      const observations = toolObservations(body);
      const tools = new Set((body.tools ?? []).map((tool) => tool.name));
      if (tools.has("get_active_profile") && !observations.some((item) => item.name === "get_active_profile")) {
        await fulfillTool(route, "semantic-target", "get_active_profile", {});
        return;
      }
      if (tools.has("capture_profile_intake") && !observations.some((item) => item.name === "capture_profile_intake")) {
        await fulfillTool(route, "semantic-capture", "capture_profile_intake", {});
        return;
      }
      if (tools.has("reconcile_profile_intake") && !observations.some((item) => item.name === "reconcile_profile_intake")) {
        await fulfillTool(route, "semantic-reconcile", "reconcile_profile_intake", {});
        return;
      }
      if (tools.has("commit_profile_intake") && !observations.some((item) => item.name === "commit_profile_intake")) {
        await fulfillTool(route, "semantic-commit", "commit_profile_intake", {});
        return;
      }
      if (observations.some((item) => item.name === "commit_profile_intake")) {
        await fulfillAsk(route, "新经历已确认保存到资料库。");
        return;
      }
      await fulfillAsk(route, "请自然讲讲你的经历。");
    });

    await startProfileIntake(page);
    await send(page, narrative);
    await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /产物 \d+/ }).click();
    const artifact = page.getByRole("region", { name: "经历核对" });
    await expect(artifact).toContainText("海岚物流运营实习");
    await expect(artifact).toContainText("TideNote");
    await expect(artifact).toContainText("2025-06 — 2025-08");
    await expect(artifact).toContainText("运营实习生");
    await expect(artifact).toContainText("使用 Excel 整理每日配送异常");
    await expect(artifact.getByRole("button", { name: "编辑后采用" }).first()).toBeVisible();
    await expect(artifact.getByRole("button", { name: "补充细节" }).first()).toBeVisible();
    await page.getByRole("button", { name: "关闭任务产物" }).click();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.getByRole("button", { name: "仅保存资料库" })).toBeVisible();
    await page.getByRole("button", { name: "仅保存资料库" }).click();
    await expect.poll(() => readLatestAgentTask(page)).toMatchObject({
      stage: "profile_complete",
      completionStatus: "completed"
    });

    const stored = await activeProfileStructuredFacts(page);
    expect(stored.map((entry) => entry.sectionType)).toEqual(expect.arrayContaining(["internship", "project"]));
    expect(JSON.stringify(stored)).toContain("海岚物流");
    expect(JSON.stringify(stored)).toContain("TideNote");
    expect(JSON.stringify(stored)).not.toContain("主导");
  });
});

test("RC2 J2 — real semantic provider reaches confirmed Profile, General Resume, and PDF", async ({ page }) => {
  test.setTimeout(300_000);
  const narrative = [
    "2025年6月至8月，我在海岚物流担任运营实习生，用 Excel 整理每日配送异常并协助客服核对原因。",
    "另外我独立开发 TideNote 离线笔记工具，用 Rust 编写本地索引，并用 Tauri 完成桌面界面。"
  ].join("");
  await page.goto("/profile");
  await expect(page.locator(".ai-asset-content")).toBeVisible();
  await expect(page.getByLabel("选择人物")).toBeVisible();
  const beforeProfile = await activeProfileSnapshot(page);

  await page.route("**/api/agent/stream", async (route) => {
    const body = route.request().postDataJSON() as ModelBody;
    const observations = toolObservations(body);
    const tools = new Set((body.tools ?? []).map((tool) => tool.name));
    const latestUser = latestUserMessage(body);
    if (tools.has("get_active_profile") && !observations.some((item) => item.name === "get_active_profile")) {
      await fulfillTool(route, "j2-real-target", "get_active_profile", {});
      return;
    }
    if (tools.has("capture_profile_intake") && !observations.some((item) => item.name === "capture_profile_intake")) {
      await fulfillTool(route, "j2-real-capture", "capture_profile_intake", {});
      return;
    }
    if (tools.has("reconcile_profile_intake") && !observations.some((item) => item.name === "reconcile_profile_intake")) {
      await fulfillTool(route, "j2-real-reconcile", "reconcile_profile_intake", {});
      return;
    }
    if (tools.has("commit_profile_intake") && !observations.some((item) => item.name === "commit_profile_intake")) {
      await fulfillTool(route, "j2-real-commit", "commit_profile_intake", {});
      return;
    }
    if (observations.some((item) => item.name === "commit_profile_intake") && !latestUser.includes("生成一份通用简历")) {
      await fulfillAsk(route, "经历已写入资料库。你可以仅保存资料库，或生成一份通用简历。");
      return;
    }
    if (tools.has("ensure_general_resume_from_profile") && !observations.some((item) => item.name === "ensure_general_resume_from_profile")) {
      await fulfillTool(route, "j2-real-resume", "ensure_general_resume_from_profile", {});
      return;
    }
    if (observations.some((item) => item.name === "ensure_general_resume_from_profile")) {
      await fulfillFinal(route, "资料库已确认保存，通用简历已准备好。");
      return;
    }
    await fulfillAsk(route, "请自然讲讲你的经历。");
  });

  await startProfileIntake(page);
  const semanticResponsePromise = page.waitForResponse((response) => {
    if (!response.url().includes("/api/ai/structured") || response.request().method() !== "POST") return false;
    const body = response.request().postDataJSON() as { task?: string };
    return body.task === "profile-intake-semantic";
  }, { timeout: 120_000 });
  await send(page, narrative);
  const semanticResponse = await semanticResponsePromise;
  expect(semanticResponse.status()).toBe(200);
  const semantic = await semanticResponse.json() as {
    ok?: boolean;
    output?: {
      candidates?: Array<{
        sectionType?: string;
        sourceQuote?: string;
        fieldEvidence?: Array<{ field?: string; sourceQuote?: string }>;
      }>;
    };
  };
  expect(semantic.ok).toBe(true);
  expect(semantic.output?.candidates?.length).toBeGreaterThanOrEqual(2);
  for (const candidate of semantic.output?.candidates ?? []) {
    expect(candidate.sectionType).toBeTruthy();
    expect(candidate.sourceQuote).toBeTruthy();
    expect(narrative).toContain(candidate.sourceQuote);
    expect(candidate.fieldEvidence?.length).toBeGreaterThan(0);
    for (const evidence of candidate.fieldEvidence ?? []) {
      expect(evidence.field).toBeTruthy();
      expect(evidence.sourceQuote).toBeTruthy();
      expect(narrative).toContain(evidence.sourceQuote);
    }
  }

  await page.getByRole("button", { name: /产物 \d+/ }).click();
  const artifact = page.getByRole("region", { name: "经历核对" });
  await expect(artifact).toBeVisible();
  await expect(artifact.locator(".agent-career-asset")).toHaveCount(semantic.output?.candidates?.length ?? 0);
  for (let index = 0; index < (semantic.output?.candidates?.length ?? 0); index += 1) {
    const beforeReview = await readLatestAgentTask(page);
    if (beforeReview.stage !== "review_facts") break;
    const accept = artifact.locator(".agent-career-asset:has(.is-ai_review)")
      .getByRole("button", { name: "采用", exact: true })
      .first();
    await expect(accept).toBeVisible();
    const beforeRevision = beforeReview.knownSlots.expectedIntakeDraftRevision;
    await accept.click();
    await expect.poll(async () => {
      const next = await readLatestAgentTask(page);
      return next.stage !== "review_facts"
        || next.knownSlots.expectedIntakeDraftRevision !== beforeRevision;
    }).toBe(true);
  }
  await page.getByRole("button", { name: "关闭任务产物" }).click();
  await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("button", { name: "生成一份通用简历" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "生成一份通用简历" }).click();
  await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByText("资料库已确认保存，通用简历已准备好。")).toBeVisible({ timeout: 30_000 });

  const stored = await activeProfileStructuredFacts(page);
  expect(stored.length).toBeGreaterThanOrEqual(2);
  expect(JSON.stringify(stored)).toContain("海岚物流");
  expect(JSON.stringify(stored)).toContain("TideNote");
  const result = await profileAndResumeSnapshot(page);
  expect(result.profile.version).toBeGreaterThan(beforeProfile.version);
  expect(result.branches).toHaveLength(1);
  expect(result.branches[0]?.contentItems.some((item) => item.visible && item.factRefs.length > 0)).toBe(true);

  await page.goto(`/resume?branchId=${encodeURIComponent(result.branches[0]!.id)}`);
  await expect(page.getByTestId("resume-a4-page").first()).toBeVisible({ timeout: 20_000 });
  await openManualPageTab(page);
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST"
  );
  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: "下载 PDF" }).click();
  const [pdfResponse, download] = await Promise.all([responsePromise, downloadPromise]);
  expect(pdfResponse.status()).toBe(200);
  const outputDir = resolve(process.cwd(), "artifacts", "rc2");
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const pdfPath = resolve(outputDir, "j2-real-provider-resume.pdf");
  await download.saveAs(pdfPath);
  expect(statSync(pdfPath).size).toBeGreaterThan(1_000);
  const pdfText = execFileSync(resolvePopplerBinary("pdftotext"), [pdfPath, "-"], { encoding: "utf8" });
  expect(pdfText).toContain("海岚物流");
  expect(pdfText).toContain("TideNote");
});

async function routeCompletedIntake(page: Page) {
  await page.route("**/api/agent/stream", async (route) => {
    const body = route.request().postDataJSON() as ModelBody;
    const observations = toolObservations(body);
    const tools = new Set((body.tools ?? []).map((tool) => tool.name));
    const latestUser = latestUserMessage(body);
    if (tools.has("get_active_profile") && !observations.some((item) => item.name === "get_active_profile")) {
      await fulfillTool(route, "intake-target", "get_active_profile", {});
      return;
    }
    if (
      tools.has("capture_profile_intake")
      && (latestUser.includes("示例大学") || latestUser.includes("更正一下"))
      && !observations.some((item) => item.name === "capture_profile_intake")
    ) {
      await fulfillTool(route, "intake-capture", "capture_profile_intake", {});
      return;
    }
    if (!observations.some((item) => item.name === "reconcile_profile_intake") && tools.has("reconcile_profile_intake")) {
      await fulfillTool(route, "intake-reconcile", "reconcile_profile_intake", {});
      return;
    }
    if (!observations.some((item) => item.name === "commit_profile_intake") && tools.has("commit_profile_intake")) {
      await fulfillTool(route, "intake-commit", "commit_profile_intake", {});
      return;
    }
    if (observations.some((item) => item.name === "commit_profile_intake") && !latestUser.includes("生成一份通用简历")) {
      await fulfillAsk(route, "经历已写入资料库。你可以仅保存资料库，或生成一份通用简历。");
      return;
    }
    if (!observations.some((item) => item.name === "ensure_general_resume_from_profile") && tools.has("ensure_general_resume_from_profile")) {
      await fulfillTool(route, "intake-resume", "ensure_general_resume_from_profile", {});
      return;
    }
    if (observations.some((item) => item.name === "ensure_general_resume_from_profile")) {
      await fulfillFinal(route, "资料库已确认保存，通用简历已准备好。");
      return;
    }
    await fulfillAsk(route, "先说一段最近的真实经历。");
  });
}

async function startProfileIntake(page: Page) {
  await page.goto("/profile");
  await expect(page.locator(".ai-asset-content")).toBeVisible();
  await expect(page.getByLabel("选择人物")).toBeVisible();
  await page.goto("/ai-workspace");
  await page.getByRole("button", { name: "从零整理我的经历" }).click();
}

async function send(page: Page, text: string) {
  await page.getByLabel("描述你的求职任务").fill(text);
  await page.getByRole("button", { name: "发送消息" }).click();
}

function latestUserMessage(body: ModelBody) {
  return [...(body.messages ?? [])].reverse().find((message) => message.role === "user")?.content ?? "";
}

function toolObservations(body: ModelBody) {
  const messages = body.messages ?? [];
  const latestUserIndex = messages.findLastIndex((message) => message.role === "user");
  return messages.slice(latestUserIndex + 1).filter((message) => message.role === "tool");
}

function nativeAskUser(message: string) {
  return [
    `event: model_text_delta`,
    `data: ${JSON.stringify({ type: "model_text_delta", delta: message })}`,
    "",
    `event: model_finish`,
    `data: ${JSON.stringify({ type: "model_finish", stopReason: "ask_user" })}`,
    "",
    ""
  ].join("\n");
}

function nativeFinal(message: string) {
  return [
    `event: model_text_delta`,
    `data: ${JSON.stringify({ type: "model_text_delta", delta: message })}`,
    "",
    `event: model_finish`,
    `data: ${JSON.stringify({ type: "model_finish", stopReason: "final" })}`,
    "",
    ""
  ].join("\n");
}

function nativeTool(id: string, name: string, args: Record<string, unknown>) {
  const call = { id, name, arguments: args };
  return [
    `event: model_tool_call_start`,
    `data: ${JSON.stringify({ type: "model_tool_call_start", index: 0, id, name })}`,
    "",
    `event: model_tool_call_complete`,
    `data: ${JSON.stringify({ type: "model_tool_call_complete", index: 0, call })}`,
    "",
    `event: model_finish`,
    `data: ${JSON.stringify({ type: "model_finish", stopReason: "tool_calls" })}`,
    "",
    ""
  ].join("\n");
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

async function readLatestAgentTask(page: Page): Promise<AgentTaskState> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sessions = await new Promise<Array<{ taskState?: unknown; updatedAt: string }>>((resolve, reject) => {
      const request = database.transaction("agentSessions", "readonly").objectStore("agentSessions").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.taskState as AgentTaskState;
  });
}

async function profileIntakePersistenceSnapshot(page: Page, importId: string) {
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const readMeta = (key: string) => new Promise<{ value: Record<string, unknown> }>((resolve, reject) => {
      const request = database.transaction("appMeta", "readonly").objectStore("appMeta").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const [draft, plan] = await Promise.all([
      readMeta(`importedResumeDraft:${id}`),
      readMeta(`profileReconciliation:v1:${id}`)
    ]);
    database.close();
    return { draft: draft.value, plan: plan.value };
  }, importId) as Promise<{
    draft: { revision: number };
    plan: { revision: number; profileVersion: number; draftRevision: number };
  }>;
}

async function activeProfileSnapshot(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <T>(storeName: string, key: IDBValidKey) => new Promise<T>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const meta = await read<{ value: { profileId: string } }>("appMeta", "activeProfileContext:v1");
    const profile = await read<{ id: string; name: string; version: number }>("profiles", meta.value.profileId);
    database.close();
    return profile!;
  });
}

async function mockSemanticIntake(page: Page) {
  await page.route("**/api/ai/structured", async (route) => {
    const body = route.request().postDataJSON() as {
      task?: string;
      input?: { rawNarrative?: string };
    };
    if (body.task !== "profile-intake-semantic") {
      await route.continue();
      return;
    }
    const raw = body.input?.rawNarrative?.trim() ?? "";
    const isEducation = /大学|本科|专业|入学|毕业/u.test(raw);
    const isUncertainProject = /LearnCat/u.test(raw);
    const sectionType = isEducation ? "education" : "project";
    const title = isUncertainProject ? "LearnCat"
      : isEducation ? "教育经历"
        : "通用职业经历";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        task: "profile-intake-semantic",
        promptVersion: "profile-intake-semantic.legacy-e2e",
        output: {
          candidates: [{
            candidateKey: `legacy-${sectionType}`,
            sectionType,
            title,
            institution: isEducation && raw.includes("示例大学") ? "示例大学" : undefined,
            role: isEducation && raw.includes("计算机相关专业") ? "计算机相关专业" : undefined,
            current: false,
            description: isEducation ? "教育背景待核对。" : "保留用户明确描述的职业经历。",
            highlights: [],
            tools: [],
            methods: [],
            outcomes: [],
            sourceQuote: raw,
            confidence: isUncertainProject ? 0.55 : 0.9,
            needsConfirmation: isUncertainProject,
            fieldEvidence: [
              "title",
              ...(isEducation && raw.includes("示例大学") ? ["institution"] : []),
              ...(isEducation && raw.includes("计算机相关专业") ? ["role"] : []),
              "description"
            ].map((field) => ({
              field,
              sourceQuote: raw,
              support: field === "description" ? "derived" : "explicit",
              confidence: isUncertainProject ? 0.55 : 0.9,
              needsConfirmation: isUncertainProject
            }))
          }]
        },
        meta: { provider: "mock", model: "legacy-semantic-e2e", inputLength: raw.length, outputLength: 400, latencyMs: 1 }
      })
    });
  });
}

async function activeProfileStructuredFacts(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <T>(storeName: string, key: IDBValidKey) => new Promise<T>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const meta = await read<{ value: { profileId: string } }>("appMeta", "activeProfileContext:v1");
    const profile = await read<{ structuredFacts?: Array<{ data: Record<string, unknown> }> }>("profiles", meta.value.profileId);
    database.close();
    return (profile.structuredFacts ?? []).map((entry) => entry.data);
  });
}

async function firstResumeBranchId(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const branches = await new Promise<Array<{ id: string }>>((resolve, reject) => {
      const request = database.transaction("resumeBranches", "readonly").objectStore("resumeBranches").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return branches[0]?.id ?? null;
  });
}

async function profileAndResumeSnapshot(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <T>(storeName: string, key: IDBValidKey) => new Promise<T>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = <T>(storeName: string) => new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const meta = await read<{ value: { profileId: string } }>("appMeta", "activeProfileContext:v1");
    const profile = await read<{ id: string; version: number }>("profiles", meta.value.profileId);
    const branches = await all<{
      id: string;
      contentItems: Array<{ visible: boolean; factRefs: unknown[] }>;
    }>("resumeBranches");
    const revisions = await all<{ id: string }>("resumeRevisions");
    database.close();
    return { profile: profile!, branches, revisions };
  });
}

async function cloneProfile(page: Page, id: string, name: string) {
  return page.evaluate(async ({ nextId, nextName }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("profiles", "readwrite");
    const profiles = transaction.objectStore("profiles");
    const all = await new Promise<BrowserProfileRecord[]>((resolve, reject) => {
      const request = profiles.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const source = all[0];
    const now = new Date().toISOString();
    const next = {
      ...structuredClone(source),
      id: nextId,
      name: nextName,
      basics: { ...source.basics, name: nextName },
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    profiles.put(next);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    return { id: nextId, name: nextName };
  }, { nextId: id, nextName: name });
}

async function renameActiveProfile(page: Page, name: string) {
  await page.evaluate(async (nextName) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["profiles", "appMeta"], "readwrite");
    const meta = await new Promise<{ value: { profileId: string } }>((resolve, reject) => {
      const request = transaction.objectStore("appMeta").get("activeProfileContext:v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const profiles = transaction.objectStore("profiles");
    const profile = await new Promise<BrowserProfileRecord>((resolve, reject) => {
      const request = profiles.get(meta.value.profileId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    profiles.put({
      ...profile,
      name: nextName,
      basics: { ...profile.basics, name: nextName },
      version: profile.version + 1,
      updatedAt: new Date().toISOString()
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, name);
}
