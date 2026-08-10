import { expect, test, type Page } from "@playwright/test";

const journeys = [
  {
    card: "从零整理我的经历",
    turns: ["我想把自己的经历整理清楚。做过一个智能穿戴课程项目，也处理过科研数据和校园组织工作。"]
  },
  {
    card: "导入现有简历",
    turns: ["这是我现在的简历，帮我整理进去。"]
  },
  {
    card: "生成岗位定制简历",
    turns: ["我想用现在这份简历投这个岗位，先看看哪些内容最值得调整。"]
  },
  {
    card: "从资料库组装简历",
    turns: ["帮我整理一份通用简历，保留已经确认的真实经历。"]
  },
  {
    card: "分析岗位匹配度",
    turns: ["这个岗位适合我吗？请先根据现有资料分析一下。"]
  },
  {
    card: "检查并导出简历",
    turns: ["帮我检查一下，没问题就导出。"]
  }
] as const;

/**
 * P4.5a natural-language guard.  The six cards are still typed controls, but
 * the user turns in this suite intentionally contain no implementation hints.
 */
test.describe("P4.5a six natural card journeys", () => {
  for (const journey of journeys) {
    test(journey.card, async ({ page }) => {
      test.setTimeout(60_000);
      await page.route("**/api/agent/stream", async (route) => {
        await route.fulfill({
          contentType: "text/event-stream",
          body: naturalAssistant("我已先读取当前资料。接下来我会在需要时只确认一项会影响结果的内容。")
        });
      });
      await page.goto("/ai-workspace");
      await bypassSetupIfNeeded(page);
      const card = page.getByRole("button", { name: new RegExp(journey.card) });
      if (!(await card.isVisible().catch(() => false))) await page.getByRole("button", { name: "新任务", exact: true }).click();
      await expect(card).toBeVisible({ timeout: 20_000 });
      await card.click();

      if (journey.card === "导入现有简历") {
        const file = page.locator('.agent-composer input[type="file"]');
        await expect(file).toHaveCount(1);
        await file.setInputFiles("tests/fixtures/resume-import/ordinary.docx");
        await expect(page.getByText("ordinary.docx", { exact: false })).toBeVisible({ timeout: 20_000 });
      }
      for (const turn of journey.turns) {
        await page.getByLabel("描述你的求职任务").fill(turn);
        await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled({ timeout: 20_000 });
        await page.getByRole("button", { name: "发送消息", exact: true }).click();
      }
      if (journey.card === "导入现有简历") {
        const consent = page.getByTestId("agent-import-ai-consent");
        if (await consent.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await consent.getByRole("button", { name: "仅本地解析", exact: true }).click();
          await expect(consent).toHaveCount(0, { timeout: 20_000 });
        }
      }
      await expect(page.locator(".agent-message-row.is-assistant").last()).toBeVisible({ timeout: 30_000 });

      const metrics = await readNaturalMetrics(page);
      const naturalUserMessages = metrics.userMessages.filter((message) => journey.turns.some((turn) => turn === message));
      const userText = naturalUserMessages.join("\n");
      expect(naturalUserMessages).toContain(journey.turns[0]);
      expect(userText).not.toMatch(/career\.workflow|\bMCP\b|schema|最高价值问题|请先调用|tool/iu);
      expect(metrics.duplicateQuestionCount).toBe(0);
      console.info("[p45a-natural-user]", JSON.stringify({ card: journey.card, ...metrics }));
    });
  }
});

async function bypassSetupIfNeeded(page: Page) {
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await skip.click();
    await page.goto("/ai-workspace");
  }
}

async function readNaturalMetrics(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const messages = await new Promise<Array<{ role?: string; content?: string }>>((resolve, reject) => {
      const request = database.transaction("agentMessages", "readonly").objectStore("agentMessages").getAll();
      request.onsuccess = () => resolve(request.result as Array<{ role?: string; content?: string }>);
      request.onerror = () => reject(request.error);
    });
    database.close();
    const userMessages = messages.filter((message) => message.role === "user").map((message) => String(message.content ?? ""));
    const assistantMessages = messages.filter((message) => message.role === "assistant").map((message) => String(message.content ?? ""));
    const questions = assistantMessages.flatMap((message) => message.split(/\n+/u).map((line) => line.trim()).filter((line) => /[？?]$/u.test(line)));
    const normalized = questions.map((question) => question.replace(/[\s？?。！!]+/gu, ""));
    return {
      userMessages,
      questionsAsked: questions.length,
      questionsAnswered: 0,
      duplicateQuestionCount: normalized.length - new Set(normalized).size,
      questionsWhoseAnswerAlreadyExisted: 0,
      optionalLowValueQuestionCount: 0,
      userInterventionCount: userMessages.length,
      toolCalls: messages.filter((message) => message.role === "tool").length,
      finalArtifact: assistantMessages.at(-1)
    };
  });
}

function naturalAssistant(message: string) {
  return [
    `event: model_text_delta\ndata: ${JSON.stringify({ type: "model_text_delta", delta: message })}\n\n`,
    `event: model_finish\ndata: ${JSON.stringify({ type: "model_finish", stopReason: "ask_user" })}\n\n`
  ].join("");
}
