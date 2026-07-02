import { expect, test } from "@playwright/test";

/**
 * D1 验证测试 — 覆盖完整的分支隔离、Fact Guard 阻止、版本恢复/撤销、
 * 刷新持久化、legacy 只读场景。
 *
 * 此文件仅用于本地验证，不提交到 git。
 */

// ── helpers ──────────────────────────────────────────────────────────

/** 在 /jobs 为当前选中岗位创建一个 C2 草稿（C1 + C2 流水线） */
async function createC2DraftForSelectedJob(page: import("@playwright/test").Page) {
  await page.locator("button").filter({ hasText: "C1" }).first().click();
  await expect(page.locator(".match-row").first()).toBeVisible();
  await page.locator("button").filter({ hasText: "C2" }).first().click();
  await expect(page.locator(".notice")).toContainText("C2");
}

/** 切换 JD 列表中的岗位（index 0 或 1） */
async function selectJobByIndex(page: import("@playwright/test").Page, index: number) {
  await page.locator("label").filter({ hasText: "D1" }).locator("select").selectOption({ index });
}

/** 向 IndexedDB 注入一个 legacy_unverified 占位分支 */
async function injectLegacyBranch(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(["resumeBranches", "resumeRevisions"], "readwrite");
        const branchStore = tx.objectStore("resumeBranches");
        const revisionStore = tx.objectStore("resumeRevisions");

        const now = new Date().toISOString();
        const branchId = "legacy-branch-e2e";
        const revisionId = "legacy-rev-0";
        const profileId = "profile-demo-student";

        const legacyBranch = {
          id: branchId,
          profileId,
          jobId: "job-legacy-e2e",
          name: "旧版占位分支",
          sourceProfileVersion: 1,
          sourceJobVersion: "v1-legacy",
          sourceAdaptationDraftId: "legacy-draft",
          sourceDraftRevision: 0,
          matcherVersion: "v0",
          sourceMatchSetHash: "legacy-hash-e2e",
          requirementMatchIds: ["legacy-match"],
          revision: 0,
          currentRevisionId: revisionId,
          lifecycleStatus: "active",
          migrationStatus: "legacy_unverified",
          syncStatusCache: {
            status: "in_sync",
            sourceProfileVersion: 1,
            currentProfileVersion: 1,
            sourceJobVersion: "v1-legacy",
            currentJobVersion: "v1-legacy",
            invalidFactRefs: [],
            checkedAt: now,
            message: "legacy placeholder"
          },
          contentItems: [
            {
              id: "legacy-item-1",
              itemType: "structural",
              source: "legacy",
              text: "旧版简历内容",
              originalText: "旧版简历内容",
              order: 0,
              visible: true,
              requirementIds: [],
              sourceSuggestionIds: [],
              factRefs: [],
              guardMode: "not_fact",
              guardStatus: "pass",
              guardRiskLevel: "low",
              guardFindings: [],
              guardedAt: now,
              guardVersion: "v0"
            }
          ],
          legacyPayload: { raw: "legacy data" },
          createdAt: now,
          updatedAt: now
        };

        const legacyRevision = {
          id: revisionId,
          branchId,
          revisionNumber: 0,
          source: "created",
          operationId: "legacy-op",
          previousRevisionId: null,
          restoredFromRevisionId: null,
          snapshot: {
            name: "旧版占位分支",
            lifecycleStatus: "active",
            contentItems: legacyBranch.contentItems
          },
          createdAt: now,
          updatedAt: now
        };

        branchStore.put(legacyBranch);
        revisionStore.put(legacyRevision);

        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}

// ── test suite ───────────────────────────────────────────────────────

test.describe("D1 验证：分支隔离、Fact Guard、版本历史、持久化、legacy 只读", () => {
  test("完整 D1 验证流程", async ({ page }) => {
    // ================================================================
    // 0.  前置：在 /jobs 分别为两个岗位运行 C1 + C2，产生两份草稿
    // ================================================================
    await page.goto("/jobs");
    await expect(page.locator("main")).toBeVisible();

    // 岗位 A → C2 草稿 0
    await createC2DraftForSelectedJob(page);

    // 切换到岗位 B → C2 草稿 1
    await selectJobByIndex(page, 1);
    await createC2DraftForSelectedJob(page);

    // ================================================================
    // 1.  从两份草稿分别创建两个分支
    // ================================================================
    await page.goto("/resume");
    await expect(page.getByRole("heading", { name: /.+/ }).first()).toBeVisible();

    // 选择草稿 0 → 创建 Branch A
    await page.locator("label").filter({ hasText: "C2" }).locator("select").selectOption({ index: 0 });
    await page.locator("article.panel").first().locator("input").fill("D1 验证分支 A");
    await page.locator("article.panel").first().locator("button.primary-button").click();
    await expect(
      page.locator(".branch-list .match-row").filter({ hasText: "D1 验证分支 A" })
    ).toBeVisible();

    // 选择草稿 1 → 创建 Branch B
    await page.locator("label").filter({ hasText: "C2" }).locator("select").selectOption({ index: 1 });
    await page.locator("article.panel").first().locator("input").fill("D1 验证分支 B");
    await page.locator("article.panel").first().locator("button.primary-button").click();
    await expect(
      page.locator(".branch-list .match-row").filter({ hasText: "D1 验证分支 B" })
    ).toBeVisible();

    // 两个分支共存
    await expect(page.locator(".branch-list .match-row")).toHaveCount(2);

    // ================================================================
    // 2.  修改分支 A，确认分支 B 不受影响
    // ================================================================
    await page.locator(".branch-list .match-row").filter({ hasText: "D1 验证分支 A" }).click();

    const branchATextarea = page.locator(".branch-editor textarea").first();
    const originalAText = await branchATextarea.inputValue();
    // 正常追加一个标点（规则 guard 允许的改动）
    const editedAText = `${originalAText}。`;
    await branchATextarea.fill(editedAText);
    await page.locator(".branch-editor .suggestion-card").first().locator("button.primary-button").click();

    // 验证 Fact Guard 通过且 revision 升级
    await expect(page.locator(".notice")).toContainText("已保存");
    await expect(page.locator(".revision-list .review-row").filter({ hasText: "revision 1" })).toBeVisible();

    // 切到 Branch B，确认内容未被污染
    await page.locator(".branch-list .match-row").filter({ hasText: "D1 验证分支 B" }).click();
    const branchBTextarea = page.locator(".branch-editor textarea").first();
    const branchBText = await branchBTextarea.inputValue();
    expect(branchBText).not.toBe(editedAText);

    // ================================================================
    // 3.  手动添加未被证据支持的数字或技能 → Fact Guard 阻止保存
    // ================================================================
    await page.locator(".branch-list .match-row").filter({ hasText: "D1 验证分支 A" }).click();

    // 写入包含新数字（30%）的文本，这不在 originalText 或 evidenceText 中
    const unverifiedText = `${originalAText}，项目效率提升了30%`;
    await branchATextarea.fill(unverifiedText);
    await page.locator(".branch-editor .suggestion-card").first().locator("button.primary-button").click();

    // 验证 Fact Guard 阻止了保存
    await expect(page.locator(".notice")).toContainText("保存失败");

    // 也尝试注入一个新技能词
    await branchATextarea.fill(`${originalAText}，熟练使用 Python 进行数据分析`);
    await page.locator(".branch-editor .suggestion-card").first().locator("button.primary-button").click();
    await expect(page.locator(".notice")).toContainText("保存失败");

    // ================================================================
    // 4.  正常修改后，测试恢复旧版本和撤销恢复
    // ================================================================
    // 当前 Branch A 已经有 revision 0（创建）和 revision 1（editedAText）。
    // 再做一次合法编辑以产生 revision 2。追加一个句号（与 editedAText 不同）。
    const branchATextarea2 = page.locator(".branch-editor textarea").first();
    const editedAText2 = `${originalAText}。。`;
    await branchATextarea2.fill(editedAText2);
    await page.locator(".branch-editor .suggestion-card").first().locator("button.primary-button").click();
    await expect(page.locator(".notice")).toContainText("已保存");

    // 恢复到 revision 0（原始文本）
    const rev0Row = page.locator(".revision-list .review-row").filter({ hasText: "revision 0" });
    await expect(rev0Row).toBeVisible();
    await rev0Row.locator("button").click();
    await expect(page.locator(".notice")).toContainText("已恢复旧版本");

    // 验证文本已回退到原始值
    const restoredTextarea = page.locator(".branch-editor textarea").first();
    await expect(restoredTextarea).toHaveValue(originalAText);

    // 撤销恢复（回到编辑后的版本 editedAText2）
    await page.locator("section.panel").filter({ hasText: "D1 验证分支 A" })
      .locator(".section-heading .action-row button")
      .filter({ hasText: "撤销" }).click();
    await expect(page.locator(".notice")).toContainText("撤销");

    // 验证撤销后文本恢复为 editedAText2
    const undoTextarea = page.locator(".branch-editor textarea").first();
    await expect(undoTextarea).toHaveValue(editedAText2);

    // ================================================================
    // 5.  刷新页面，确认分支和版本历史仍存在
    // ================================================================
    await page.reload();
    await expect(page.getByRole("heading", { name: /.+/ }).first()).toBeVisible();

    // 两个分支仍在
    await expect(page.locator(".branch-list .match-row")).toHaveCount(2);
    await expect(
      page.locator(".branch-list .match-row").filter({ hasText: "D1 验证分支 A" })
    ).toBeVisible();
    await expect(
      page.locator(".branch-list .match-row").filter({ hasText: "D1 验证分支 B" })
    ).toBeVisible();

    // 选中 Branch A 后，版本历史仍然可见
    await page.locator(".branch-list .match-row").filter({ hasText: "D1 验证分支 A" }).click();
    await expect(page.locator(".revision-list .review-row").first()).toBeVisible();
    // 至少有 3 个 revision（创建、编辑1、undo-as-restore）
    const revisionRows = page.locator(".revision-list .review-row");
    await expect(revisionRows.first()).toBeVisible();
    const revisionCount = await revisionRows.count();
    expect(revisionCount).toBeGreaterThanOrEqual(3);

    // ================================================================
    // 6.  legacy_unverified 旧分支不能编辑
    // ================================================================
    // 向 IndexedDB 注入一个 legacy 占位分支
    await injectLegacyBranch(page);
    await page.reload();
    await expect(page.getByRole("heading", { name: /.+/ }).first()).toBeVisible();

    // 应该能看到三个分支（A、B、legacy）
    await expect(
      page.locator(".branch-list .match-row").filter({ hasText: "旧版占位分支" })
    ).toBeVisible();

    // 选中 legacy 分支
    await page.locator(".branch-list .match-row").filter({ hasText: "旧版占位分支" }).click();

    // 验证显示只读警告
    await expect(page.getByText("旧占位分支", { exact: false })).toBeVisible();

    // textarea 应该被 disabled
    const legacyTextarea = page.locator(".branch-editor textarea").first();
    await expect(legacyTextarea).toBeDisabled();

    // 保存按钮应被 disabled
    const legacySaveBtn = page.locator(".branch-editor .suggestion-card").first().locator("button.primary-button");
    await expect(legacySaveBtn).toBeDisabled();

    // 撤销按钮应被 disabled
    const legacyUndoBtn = page.locator("section.panel").filter({ hasText: "旧版占位分支" })
      .locator(".section-heading .action-row button").filter({ hasText: "撤销" });
    await expect(legacyUndoBtn).toBeDisabled();

    // 恢复按钮应被 disabled
    const legacyRestoreBtn = page.locator(".revision-list .review-row").first().locator("button");
    await expect(legacyRestoreBtn).toBeDisabled();
  });
});
