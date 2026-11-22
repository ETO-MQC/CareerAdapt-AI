import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { openManualPageTab } from "./support/g7b2Ui";
import { readStore } from "./support/p51CoreWorkflow";

test("P522 formal multi-page PDF preserves anonymous revision content and page boundaries", async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.goto("/resume");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  await skip.click();
  await page.goto("/resume");
  const before = new Set((await readStore(page, "resumeBranches")).map((branch) => branch.id));
  await page.getByRole("button", { name: /导入已有简历/ }).click();
  const dialog = page.getByRole("dialog", { name: "导入简历" });
  await dialog.getByText("粘贴 JSON", { exact: true }).click();
  const names = Array.from({ length: 10 }, (_, index) => `匿名项目${String(index + 1).padStart(2, "0")}`);
  const projects = names.map((title, index) => ({ id: `p522-project-${index}`, sectionType: "project", title,
    role: "项目成员", startDate: "2024-01", endDate: "2024-06", current: false, tools: [], outcomes: [], customFields: [],
    highlights: [1, 2, 3, 4].map((n) => `${title}记录${n}：参与需求梳理、资料整理、流程核对和结果复核，按步骤记录工作内容并整理项目材料。`) }));
  await dialog.getByLabel("JSON 内容").fill(JSON.stringify({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN",
    basics: { name: "匿名分页候选人", email: "anonymous@example.org", portfolioLinks: [], otherLinks: [], customFields: [] },
    sections: [
      { id: "education", sectionType: "education", title: "教育经历", order: 0, visible: true, items: [{ id: "p522-education", sectionType: "education", school: "匿名大学", major: "信息管理", degree: "本科", startDate: "2020-09", endDate: "2024-06", current: false, courses: [], honors: [], highlights: [], customFields: [] }] },
      { id: "project", sectionType: "project", title: "项目经历", order: 1, visible: true, items: projects },
      { id: "skills", sectionType: "skills", title: "专业技能", order: 2, visible: true, items: [{ id: "p522-skill", sectionType: "skills", name: "Excel", description: "使用 Excel 整理表格。", customFields: [] }] },
      { id: "certificates", sectionType: "certificates", title: "证书", order: 3, visible: true, items: [{ id: "p522-cert", sectionType: "certificates", name: "匿名能力证书", issuer: "示例机构", issuedAt: "2023-01", customFields: [] }] }
    ], unclassifiedBlocks: [] }));
  await dialog.getByRole("button", { name: "导入 JSON", exact: true }).click();
  await dialog.locator("label.import-target-option").filter({ hasText: "创建新人物" }).click();
  for (let i = 0; i < 160 && await dialog.getByRole("button", { name: "确认此字段", exact: true }).count(); i++) await dialog.getByRole("button", { name: "确认此字段", exact: true }).first().click();
  for (let i = 0; i < 160 && await dialog.getByRole("button", { name: "核对并保留来源", exact: true }).count(); i++) await dialog.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
  await dialog.locator(".import-review-footer button.primary-button").click();
  const open = page.getByRole("button", { name: "打开", exact: true });
  if (await open.isVisible()) await open.click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  const branch = (await readStore(page, "resumeBranches")).find((value) => !before.has(value.id) && value.branchPurpose === "general")!;
  expect(branch?.currentRevisionId).toBeTruthy();
  await openManualPageTab(page);
  await expect.poll(() => page.getByTestId("resume-a4-page").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  const preview = page.getByTestId("resume-a4-page");
  const previewCount = await preview.count();
  const normalized = (value: string) => value.replace(/\s+/gu, "");
  const previewPages = (await preview.allInnerTexts()).map(normalized);
  const previewText = previewPages.join("");
  for (const text of ["匿名大学", "信息管理", "Excel", "匿名能力证书", ...names]) expect(previewText).toContain(normalized(text));
  const request = page.waitForRequest((value) => value.url().includes("/api/resume-export/pdf") && value.method() === "POST");
  const response = page.waitForResponse((value) => value.url().includes("/api/resume-export/pdf") && value.request().method() === "POST");
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ snapshot: { branchId: branch.id, currentRevisionId: branch.currentRevisionId } });
  expect((await response).status()).toBe(200);
  const path = info.outputPath("anonymous-multipage.pdf");
  await (await download).saveAs(path);
  const root = "E:/Pycharm/Lib/poppler/Library/bin";
  const bin = (name: string) => existsSync(`${root}/${name}.exe`) ? `${root}/${name}.exe` : name;
  const pdfinfo = execFileSync(bin("pdfinfo"), [path], { encoding: "utf8" });
  expect(Number(pdfinfo.match(/^Pages:\s+(\d+)/mu)?.[1])).toBe(previewCount);
  expect(pdfinfo).toContain("A4");
  const pdfPages = execFileSync(bin("pdftotext"), [path, "-"], { encoding: "utf8" }).split("\f").filter((part) => part.trim()).map(normalized);
  expect(pdfPages).toHaveLength(previewCount);
  const pdfText = pdfPages.join("");
  for (const text of ["匿名大学", "信息管理", "Excel", "匿名能力证书", ...names]) expect(pdfText).toContain(normalized(text));
  const positions = names.map((name) => pdfText.indexOf(normalized(name)));
  expect(positions.every((value, index) => value >= 0 && (index === 0 || value > positions[index - 1]))).toBe(true);
  for (const project of projects) for (const text of project.highlights) {
    expect(previewText).toContain(normalized(text));
    expect(pdfText).toContain(normalized(text));
    const marker = normalized(text.split("：")[0]);
    expect(pdfPages.findIndex((part) => part.includes(marker))).toBe(previewPages.findIndex((part) => part.includes(marker)));
  }
  const boxes = execFileSync(bin("pdftotext"), ["-bbox", path, "-"], { encoding: "utf8" });
  const pages = [...boxes.matchAll(/<page\s+width="([\d.]+)"\s+height="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/gu)];
  expect(pages).toHaveLength(previewCount);
  for (const [, width, height, body] of pages) {
    const words = [...body.matchAll(/<word\s+xMin="([\d.]+)"\s+yMin="([\d.]+)"\s+xMax="([\d.]+)"\s+yMax="([\d.]+)"/gu)];
    expect(words.length).toBeGreaterThan(0);
    for (const [, left, top, right, bottom] of words) {
      expect(Number(left)).toBeGreaterThanOrEqual(0); expect(Number(top)).toBeGreaterThanOrEqual(0);
      expect(Number(right)).toBeLessThanOrEqual(Number(width)); expect(Number(bottom)).toBeLessThanOrEqual(Number(height));
    }
  }
});
