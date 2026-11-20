// @vitest-environment node
import { expect, test } from "vitest";
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createResumeJsonV2Example } from "@/domain/resumeImport/jsonV2Adapter";
import { projectResumePresentationItem } from "@/domain/resumePresentation/projector";
import { ResumePresentationConfigSchema, ResumeRenderModelSchema, type ResumeItemV2 } from "@/domain/schemas";
import { precisionAttrs } from "@/components/resume/templates/precisionStyles";
import { getResumeTemplate, resumeTemplateStyleVars } from "@/components/resume/templates/templateRegistry";
import { createResumePaginationPlan, paginateResumeRenderModel, type ResumePaginationMeasurement } from "@/services/export/pagination";

test("long research titles and continuation pages stay visible", async () => {
  const templateId = "campus-reference";
  const skillLayout = "inline" as const;
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  const resume = createResumeJsonV2Example();
  const sections = resume.sections.map(section => {
    const expanded = section.items.flatMap<ResumeItemV2>(item => item.sectionType === "skills"
      ? Array.from({ length: 18 }, (_, index) => ({ ...item, id: `skill-${index + 1}`, name: `技术工具${index + 1}`, description: index < 3 ? undefined : "数据处理和分析工作中的可验证实践" }))
      : item.sectionType === "certificates" ? [...Array.from({ length: 3 }, (_, index) => ({ ...item, id: `short-cert-${index + 1}`, name: `证书${index + 1}`, issuer: undefined, issuedAt: undefined, expiresAt: undefined, credentialId: undefined, status: undefined, description: undefined })), item]
      : item.sectionType === "research" ? [{ ...item, title: "《复杂数据价值评估：基于机器学习的非线性分析框架》", authorRole: "第一作者", highlights: Array.from({ length: 6 }, (_, index) => `研究成果${index + 1}：开展分析和数据核验，记录指标并形成可复核研究报告。`.repeat(2)) }]
      : item.sectionType === "project" ? [{ ...item, highlights: Array.from({ length: 12 }, (_, index) => `项目成果${index + 1}：完成数据分析、结果核对与业务交付，形成完整记录。`) }] : [item]);
    return { sectionId: section.id, sectionType: section.sectionType, title: section.title, order: section.order,
      items: expanded.map(item => ({ sectionId: section.id, sectionType: section.sectionType, itemId: item.id, data: item, plainText: item.id, presentation: projectResumePresentationItem(item) })) };
  });
  const model = ResumeRenderModelSchema.parse({ schemaVersion: "resume-render-v2", branchId: "test", branchRevision: 1, branchCurrentRevisionId: "rev", branchName: "test", jobTitle: "岗位", company: "通用", candidate: { name: "示例同学", contacts: [] }, sections: [], structuredSections: sections, compatibilityWarnings: [], safety: { ruleOnlyItemIds: [], visibleItemCount: sections.reduce((n, section) => n + section.items.length, 0), excludedItemIds: [] }, sourceTrace: { profileId: "profile", currentRevisionId: "rev", sourceProfileVersion: 1 } });
  const config = ResumePresentationConfigSchema.parse({ schemaVersion: "resume-presentation-v1", branchId: "test", templateId, contentRevision: { branchRevision: 1, currentRevisionId: "rev" }, presentationRevision: 0, updatedAt: "2026-11-20T00:00:00.000Z", typography: { chineseFont: "system_sans", englishFont: "system_sans", bodyTextScale: "normal", titleTextScale: "normal", lineHeight: "tight" }, spacing: { pageMargin: "narrow", sectionGap: "tight", itemGap: "tight" }, precision: { fontSizePx: 14.8, skillLayout, entryStyle: "inline", sectionGapPx: 10, lineHeight: 1.56 }, theme: { primaryColor: "blue", accentColor: "blue", dividerColor: "blue", density: "compact" } });
  const template = getResumeTemplate(templateId);
  const css = readFileSync("src/app/globals.css", "utf8");
  const markup = (content: React.ReactNode) => renderToStaticMarkup(React.createElement("article", { className: `resume-a4-page ${template.className}`, style: resumeTemplateStyleVars(template, config), ...precisionAttrs(config) }, content));
  const wrap = (content: string) => `<style>${css}\n*,::before,::after{box-sizing:border-box;border-width:0;border-style:solid}h1,h2,h3,p,ul,ol{margin:0}body{margin:0}.resume-a4-page{box-shadow:none;break-after:page}</style>${content}`;
  await page.setContent(wrap(markup(template.render(model, { presentationConfig: config, measurement: true }))));
  await page.evaluate(() => document.fonts.ready);
  const measurement = await page.locator("article.resume-a4-page").evaluate((element): ResumePaginationMeasurement => {
    const pageElement = element as HTMLElement; const pageBox = pageElement.getBoundingClientRect();
    const sectionNodes = [...pageElement.querySelectorAll<HTMLElement>("[data-render-section]")];
    const sections = sectionNodes.map(section => { const rect = section.getBoundingClientRect(); return { sectionType: section.dataset.renderSection!, sectionId: section.dataset.renderSectionId, top: rect.top - pageBox.top, bottom: rect.bottom - pageBox.top, height: rect.height, blockIds: [...section.querySelectorAll<HTMLElement>("[data-pagination-item-id]")].map(el => el.dataset.paginationItemId!) }; });
    const blocks = [...pageElement.querySelectorAll<HTMLElement>("[data-pagination-item-id]")].map(el => { const rect = el.getBoundingClientRect(); const section = el.closest<HTMLElement>("[data-render-section]")!; const units = el.matches("[data-pagination-unit]") ? [el] : [...el.querySelectorAll<HTMLElement>("[data-pagination-unit]")]; return { sourceItemId: el.dataset.paginationItemId!, sectionType: section.dataset.renderSection!, sectionId: section.dataset.renderSectionId, top: rect.top - pageBox.top, bottom: rect.bottom - pageBox.top, height: rect.height, inlineRow: el.dataset.paginationInline === "true", units: units.map(unit => { const box = unit.getBoundingClientRect(); return { key: unit.dataset.paginationUnit!, top: box.top - pageBox.top, bottom: box.bottom - pageBox.top, height: box.height }; }) }; });
    return { scrollHeight: pageElement.scrollHeight, clientHeight: pageElement.clientHeight, paddingTop: parseFloat(getComputedStyle(pageElement).paddingTop), paddingBottom: parseFloat(getComputedStyle(pageElement).paddingBottom), sections, blocks: blocks.sort((a,b) => a.top - b.top) } as ResumePaginationMeasurement;
  });
  const plan = createResumePaginationPlan({ measurement, paginationConfig: config.pagination });
  const pages = paginateResumeRenderModel(model, plan);
  expect(pages.length).toBeGreaterThan(1);
  await page.setContent(wrap(pages.map((m, i) => markup(template.render(m, { presentationConfig: config, pagination: { pageNumber: i + 1, pageCount: pages.length, isContinuation: i > 0 } }))).join("")));
  const titleLines = await page.locator('[data-render-section="research"] h3').first().evaluate(el => ({ height: el.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(el).lineHeight) }));
  expect(titleLines.height).toBeLessThanOrEqual(titleLines.lineHeight + 1);
  const headingGeometry = await page.locator('[data-render-section="research"] .resume-presentation-heading').first().evaluate(el => {
    const title = el.querySelector("h3")!.getBoundingClientRect();
    const role = el.querySelector("strong")!.getBoundingClientRect();
    const date = el.querySelector("time")!.getBoundingClientRect();
    return { titleRight: title.right, roleLeft: role.left, roleCenter: (role.left + role.right) / 2, dateLeft: date.left };
  });
  expect(headingGeometry.titleRight).toBeLessThanOrEqual(headingGeometry.roleLeft);
  expect(Math.abs(headingGeometry.roleCenter - (headingGeometry.titleRight + headingGeometry.dateLeft) / 2)).toBeLessThan(1);
  const clipped = await page.locator("article.resume-a4-page").evaluateAll(pages => pages.flatMap(p => { const boundary = p.getBoundingClientRect(); return [...p.querySelectorAll<HTMLElement>('[data-pagination-unit]')].filter(el => { const b = el.getBoundingClientRect(); return b.bottom > boundary.bottom + 2 || b.right > boundary.right + 2; }).map(el => el.textContent); }));
  expect(clipped).toEqual([]);
  const markers = await page.locator('[data-render-section="education"] li').evaluateAll(items => items.slice(0, 3).map(item => ({ left: item.getBoundingClientRect().left, color: getComputedStyle(item, "::marker").color, size: getComputedStyle(item, "::marker").fontSize })));
  expect(markers).toHaveLength(3);
  expect(new Set(markers.map(marker => `${marker.left}:${marker.color}:${marker.size}`)).size).toBe(1);
  const firstSkills = await page.locator('[data-pagination-item-id^="skill-"]').evaluateAll(items => items.slice(0, 2).map(item => item.getBoundingClientRect().top));
  expect(firstSkills).toHaveLength(2);
  if (skillLayout === "inline") expect(Math.abs(firstSkills[0] - firstSkills[1])).toBeLessThan(1);
  else expect(firstSkills[1]).toBeGreaterThan(firstSkills[0]);
  const firstCertificates = await page.locator('[data-pagination-item-id^="short-cert-"]').evaluateAll(items => items.slice(0, 2).map(item => item.getBoundingClientRect().top));
  expect(firstCertificates).toHaveLength(2);
  if (skillLayout === "inline") expect(Math.abs(firstCertificates[0] - firstCertificates[1])).toBeLessThan(1);
  else expect(firstCertificates[1]).toBeGreaterThan(firstCertificates[0]);
  await page.locator("article.resume-a4-page").first().screenshot({ path: `.tmp/research-layout-after.png` });
  const text = await page.locator("body").innerText();
  for (const value of ["示例大学", "3.8/4", "5/120", "统计建模", "技术工具1", "技术工具18", "项目成果12", "EXAMPLE-001"]) expect(text).toContain(value);
  const pdfPath = `.tmp/research-layout-after.pdf`;
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
  const pdfInfo = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  expect(Number(/Pages:\s+(\d+)/.exec(pdfInfo)?.[1])).toBe(pages.length);
  const pdfText = execFileSync("pdftotext", ["-enc", "UTF-8", pdfPath, "-"], { encoding: "utf8" }).replace(/\s+/gu, "");
  for (const value of ["示例大学", "3.8/4", "5/120", "统计建模", "技术工具1", "技术工具18", "项目成果12", "EXAMPLE-001"]) expect(pdfText).toContain(value);
  } finally { await browser.close(); }
}, 45000);

test("entry headings preserve explicit author line breaks", async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
    const css = readFileSync("src/app/globals.css", "utf8");
    await page.setContent(`<style>${css}</style><div class="resume-a4-page template-campus-reference" data-precision-entry="inline"><div class="resume-presentation-heading"><h3>第一行\n第二行</h3><strong>第一作者</strong><time>2025</time></div></div>`);
    const heading = await page.locator("h3").evaluate(el => ({ text: el.textContent, whiteSpace: getComputedStyle(el).whiteSpace, height: el.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(el).lineHeight) }));
    expect(heading.text).toBe("第一行\n第二行");
    expect(heading.whiteSpace).toBe("pre-line");
    expect(heading.height).toBeGreaterThan(heading.lineHeight * 1.8);
  } finally { await browser.close(); }
}, 30000);
