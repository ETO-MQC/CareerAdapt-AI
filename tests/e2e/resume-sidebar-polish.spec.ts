import { AgentSessionSchema } from "@/agent/contracts/agentSession";
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
const output=resolve("artifacts/sidebar-polish");
async function dismiss(page:Page){while(await page.getByRole("button",{name:/^关闭通知/}).count())await page.getByRole("button",{name:/^关闭通知/}).first().click();}

test("paragraph rows, repeat-click collapse, field formatting and calendar persist into formal PDF",async({page})=>{
 test.setTimeout(150_000);mkdirSync(output,{recursive:true});await page.setViewportSize({width:1366,height:768});
 await page.addInitScript(()=>localStorage.setItem("careeradapt.theme","light"));await importCanonicalFixture(page);await dismiss(page);
 const work=page.locator('[data-section-key="work"]');
 const title=work.getByRole("button",{name:"工作经历",exact:true});
 await title.click();await expect(work.locator('.sidebar-section-body')).toBeVisible();
 await title.click();await expect(work.locator('.sidebar-section-body')).toBeHidden();
 await title.click();
 const item=work.locator('.sidebar-item-card').first();
 const list=item.getByLabel("描述逐条编辑",{exact:true});
 await expect(list.locator('textarea')).toHaveCount(3);
 await expect(list.locator('textarea').nth(1)).toHaveValue("协助流程登记");
 const row=list.locator('.string-list-row').first();await row.locator('textarea').focus();
 await row.getByRole("button",{name:"加粗：描述第1条",exact:true}).click();
 await row.getByRole("button",{name:"斜体：描述第1条",exact:true}).click();
 await row.getByRole("button",{name:"下划线：描述第1条",exact:true}).click();
 const measure=page.getByTestId("resume-pagination-measurement-page");
 const styled=measure.locator('[data-render-section="work"] [data-field-format="true"]').filter({hasText:"完成台账核对"});
 await expect(styled).toHaveCSS("font-weight","700");await expect(styled).toHaveCSS("font-style","italic");await expect(styled).toHaveCSS("text-decoration-line","underline");
 await row.locator("textarea").hover();await page.screenshot({path:resolve(output,"1366-field-floating-tools.png")});
 await row.getByRole("button",{name:"隐藏字段：描述第1条",exact:true}).click();await expect(measure).not.toContainText("完成台账核对");
 await row.getByRole("button",{name:"显示字段：描述第1条",exact:true}).click();await expect(measure).toContainText("完成台账核对");
 await list.locator('.string-list-grip').nth(2).dragTo(list.locator('.string-list-grip').nth(1));
 await expect(list.locator('textarea').nth(1)).toHaveValue("归档项目记录");
 await list.locator('.string-list-grip').first().press("Alt+ArrowDown");
 await expect(list.locator('textarea').first()).toHaveValue("归档项目记录");
 await list.locator('.string-list-grip').nth(1).press("Alt+ArrowUp");
 await expect(list.locator('textarea').nth(1)).toHaveValue("归档项目记录");
 await list.getByRole("button",{name:"＋ 添加描述",exact:true}).click();
 await list.locator('.string-list-row').nth(3).getByRole("button",{name:"删除字段内容：描述第4条",exact:true}).click();
 await expect(list.locator('textarea')).toHaveCount(3);
 await list.getByRole("button",{name:"＋ 添加描述",exact:true}).click();
 await list.locator('textarea').nth(3).fill("整理学习笔记");
 await dismiss(page);
 await item.getByRole("button",{name:"选择开始日期",exact:true}).click();
 const calendar=item.getByRole("dialog",{name:"开始日期日历",exact:true});
 await calendar.getByRole("spinbutton",{name:"开始日期年份",exact:true}).fill("2022");
 await calendar.getByRole("combobox",{name:"开始日期月份",exact:true}).selectOption("5");
 const calendarBounds=await calendar.boundingBox();const paneBounds=await item.boundingBox();expect(calendarBounds!.x).toBeGreaterThanOrEqual(paneBounds!.x);expect(calendarBounds!.x+calendarBounds!.width).toBeLessThanOrEqual(paneBounds!.x+paneBounds!.width);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await page.screenshot({path:resolve(output,"1366-calendar.png")});
 await calendar.getByRole("button",{name:"2022-06-15",exact:true}).click();
 await expect(item.getByLabel("开始日期",{exact:true})).toHaveValue("2022-06-15");
 await item.getByLabel("开始日期",{exact:true}).fill("2022-06");
 await item.getByRole("button",{name:"保存",exact:true}).click();
 await expect.poll(async()=>await page.getByRole("button",{name:"仅保存到简历",exact:true}).isVisible() || (await measure.textContent()??"").includes("整理学习笔记")).toBe(true);
 if(await page.getByRole("button",{name:"仅保存到简历",exact:true}).isVisible()) await page.getByRole("button",{name:"仅保存到简历",exact:true}).click();
 await expect(measure).toContainText("整理学习笔记");
 await dismiss(page);await item.evaluate(node=>node.scrollIntoView({block:"start"}));await page.screenshot({path:resolve(output,"1366-paragraph-tools.png")});
 await page.reload();await title.click();
 await expect(list.locator('textarea')).toHaveCount(4);
 await expect(list.locator('textarea').nth(1)).toHaveValue("归档项目记录");await expect(styled).toHaveCSS("font-weight","700");
 let requestBody:Record<string,unknown>|undefined;page.on("request",request=>{if(request.url().includes("/api/resume-export/pdf"))requestBody=request.postDataJSON();});
 const responsePromise=page.waitForResponse(response=>response.url().includes("/api/resume-export/pdf")&&response.request().method()==="POST");const downloadPromise=page.waitForEvent("download",{timeout:120_000});
 await page.getByRole("button",{name:"下载 PDF",exact:true}).click();const [response,download]=await Promise.all([responsePromise,downloadPromise]);expect(response.status()).toBe(200);
 expect(JSON.stringify(requestBody)).toContain("fieldAppearances");
 const file=resolve(output,"field-format.pdf");await download.saveAs(file);
 const converter=["E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe","C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"].find(existsSync)??"pdftotext";
 const text=execFileSync(converter,[file,"-"],{encoding:"utf8"});for(const value of ["完成台账核对","整理学习笔记","归档项目记录"])expect(text).toContain(value);
});
test("polished panel spacing, hover feedback and fixed viewports",async({page})=>{
 test.setTimeout(90_000);mkdirSync(output,{recursive:true});await page.addInitScript(()=>localStorage.setItem("careeradapt.theme","light"));await importCanonicalFixture(page);await dismiss(page);
 const settings=page.getByTestId("resume-layout-inspector");const fields=page.getByTestId("resume-active-section-fields");
 for(const width of [1920,1366,1024]){
   await page.setViewportSize({width,height:width===1920?1080:768});await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
   if(!await settings.isVisible())await page.getByRole("button",{name:"排版设置",exact:true}).click();
   for(const tab of ["排版","样式","页面","模板"]){
     await settings.getByRole("tab",{name:tab,exact:true}).click();await expect(settings.getByRole("tab",{name:tab,exact:true})).toHaveAttribute("aria-selected","true");
     await page.screenshot({path:resolve(output,`${width}-${tab}.png`)});
   }
   await settings.getByRole("tab",{name:"排版",exact:true}).click();
   const group=settings.locator('.precision-group').first();await page.mouse.move(1,1);const before=await group.evaluate(node=>getComputedStyle(node).boxShadow);
   await group.hover();await expect.poll(()=>group.evaluate(node=>getComputedStyle(node).boxShadow)).not.toBe(before);
   await expect(group).toHaveCSS("row-gap","10px");
   await page.screenshot({path:resolve(output,`${width}-inspector-hover.png`)});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   if(width===1024)await settings.getByRole("button",{name:"返回预览",exact:true}).click();
   const workTitle=fields.getByRole("button",{name:"工作经历",exact:true});if(await workTitle.getAttribute("aria-expanded")!=="true")await workTitle.click();
   await page.locator('[data-section-key="work"] .sidebar-item-card').first().evaluate(node=>node.scrollIntoView({block:"start"}));
   await page.screenshot({path:resolve(output,`${width}-paragraphs.png`)});
   expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+2)).toBe(true);
 }
});
async function importCanonicalFixture(page: Page) {
  await page.addInitScript(() => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "test", apiKeyConfigured: true })));
  await page.goto("/resume");
  await page.getByRole("button", { name: /^导入已有简历/ }).click();
  await page.getByTestId("resume-import-dock").locator("summary").filter({ hasText: /^粘贴 JSON$/ }).click();
  await page.locator(".import-json-details textarea").fill(JSON.stringify(polishFixture()));
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
function polishFixture() {
  const base = { schemaVersion: "careeradapt-resume-v2", locale: "zh-CN", basics: { name: "演示候选人", targetRole: "软件工程师", phone: "13800000000", email: "candidate@example.com", location: "示例城市", portfolioLinks: [], otherLinks: [], customFields: [] }, unclassifiedBlocks: [] };
  const common = { customFields: [] };
  return { ...base, sections: [
    { id: "summary", sectionType: "summary", title: "自我评价", order: 0, visible: true, items: [{ ...common, id: "summary-1", sectionType: "summary", text: "关注可靠工程交付。" }] },
    { id: "education", sectionType: "education", title: "教育经历", order: 1, visible: true, items: [{ ...common, id: "education-1", sectionType: "education", school: "示例大学", degree: "本科", major: "计算机科学", location: "示例城市", startDate: "2024-09", endDate: "2028-06", current: false, courses: [], honors: [], highlights: ["教育亮点"] }] },
    { id: "work", sectionType: "work", title: "工作经历", order: 2, visible: true, items: ["一", "二"].map((suffix, index) => ({ ...common, id: `work-${index + 1}`, sectionType: "work", organization: `工作条目${suffix}`, role: "工程师", location: "示例城市", startDate: `202${index + 3}-01`, current: true, highlights: index === 0 ? ["完成台账核对", "协助流程登记", "归档项目记录"] : [`工作亮点${suffix}`] })) },
    { id: "project", sectionType: "project", title: "项目经历", order: 3, visible: true, items: ["一", "二", "三", "四"].map((suffix, index) => ({ ...common, id: `project-${index + 1}`, sectionType: "project", title: `项目${suffix}/版本—${index + 1}`, role: "项目角色", organization: "示例团队", location: "示例城市", startDate: `2025-0${index + 1}`, current: true, url: `https://example.com/project-${index + 1}`, tools: ["React", "TypeScript"], highlights: [`项目亮点${suffix}`, `项目成果${suffix}`], outcomes: [] })) },
    { id: "awards", sectionType: "awards", title: "奖项荣誉", order: 4, visible: true, items: ["一", "二"].map((suffix, index) => ({ ...common, id: `award-${index + 1}`, sectionType: "awards", name: `奖项${suffix}`, issuer: "示例机构", awardedAt: `2025-0${index + 3}` })) },
    { id: "skills", sectionType: "skills", title: "专业技能", order: 5, visible: true, items: ["AI 与模型", "工程开发", "测试工具", "数据分析", "产品设计", "协作工具"].map((category, index) => ({ ...common, id: `skill-${index + 1}`, sectionType: "skills", name: `技能${index + 1}`, category, ...(index === 0 ? { level: "熟练", description: "使用 Kotlin 完成 Android 开发。" } : {}) })) },
    { id: "languages", sectionType: "languages", title: "语言能力", order: 6, visible: true, items: [{ ...common, id: "language-1", sectionType: "languages", language: "中文母语，英语四级备考中" }] }
  ] };
}


test("collapsed navigation shows expansion only and editor uses bottom space", async ({page}) => {
 test.setTimeout(90_000);
 const directory=resolve("artifacts/sidebar-nav-polish");mkdirSync(directory,{recursive:true});
 await page.addInitScript(()=>localStorage.setItem("careeradapt.theme","light"));
 await importCanonicalFixture(page);await dismiss(page);
 // Seed an isolated browser test session; production session writes are unchanged.
 const timestamp=new Date().toISOString();
 const session=AgentSessionSchema.parse({id:"sidebar-visual-session",title:"导航交互验收",messages:[],artifactRefs:[],createdAt:timestamp,updatedAt:timestamp});
 await page.evaluate(async session=>{
   const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open("CareerAdaptDb");request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   await new Promise<void>((resolve,reject)=>{const transaction=db.transaction("agentSessions","readwrite");transaction.objectStore("agentSessions").put(session);transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);});db.close();
   window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));
 },session);
 const sidebar=page.getByRole("complementary",{name:"AI 工作区导航",exact:true});
 const recent=sidebar.locator(".agent-session-item");await expect(recent).toHaveCount(1);
 for(const width of [1920,1366,1024]) {
   await page.setViewportSize({width,height:width===1920?1080:768});
   const expand=sidebar.getByRole("button",{name:"展开 AI 导航",exact:true});await expect(expand).toBeVisible();
   await expect(sidebar.locator(".agent-brand")).toBeHidden();await expect(sidebar.getByLabel("工作区模式",{exact:true})).toBeHidden();
   await recent.hover();await expect(recent.getByRole("button",{name:"归档",exact:true})).toBeHidden();await expect(recent.getByRole("button",{name:"重命名",exact:true})).toBeHidden();
   const shell=page.locator(".resume-studio-shell");
   await expect.poll(async()=>Math.round((await shell.boundingBox())!.y+(await shell.boundingBox())!.height)).toBe(width===1920?1079:767);
   expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
   const buttonBounds=await expand.boundingBox();const sidebarBounds=await sidebar.boundingBox();expect(buttonBounds!.x).toBeGreaterThanOrEqual(sidebarBounds!.x);expect(buttonBounds!.x+buttonBounds!.width).toBeLessThanOrEqual(sidebarBounds!.x+sidebarBounds!.width);
   await page.screenshot({path:resolve(directory,`${width}-collapsed.png`)});
   await expand.click();await expect(sidebar.locator(".agent-brand")).toBeVisible();await expect(sidebar.getByLabel("工作区模式",{exact:true})).toBeVisible();
   await recent.hover();await expect(recent.getByRole("button",{name:"重命名",exact:true})).toBeVisible();
   await page.screenshot({path:resolve(directory,`${width}-expanded.png`)});
   await sidebar.getByRole("button",{name:"收起 AI 导航",exact:true}).click();
 }
});
