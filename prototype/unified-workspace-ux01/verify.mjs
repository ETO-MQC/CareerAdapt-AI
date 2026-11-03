import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const out='docs/architecture/evidence/p522-ux01';fs.mkdirSync(out+'/screenshots',{recursive:true});
const result={status:'RUNNING',errors:[],externalRequests:[],checks:[],screenshots:[]};
const browser=await chromium.launch({headless:true});const page=await browser.newPage();
page.on('pageerror',e=>result.errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:5183'))result.externalRequests.push(r.url());});
try{
 await page.goto('http://127.0.0.1:5183');await page.getByRole('heading',{name:'梳理项目经历',exact:true}).waitFor();
 for(const size of [{width:1920,height:1080},{width:1440,height:900},{width:1024,height:768}]){
  await page.setViewportSize(size);
  for(const theme of ['light','dark']){
   if(await page.locator('.ux01').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:'切换明暗',exact:true}).click();
   for(const title of ['AI 工作台','首页','个人资料库','岗位中心','求职申请','简历工作室','资料导入','设置']){
    await page.getByRole('navigation',{name:'全局主菜单'}).getByRole('button',{name:title,exact:false}).click();
    const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,navs:document.querySelectorAll('nav').length,smallest:Math.min(...[...document.querySelectorAll('p,small,button')].filter(e=>e.getBoundingClientRect().width>0).map(e=>parseFloat(getComputedStyle(e).fontSize)))}));
    assert.equal(geometry.overflow,false,title+' overflow');assert.equal(geometry.navs,1);assert(geometry.smallest>=11);
    const file=`${size.width}-${theme}-${['AI 工作台','首页','个人资料库','岗位中心','求职申请','简历工作室','资料导入','设置'].indexOf(title)}.png`;
    await page.screenshot({path:out+'/screenshots/'+file});result.screenshots.push(file);result.checks.push({size,theme,page:title,geometry});
   }
  }
 }
 const nav=page.getByRole('navigation',{name:'全局主菜单'});
 await nav.getByRole('button',{name:'AI 工作台',exact:false}).click();await page.setViewportSize({width:1440,height:900});
 const sash=page.getByRole('separator');let before=Number(await sash.getAttribute('aria-valuenow'));await sash.focus();await page.keyboard.press('ArrowLeft');assert(Number(await sash.getAttribute('aria-valuenow'))>before);
 const b=await sash.boundingBox();before=Number(await sash.getAttribute('aria-valuenow'));await page.mouse.move(b.x+2,b.y+100);await page.mouse.down();await page.mouse.move(b.x-35,b.y+100,{steps:5});await page.mouse.up();assert(Number(await sash.getAttribute('aria-valuenow'))>before);
 const width=await sash.getAttribute('aria-valuenow');await page.getByRole('button',{name:'折叠产物',exact:true}).first().click();assert.equal(await sash.count(),0);await page.getByRole('button',{name:'恢复产物'}).click();assert.equal(await sash.getAttribute('aria-valuenow'),width);
 const scroll=await page.locator('.messages').evaluate(e=>e.scrollTop);await page.locator('.artifact-scroll').evaluate(e=>e.scrollTop=180);assert(await page.locator('.artifact-scroll').evaluate(e=>e.scrollTop)>0);assert.equal(await page.locator('.messages').evaluate(e=>e.scrollTop),scroll);
 await page.getByRole('combobox',{name:'产物任务'}).selectOption('岗位解析');await page.getByRole('button',{name:'模拟错误'}).click();await page.getByRole('alert').waitFor();assert(await page.locator('.composer').isVisible());await page.getByRole('button',{name:'重试示例'}).click();
 await nav.getByRole('button',{name:'个人资料库',exact:false}).click();await page.getByRole('button',{name:'项目经历',exact:true}).click();assert(await page.getByRole('textbox',{name:'名称合成详情',exact:true}).isVisible());
 for(const state of ['loading','empty','error','success'])await page.getByRole('combobox',{name:'资料状态'}).selectOption(state);
 await nav.getByRole('button',{name:'岗位中心',exact:false}).click();await page.getByRole('button',{name:'交互设计实习生',exact:false}).click();await page.getByRole('button',{name:'岗位要求',exact:true}).click();assert(await page.getByText('可用性测试',{exact:true}).isVisible());
 await nav.getByRole('button',{name:'求职申请',exact:false}).click();await page.getByRole('combobox',{name:'申请状态'}).selectOption('面试中');await page.getByRole('button',{name:'切换列表'}).click();await page.getByRole('button',{name:'申请材料',exact:true}).click();
 await nav.getByRole('button',{name:'简历工作室',exact:false}).click();await page.getByRole('button',{name:'教育经历',exact:false}).click();await page.getByRole('button',{name:'页面',exact:true}).click();assert(await page.getByRole('heading',{name:'页面检查器'}).isVisible());
 await page.getByRole('button',{name:'切换品牌强调色'}).click();await page.getByRole('button',{name:'折叠或展开导航'}).click();await page.getByRole('button',{name:'折叠或展开导航'}).click();
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.externalRequests,[]);result.status='PASS';result.interactions='navigation, keyboard/pointer resize, fold/restore preserving width, independent scroll, task switch, error isolation, profile categories/states, job selection/requirements, application list/status/materials, studio section/inspector, accent/nav toggles';
}catch(e){result.status='FAILED';result.failure=String(e.stack||e);await page.screenshot({path:out+'/screenshots/verification-failure.png'});process.exitCode=1;}
finally{await browser.close();fs.writeFileSync(out+'/prototype-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,screenshots:result.screenshots.length,failure:result.failure}));}
