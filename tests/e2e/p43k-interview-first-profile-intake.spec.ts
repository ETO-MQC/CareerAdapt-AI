import { expect, test, type Page } from "@playwright/test";

const EXPERIENCES = [
  {
    marker: "示例大学",
    text: "我在示例大学读计算机本科，2024年9月入学，预计2028年6月毕业。",
    item: {
      id: "p43k-education",
      sectionType: "education" as const,
      school: "示例大学",
      degree: "本科",
      major: "计算机科学",
      startDate: "2024-09",
      endDate: "2028-06",
      current: false,
      courses: [],
      honors: [],
      highlights: [],
      customFields: []
    }
  },
  {
    marker: "Smart Fox",
    text: "在 Smart Fox 项目中负责数据采集，使用 RPA 完成自动化处理。",
    item: project("p43k-smart-fox", "Smart Fox", "数据采集", "使用 RPA 完成自动化处理。", ["RPA"], ["完成自动化处理"])
  },
  {
    marker: "Learn AI",
    text: "在 Learn AI 项目中负责数据清洗，交付训练数据集。",
    item: project("p43k-learn-ai", "Learn AI", "数据负责人", "负责数据清洗并交付训练数据集。", [], ["交付训练数据集"])
  },
  {
    marker: "创新竞赛",
    text: "获得校级创新竞赛二等奖，颁发方为示例大学。",
    item: {
      id: "p43k-award",
      sectionType: "awards" as const,
      name: "创新竞赛二等奖",
      issuer: "示例大学",
      level: "校级",
      awardedAt: "2025-06",
      description: "获得校级创新竞赛二等奖。",
      customFields: []
    }
  },
  {
    marker: "视觉模型",
    text: "在实验室研究视觉模型，使用 Python 从 1000 页 PDF 中提取实验数据。",
    item: {
      id: "p43k-research",
      sectionType: "research" as const,
      title: "实验数据提取研究",
      authorRole: "研究助理",
      institution: "示例实验室",
      methods: ["视觉模型", "Python"],
      current: false,
      description: "从 1000 页 PDF 中提取实验数据。",
      highlights: ["完成实验数据提取"],
      customFields: []
    }
  },
  {
    marker: "校园社团",
    text: "在校园社团中担任学习部长，组织学习分享活动。",
    item: experience("p43k-campus", "校园社团", "学习部长", "组织学习分享活动。")
  },
  {
    marker: "社会实践",
    text: "参加社会实践志愿项目，组织社区数字技能培训。",
    item: experience("p43k-social", "社会实践志愿项目", "志愿者", "组织社区数字技能培训。")
  },
  {
    marker: "CareerAdapt AI",
    text: "开发 CareerAdapt AI 简历制作平台，负责访谈流程和事实核对。",
    item: project("p43k-careeradapt", "CareerAdapt AI", "产品开发", "负责访谈流程和事实核对。", ["TypeScript"], ["完成事实核对流程"])
  }
] as const;

test.describe("P4.3k interview-first profile intake", () => {
  test("records every turn, synthesizes once, preserves correction provenance, and commits only after one review", async ({ page }) => {
    test.setTimeout(180_000);
    const structuredTasks: string[] = [];
    await installFixtureRoutes(page, structuredTasks);
    await applyScreenshotViewport(page);
    await startIntake(page);
    await captureScreenshot(page, "collecting");
    const before = await readActiveProfile(page);

    for (const experience of EXPERIENCES) {
      await send(page, experience.text);
      await expect.poll(async () => {
        const messages = (await readActiveSession(page)).messages;
        return messages.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
      }, { timeout: 30_000 }).toMatch(/接下来|还想确认|为了|在“|完成整理/u);
      await expect.poll(() => readActiveTask(page), { timeout: 30_000 }).toMatchObject({ completionStatus: "waiting_for_user" });
    }

    expect(await page.locator(".profile-intake-candidate-card").count()).toBe(0);
    await expect.poll(() => readActiveTask(page), { timeout: 30_000 }).toMatchObject({
      stage: "collect_experience",
      knownSlots: { profileIntakePhase: "clarifying" }
    });
    expect((await readSourceJournal(page))).toHaveLength(EXPERIENCES.length);
    await expect.poll(async () => (await readSourceJournal(page)).every((turn) => ["structured", "partial"].includes(String(turn.processingStatus))), { timeout: 30_000 }).toBe(true);

    await page.locator("form").getByRole("button", { name: "完成整理", exact: true }).click();
    await expect.poll(() => readActiveTask(page), { timeout: 30_000 }).toMatchObject({
      stage: "final_review",
      knownSlots: { profileIntakePhase: "ready_for_review" }
    });

    let artifact = await openIntakeArtifact(page);
    let finalReview = artifact.getByRole("region", { name: "最终资料草稿审核" });
    await expect(finalReview.getByText(/最终资料草稿 共 8 项，AI 已根据本次完整访谈进行整理/u)).toBeVisible();
    await captureScreenshot(page, "final-review");
    for (const experience of EXPERIENCES) await expect(finalReview).toContainText(String(experience.item.sectionType === "education" ? experience.item.school : "title" in experience.item ? experience.item.title : "name" in experience.item ? experience.item.name : experience.item.organization));
    await expect(finalReview.getByRole("button", { name: "全部采用", exact: true })).toBeVisible();
    await expect(finalReview.getByRole("button", { name: "逐项采用", exact: true })).toHaveCount(EXPERIENCES.length);
    await expect(finalReview.getByRole("button", { name: "编辑", exact: true })).toHaveCount(EXPERIENCES.length);
    await expect(finalReview.getByRole("button", { name: "忽略", exact: true })).toHaveCount(EXPERIENCES.length);
    await expect(finalReview.getByRole("button", { name: "新增一项", exact: true })).toBeVisible();
    await expect(finalReview.getByRole("button", { name: "返回继续补充", exact: true })).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    await expect.poll(() => readActiveTask(page), { timeout: 30_000 }).toMatchObject({
      stage: "final_review",
      knownSlots: { profileIntakePhase: "ready_for_review" }
    });
    artifact = await openIntakeArtifact(page);
    finalReview = artifact.getByRole("region", { name: "最终资料草稿审核" });
    await expect(finalReview.getByText(/最终资料草稿 共 8 项，AI 已根据本次完整访谈进行整理/u)).toBeVisible();
    await expect(finalReview.getByRole("button", { name: "逐项采用", exact: true })).toHaveCount(EXPERIENCES.length);

    const learnAiCard = finalReview.locator("[data-candidate-id]").filter({ hasText: "Learn AI" }).first();
    await learnAiCard.getByRole("button", { name: "编辑", exact: true }).click();
    await learnAiCard.getByLabel("角色", { exact: true }).fill("项目负责人");
    await learnAiCard.getByRole("button", { name: "保存并采用", exact: true }).click();
    await expect.poll(async () => {
      const task = await readActiveTask(page);
      const projection = objectValue(objectValue(task.knownSlots).profileIntakeReviewProjection);
      return objectValue(projection.reviewProgress).accepted;
    }, { timeout: 30_000 }).toBe(1);
    const editedTask = await readActiveTask(page);
    const editedProjection = objectValue(objectValue(editedTask.knownSlots).profileIntakeReviewProjection);
    const finalSynthesis = objectValue(editedProjection.finalSynthesis);
    const finalAssets = Array.isArray(finalSynthesis.assets) ? finalSynthesis.assets.map(objectValue) : [];
    const learnAiAsset = finalAssets.find((asset) => JSON.stringify(asset.structuredItem).includes("Learn AI"));
    expect(learnAiAsset).toBeDefined();
    expect(JSON.stringify(learnAiAsset?.structuredItem)).toContain("项目负责人");
    expect(Array.isArray(learnAiAsset?.careerReadyHighlights)).toBe(true);
    expect((learnAiAsset?.careerReadyHighlights as unknown[] | undefined)?.length).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(learnAiAsset?.provenance)).toBe(true);
    expect(learnAiAsset?.provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "source_turn" })
    ]));

    await send(page, "确认");
    await expect(page.getByText("最终资料草稿还没有全部采用。", { exact: false }).last()).toBeVisible({ timeout: 30_000 });
    expect((await readActiveProfile(page)).version).toBe(before.version);
    expect((await readActiveSession(page)).messages.map((message) => message.toolName)).not.toContain("commit_profile_intake");

    artifact = await openIntakeArtifact(page);
    await artifact.getByRole("region", { name: "最终资料草稿审核" }).getByRole("button", { name: "全部采用", exact: true }).click();
    await expect.poll(async () => {
      const task = await readActiveTask(page);
      return objectValue(objectValue(objectValue(task.knownSlots).profileIntakeReviewProjection).reviewProgress).accepted;
    }, { timeout: 30_000 }).toBe(EXPERIENCES.length);

    artifact = await openIntakeArtifact(page);
    await artifact.getByRole("button", { name: "确认并写入个人资料库", exact: true }).click();
    await expect.poll(() => readActiveTask(page), { timeout: 60_000 }).toMatchObject({ stage: "profile_complete" });
    await expect.poll(() => readActiveProfile(page), { timeout: 10_000 }).toMatchObject({ version: before.version + 1 });
    const committed = await readCommittedProfile(page);
    expect(committed.items.join("\n")).toContain("Smart Fox");
    expect(committed.items.join("\n")).toContain("Learn AI");
    expect(committed.items.join("\n")).toContain("CareerAdapt AI");

    const toolNames = (await readActiveSession(page)).messages.map((message) => message.toolName);
    expect(toolNames).toContain("synthesize_profile_intake");
    expect(toolNames).toContain("review_profile_intake");
    expect(toolNames).toContain("reconcile_profile_intake");
    expect(toolNames).toContain("commit_profile_intake");
    expect(toolNames).toContain("get_profile");
    expect(structuredTasks.filter((task) => task === "profile-intake-final-career-synthesis")).toHaveLength(1);
    await captureScreenshot(page, "completed");
  });

  test("P4.3k.1 automatically continues after capture instead of returning a receipt", async ({ page }) => {
    test.setTimeout(120_000);
    await installConversationalFixtureRoutes(page);
    await startIntake(page);

    await send(page, EXPERIENCES[0].text);
    await expect.poll(async () => {
      const messages = (await readActiveSession(page)).messages;
      return messages.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
      }, { timeout: 30_000 }).toMatch(/接下来|还想确认|为了/u);
  });

  test("P4.3k.1 patches only the active asset and preserves it through draft review", async ({ page }) => {
    test.setTimeout(120_000);
    const semanticInputs: string[] = [];
    const structuredTasks: string[] = [];
    await installConversationalFixtureRoutes(page, semanticInputs, structuredTasks);
    await startIntake(page);
    const beforeProfile = await readActiveProfile(page);

    await send(page, P43K1_LONG_NARRATIVE);
    await expect.poll(() => readActiveTask(page), { timeout: 30_000 }).toMatchObject({
      knownSlots: { intakeActiveQuestion: { candidateId: expect.any(String) } }
    });
    const beforeTask = await readActiveTask(page);
    const beforeArtifact = objectValue(objectValue(beforeTask.knownSlots).intakeArtifact);
    const beforeCandidates = Array.isArray(beforeArtifact.candidates) ? beforeArtifact.candidates.map(objectValue) : [];
    const activeQuestion = objectValue(objectValue(beforeTask.knownSlots).intakeActiveQuestion);
    const targetId = String(activeQuestion.candidateId ?? "");
    const targetCandidate = beforeCandidates.find((candidate) => candidate.id === targetId);
    const targetLabel = String(targetCandidate?.label ?? "");
    expect(targetId).not.toBe("");
    expect(targetLabel).not.toBe("");
    const firstNarration = (await readActiveSession(page)).messages.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
    expect(firstNarration).toContain(targetLabel);
    expect((firstNarration.match(/[？?]/gu) ?? []).length).toBe(1);
    expect(await page.locator(".profile-intake-candidate-card")).toHaveCount(0);
    const beforeIds = beforeCandidates.map((candidate) => candidate.id);
    const beforeSemanticCalls = semanticInputs.length;
    const beforeCaptureCalls = (await readActiveSession(page)).messages.filter((message) => message.toolName === "capture_profile_intake").length;
    const beforeSourceTurns = (await readSourceJournal(page)).length;
    const answer = `我在“${targetLabel}”中遇到提醒与计时联动问题，通过拆分任务状态处理。`;

    await send(page, "什么工作？");
    await expect.poll(async () => {
      const messages = (await readActiveSession(page)).messages;
      return messages.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
    }, { timeout: 30_000 }).toContain(targetLabel);
    expect(semanticInputs).toHaveLength(beforeSemanticCalls);
    expect((await readSourceJournal(page)).length).toBe(beforeSourceTurns);
    expect((await readActiveSession(page)).messages.filter((message) => message.toolName === "capture_profile_intake")).toHaveLength(beforeCaptureCalls);

    await send(page, answer);
    await expect.poll(async () => (await readSourceJournal(page)).length, { timeout: 30_000 }).toBe(beforeSourceTurns + 1);
    await expect.poll(() => readActiveTask(page), { timeout: 30_000 }).toMatchObject({ completionStatus: "waiting_for_user" });
    const afterTask = await readActiveTask(page);
    const afterArtifact = objectValue(objectValue(afterTask.knownSlots).intakeArtifact);
    const afterCandidates = Array.isArray(afterArtifact.candidates) ? afterArtifact.candidates.map(objectValue) : [];
    expect(afterCandidates.map((candidate) => candidate.id)).toEqual(beforeIds);
    const patchedCandidate = afterCandidates.find((candidate) => candidate.id === targetId);
    expect(JSON.stringify(patchedCandidate?.structuredItem)).toContain("提醒与计时联动问题");
    expect(semanticInputs).toHaveLength(beforeSemanticCalls + 1);
    expect((await readActiveSession(page)).messages.filter((message) => message.toolName === "capture_profile_intake")).toHaveLength(beforeCaptureCalls + 1);

    const activeAfterPatch = objectValue(objectValue(afterTask.knownSlots).intakeActiveQuestion);
    const activeAfterPatchLabel = String(afterCandidates.find((candidate) => candidate.id === activeAfterPatch.candidateId)?.label ?? targetLabel);
    await send(page, "查看草稿");
    await expect.poll(async () => {
      const messages = (await readActiveSession(page)).messages;
      return messages.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
    }, { timeout: 30_000 }).toContain(activeAfterPatchLabel);
    await expect.poll(async () => {
      const messages = (await readActiveSession(page)).messages;
      return messages.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
    }, { timeout: 30_000 }).toContain("目前已整理");
    const afterDraftTask = await readActiveTask(page);
    const activeAfterDraft = objectValue(objectValue(afterDraftTask.knownSlots).intakeActiveQuestion);
    expect(activeAfterDraft.candidateId).toBe(activeAfterPatch.candidateId);
    expect(semanticInputs).toHaveLength(beforeSemanticCalls + 1);
    expect((await readSourceJournal(page)).length).toBe(beforeSourceTurns + 1);
    expect((await readActiveSession(page)).messages.filter((message) => message.toolName === "capture_profile_intake")).toHaveLength(beforeCaptureCalls + 1);
    expect(structuredTasks.filter((task) => task === "profile-intake-final-career-synthesis")).toHaveLength(0);

    await send(page, "继续");
    await expect.poll(async () => {
      const messages = (await readActiveSession(page)).messages;
      return messages.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
    }, { timeout: 30_000 }).toContain(activeAfterPatchLabel);
    expect(semanticInputs).toHaveLength(beforeSemanticCalls + 1);
    expect((await readSourceJournal(page)).length).toBe(beforeSourceTurns + 1);

    await send(page, "完成整理");
    await expect.poll(() => readActiveTask(page), { timeout: 60_000 }).toMatchObject({
      stage: "final_review",
      knownSlots: { profileIntakePhase: "ready_for_review" }
    });
    const finalTask = await readActiveTask(page);
    const finalKnownSlots = objectValue(finalTask.knownSlots);
    const finalProjection = objectValue(finalKnownSlots.profileIntakeReviewProjection);
    const finalSynthesis = objectValue(finalProjection.finalSynthesis);
    const finalAssets = Array.isArray(finalSynthesis.assets) ? finalSynthesis.assets.map(objectValue) : [];
    expect(finalAssets).toHaveLength(beforeCandidates.length);
    expect(finalAssets.filter((asset) => asset.sectionType === "project").every((asset) => {
      const highlights = asset.careerReadyHighlights;
      return Array.isArray(highlights) && highlights.length >= 2 && highlights.length <= 4;
    })).toBe(true);
    expect(objectValue(finalKnownSlots.intakeSession).finalReviewCount).toBe(1);

    let finalArtifact = await openIntakeArtifact(page);
    const finalReview = finalArtifact.getByRole("region", { name: "最终资料草稿审核" });
    await expect(finalReview.getByText(/最终资料草稿 共 8 项，AI 已根据本次完整访谈进行整理/u)).toBeVisible();
    const learnAiCard = finalReview.locator("[data-candidate-id]").filter({ hasText: "Learn AI" }).first();
    await learnAiCard.getByRole("button", { name: "编辑", exact: true }).click();
    await learnAiCard.getByLabel("项目名称", { exact: true }).fill("Learn AI（已核对）");
    await learnAiCard.getByRole("button", { name: "保存并采用", exact: true }).click();
    await expect.poll(async () => {
      const task = await readActiveTask(page);
      return objectValue(objectValue(objectValue(task.knownSlots).profileIntakeReviewProjection).reviewProgress).accepted;
    }, { timeout: 30_000 }).toBe(1);

    const editedFinalTask = await readActiveTask(page);
    const editedFinalProjection = objectValue(objectValue(editedFinalTask.knownSlots).profileIntakeReviewProjection);
    const editedFinalSynthesis = objectValue(editedFinalProjection.finalSynthesis);
    const editedFinalAssets = Array.isArray(editedFinalSynthesis.assets) ? editedFinalSynthesis.assets.map(objectValue) : [];
    const editedLearnAi = editedFinalAssets.find((asset) => JSON.stringify(asset.structuredItem).includes("Learn AI（已核对）"));
    expect(editedLearnAi).toBeDefined();
    expect(editedLearnAi?.provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "source_turn" })
    ]));

    finalArtifact = await openIntakeArtifact(page);
    await finalArtifact.getByRole("region", { name: "最终资料草稿审核" }).getByRole("button", { name: "全部采用", exact: true }).click();
    await expect.poll(async () => {
      const task = await readActiveTask(page);
      return objectValue(objectValue(objectValue(task.knownSlots).profileIntakeReviewProjection).reviewProgress).accepted;
    }, { timeout: 30_000 }).toBe(beforeCandidates.length);
    finalArtifact = await openIntakeArtifact(page);
    await finalArtifact.getByRole("button", { name: "确认并写入个人资料库", exact: true }).click();
    await expect.poll(() => readActiveTask(page), { timeout: 60_000 }).toMatchObject({ stage: "profile_complete" });
    await expect.poll(() => readActiveProfile(page), { timeout: 10_000 }).toMatchObject({ version: beforeProfile.version + 1 });
    const committed = await readCommittedProfile(page);
    expect(committed.items.join("\n")).toContain("Learn AI（已核对）");
    expect(committed.structuredFacts.some((entry) =>
      JSON.stringify(entry.data).includes("Learn AI（已核对）")
      && Array.isArray(entry.provenance)
      && entry.provenance.some((provenance) => typeof provenance.sourceTurnId === "string")
    )).toBe(true);
    const completedSession = await readActiveSession(page);
    const completedToolNames = completedSession.messages.map((message) => message.toolName);
    expect(completedToolNames.filter((name) => name === "capture_profile_intake")).toHaveLength(2);
    expect(completedToolNames.filter((name) => name === "synthesize_profile_intake")).toHaveLength(1);
    expect(completedToolNames.filter((name) => name === "commit_profile_intake")).toHaveLength(1);
    expect(semanticInputs).toHaveLength(beforeSemanticCalls + 1);
    expect((await readSourceJournal(page)).length).toBe(beforeSourceTurns + 1);
    expect(structuredTasks.filter((task) => task === "profile-intake-final-career-synthesis")).toHaveLength(1);

    await page.reload({ waitUntil: "networkidle" });
    await expect.poll(() => readActiveTask(page), { timeout: 30_000 }).toMatchObject({ stage: "profile_complete" });
    const afterReload = await readCommittedProfile(page);
    expect(afterReload.items.join("\n")).toContain("Learn AI（已核对）");
    expect(afterReload.structuredFacts.some((entry) =>
      JSON.stringify(entry.data).includes("Learn AI（已核对）")
      && Array.isArray(entry.provenance)
      && entry.provenance.some((provenance) => typeof provenance.sourceTurnId === "string")
    )).toBe(true);
  });

  test("P4.3k.1 routes a short reference question without creating evidence", async ({ page }) => {
    test.setTimeout(120_000);
    const semanticInputs: string[] = [];
    await installConversationalFixtureRoutes(page, semanticInputs);
    await startIntake(page);

    await send(page, P43K1_LONG_NARRATIVE);
    await expect.poll(() => readActiveTask(page), { timeout: 30_000 }).toMatchObject({
      knownSlots: { intakeActiveQuestion: { candidateId: expect.any(String) } }
    });
    const beforeSemanticCalls = semanticInputs.length;
    const beforeSourceTurns = (await readSourceJournal(page)).length;
    const beforeCaptureCalls = (await readActiveSession(page)).messages.filter((message) => message.toolName === "capture_profile_intake").length;
    const activeTask = await readActiveTask(page);
    const activeQuestion = objectValue(objectValue(activeTask.knownSlots).intakeActiveQuestion);
    const artifact = objectValue(objectValue(activeTask.knownSlots).intakeArtifact);
    const candidates = Array.isArray(artifact.candidates) ? artifact.candidates.map(objectValue) : [];
    const targetCandidate = candidates.find((candidate) => candidate.id === activeQuestion.candidateId);
    const targetLabel = String(targetCandidate?.label ?? "");
    expect(targetLabel).not.toBe("");

    await send(page, "什么工作？");
    await expect.poll(async () => {
      const messages = (await readActiveSession(page)).messages;
      return messages.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
    }, { timeout: 30_000 }).toContain(targetLabel);

    expect(semanticInputs).toHaveLength(beforeSemanticCalls);
    expect((await readSourceJournal(page)).length).toBe(beforeSourceTurns);
    expect((await readActiveSession(page)).messages.filter((message) => message.toolName === "capture_profile_intake")).toHaveLength(beforeCaptureCalls);
  });
});

function project(id: string, title: string, role: string, description: string, tools: string[], outcomes: string[]) {
  return { id, sectionType: "project" as const, title, role, description, current: false, tools, highlights: [], outcomes, customFields: [] };
}

function experience(id: string, organization: string, role: string, description: string) {
  return { id, sectionType: "volunteer" as const, organization, role, description, current: false, highlights: [], customFields: [] };
}

async function installFixtureRoutes(page: Page, structuredTasks: string[] = []) {
  await page.addInitScript(() => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
      baseUrl: "",
      apiKey: "mock-key",
      model: "",
      provider: "mock"
    }));
  });
  await page.route("**/api/ai/structured**", async (route) => {
    const body = route.request().postDataJSON() as { task?: string; input?: { rawNarrative?: string } };
    if (body.task) structuredTasks.push(body.task);
    if (body.task !== "profile-intake-semantic") return route.continue();
    const raw = body.input?.rawNarrative ?? "";
    const fixture = [...EXPERIENCES].reverse().find((candidate) => raw.includes(candidate.marker)) ?? EXPERIENCES[0];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        task: body.task,
        promptVersion: "p43k-e2e",
        output: {
          candidates: [{
            candidateKey: fixture.item.id,
            sectionType: fixture.item.sectionType,
            sourceSpan: { start: 0, end: raw.length },
            structuredItem: fixture.item,
            professionalText: raw,
            uncertainFields: []
          }],
          followUpQuestions: []
        },
        meta: { provider: "fixture", model: "p43k-e2e", latencyMs: 1 }
      })
    });
  });
  await page.route("**/api/agent/stream", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: nativeAsk("请继续补充下一段经历。") });
  });
}

const P43K1_LONG_NARRATIVE = [
  "我在智能穿戴课程项目中完成传感器数据采集和课程展示，形成课程项目成果。",
  "获得校级创新竞赛二等奖，颁发方为示例大学，2025年6月获得。",
  "在示例实验室支持视觉模型研究，使用 Python 从 1000 页 PDF 中提取实验数据，完成实验数据交付。",
  "在校园社团担任学习部长，组织学习分享活动并完成活动交付。",
  "在 Smart Fox Task AI 中实现任务四象限、计时和提醒能力。",
  "在 Learn AI 中负责数据清洗，使用 Python 交付训练数据集。",
  "在社会平台信誉分析项目中使用 Python 完成数据分析并交付分析报告。",
  "开发 CareerAdapt AI，负责访谈流程和事实核对，使用 TypeScript 完成平台交付。"
].join("\n");

async function installConversationalFixtureRoutes(page: Page, semanticInputs: string[] = [], structuredTasks: string[] = []) {
  await page.addInitScript(() => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
      baseUrl: "",
      apiKey: "mock-key",
      model: "",
      provider: "mock"
    }));
  });
  await page.route("**/api/ai/structured**", async (route) => {
    const body = route.request().postDataJSON() as {
      task?: string;
      input?: {
        rawNarrative?: string;
        followUpContext?: { candidateId?: string; currentStructuredItem?: unknown };
      };
    };
    if (body.task) structuredTasks.push(body.task);
    if (body.task !== "profile-intake-semantic") return route.continue();
    const raw = body.input?.rawNarrative ?? "";
    semanticInputs.push(raw);
    const followUp = body.input?.followUpContext;
    if (followUp?.candidateId && followUp.currentStructuredItem && typeof followUp.currentStructuredItem === "object") {
      const current = objectValue(followUp.currentStructuredItem);
      const structuredItem: Record<string, unknown> = { ...current };
      if (typeof current.description === "string") {
        structuredItem.description = raw;
      } else if (Array.isArray(current.highlights)) {
        structuredItem.highlights = [...current.highlights, raw];
      } else if (Array.isArray(current.outcomes)) {
        structuredItem.outcomes = [...current.outcomes, raw];
      } else if (typeof current.role === "string") {
        structuredItem.role = `${current.role}；${raw}`;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          task: body.task,
          promptVersion: "p43k1-follow-up-e2e",
          output: {
            candidates: [{
              candidateKey: followUp.candidateId,
              sectionType: current.sectionType,
              sourceSpan: { start: 0, end: raw.length },
              structuredItem,
              professionalText: raw,
              uncertainFields: []
            }],
            followUpQuestions: []
          },
          meta: { provider: "fixture", model: "p43k1-follow-up-e2e", latencyMs: 1 }
        })
      });
      return;
    }
    const fixtures = raw.includes("\n")
      ? P43K1_ASSETS.filter((candidate) => raw.includes(candidate.text))
      : [EXPERIENCES.find((candidate) => raw.includes(candidate.marker)) ?? EXPERIENCES[0]];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        task: body.task,
        promptVersion: "p43k1-e2e",
        output: {
          candidates: fixtures.map((fixture) => {
            const start = raw.indexOf(fixture.text);
            return {
              candidateKey: fixture.item.id,
              sectionType: fixture.item.sectionType,
              sourceSpan: { start: Math.max(0, start), end: Math.max(0, start) + fixture.text.length },
              structuredItem: fixture.item,
              professionalText: fixture.text,
              uncertainFields: []
            };
          }),
          followUpQuestions: []
        },
        meta: { provider: "fixture", model: "p43k1-e2e", latencyMs: 1 }
      })
    });
  });
  await page.route("**/api/agent/stream", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: nativeAsk("请继续补充下一段经历。") });
  });
}

const P43K1_ASSETS = [
  {
    text: "我在智能穿戴课程项目中完成传感器数据采集和课程展示，形成课程项目成果。",
    item: project("p43k1-wearable", "智能穿戴课程项目", "项目成员", "完成传感器数据采集和课程展示，形成课程项目成果。", ["Arduino"], ["形成课程项目成果"])
  },
  {
    text: "获得校级创新竞赛二等奖，颁发方为示例大学，2025年6月获得。",
    item: {
      id: "p43k1-award",
      sectionType: "awards" as const,
      name: "校级创新竞赛二等奖",
      issuer: "示例大学",
      level: "校级",
      awardedAt: "2025-06",
      description: "获得校级创新竞赛二等奖。",
      customFields: []
    }
  },
  {
    text: "在示例实验室支持视觉模型研究，使用 Python 从 1000 页 PDF 中提取实验数据，完成实验数据交付。",
    item: {
      id: "p43k1-research",
      sectionType: "research" as const,
      title: "视觉模型研究支持",
      authorRole: "研究助理",
      institution: "示例实验室",
      methods: ["Python"],
      samples: "1000 页 PDF",
      current: false,
      description: "从 1000 页 PDF 中提取实验数据。",
      highlights: ["完成实验数据交付"],
      customFields: []
    }
  },
  {
    text: "在校园社团担任学习部长，组织学习分享活动并完成活动交付。",
    item: experience("p43k1-campus", "校园社团", "学习部长", "组织学习分享活动并完成活动交付。")
  },
  {
    text: "在 Smart Fox Task AI 中实现任务四象限、计时和提醒能力。",
    item: project("p43k1-smart-fox", "Smart Fox Task AI", "开发者", "实现任务四象限、计时和提醒能力。", [], [])
  },
  {
    text: "在 Learn AI 中负责数据清洗，使用 Python 交付训练数据集。",
    item: project("p43k1-learn-ai", "Learn AI", "数据负责人", "负责数据清洗并交付训练数据集。", ["Python"], ["交付训练数据集"])
  },
  {
    text: "在社会平台信誉分析项目中使用 Python 完成数据分析并交付分析报告。",
    item: project("p43k1-social", "社会平台信誉分析", "分析成员", "使用 Python 完成数据分析并交付分析报告。", ["Python"], ["交付分析报告"])
  },
  {
    text: "开发 CareerAdapt AI，负责访谈流程和事实核对，使用 TypeScript 完成平台交付。",
    item: project("p43k1-careeradapt", "CareerAdapt AI", "产品开发", "负责访谈流程和事实核对，使用 TypeScript 完成平台交付。", ["TypeScript"], ["完成平台交付"])
  }
] as const;

async function applyScreenshotViewport(page: Page) {
  const value = process.env.P43K_SCREENSHOT_VIEWPORT;
  if (!value) return;
  const match = value.match(/^(\d+)x(\d+)$/u);
  if (!match) throw new Error(`Invalid P43K_SCREENSHOT_VIEWPORT: ${value}`);
  await page.setViewportSize({ width: Number(match[1]), height: Number(match[2]) });
}

async function captureScreenshot(page: Page, name: string) {
  const directory = process.env.P43K_SCREENSHOT_DIR;
  const viewport = process.env.P43K_SCREENSHOT_VIEWPORT;
  if (!directory || !viewport) return;
  await page.screenshot({ path: `${directory}/p43k-${viewport}-${name}.png`, fullPage: true });
}

async function startIntake(page: Page) {
  await page.goto("/profile");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能", exact: true });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await page.waitForTimeout(200);
  }
  await resetIntakeBrowserState(page);
  await page.reload();
  if (await page.getByRole("button", { name: "跳过，先体验其他功能", exact: true }).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "跳过，先体验其他功能", exact: true }).click();
  }
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "个人资料库", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.goto("/ai-workspace");
  await page.getByRole("button", { name: /从零整理我的经历/ }).click();
  await expect(page.locator('[data-agent-workflow-id="guided_profile_intake"][data-agent-task-stage="collect_experience"]'))
    .toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("描述你的求职任务")).toBeVisible();
}

async function resetIntakeBrowserState(page: Page) {
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const storeNames = ["agentSessions", "agentMessages", "appMeta"].filter((name) => database.objectStoreNames.contains(name));
      if (!storeNames.length) {
        resolve();
        return;
      }
      const transaction = database.transaction(storeNames, "readwrite");
      if (storeNames.includes("agentSessions")) transaction.objectStore("agentSessions").clear();
      if (storeNames.includes("agentMessages")) transaction.objectStore("agentMessages").clear();
      if (!storeNames.includes("appMeta")) {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
        return;
      }
      const appMeta = transaction.objectStore("appMeta");
      const request = appMeta.getAll();
      request.onsuccess = () => {
        for (const row of request.result as Array<{ key?: string }>) {
          if (String(row.key ?? "").startsWith("profileIntakeSourceTurn:v1:")) appMeta.delete(row.key as IDBValidKey);
        }
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    localStorage.removeItem("careeradapt.agent.activeSessionId");
  });
}

async function send(page: Page, text: string) {
  await page.getByLabel("描述你的求职任务").fill(text);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
}

async function openIntakeArtifact(page: Page) {
  const artifact = page.getByRole("region", { name: "经历核对" });
  if (!(await artifact.isVisible().catch(() => false))) await page.getByRole("button", { name: /产物/ }).last().click();
  await expect(artifact).toBeVisible({ timeout: 10_000 });
  return artifact;
}

async function readActiveTask(page: Page): Promise<Record<string, unknown>> {
  const session = await readActiveSession(page);
  return objectValue(session.taskState);
}

async function readActiveSession(page: Page): Promise<{ taskState?: unknown; messages: Array<{ id?: string; role?: string; content?: string; toolName?: string }> }> {
  return page.evaluate(async () => {
    const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const getAll = <T>(database: IDBDatabase, storeName: string) => new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
    const database = await openDatabase();
    const sessions = await getAll<{ id: string; taskState?: unknown; updatedAt: string }>(database, "agentSessions");
    const activeId = localStorage.getItem("careeradapt.agent.activeSessionId");
    const session = sessions.find((candidate) => candidate.id === activeId) ?? sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const messages = await getAll<{ sessionId: string; sequence: number; toolName?: string }>(database, "agentMessages");
    database.close();
    return {
      taskState: session?.taskState,
      messages: messages.filter((message) => message.sessionId === session?.id).sort((left, right) => left.sequence - right.sequence)
    };
  });
}

async function readSourceJournal(page: Page) {
  return page.evaluate(async () => {
    const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const getAll = <T>(database: IDBDatabase, storeName: string) => new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
    const database = await openDatabase();
    const rows = await getAll<{ key: string; value?: { processingStatus?: string } }>(database, "appMeta");
    database.close();
    return rows.filter((row) => row.key.startsWith("profileIntakeSourceTurn:v1:")).map((row) => row.value ?? {});
  });
}

async function readActiveProfile(page: Page) {
  return page.evaluate(async () => {
    const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const getOne = <T>(database: IDBDatabase, storeName: string, key: IDBValidKey) => new Promise<T | undefined>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
    const database = await openDatabase();
    const context = await getOne<{ value?: { profileId?: string } }>(database, "appMeta", "activeProfileContext:v1");
    const profile = context?.value?.profileId ? await getOne<{ version: number }>(database, "profiles", context.value.profileId) : undefined;
    database.close();
    return profile ?? { version: -1 };
  });
}

async function readCommittedProfile(page: Page) {
  return page.evaluate(async () => {
    const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const getOne = <T>(database: IDBDatabase, storeName: string, key: IDBValidKey) => new Promise<T | undefined>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
    const database = await openDatabase();
    const context = await getOne<{ value?: { profileId?: string } }>(database, "appMeta", "activeProfileContext:v1");
    const profile = context?.value?.profileId
      ? await getOne<{ structuredFacts?: Array<{ data?: unknown; provenance?: unknown }>; experiences?: unknown[]; skills?: unknown[] }>(database, "profiles", context.value.profileId)
      : undefined;
    database.close();
    const structured = (profile?.structuredFacts ?? []).map((entry) => JSON.stringify(entry.data ?? entry));
    return { items: [...structured, ...(profile?.experiences ?? []).map(String), ...(profile?.skills ?? []).map(String)], structuredFacts: profile?.structuredFacts ?? [] };
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nativeAsk(message: string) {
  return [
    `event: model_text_delta`, `data: ${JSON.stringify({ type: "model_text_delta", delta: message })}`, "",
    `event: model_finish`, `data: ${JSON.stringify({ type: "model_finish", stopReason: "ask_user" })}`, "", ""
  ].join("\n");
}
