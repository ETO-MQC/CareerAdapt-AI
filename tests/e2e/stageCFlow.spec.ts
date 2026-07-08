import { expect, test } from "@playwright/test";

test.describe("Stage C1 evidence matcher flow", () => {
  test("runs rule matching, AI explanation, manual overrides, and stale display", async ({ page }) => {
    await page.route("**/api/ai/structured", async (route) => {
      const body = route.request().postDataJSON() as {
        task: string;
        input: {
          requirement?: { id: string };
          candidates?: Array<{ evidenceRef: unknown }>;
        };
      };

      if (body.task === "evidence-matcher") {
        const evidenceRef = body.input.candidates?.[0]?.evidenceRef;
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            task: "evidence-matcher",
            promptVersion: "evidence-matcher.v1",
            output: {
              evaluations: [
                {
                  requirementId: body.input.requirement?.id,
                  matchLevel: evidenceRef ? "weak" : "none",
                  riskLevel: evidenceRef ? "low" : "medium",
                  risks: evidenceRef ? [] : ["source_missing"],
                  evidenceRefs: evidenceRef ? [evidenceRef] : [],
                  explanation: "E2E 固定 AI 解释，仅用于离线回归。"
                }
              ]
            },
            meta: { provider: "mock", model: "mock-c1", inputLength: 1, outputLength: 1, latencyMs: 1 }
          })
        });
        return;
      }

      await route.continue();
    });

    await page.goto("/jobs");
    await expect(page.locator(".jobs-workspace")).toBeVisible();

    await page.getByTestId("run-experience-match").click();
    await expect(page.locator(".notice")).toBeVisible();
    const matchRows = page.locator(".match-layout .match-list .match-row");
    await expect(matchRows.first()).toBeVisible();

    await page.getByTestId("run-ai-evidence-explanation").click();
    await expect(page.locator(".notice")).toBeVisible({ timeout: 15_000 });

    await matchRows.first().click();
    await page.locator(".manual-override select").nth(0).selectOption("strong");
    await page.locator(".manual-override select").nth(1).selectOption("low");
    await page.locator(".manual-override select").nth(2).selectOption({ index: 1 });
    await page.locator(".manual-override textarea").fill("人工确认该岗位要求可由已确认事实支持。");
    await page.getByRole("button", { name: "保存人工覆盖" }).click();
    await expect(page.getByText("人工覆盖已保存", { exact: false })).toBeVisible();

    await matchRows.nth(1).click();
    await page.locator(".manual-override select").nth(0).selectOption("none");
    await page.locator(".manual-override textarea").fill("当前正式事实中没有足够证据。");
    await page.getByRole("button", { name: "保存人工覆盖" }).click();
    await expect(page.getByText("人工覆盖已保存", { exact: false })).toBeVisible();

    await page.reload();
    await expect(matchRows.first()).toBeVisible();

    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("CareerAdaptDb");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("profiles", "readwrite");
          const store = tx.objectStore("profiles");
          const getRequest = store.get("profile-demo-student");
          getRequest.onerror = () => reject(getRequest.error);
          getRequest.onsuccess = () => {
            const profile = getRequest.result;
            profile.version += 1;
            profile.updatedAt = new Date().toISOString();
            store.put(profile);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    });

    await page.reload();
    await expect(matchRows.first()).toBeVisible();
    await matchRows.first().click();
    await expect(page.locator(".warning-box").first()).toBeVisible();
  });

  test("creates C2 adaptation draft, generates guarded suggestions, edits, accepts, rejects, and undoes", async ({ page }) => {
    await page.route("**/api/ai/structured", async (route) => {
      const body = route.request().postDataJSON() as {
        task: string;
        input: {
          sectionTexts?: Array<{ sectionId: string; text: string; originalText: string }>;
          matches?: Array<{ requirementId: string }>;
          allowedEvidenceRefs?: unknown[];
          checkedText?: string;
          ruleFindings?: unknown[];
        };
      };

      if (body.task === "resume-tailor") {
        const section = body.input.sectionTexts?.[0];
        const match = body.input.matches?.[0];
        const evidenceRef = body.input.allowedEvidenceRefs?.[0];
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            task: "resume-tailor",
            promptVersion: "resume-tailor.v1",
            output: {
              suggestions: [
                {
                  type: "rewrite",
                  targetSectionId: section?.sectionId,
                  originalText: section?.text,
                  suggestedText: section?.text,
                  reason: "保留已确认事实并贴合岗位表达。",
                  requirementIds: [match?.requirementId],
                  usedEvidenceRefs: evidenceRef ? [evidenceRef] : [],
                  riskLevel: "low"
                },
                {
                  type: "rewrite",
                  targetSectionId: section?.sectionId,
                  originalText: section?.text,
                  suggestedText: "主导项目并提升 30%",
                  reason: "用于演示 Fact Guard 阻止新增事实。",
                  requirementIds: [match?.requirementId],
                  usedEvidenceRefs: evidenceRef ? [evidenceRef] : [],
                  riskLevel: "high"
                },
                {
                  type: "follow_up_question",
                  targetSectionId: section?.sectionId,
                  originalText: section?.text,
                  suggestedText: "是否有已确认的量化结果可以补充？",
                  reason: "证据不足时只追问，不编造。",
                  requirementIds: [match?.requirementId],
                  usedEvidenceRefs: [],
                  riskLevel: "medium"
                }
              ]
            },
            meta: { provider: "mock", model: "mock-c2", inputLength: 1, outputLength: 1, latencyMs: 1 }
          })
        });
        return;
      }

      if (body.task === "fact-guard") {
        const checkedText = body.input.checkedText ?? "";
        const blocked = checkedText.includes("提升 30%") || checkedText.includes("主导");
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            task: "fact-guard",
            promptVersion: "fact-guard.v1",
            output: {
              status: blocked ? "blocked_high_risk" : "pass",
              riskLevel: blocked ? "high" : "low",
              findings: body.input.ruleFindings ?? [],
              explanation: blocked ? "检测到新增事实或责任升级。" : "未检测到越界事实。"
            },
            meta: { provider: "mock", model: "mock-c2", inputLength: 1, outputLength: 1, latencyMs: 1 }
          })
        });
        return;
      }

      await route.continue();
    });

    await page.goto("/jobs");
    await expect(page.locator(".jobs-workspace")).toBeVisible();

    await page.getByTestId("run-experience-match").click();
    await expect(page.locator(".notice")).toBeVisible();

    await page.getByTestId("create-suggestion-draft").click();
    await expect(page.locator(".notice")).toBeVisible();
    await page.getByTestId("generate-ai-suggestions").click();
    await expect(page.locator(".notice")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".suggestion-card")).toHaveCount(3);

    await page.locator(".suggestion-card").first().getByRole("button", { name: "接受" }).click();
    await expect(page.getByText("建议已接受", { exact: false })).toBeVisible();

    const blockedCard = page.locator(".suggestion-card").filter({ hasText: "blocked_high_risk" }).first();
    await expect(blockedCard).toBeVisible();
    await blockedCard.locator("textarea").fill("使用 Stata 完成数据清洗。");
    await blockedCard.getByRole("button", { name: "编辑后检测" }).click();
    await expect(page.locator(".notice")).toBeVisible();
    await page.locator(".suggestion-card").filter({ hasText: "edited_guarded" }).getByRole("button", { name: "接受" }).click();
    await expect(page.getByText("建议已接受", { exact: false })).toBeVisible();

    await page.locator(".suggestion-card").filter({ hasText: "follow_up_question" }).getByRole("button", { name: "拒绝" }).click();
    await expect(page.getByText("建议已拒绝", { exact: false })).toBeVisible();

    await page.locator(".suggestion-card").first().getByRole("button", { name: "撤销" }).click();
    await expect(page.getByText("已撤销该建议", { exact: false })).toBeVisible();
  });
});
