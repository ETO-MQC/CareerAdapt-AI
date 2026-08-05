import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import narrativeFixture from "../fixtures/p43f-long-narrative.anonymized.json";

const NARRATIVE = narrativeFixture.narrative;

const CANDIDATE_FIXTURES = [
  {
    key: "education",
    sectionType: "education",
    quote: "示例大学计算机相关专业。",
    structuredItem: { sectionType: "education", school: "示例大学", major: "计算机相关专业", degree: "本科", courses: [], honors: [], highlights: [] },
    professionalText: "就读于示例大学，学习计算机相关专业。"
  },
  {
    key: "wearable-project",
    sectionType: "project",
    quote: "课程项目使用 ESP32 做可检测心跳与摔倒的穿戴设备，我协助心跳模块、走线修复和蓝牙连接。",
    structuredItem: { sectionType: "project", title: "可穿戴设备课程项目", tools: ["ESP32"], description: "协助心跳模块、走线修复和蓝牙连接。", highlights: [], outcomes: [] },
    professionalText: "在课程项目中协助可穿戴设备的心跳模块、走线修复和蓝牙连接。"
  },
  {
    key: "award",
    sectionType: "awards",
    quote: "参加示例编程竞赛并获得某省省级三等奖。",
    structuredItem: { sectionType: "awards", name: "示例编程竞赛省级三等奖", level: "省级", description: "参加示例编程竞赛并获得省级三等奖。" },
    professionalText: "参加示例编程竞赛并获得某省省级三等奖。"
  },
  {
    key: "research",
    sectionType: "research",
    quote: "在实验室用视觉模型和 Python 从近 1000 页 PDF 中提取实验数据。",
    structuredItem: { sectionType: "research", title: "实验数据提取", methods: ["视觉模型", "Python"], description: "从近 1000 页 PDF 中提取实验数据。", highlights: [] },
    professionalText: "在实验室使用视觉模型和 Python 从近 1000 页 PDF 中提取实验数据。"
  },
  {
    key: "campus",
    sectionType: "campus",
    quote: "担任团支书，组织团日活动、信息答疑和社会实践传达。",
    structuredItem: { sectionType: "campus", role: "团支书", description: "组织团日活动、信息答疑和社会实践传达。", highlights: [] },
    professionalText: "担任团支书，组织团日活动、信息答疑和社会实践传达。"
  },
  {
    key: "taskai",
    sectionType: "project",
    quote: "独立开发示例任务系统 / TaskAI",
    structuredItem: { sectionType: "project", title: "TaskAI", description: "独立开发示例任务系统 / TaskAI", highlights: [], outcomes: [] },
    professionalText: "独立开发示例任务系统 / TaskAI。"
  },
  {
    key: "learning-assistant",
    sectionType: "project",
    quote: "示例学习助手",
    structuredItem: { sectionType: "project", title: "示例学习助手", description: "示例学习助手", highlights: [], outcomes: [] },
    professionalText: "独立开发示例学习助手。"
  },
  {
    key: "content-analysis",
    sectionType: "project",
    quote: "示例内容采集与 AI 可信度分析系统，支持多格式报告导出。",
    structuredItem: { sectionType: "project", title: "示例内容采集与 AI 可信度分析系统", description: "开发示例内容采集与 AI 可信度分析系统。", highlights: [], outcomes: ["多格式报告导出"] },
    professionalText: "开发示例内容采集与 AI 可信度分析系统，并支持多格式报告导出。"
  },
  {
    key: "careeradapt-platform",
    sectionType: "project",
    quote: "开发 CareerAdapt AI 简历制作平台。",
    structuredItem: { sectionType: "project", title: "CareerAdapt AI 简历制作平台", description: "开发 CareerAdapt AI 简历制作平台。", highlights: [], outcomes: [] },
    professionalText: "开发 CareerAdapt AI 简历制作平台。"
  }
] as const;

test.describe("P4.3f conversational experience intake V2", () => {
  test("A — a single education candidate supports inline edit and stays out of Profile", async ({ page }) => {
    await installHarness(page, false, true);
    await startIntake(page);
    await send(page, "我现在是示例大学本科学生，计算机科学专业，2024年9月入学，预计2028年6月毕业");
    const card = page.locator(".profile-intake-candidate-card");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("示例大学");
    await expect(card).toContainText("本科");
    await expect(card).toContainText("计算机");
    await expect(card).toContainText("2024-09");
    await expect(card).toContainText("2028-06");
    const profileVersionBeforeReview = await readActiveProfileVersion(page);
    await card.getByRole("button", { name: "编辑后采用", exact: true }).click();
    await card.locator("input[name='major']").fill("计算机科学");
    const educationCandidateId = await card.getAttribute("data-candidate-id");
    await card.getByRole("button", { name: "保存并采用", exact: true }).click();
    await expect.poll(() => readTask(page)).toMatchObject({
      knownSlots: { profileIntakeReviewProjection: { reviewProgress: { accepted: 1 } } }
    });
    await expect(page.locator(`.profile-intake-candidate-card[data-candidate-id="${educationCandidateId}"]`)).toHaveCount(0);
    await expect(page.locator(".profile-intake-compact-receipt")).toContainText("✓ 已记录教育经历：示例大学 · 本科 · 计算机科学");
    await expect(page.getByRole("button", { name: "重新打开", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /产物 [0-9]+/ })).toBeVisible();
    await page.getByRole("button", { name: /产物 [0-9]+/ }).click();
    await expect(page.getByRole("region", { name: "经历核对" })).toContainText("计算机科学");
    await page.screenshot({ path: "artifacts/p43f-inline-review-after.png", fullPage: true });
    expect(await readActiveProfileVersion(page)).toBe(profileVersionBeforeReview);
  });

  test("A — extracts a long narrative into multiple inline review cards", async ({ page }) => {
    const harness = await installHarness(page);
    await startIntake(page);
    await send(page, NARRATIVE);

    await expect.poll(() => readTask(page)).toMatchObject({
      workflowId: "guided_profile_intake",
      stage: "review_facts",
      completionStatus: "waiting_for_user"
    });
    const cards = page.locator(".profile-intake-candidate-card");
    await expect(cards).toHaveCount(CANDIDATE_FIXTURES.length);
    const projection = ((await readTask(page)) as { knownSlots: { profileIntakeReviewProjection: { reviewProgress: Record<string, number> } } }).knownSlots.profileIntakeReviewProjection;
    expect(projection.reviewProgress).toMatchObject({ total: CANDIDATE_FIXTURES.length, valid: CANDIDATE_FIXTURES.length });
    expect(projection.reviewProgress.uncertain).toBeGreaterThan(0);
    await expect(cards.nth(0)).toContainText("示例大学");
    await expect(cards.nth(1)).toContainText("可穿戴设备课程项目");
    await expect(cards.nth(2)).toContainText("示例编程竞赛省级三等奖");
    await expect(cards.nth(3)).toContainText("实验数据提取");
    await expect(cards.nth(4)).toContainText("团支书");
    await expect(cards.filter({ hasText: "TaskAI" })).toHaveCount(1);
    await expect(cards.filter({ hasText: "示例学习助手" })).toHaveCount(1);
    await expect(cards.filter({ hasText: "示例内容采集与 AI 可信度分析系统" })).toHaveCount(1);
    expect(await cards.locator("> details").evaluateAll((details) => details.map((detail) => (detail as HTMLDetailsElement).open))).toEqual(
      CANDIDATE_FIXTURES.map((_, index) => index === 0)
    );
    await expect(page.getByRole("button", { name: "展开全部", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "展开全部", exact: true }).click();
    expect(await cards.locator("> details").evaluateAll((details) => details.every((detail) => (detail as HTMLDetailsElement).open))).toBe(true);
    await expect(page.getByText("这段内容没有完成结构化")).toHaveCount(0);
    expect(harness.aiCalls).toBe(1);
  });

  test("B — adopts, edits, and ignores through typed actions without another model turn", async ({ page }) => {
    const harness = await installHarness(page);
    await startIntake(page);
    await send(page, NARRATIVE);
    await expect(page.locator(".profile-intake-candidate-card")).toHaveCount(CANDIDATE_FIXTURES.length);
    const profileVersionBeforeReview = await readActiveProfileVersion(page);
    const before = await readTask(page) as { knownSlots: Record<string, unknown> };
    const firstId = await page.locator(".profile-intake-candidate-card").nth(0).getAttribute("data-candidate-id");
    await page.locator(".profile-intake-candidate-card").nth(0).getByRole("button", { name: "采用", exact: true }).click();
    await expect.poll(() => readTask(page)).toMatchObject({ knownSlots: { profileIntakeReviewProjection: { reviewProgress: { accepted: 1 } } } });
    const streamCallsAfterCapture = harness.streamCalls;
    const aiCallsAfterCapture = harness.aiCalls;
    expect(await page.locator(`.profile-intake-candidate-card[data-candidate-id="${firstId}"]`).count()).toBe(0);
    await expect(page.locator(".profile-intake-compact-receipt")).toContainText("✓ 已记录");

    const second = page.locator(".profile-intake-candidate-card").first();
    await openCandidateCard(second);
    await second.getByRole("button", { name: "编辑后采用", exact: true }).click();
    const titleInput = second.locator("input[name='title']");
    await expect(titleInput).toBeVisible();
    await titleInput.fill("课程项目");
    await second.getByRole("button", { name: "保存并采用", exact: true }).click();
    await expect.poll(() => readTask(page)).toMatchObject({ knownSlots: { profileIntakeReviewProjection: { reviewProgress: { accepted: 2 } } } });
    const third = page.locator(".profile-intake-candidate-card").first();
    await openCandidateCard(third);
    await third.getByRole("button", { name: "忽略", exact: true }).click();
    await expect.poll(() => readTask(page)).toMatchObject({ knownSlots: { profileIntakeReviewProjection: { reviewProgress: { ignored: 1 } } } });
    expect(harness.streamCalls).toBe(streamCallsAfterCapture);
    expect(harness.aiCalls).toBe(aiCallsAfterCapture);
    expect(await readActiveProfileVersion(page)).toBe(profileVersionBeforeReview);
    expect(before.knownSlots.profileIntakeReviewProjection).toBeDefined();
  });

  test("C — failed extraction exposes retry, manual, and preserve recovery", async ({ page }) => {
    const harness = await installHarness(page, true);
    await startIntake(page);
    await send(page, NARRATIVE);
    const inlineReview = page.getByRole("region", { name: "经历候选核对" });
    await expect(inlineReview.getByText("这段内容没有完成结构化，但原文已经保留。", { exact: true })).toBeVisible();
    await expect(inlineReview.getByRole("button", { name: "重新解析", exact: true })).toBeVisible();
    await expect(inlineReview.getByRole("button", { name: "手动整理", exact: true })).toBeVisible();
    await expect(inlineReview.getByRole("button", { name: "保留为来源", exact: true })).toBeVisible();
    const artifactReview = page.getByRole("region", { name: "经历核对" });
    await expect(artifactReview.getByRole("button", { name: "编辑后采用", exact: true })).toHaveCount(0);
    await expect(artifactReview.getByRole("button", { name: "忽略", exact: true })).toHaveCount(0);
    const streamCallsBeforeRetry = harness.streamCalls;
    await inlineReview.getByRole("button", { name: "重新解析", exact: true }).click();
    await expect.poll(() => readTask(page)).toMatchObject({ stage: "review_facts" });
    await expect(page.locator(".profile-intake-candidate-card")).toHaveCount(CANDIDATE_FIXTURES.length);
    expect(harness.streamCalls).toBe(streamCallsBeforeRetry);
    expect(harness.aiCalls).toBe(2);
  });

  test("D — the artifact mirrors the same candidate IDs and the review survives reload", async ({ page }) => {
    await installHarness(page);
    await startIntake(page);
    await send(page, NARRATIVE);
    await expect(page.locator(".profile-intake-candidate-card")).toHaveCount(CANDIDATE_FIXTURES.length);
    const inlineIds = await page.locator(".profile-intake-candidate-card").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-candidate-id")));
    await page.getByRole("button", { name: /产物 \d+/ }).click();
    const artifact = page.getByRole("region", { name: "经历核对" }).last();
    await expect(artifact).toContainText("示例大学");
    const artifactIds = await artifact.locator("[data-candidate-id]").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-candidate-id")));
    expect(artifactIds).toEqual(inlineIds);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(".profile-intake-candidate-card")).toHaveCount(CANDIDATE_FIXTURES.length);
    expect(await page.locator(".profile-intake-candidate-card").evaluateAll((cards) => cards.map((card) => card.getAttribute("data-candidate-id")))).toEqual(inlineIds);
  });

  test("E — source details stay collapsed and the review has a single high-value follow-up boundary", async ({ page }) => {
    await installHarness(page);
    await startIntake(page);
    await send(page, NARRATIVE);
    const first = page.locator(".profile-intake-candidate-card").first();
    await expect(first.locator(".profile-intake-candidate-source")).not.toHaveAttribute("open");
    await expect(first.locator(".profile-intake-candidate-source blockquote")).toBeHidden();
    const cards = page.locator(".profile-intake-candidate-card");
    while (await cards.count()) {
      const card = cards.first();
      await openCandidateCard(card);
      const accept = card.getByRole("button", { name: "采用", exact: true });
      if (!await accept.count()) break;
      await accept.click();
    }
    await expect.poll(() => readTask(page)).toMatchObject({
      stage: "collect_experience",
      knownSlots: { profileIntakeReviewProjection: { reviewProgress: { proposed: 0, uncertain: 0 } } }
    });
    await expect(page.locator(".agent-message-row.is-assistant").filter({ hasText: /接下来|补充/ }).last()).toBeVisible();
    const reviewOptions = page.locator(".agent-message-options").last();
    await expect(reviewOptions.getByRole("button", { name: "换一个方向", exact: true })).toBeVisible();
    await expect(reviewOptions.getByRole("button", { name: "完成整理", exact: true })).toBeVisible();
    expect((await page.locator(".agent-message-row.is-assistant").allTextContents()).some((text) => /接下来|补充/.test(text))).toBe(true);
  });

  test("F — the failed card keeps original text and never offers an adopt action", async ({ page }) => {
    await installHarness(page, true);
    await startIntake(page);
    const source = NARRATIVE;
    await send(page, source);
    const card = page.locator(".profile-intake-candidate-card");
    await expect(card).toContainText(source);
    await expect(card.getByRole("button", { name: "采用", exact: true })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "编辑后采用", exact: true })).toHaveCount(0);
  });
});

async function installHarness(page: Page, alwaysFail = false, educationOnly = false) {
  let aiCalls = 0;
  let streamCalls = 0;
  let extractionAttempts = 0;
  await page.route("**/api/ai/structured", async (route) => {
    const body = route.request().postDataJSON() as { task?: string; input?: { rawNarrative?: string } };
    if (body.task !== "profile-intake-semantic") {
      await route.continue();
      return;
    }
    aiCalls += 1;
    const raw = body.input?.rawNarrative ?? "";
    const shouldFail = alwaysFail && extractionAttempts === 0;
    extractionAttempts += 1;
    if (shouldFail) {
      await fulfillJson(route, {
        ok: true,
        task: "profile-intake-semantic",
        promptVersion: "p43f-e2e",
        output: { candidates: [], followUpQuestions: [] },
        meta: { provider: "mock", model: "p43f-e2e", inputLength: raw.length, outputLength: 40, latencyMs: 1 }
      });
      return;
    }
    const sourceFixtures = educationOnly ? [{
      key: "education-only",
      sectionType: "education" as const,
      quote: raw,
      structuredItem: {
        sectionType: "education" as const,
        school: "示例大学",
        degree: "本科",
        major: "计算机",
        startDate: "2024-09",
        endDate: "2028-06",
        current: false,
        courses: [],
        honors: [],
        highlights: []
      },
      professionalText: "就读于示例大学，学习计算机科学专业。",
      uncertainFields: [] as string[]
    }] : CANDIDATE_FIXTURES;
    const candidates = sourceFixtures.map((fixture) => {
      const start = raw.indexOf(fixture.quote);
      return {
        candidateKey: fixture.key,
        sectionType: fixture.sectionType,
        sourceSpan: { start, end: start + fixture.quote.length },
        structuredItem: fixture.structuredItem,
        professionalText: fixture.professionalText,
        uncertainFields: fixture.key === "wearable-project" ? ["role"] : []
      };
    }).filter((candidate) => candidate.sourceSpan.start >= 0);
    await fulfillJson(route, {
      ok: true,
      task: "profile-intake-semantic",
      promptVersion: "p43f-e2e",
      output: { candidates, followUpQuestions: ["这个项目中你本人承担的最重要一项工作是什么？", "是否有可公开展示的链接？"] },
      meta: { provider: "mock", model: "p43f-e2e", inputLength: raw.length, outputLength: 900, latencyMs: 1 }
    });
  });
  await page.route("**/api/agent/stream", async (route) => {
    streamCalls += 1;
    const body = route.request().postDataJSON() as { messages?: Array<{ role: string; name?: string; content: string }>; tools?: Array<{ name: string }> };
    const observations = (body.messages ?? []).filter((message) => message.role === "tool");
    const tools = new Set((body.tools ?? []).map((tool) => tool.name));
    const hasObservation = (name: string) => observations.some((message) => message.name === name || message.content.includes(name));
    if (tools.has("get_active_profile") && !hasObservation("get_active_profile")) {
      await fulfillTool(route, "p43f-target", "get_active_profile");
      return;
    }
    if (tools.has("capture_profile_intake") && !hasObservation("capture_profile_intake")) {
      await fulfillTool(route, "p43f-capture", "capture_profile_intake");
      return;
    }
    await fulfillAsk(route, "请继续补充一段真实经历。");
  });
  return {
    get aiCalls() { return aiCalls; },
    get streamCalls() { return streamCalls; }
  };
}

async function startIntake(page: Page) {
  await page.goto("/setup");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能", exact: true });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "", { timeout: 10000 });
  }
  await page.goto("/profile");
  await expect(page.locator(".ai-asset-content")).toBeVisible();
  await expect(page.getByLabel("选择人物")).toBeVisible();
  await page.goto("/ai-workspace");
  await page.getByRole("button", { name: /从零整理我的经历/ }).click();
  await expect(page.getByLabel("描述你的求职任务")).toBeVisible();
}

async function send(page: Page, text: string) {
  await page.getByLabel("描述你的求职任务").fill(text);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
}

async function openCandidateCard(card: Locator) {
  await card.locator("details").first().evaluate((details) => {
    (details as HTMLDetailsElement).open = true;
  });
}

async function readTask(page: Page) {
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
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.taskState as Record<string, unknown>;
  });
}

async function readActiveProfileVersion(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const version = await new Promise<number>((resolve, reject) => {
      const transaction = database.transaction(["appMeta", "profiles"], "readonly");
      const metaRequest = transaction.objectStore("appMeta").get("activeProfileContext:v1");
      metaRequest.onsuccess = () => {
        const profileId = (metaRequest.result as { value?: { profileId?: string } } | undefined)?.value?.profileId;
        if (!profileId) return reject(new Error("active profile missing"));
        const profileRequest = transaction.objectStore("profiles").get(profileId);
        profileRequest.onsuccess = () => resolve((profileRequest.result as { version: number }).version);
        profileRequest.onerror = () => reject(profileRequest.error);
      };
      metaRequest.onerror = () => reject(metaRequest.error);
    });
    database.close();
    return version;
  });
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
}

async function fulfillTool(route: Route, id: string, name: string) {
  await route.fulfill({ contentType: "text/event-stream", body: [
    "event: model_tool_call_start",
    `data: ${JSON.stringify({ type: "model_tool_call_start", index: 0, id, name })}`,
    "",
    "event: model_tool_call_complete",
    `data: ${JSON.stringify({ type: "model_tool_call_complete", index: 0, call: { id, name, arguments: {} } })}`,
    "",
    "event: model_finish",
    `data: ${JSON.stringify({ type: "model_finish", stopReason: "tool_calls" })}`,
    "",
    ""
  ].join("\n") });
}

async function fulfillAsk(route: Route, message: string) {
  await route.fulfill({ contentType: "text/event-stream", body: [
    "event: model_text_delta",
    `data: ${JSON.stringify({ type: "model_text_delta", delta: message })}`,
    "",
    "event: model_finish",
    `data: ${JSON.stringify({ type: "model_finish", stopReason: "ask_user" })}`,
    "",
    ""
  ].join("\n") });
}
