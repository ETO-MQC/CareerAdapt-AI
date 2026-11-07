import { test, expect, type Page } from "@playwright/test";
import { readStore } from "./support/p51CoreWorkflow";
import { mkdir, writeFile } from "node:fs/promises";
import { prepareA2Source } from "./support/ux013A2Fixture";
import type { ResumeBranch } from "@/domain/schemas";

test.use({ trace: "on", screenshot: "only-on-failure" });
const evidenceDir = process.env.UX013_A2_BROWSER_EVIDENCE_DIR ?? "docs/quality/ux-01.3-a2-logs/browser";
async function formal(page: Page) {
  return { profiles: await readStore(page, "profiles"), branches: await readStore(page, "resumeBranches"), revisions: await readStore(page, "resumeRevisions"),
    operations: await readStore(page, "resumeBranchOperations"), appMeta: await readStore(page, "appMeta") };
}
test("UX013 A2 four structured operations reviewed committed and refreshed with durable user source", async ({ page }, info) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  // The direct user-input route exercises production Facade/Gateway without an upstream model call.
  // Any accidental provider request fails the test, instead of falling through to a real configured provider.
  let providerCalls = 0;
  await page.route("**/api/ai/**", route => { providerCalls++; return route.abort(); });
  await page.goto("/setup");
  await page.getByRole("button", { name: "跳过，先体验其他功能" }).click();
  const selected = await prepareA2Source(page);
  const initial = await formal(page);
  const branch = initial.branches.find(b => b.id === selected.branchId) as unknown as ResumeBranch;
  expect(branch).toBeTruthy();
  await page.goto("/ai-workspace"); await page.getByRole("button", { name: "新任务", exact: true }).click();
  const panel = page.getByTestId("structured-resume-editor"); await panel.locator("summary").first().click();
  await mkdir(evidenceDir, { recursive: true });
  const operations = ["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"];
  let factRevisionId = "";
  for (const operation of operations) {
    if (operation !== operations[0]) await panel.getByRole("button", { name: "开始另一项结构化操作", exact: true }).click();
    await panel.getByLabel("结构化修改简历", { exact: true }).selectOption(branch.id);
    await panel.getByLabel("结构化操作", { exact: true }).selectOption(operation);
    const target = panel.getByLabel("结构化修改目标", { exact: true });
    const options = await target.locator("option").allTextContents();
    const index = operation === "fact_correction" ? options.findIndex(t => t.includes("项目名称"))
      : operation === "bullet_removal" ? options.findIndex(t => t.includes("要点 3")) : 1;
    expect(index).toBeGreaterThan(0); await target.selectOption({ index });
    if (operation === "fact_correction") await panel.getByLabel("我的纠正内容", { exact: true }).fill("用户更正的新项目名称");
    if (operation === "bullet_reordering") await panel.getByLabel("要点新顺序", { exact: true }).fill("2,1");
    const before = await formal(page);
    await panel.getByRole("button", { name: "生成结构化审核提案", exact: true }).click();
    await expect(panel.getByRole("region", { name: "结构化修改审核" })).toBeVisible();
    expect((await formal(page)).revisions).toEqual(before.revisions);
    await page.reload(); await panel.locator("summary").first().click();
    await expect(panel.getByRole("region", { name: "结构化修改审核" })).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 900 });
    const confirm = panel.getByRole("button", { name: "确认结构化修改", exact: true });
    await expect(confirm).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${operation}-review-1024.png`), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: info.outputPath(`${operation}-review-wide.png`), fullPage: true });
    await confirm.click();
    await expect(panel.getByText(/已保存版本：/)).toBeVisible();
    const after = await formal(page), changed = after.branches.find(b => b.id === branch.id) as unknown as ResumeBranch;
    const revisionId = changed.currentRevisionId!;
    if (operation === "fact_correction") factRevisionId = revisionId;
    expect(after.profiles).toEqual(before.profiles);
    expect(after.branches.filter(b => b.id !== branch.id)).toEqual(before.branches.filter(b => b.id !== branch.id));
    expect(after.revisions).toHaveLength(before.revisions.length + 1);
    expect(after.revisions.filter(r => r.id !== revisionId)).toEqual(before.revisions);
    const original = (before.branches.find(b => b.id === branch.id) as unknown as ResumeBranch), expected = structuredClone(original);
    const project = expected.structuredContentItems!.find(i => i.data.sectionType === "project")!;
    if (operation === "confirmed_skill_addition") {
      expect(changed.structuredContentItems!.slice(0, -1)).toEqual(expected.structuredContentItems);
      expect(changed.contentItems.slice(0, -1)).toEqual(expected.contentItems);
    } else {
      const next = changed.structuredContentItems!.find(i => i.id === project.id)!;
      expect(changed.structuredContentItems!.filter(i => i.id !== project.id)).toEqual(expected.structuredContentItems!.filter(i => i.id !== project.id));
      expect(changed.contentItems.filter(i => i.id !== project.id)).toEqual(expected.contentItems.filter(i => i.id !== project.id));
      expect(next.data).toEqual({ ...project.data, ...(operation === "fact_correction" ? { title: "用户更正的新项目名称" }
        : { highlights: operation === "bullet_removal" ? ["执行接口测试。", "SQL 查询验证。"] : ["SQL 查询验证。", "执行接口测试。"] }) });
      expect(next.factRefs).toEqual(project.factRefs);
    }
    expect(changed).toEqual({ ...original, structuredContentItems: changed.structuredContentItems, contentItems: changed.contentItems,
      revision: original.revision + 1, currentRevisionId: revisionId, updatedAt: changed.updatedAt });
    const receipt = after.operations.find(r => r.revisionId === revisionId); expect(receipt).toBeTruthy();
    await page.reload(); await panel.locator("summary").first().click();
    await expect(panel.getByText(`已保存版本：${revisionId}`, { exact: true })).toBeVisible();
    expect((await formal(page)).revisions).toEqual(after.revisions);
    await writeFile(`${evidenceDir}/${operation}.json`, JSON.stringify({ before, after, receipt }, null, 2));
    if (operation === "confirmed_skill_addition") {
      await panel.getByRole("button", { name: "开始另一项结构化操作", exact: true }).click();
      await panel.getByLabel("结构化修改简历", { exact: true }).selectOption(branch.id);
      await panel.getByLabel("结构化操作", { exact: true }).selectOption("confirmed_skill_addition");
      const existingSkill = panel.getByLabel("结构化修改目标", { exact: true }).locator("option").filter({ hasText: "SQL（已存在）" });
      await expect(existingSkill).toHaveAttribute("disabled", "");
      await expect(existingSkill).toHaveJSProperty("disabled", true);
      // A reload restores the saved authoritative outcome; no new task has been selected or committed.
      await page.reload(); await panel.locator("summary").first().click();
    }
  }
  // The first correction remains traceable after three subsequent tasks replaced its TaskState proposal.
  await page.goto(`/resume?branchId=${encodeURIComponent(branch.id)}`);
  await page.locator("details.toolbar-more > summary").click();
  await page.getByText("查询版本操作来源", { exact: true }).click();
  await page.getByLabel("历史版本来源", { exact: true }).selectOption(factRevisionId);
  const historical = page.getByTestId("precise-revision-evidence"); await historical.locator("summary").click();
  await expect(historical.getByText("原始纠正声明：用户更正的新项目名称", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("historical-source.png"), fullPage: true });
  expect((await formal(page)).profiles).toEqual(initial.profiles);
  expect(providerCalls).toBe(0);
  await writeFile(`${evidenceDir}/summary.json`, JSON.stringify({ operations, factRevisionId, providerCalls, final: await formal(page) }, null, 2));
});
