import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { ResumePdfExportSnapshot } from "@/domain/schemas";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
const captureDir = resolve("artifacts/sidebar-finish", process.env.SIDEBAR_CAPTURE_PHASE ?? "after");
test("sidebar fixed viewport reference captures", async ({ page }) => {
 test.setTimeout(120_000); mkdirSync(captureDir, { recursive: true });
 await page.addInitScript(() => localStorage.setItem("careeradapt.theme", "light"));
 await importCanonicalFixture(page);
 await dismissNotifications(page);
 const fields=page.getByTestId("resume-active-section-fields");
 for(const width of [1920,1366,1024]) {
  await page.setViewportSize({width,height:width===1920?1080:768});
  await fields.getByRole("button",{name:"收起全部",exact:true}).click();
  await fields.evaluate(node=>node.scrollTop=0);
  await page.screenshot({path:resolve(captureDir,`${width}-collapsed.png`)});
  await fields.getByRole("button",{name:"展开全部",exact:true}).click();
  await fields.evaluate(node=>node.scrollTop=0);
  await page.screenshot({path:resolve(captureDir,`${width}-expanded.png`)});
  if (process.env.SIDEBAR_CAPTURE_PHASE !== "before") {
    const education = page.locator('[data-section-key="education"]');
    await education.evaluate(node => node.scrollIntoView({block:"start"}));
    await page.screenshot({path:resolve(captureDir,`${width}-education-expanded.png`)});
    const work = page.locator('[data-section-key="work"]');
    await work.evaluate(node => node.scrollIntoView({block:"start"}));
    await page.screenshot({path:resolve(captureDir,`${width}-work-expanded.png`)});
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2)).toBe(true);
    expect(await fields.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  }
 }
});
async function importCanonicalFixture(page: Page) {
  await page.addInitScript(() => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "test", apiKeyConfigured: true })));
  await page.goto("/resume");
  await page.getByRole("button", { name: /^导入已有简历/ }).click();
  await page.getByTestId("resume-import-dock").locator("summary").filter({ hasText: /^粘贴 JSON$/ }).click();
  await page.locator(".import-json-details textarea").fill(JSON.stringify(canonicalFixture()));
  await page.locator(".import-json-details button.primary-button").click();
  await page.getByLabel("创建新人物").check();
  while (await page.getByRole("button", { name: "确认字段映射", exact: true }).count()) {
    await page.getByRole("button", { name: "确认字段映射", exact: true }).first().click();
  }
  while (await page.getByRole("button", { name: "核对并保留来源", exact: true }).count()) {
    await page.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
  }
  await expect(page.getByRole("button", { name: "确认导入", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  const openButton = page.getByRole("button", { name: "打开", exact: true });
  if (await openButton.isVisible()) await openButton.click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
}

function canonicalFixture() {
  const base = { schemaVersion: "careeradapt-resume-v2", locale: "zh-CN", basics: { name: "演示候选人", targetRole: "软件工程师", phone: "13800000000", email: "candidate@example.com", location: "示例城市", portfolioLinks: [], otherLinks: [], customFields: [] }, unclassifiedBlocks: [] };
  const common = { customFields: [] };
  return { ...base, sections: [
    { id: "summary", sectionType: "summary", title: "自我评价", order: 0, visible: true, items: [{ ...common, id: "summary-1", sectionType: "summary", text: "关注可靠工程交付。" }] },
    { id: "education", sectionType: "education", title: "教育经历", order: 1, visible: true, items: [{ ...common, id: "education-1", sectionType: "education", school: "示例大学", degree: "本科", major: "计算机科学", location: "示例城市", startDate: "2024-09", endDate: "2028-06", current: false, courses: [], honors: [], highlights: ["教育亮点"] }] },
    { id: "work", sectionType: "work", title: "工作经历", order: 2, visible: true, items: ["一", "二"].map((suffix, index) => ({ ...common, id: `work-${index + 1}`, sectionType: "work", organization: `工作条目${suffix}`, role: "工程师", location: "示例城市", startDate: `202${index + 3}-01`, current: true, highlights: [`工作亮点${suffix}`] })) },
    { id: "project", sectionType: "project", title: "项目经历", order: 3, visible: true, items: ["一", "二", "三", "四"].map((suffix, index) => ({ ...common, id: `project-${index + 1}`, sectionType: "project", title: `项目${suffix}/版本—${index + 1}`, role: "项目角色", organization: "示例团队", location: "示例城市", startDate: `2025-0${index + 1}`, current: true, url: `https://example.com/project-${index + 1}`, tools: ["React", "TypeScript"], highlights: [`项目亮点${suffix}`, `项目成果${suffix}`], outcomes: [] })) },
    { id: "awards", sectionType: "awards", title: "奖项荣誉", order: 4, visible: true, items: ["一", "二"].map((suffix, index) => ({ ...common, id: `award-${index + 1}`, sectionType: "awards", name: `奖项${suffix}`, issuer: "示例机构", awardedAt: `2025-0${index + 3}` })) },
    { id: "skills", sectionType: "skills", title: "专业技能", order: 5, visible: true, items: ["AI 与模型", "工程开发", "测试工具", "数据分析", "产品设计", "协作工具"].map((category, index) => ({ ...common, id: `skill-${index + 1}`, sectionType: "skills", name: `技能${index + 1}`, category, ...(index === 0 ? { level: "熟练", description: "使用 Kotlin 完成 Android 开发。" } : {}) })) },
    { id: "languages", sectionType: "languages", title: "语言能力", order: 6, visible: true, items: [{ ...common, id: "language-1", sectionType: "languages", language: "中文母语，英语四级备考中" }] }
  ] };
}

async function dismissNotifications(page: Page) {
  while (await page.getByRole("button", { name: /^关闭通知/ }).count()) await page.getByRole("button", { name: /^关闭通知/ }).first().click();
}

test("nested section editing, visibility, local styles and real empty-section creation", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({width:1366,height:768});
  await importCanonicalFixture(page); await dismissNotifications(page);
  const fields=page.getByTestId("resume-active-section-fields");
  const education=page.locator('[data-section-key="education"]');
  const work=page.locator('[data-section-key="work"]');
  await fields.getByRole("button",{name:"收起全部",exact:true}).click();
  await expect(education.locator('.sidebar-section-body')).toBeHidden();
  await education.getByRole("button",{name:"教育经历",exact:true}).click();
  await expect(education.getByLabel("学校名称", {exact:false}).first()).toHaveValue("示例大学");
  await work.getByRole("button",{name:"工作经历",exact:true}).click();
  await expect(education.getByLabel("学校名称", {exact:false}).first()).toBeVisible();
  await expect(work.locator('.sidebar-item-card')).toHaveCount(2);
  await expect(work.getByLabel("学校名称", {exact:false})).toHaveCount(0);
  await work.locator('.sidebar-section-header').hover();
  await expect(work.locator('.sidebar-section-tools')).toHaveCSS("opacity","1");
  await work.getByRole("button",{name:"隐藏板块：工作经历",exact:true}).click();
  const measure=page.getByTestId("resume-pagination-measurement-page");
  await expect(measure.locator('[data-render-section="work"]')).toHaveCount(0);
  await expect(work.locator('.sidebar-item-card')).toHaveCount(2);
  await work.locator('.sidebar-section-header').hover();
  await work.getByRole("button",{name:"显示板块：工作经历",exact:true}).click();
  await expect(measure.locator('[data-render-section="work"]')).toHaveCount(1);
  await education.getByRole("button",{name:"跟随全局设置",exact:true}).click();
  await education.getByRole("textbox",{name:"教育经历独立标题"}).fill("学习与教育");
  await education.getByRole("button",{name:"应用标题设置",exact:true}).click();
  await expect(measure.locator('[data-render-section="education"] h2')).toHaveText("学习与教育");
  await education.getByRole("button",{name:"本板块独立设置",exact:true}).click();
  await education.locator('.sidebar-style-popover').getByRole("button",{name:"跟随全局设置",exact:true}).click();
  await expect(measure.locator('[data-render-section="education"] h2')).toHaveText("教育经历");
  await page.locator('.sidebar-add-card').getByRole("button",{name:/科研经历/}).click();
  const research=page.locator('[data-section-key="research"]');
  await expect(research.getByText("暂无科研经历",{exact:true})).toBeVisible();
  await research.getByRole("button",{name:"＋ 添加科研经历",exact:true}).click();
  await research.getByLabel("研究题目",{exact:true}).fill("匿名研究项目");
  await research.getByLabel("研究机构",{exact:true}).fill("示例实验室");
  await research.getByRole("button",{name:"保存并确认",exact:true}).click();
  await expect(measure).toContainText("匿名研究项目");
  await expect(research.locator('.sidebar-item-card')).toHaveCount(1);
  await page.reload();
  await page.locator('[data-section-key="research"]').getByRole("button",{name:"科研经历",exact:true}).click();
  await expect(page.locator('[data-section-key="research"]').getByLabel("研究题目",{exact:true})).toHaveValue("匿名研究项目");
});


async function businessSnapshot(page: Page) {
  return page.evaluate(async () => {
    const database=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open("CareerAdaptDb");request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try { const names=["profiles","resumeBranches","resumeRevisions","resumeBranchOperations"]; const tx=database.transaction(names,"readonly");return await Promise.all(names.map(name=>new Promise<unknown[]>((resolve,reject)=>{const request=tx.objectStore(name).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}))); }
    finally {database.close();}
  });
}

test("section and item sorting respect ownership, undo redo and formal PDF without content revisions", async ({page})=>{
  test.setTimeout(120_000);
  await importCanonicalFixture(page); await dismissNotifications(page);
  const baseline=await businessSnapshot(page);
  const work=page.locator('[data-section-key="work"]');
  const project=page.locator('[data-section-key="project"]');
  const education=page.locator('[data-section-key="education"]');
  const measure=page.getByTestId("resume-pagination-measurement-page");
  await work.getByRole("button",{name:"工作经历",exact:true}).click();
  for (const summary of await work.locator('.accordion-item > summary').all()) await summary.click();
  await work.locator('.sidebar-item-grip').first().dragTo(work.locator('.sidebar-item-grip').nth(1));
  const workText=()=>measure.locator('[data-render-section="work"]').textContent();
  await expect.poll(async()=>{const text=await workText()??"";return text.indexOf("工作条目二")<text.indexOf("工作条目一");}).toBe(true);
  await page.getByRole("button",{name:"撤销",exact:true}).click();
  await expect.poll(async()=>{const text=await workText()??"";return text.indexOf("工作条目一")<text.indexOf("工作条目二");}).toBe(true);
  await page.getByRole("button",{name:"重做",exact:true}).click();
  await expect.poll(async()=>{const text=await workText()??"";return text.indexOf("工作条目二")<text.indexOf("工作条目一");}).toBe(true);
  await project.getByRole("button",{name:"项目经历",exact:true}).click();
  const beforeCross=await workText();
  for (const summary of await project.locator('.accordion-item > summary').all()) await summary.click();
  await project.locator('.sidebar-item-grip').first().dragTo(work.locator('.sidebar-item-grip').first());
  await expect.poll(workText).toBe(beforeCross);
  const keys=()=>page.locator('.sidebar-section-card:not(.sidebar-personal-card)').evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).dataset.sectionKey));
  await education.locator('.content-drag-handle').press("Alt+ArrowDown");
  await expect.poll(async()=>{const order=await keys();return order.indexOf("work")<order.indexOf("education");}).toBe(true);
  await page.getByRole("button",{name:"撤销",exact:true}).click();
  await expect.poll(async()=>{const order=await keys();return order.indexOf("education")<order.indexOf("work");}).toBe(true);
  await page.getByRole("button",{name:"重做",exact:true}).click();
  await expect.poll(async()=>{const order=await keys();return order.indexOf("work")<order.indexOf("education");}).toBe(true);
  expect(await businessSnapshot(page)).toEqual(baseline);
  await page.reload();
  await expect.poll(async()=>{const text=await workText()??"";return text.indexOf("工作条目二")<text.indexOf("工作条目一");}).toBe(true);
  let snapshot:ResumePdfExportSnapshot|undefined;
  page.on("request",request=>{if(request.url().includes("/api/resume-export/pdf")) snapshot=request.postDataJSON().snapshot;});
  const responsePromise=page.waitForResponse(response=>response.url().includes("/api/resume-export/pdf")&&response.request().method()==="POST");
  const downloadPromise=page.waitForEvent("download",{timeout:120_000});
  await page.getByRole("button",{name:"下载 PDF",exact:true}).click();
  const [response,download]=await Promise.all([responsePromise,downloadPromise]); expect(response.status()).toBe(200);
  const order=snapshot!.presentation.canonicalSectionOrder!;expect(order.indexOf("work")).toBeLessThan(order.indexOf("education"));
  const pdfPath=resolve("artifacts/sidebar-finish/section-item-order.pdf");await download.saveAs(pdfPath);
  const pdfToText=["E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe","C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"].find(existsSync)??"pdftotext";
  const text=execFileSync(pdfToText,[pdfPath,"-"],{encoding:"utf8"});expect(text.indexOf("工作条目二")).toBeLessThan(text.indexOf("工作条目一"));expect(text.indexOf("工作条目一")).toBeLessThan(text.indexOf("示例大学"));
});

test("section deletion is one content revision and undo restores structured entries",async({page})=>{
 test.setTimeout(90_000);await importCanonicalFixture(page);await dismissNotifications(page);
 await page.locator('[data-section-key="education"] .content-drag-handle').press("Alt+ArrowDown");
 await expect.poll(async()=>{const keys=await page.locator('.sidebar-section-card').evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).dataset.sectionKey));return keys.indexOf("work")<keys.indexOf("education");}).toBe(true);
 const before=await businessSnapshot(page);
 const work=page.locator('[data-section-key="work"]');
 await work.locator('.sidebar-section-header').hover();
 page.once("dialog",dialog=>dialog.accept());
 await work.getByRole("button",{name:"删除板块内容：工作经历",exact:true}).click();
 await expect(work.getByText("0 个条目",{exact:true})).toBeVisible();
 const after=await businessSnapshot(page);expect(after[0]).toEqual(before[0]);expect(after[2].length).toBe(before[2].length+1);
 await page.getByRole("button",{name:"撤销",exact:true}).click();
 await expect(work.getByText("2 个条目",{exact:true})).toBeVisible();
 await work.getByRole("button",{name:"工作经历",exact:true}).click();
 await expect(work.locator('.sidebar-item-card')).toHaveCount(2);
 await expect(page.getByTestId("resume-pagination-measurement-page")).toContainText("工作条目一");
 await page.locator(".toolbar-more > summary").click();
 await expect(page.getByText(/历史版本（/)).toBeVisible();
 await expect(page.getByRole("button",{name:/恢复版本/}).first()).toBeVisible();
 await page.getByRole("button",{name:/^恢复版本 2 /}).click();
 await expect(work.getByText("0 个条目",{exact:true})).toBeVisible();
 await page.locator(".toolbar-more > summary").click();
 await page.getByRole("button",{name:"撤销",exact:true}).click();
 await expect(work.getByText("2 个条目",{exact:true})).toBeVisible();
});


test("nested sidebar keeps unsaved canonical fields in both themes and accents",async({page})=>{
 test.setTimeout(90_000);await importCanonicalFixture(page);await dismissNotifications(page);
 await page.setViewportSize({width:1366,height:768});
 for(const theme of ["light","dark"]) for(const accent of ["green","burgundy"]) {
   await page.evaluate(({theme,accent})=>{localStorage.setItem("careeradapt.theme",theme);localStorage.setItem("careeradapt.appAccent",accent);},{theme,accent});
   await page.reload();
   await expect(page.locator("html")).toHaveAttribute("data-theme",theme);await expect(page.locator("html")).toHaveAttribute("data-app-accent",accent);
   const skills=page.locator('[data-section-key="skills"]');
   await skills.getByRole("button",{name:"专业技能",exact:true}).click();
   const name=skills.getByLabel("技能名称",{exact:true}).first();
   await name.fill("未保存的技能草稿");
   await skills.locator('.sidebar-section-header').hover();
   await skills.getByRole("button",{name:"隐藏板块：专业技能",exact:true}).click();
   await expect(name).toHaveValue("未保存的技能草稿");
   await skills.locator('.sidebar-section-header').hover();await skills.getByRole("button",{name:"显示板块：专业技能",exact:true}).click();
   await skills.getByRole("button",{name:"展开或收起专业技能",exact:true}).click();
   await skills.getByRole("button",{name:"专业技能",exact:true}).click();await expect(name).toHaveValue("未保存的技能草稿");
   await skills.evaluate(node=>node.scrollIntoView({block:"start"}));
   await dismissNotifications(page);await page.screenshot({path:resolve("artifacts/sidebar-finish/after",`1366-${theme}-${accent}.png`)});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await expect(page.getByTestId("resume-pagination-measurement-page")).not.toContainText("未保存的技能草稿");
 }
});


test("certificate and training creation validate real schemas and survive reload",async({page})=>{
 test.setTimeout(90_000);await importCanonicalFixture(page);await dismissNotifications(page);
 const before=await businessSnapshot(page);
 await page.locator('.sidebar-add-card').getByRole("button",{name:/证书/}).click();
 const certificates=page.locator('[data-section-key="certificates"]');
 await certificates.getByRole("button",{name:"＋ 添加证书",exact:true}).click();
 await certificates.getByRole("button",{name:"保存并确认",exact:true}).click();
 await expect(certificates.getByRole("alert")).toContainText("证书名称");
 await certificates.getByLabel("证书名称",{exact:true}).fill("示例认证");
 await certificates.getByLabel("颁发方",{exact:true}).fill("示例协会");
 await certificates.getByLabel("颁发日期",{exact:true}).fill("2025-06");
 await certificates.getByRole("button",{name:"保存并确认",exact:true}).click();
 const measure=page.getByTestId("resume-pagination-measurement-page");
 await expect(measure).toContainText("示例认证");
 await page.locator('.sidebar-add-card').getByRole("button",{name:/培训经历/}).click();
 const training=page.locator('[data-section-key="training"]');
 await training.getByRole("button",{name:"＋ 添加培训经历",exact:true}).click();
 await training.getByLabel("培训机构",{exact:true}).fill("示例培训机构");
 await training.getByLabel("培训项目",{exact:true}).fill("工程实践课程");
 await training.getByLabel("开始日期",{exact:true}).fill("2025-07");
 await training.getByLabel("结束日期",{exact:true}).fill("2025-08");
 await training.getByRole("button",{name:"保存并确认",exact:true}).click();
 await expect(measure).toContainText("工程实践课程");
 const after=await businessSnapshot(page);expect(after[0]).toEqual(before[0]);expect(after[2].length).toBe(before[2].length+2);
 await page.reload();
 await certificates.getByRole("button",{name:"证书",exact:true}).click();await expect(certificates.getByLabel("证书名称",{exact:true})).toHaveValue("示例认证");
 await training.getByRole("button",{name:"培训经历",exact:true}).click();await expect(training.getByLabel("培训机构",{exact:true})).toHaveValue("示例培训机构");await expect(training.getByLabel("结束日期",{exact:true})).toHaveValue("2025-08");
});


test("manual section order wins over campus and two-column template defaults in preview and PDF",async({page})=>{
 test.setTimeout(180_000);await page.setViewportSize({width:1920,height:1080});await importCanonicalFixture(page);await dismissNotifications(page);
 await page.locator('[data-section-key="education"] .content-drag-handle').press("Alt+ArrowDown");
 const measure=page.getByTestId("resume-pagination-measurement-page");
 const order=()=>measure.locator('[data-render-section-id]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute("data-render-section-id")));
 const expected=["summary","work","education","project","awards","skills","languages"];
 await expect.poll(order).toEqual(expected);
 const settings=page.getByTestId("resume-layout-inspector");
 for(const templateId of ["campus-reference","campus-clean","professional-classic","business-consulting","modern-operations","ats-minimal","classic-technical"]){
   await settings.getByRole("tab",{name:"模板",exact:true}).click();await settings.getByRole("button",{name:"模板中心",exact:true}).click();
   await page.getByTestId(`template-card-${templateId}`).getByRole("button",{name:/应用模板/}).click();
   await expect(page.getByTestId(`template-card-${templateId}`)).toHaveAttribute("aria-current","true");
   await page.getByRole("button",{name:"关闭模板中心",exact:true}).click();
   await expect.poll(order).toEqual(expected);
   if(templateId==="campus-reference") await expect(measure.locator('[data-render-section="languages"] h2')).toHaveText("语言能力");
   if(["modern-operations","business-consulting"].includes(templateId)) await expect(measure.locator('.resume-user-section-flow')).toHaveCSS("grid-template-columns",/^[0-9.]+px$/);
   if(["campus-reference","modern-operations"].includes(templateId)){
     let snapshot:ResumePdfExportSnapshot|undefined;const capture=(request:import("@playwright/test").Request)=>{if(request.url().includes("/api/resume-export/pdf")) snapshot=request.postDataJSON().snapshot;};page.on("request",capture);
     const responsePromise=page.waitForResponse(response=>response.url().includes("/api/resume-export/pdf")&&response.request().method()==="POST");const downloadPromise=page.waitForEvent("download",{timeout:120_000});
     await page.getByRole("button",{name:"下载 PDF",exact:true}).click();const [response,download]=await Promise.all([responsePromise,downloadPromise]);expect(response.status()).toBe(200);
     expect(snapshot!.presentation.canonicalSectionOrder?.indexOf("work")).toBeLessThan(snapshot!.presentation.canonicalSectionOrder!.indexOf("education"));
     const file=resolve("artifacts/sidebar-finish",`${templateId}-manual-order.pdf`);await download.saveAs(file);
     const converter=["E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe","C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"].find(existsSync)??"pdftotext";const text=execFileSync(converter,[file,"-"],{encoding:"utf8"});
     expect(text.indexOf("关注可靠工程交付")).toBeLessThan(text.indexOf("工作条目一"));expect(text.indexOf("工作条目一")).toBeLessThan(text.indexOf("示例大学"));
     await dismissNotifications(page);await page.screenshot({path:resolve("artifacts/sidebar-finish/after",`${templateId}-manual-order.png`)});page.off("request",capture);
   }
 }
 await page.reload();await expect.poll(order).toEqual(expected);
});
