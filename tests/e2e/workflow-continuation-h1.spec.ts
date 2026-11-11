import { expect, test } from "@playwright/test";
import { readStore, installCoreWritingProvider } from "./support/p51CoreWorkflow";

test("H1 bundled Hermes analyze/save/compose/confirm/fit/refresh", async ({ page }, info) => {
 test.setTimeout(240_000);
 page.setDefaultTimeout(15000);

 await page.goto("/setup");
 await expect.poll(async () => (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot?.apiReady, { timeout: 90_000 }).toBe(true);
 await page.getByLabel("API 密钥", { exact: true }).fill(process.env.HERMES_INTEGRATION_PROVIDER_KEY!);
 await page.getByLabel("API 地址", { exact: true }).fill(process.env.HERMES_INTEGRATION_PROVIDER_URL!);
 await page.getByLabel("模型名称", { exact: true }).fill("careeradapt-test");
 await page.getByRole("button", { name: "开始使用", exact: true }).click();
 await expect(page).not.toHaveURL(/\/setup$/u, {timeout:30000});
 await page.goto("/resume");
 await page.getByRole("button", { name: "导入资料", exact: false }).click();
 const dialog = page.getByRole("dialog", { name: "导入资料", exact: true });
 await dialog.getByLabel("识别方式").selectOption("local");
 const material={schemaVersion:"careeradapt-resume-v2",locale:"zh-CN",basics:{name:"H1合成人物",portfolioLinks:[],otherLinks:[],customFields:[]},sections:[
  {id:"project",sectionType:"project",title:"项目经历",order:0,visible:true,items:[{id:"h1-project",sectionType:"project",title:"AI应用项目",role:"项目成员",description:"参与 AI 应用项目的需求梳理、原型设计和功能验收。",highlights:["参与 AI 应用项目的需求梳理、原型设计和功能验收。"],tools:[],outcomes:[],customFields:[]}]},
  {id:"internship",sectionType:"internship",title:"实习经历",order:1,visible:true,items:[{id:"h1-internship",sectionType:"internship",organization:"合成公司",role:"开发实习生",highlights:["参与产品测试与缺陷记录。"],tools:[],outcomes:[],customFields:[]}]}
 ],unclassifiedBlocks:[]};
 await dialog.getByLabel("选择职业材料").setInputFiles({name:"h1-profile.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(material))});
 await expect(dialog.locator("article.review-row").first()).toBeVisible();
 await dialog.getByText("创建新人物", {exact:true}).click();
 await dialog.locator('input[name="new-profile-name"]').fill("H1合成人物");
 const accept=dialog.getByRole("button",{name:"采用此条",exact:true});
 while(await accept.count()) await accept.first().click();
 const retain=dialog.getByRole("button",{name:"核对并保留来源",exact:true});
 for(let index=0;index<40 && await retain.count();index++) await retain.first().click();
 await expect(dialog.locator('input[name="import-create-general-resume"]').first()).not.toBeChecked();
 await dialog.getByRole("button",{name:"确认导入",exact:true}).click();
 await expect(dialog).not.toBeVisible();
 expect(await readStore(page,"resumeBranches")).toHaveLength(0);
 const before=await readStore(page,"profiles");
 await installCoreWritingProvider(page);
 await page.goto("/ai-workspace");
 await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u,{timeout:90000});
 const send=async(text:string)=>{await page.getByLabel("描述你的求职任务").fill(text);await page.getByRole("button",{name:"发送消息",exact:true}).click();};
 const sessions=()=>readStore(page,"agentSessions");
 await send("分析这个岗位 JD：岗位：软件工程师；岗位职责：参与产品开发和测试；任职要求：本科及以上学历，熟悉 Python，具备项目开发与团队协作经验。");
 await expect.poll(async()=> (await sessions()).some(s=> (s.taskState as {workflowId?:string;completionStatus?:string})?.workflowId==="job_ingestion" && (s.taskState as {completionStatus?:string}).completionStatus==="completed"),{timeout:60000}).toBe(true);
 expect(await readStore(page,"jobDescriptions")).toHaveLength(0);
 await send("先保存该岗位，再进行岗位匹配分析");
 await expect.poll(async()=> (await readStore(page,"jobDescriptions")).length,{timeout:60000}).toBe(1);
 await expect(page.getByRole("button",{name:"发送消息",exact:true})).toBeEnabled({timeout:60000});
 await send("基于已确认的 Profile 创建一份通用简历，然后再做岗位匹配");
 await expect(page.getByRole("button",{name:"直接生成",exact:true}).last()).toBeVisible({timeout:60000});
 await page.reload();
 await page.getByRole("button",{name:"直接生成",exact:true}).last().click();
 await expect.poll(async()=> (await sessions()).some(s=> (s.taskState as {workflowId?:string;completionStatus?:string})?.workflowId==="analyze_job_fit" && (s.taskState as {completionStatus?:string}).completionStatus==="completed"),{timeout:60000}).toBe(true);
 await page.reload();
 const branches=await readStore(page,"resumeBranches");
 expect(branches).toHaveLength(1);expect(branches[0].branchPurpose).toBe("general");
 expect(await readStore(page,"jobDescriptions")).toHaveLength(1);
 expect(await readStore(page,"profiles")).toEqual(before);
 const final=await sessions();expect(JSON.stringify(final)).not.toMatch(/duplicate_invalid_call|jobId invalid_type|mode invalid/);
 await info.attach("h1-final",{body:JSON.stringify({branches,sessions:final}),contentType:"application/json"});
});
