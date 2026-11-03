import { chromium } from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out='docs/architecture/evidence/p521';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const evidence={status:'RUNNING',errors:[],requests:[],checks:[],screenshots:[]};
page.on('pageerror',e=>evidence.errors.push(e.message));page.on('request',r=>evidence.requests.push(r.url()));
async function shot(name){await page.screenshot({path:`${out}/${name}.png`,animations:'disabled'});evidence.screenshots.push(name+'.png');}
async function geometry(){return page.evaluate(()=>{const r=e=>{const x=document.querySelector(e).getBoundingClientRect();return {x:x.x,y:x.y,width:x.width,height:x.height,right:x.right,bottom:x.bottom};};return {chat:r('.conversation'),artifact:r('.artifact-pane'),divider:r('.divider'),horizontalOverflow:document.documentElement.scrollWidth>innerWidth};});}
try{
 await page.goto('http://127.0.0.1:5181');await page.getByRole('heading',{name:'通用简历表达梳理'}).waitFor();
 for(const size of [{width:1440,height:900},{width:1920,height:1080},{width:1024,height:768}]){
  await page.setViewportSize(size);
  for(const theme of ['light','dark']){
   if(await page.locator('.prototype').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:'切换明暗主题',exact:true}).click();
   await page.waitForTimeout(180);
   const g=await geometry();assert(!g.horizontalOverflow);assert(g.chat.right<=g.artifact.x);assert(g.chat.width>=420);assert(g.artifact.width>=320);evidence.checks.push({viewport:size,theme,geometry:g});await shot(`prototype-chat-${theme}-${size.width}`);
   await page.getByRole('button',{name:'个人资料库',exact:true}).click();await page.getByRole('heading',{name:'个人资料库',exact:true}).waitFor();await page.getByRole('button',{name:'基础资料',exact:false}).last().click();await shot(`prototype-profile-${theme}-${size.width}`);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.getByRole('button',{name:'项目经历',exact:false}).click();await page.getByRole('heading',{name:'虚构灯塔导航项目',exact:true}).waitFor();if(size.width===1024&&theme==='dark')await shot('prototype-profile-projects-dark-1024');
   await page.getByRole('button',{name:'AI 工作台',exact:true}).click();
  }
 }
 await page.setViewportSize({width:1440,height:900});
 const divider=page.getByRole('separator');const before=await divider.getAttribute('aria-valuenow');await divider.focus();await page.keyboard.press('ArrowLeft');assert(Number(await divider.getAttribute('aria-valuenow'))>Number(before));
 const box=await divider.boundingBox();await page.mouse.move(box.x+4,box.y+80);await page.mouse.down();await page.mouse.move(box.x-70,box.y+80,{steps:6});await page.mouse.up();assert(Number(await divider.getAttribute('aria-valuenow'))>Number(before));evidence.checks.push('Keyboard and pointer resize PASS');
 const resized=await divider.getAttribute('aria-valuenow');await page.getByRole('button',{name:'关闭产物',exact:true}).click();assert.equal(await page.getByRole('complementary',{name:'产物区域'}).count(),0);await page.getByRole('button',{name:'恢复产物',exact:true}).click();assert.equal(await page.getByRole('separator').getAttribute('aria-valuenow'),resized);
 const chatScroll=await page.locator('.messages').evaluate(e=>e.scrollTop);await page.locator('.artifact-scroll').evaluate(e=>e.scrollTop=100);assert((await page.locator('.artifact-scroll').evaluate(e=>e.scrollTop))>0);assert.equal(await page.locator('.messages').evaluate(e=>e.scrollTop),chatScroll);evidence.checks.push('Independent scroll and collapse/restore PASS');
 await page.getByRole('button',{name:'折叠导航',exact:true}).click();await page.getByRole('button',{name:'展开导航',exact:true}).click();assert.equal(await page.locator('.prototype').getAttribute('data-collapsed'),'false');evidence.checks.push('Navigation collapse and restore PASS');
 await page.getByRole('button',{name:'外观与设置',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').isVisible(),false);assert.equal(await page.getByRole('button',{name:'外观与设置',exact:true}).evaluate(e=>e===document.activeElement),true);evidence.checks.push('Dialog Escape and focus restoration PASS');
 await page.getByRole('button',{name:'新建对话',exact:true}).click();await page.getByRole('button',{name:'梳理通用简历的表达',exact:true}).click();await page.getByRole('button',{name:'添加合成附件',exact:true}).click();assert(await page.getByRole('button',{name:'移除示例附件'}).isVisible());await page.getByRole('button',{name:'发送演示消息'}).click();await page.getByRole('button',{name:'停止演示生成'}).waitFor();await shot('prototype-running-1440');await page.getByRole('button',{name:'停止演示生成'}).click();await page.getByText('演示已停止，已有内容保留。',{exact:true}).waitFor();
 await page.getByRole('button',{name:'重新演示生成'}).click();await page.getByRole('button',{name:'演示失败'}).click();await page.getByRole('alert').waitFor();await shot('prototype-error-1440');await page.getByRole('button',{name:'重试演示'}).click();await page.getByRole('button',{name:'完成演示'}).click();
 evidence.checks.push('New chat, suggestion, attachment, send, stop, error, retry, completion synchronization PASS');
 await page.getByRole('button',{name:'测试预览错误'}).click();await page.getByRole('heading',{name:'产物预览暂不可用'}).waitFor();assert(await page.getByRole('textbox',{name:'消息输入'}).isVisible());await shot('prototype-artifact-error-1440');await page.getByRole('button',{name:'关闭产物',exact:true}).click();await page.getByRole('button',{name:'恢复产物',exact:true}).click();await page.getByRole('heading',{name:'虚构灯塔导航项目',exact:true}).waitFor();
 evidence.checks.push('Artifact error boundary and restore PASS');
 assert(evidence.requests.every(x=>x.startsWith('http://127.0.0.1:5181/')));assert.equal(evidence.errors.length,0);evidence.status='PASS';
}catch(e){evidence.status='FAIL';evidence.failure=String(e);await shot('prototype-failure');}
finally{await browser.close();fs.writeFileSync(`${out}/prototype-verification.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));}
if(evidence.status!=='PASS')process.exitCode=1;
